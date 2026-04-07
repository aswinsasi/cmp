"use strict";
/**
 * CMP WebRTC Transport — Production
 * Uses WebRTC DataChannels for high-throughput, low-latency mesh data transfer.
 *
 * Architecture:
 *   - Discovery: Beacons exchanged via signaling channel (WebSocket or in-band CMP)
 *   - Connection: RTCPeerConnection with STUN/TURN for NAT traversal
 *   - Data Transfer: Reliable ordered DataChannel ("cmp-data")
 *   - Large Messages: Fragmented into DC_CHUNK_SIZE packets with sequence headers
 *   - Backpressure: Queue-and-drain with bufferedAmountLowThreshold
 *   - Resilience: ICE restart, peer reconnection with exponential backoff
 *   - Observability: RTCStatsReport collection (bandwidth, RTT, packet loss)
 *
 * Signaling (pluggable):
 *   - WebSocketSignaling: Lightweight relay server (for cross-network peers)
 *   - InBandSignaling: Uses existing CMP transport (LAN/BLE) → fully serverless
 *
 * Environments:
 *   - Browser: Uses native RTCPeerConnection / RTCDataChannel
 *   - Node.js: Requires `wrtc` or `@roamhq/wrtc` package
 *
 * Wire format:
 *   DataChannel messages: raw Uint8Array (CMP protocol frames)
 *   Fragments: [totalLen: 4B BE][offset: 4B BE][seqId: 4B BE][chunk]
 *
 * @module transport/webrtc-transport
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebRTCTransport = void 0;
// ── Constants ──
/** Max DataChannel message size (64KB — safe across all browsers) */
const DC_CHUNK_SIZE = 65536;
/** Magic byte prefixed to all fragment packets to distinguish from CMP frames */
const FRAG_MAGIC = 0xFF;
/** Fragment header: [magic: 1B][totalLen: 4B][offset: 4B][seqId: 4B] = 13 bytes */
const FRAG_HEADER_SIZE = 13;
/** Max usable payload per chunk after header */
const DC_PAYLOAD_PER_CHUNK = DC_CHUNK_SIZE - FRAG_HEADER_SIZE;
/** Max reassembly buffer age before discard (ms) */
const REASSEMBLY_TIMEOUT_MS = 30000;
/** ICE connection timeout (ms) */
const ICE_TIMEOUT_MS = 15000;
/** DataChannel open timeout (ms) */
const DC_OPEN_TIMEOUT_MS = 10000;
/** Beacon re-broadcast interval via signaling (ms) */
const BEACON_REBROADCAST_MS = 5000;
/** Peer stale timeout — no messages for this long → peer_lost (ms) */
const PEER_STALE_TIMEOUT_MS = 60000;
/** Default STUN servers */
const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];
/** DataChannel label for CMP protocol messages */
const CMP_DC_LABEL = 'cmp-data';
/** Backpressure: High-water mark — pause sending when bufferedAmount exceeds this */
const DC_HIGH_WATER_MARK = 1 * 1024 * 1024; // 1MB
/** Backpressure: Low-water mark — resume sending when bufferedAmount drops below this */
const DC_LOW_WATER_MARK = 256 * 1024; // 256KB
/** Max queued bytes per peer before rejecting new sends */
const DC_MAX_QUEUE_BYTES = 16 * 1024 * 1024; // 16MB
/** Max reconnection attempts before giving up on a peer */
const MAX_RECONNECT_ATTEMPTS = 5;
/** Base reconnection delay (ms) — doubles each attempt */
const RECONNECT_BASE_DELAY_MS = 1000;
/** Max reconnection delay cap (ms) */
const RECONNECT_MAX_DELAY_MS = 30000;
/** Stats collection interval (ms) */
const STATS_INTERVAL_MS = 10000;
/** ICE restart grace period — wait this long after 'disconnected' before restarting (ms) */
const ICE_RESTART_GRACE_MS = 3000;
// ── RTCPeerConnection polyfill detection ──
function getRTC() {
    if (typeof RTCPeerConnection !== 'undefined') {
        return { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate };
    }
    for (const pkg of ['@roamhq/wrtc', 'wrtc', 'werift']) {
        try {
            const wrtc = require(pkg);
            if (wrtc.RTCPeerConnection)
                return wrtc;
        }
        catch { }
    }
    return null;
}
class WebRTCTransport {
    name = 'webrtc';
    maxPayloadBytes = 16 * 1024 * 1024; // 16MB (fragmented over DC)
    estimatedBandwidthMbps = 250;
    running = false;
    signaling;
    config;
    rtc = null;
    /** Active ICE servers (may be refreshed by TURN credential rotation) */
    activeIceServers;
    /** Random 8-byte instance ID for self-identification */
    instanceId;
    instanceIdHex;
    /** Active peer connections: hex instance ID → PeerConnection */
    peers = new Map();
    /** Known peer IDs we've seen beacons from (for reconnection) */
    knownPeerIds = new Set();
    /** Incoming fragment reassembly buffers: "peerId:seqId" → ReassemblyBuffer */
    reassemblyBuffers = new Map();
    /** Monotonically increasing sequence ID for outgoing fragmented messages */
    nextSeqId = 0;
    /** Beacon state */
    beaconData = null;
    beaconTimer = null;
    /** Stale peer cleanup timer */
    staleCheckTimer = null;
    /** Stats collection timer */
    statsTimer = null;
    /** TURN credential refresh timer */
    iceRefreshTimer = null;
    /** Latest stats per peer */
    peerStats = new Map();
    /** Event handlers */
    handlers = new Map();
    /** Signal handler reference for cleanup */
    signalHandler = null;
    constructor(signaling, config = {}) {
        this.signaling = signaling;
        this.config = {
            iceServers: config.iceServers ?? DEFAULT_ICE_SERVERS,
            iceTimeoutMs: config.iceTimeoutMs ?? ICE_TIMEOUT_MS,
            dcOpenTimeoutMs: config.dcOpenTimeoutMs ?? DC_OPEN_TIMEOUT_MS,
            debug: config.debug ?? false,
            maxReconnectAttempts: config.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS,
            collectStats: config.collectStats ?? true,
            statsIntervalMs: config.statsIntervalMs ?? STATS_INTERVAL_MS,
            refreshIceServers: config.refreshIceServers,
            iceServerRefreshIntervalMs: config.iceServerRefreshIntervalMs ?? 3600000,
        };
        this.activeIceServers = [...this.config.iceServers];
        // Generate random instance ID
        this.instanceId = new Uint8Array(8);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(this.instanceId);
        }
        else {
            for (let i = 0; i < 8; i++) {
                this.instanceId[i] = Math.floor(Math.random() * 256);
            }
        }
        this.instanceIdHex = this.bytesToHex(this.instanceId);
    }
    // ═══════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════
    async start() {
        if (this.running)
            return;
        this.rtc = getRTC();
        if (!this.rtc) {
            throw new Error('WebRTC not available. In Node.js, install: npm install @roamhq/wrtc');
        }
        await this.signaling.start(this.instanceIdHex);
        this.signalHandler = (signal) => this.handleSignal(signal);
        this.signaling.onSignal(this.signalHandler);
        // Stale peer cleanup every 15s
        this.staleCheckTimer = setInterval(() => this.cleanupStalePeers(), 15000);
        // Stats collection
        if (this.config.collectStats) {
            this.statsTimer = setInterval(() => this.collectAllStats(), this.config.statsIntervalMs);
        }
        // TURN credential refresh
        if (this.config.refreshIceServers) {
            this.iceRefreshTimer = setInterval(() => this.refreshTurnCredentials(), this.config.iceServerRefreshIntervalMs);
        }
        this.running = true;
        this.log('Transport started', `id=${this.instanceIdHex.substring(0, 12)}`);
    }
    async stop() {
        this.running = false;
        await this.stopBeaconing();
        if (this.staleCheckTimer) {
            clearInterval(this.staleCheckTimer);
            this.staleCheckTimer = null;
        }
        if (this.statsTimer) {
            clearInterval(this.statsTimer);
            this.statsTimer = null;
        }
        if (this.iceRefreshTimer) {
            clearInterval(this.iceRefreshTimer);
            this.iceRefreshTimer = null;
        }
        // Close all peers (intentionally — no reconnect)
        for (const [id, peer] of this.peers) {
            peer.intentionalClose = true;
            if (peer.reconnectTimer) {
                clearTimeout(peer.reconnectTimer);
                peer.reconnectTimer = null;
            }
            if (peer.iceRestartTimer) {
                clearTimeout(peer.iceRestartTimer);
                peer.iceRestartTimer = null;
            }
            this.rejectSendQueue(peer, new Error('Transport stopping'));
            this.closePeer(id, peer);
        }
        this.peers.clear();
        this.knownPeerIds.clear();
        this.reassemblyBuffers.clear();
        this.peerStats.clear();
        if (this.signalHandler) {
            this.signaling.offSignal(this.signalHandler);
            this.signalHandler = null;
        }
        await this.signaling.stop();
        this.log('Transport stopped');
    }
    isRunning() {
        return this.running;
    }
    // ═══════════════════════════════════════
    // Discovery (via signaling channel)
    // ═══════════════════════════════════════
    async startBeaconing(beaconData, intervalMs) {
        this.beaconData = beaconData;
        this.broadcastBeacon();
        const effectiveInterval = Math.max(intervalMs, BEACON_REBROADCAST_MS);
        this.beaconTimer = setInterval(() => this.broadcastBeacon(), effectiveInterval);
    }
    async stopBeaconing() {
        if (this.beaconTimer) {
            clearInterval(this.beaconTimer);
            this.beaconTimer = null;
        }
        this.beaconData = null;
    }
    async startScanning() { }
    async stopScanning() { }
    // ═══════════════════════════════════════
    // Data Transfer (DataChannel)
    // ═══════════════════════════════════════
    async sendTo(peerAddress, data) {
        if (!this.running)
            throw new Error('Transport not running');
        if (data.length > this.maxPayloadBytes) {
            throw new Error(`Payload too large: ${data.length} > ${this.maxPayloadBytes}`);
        }
        const peerId = this.extractPeerId(peerAddress);
        let peer = this.peers.get(peerId);
        // If no connection exists, initiate one
        if (!peer || !peer.dcReady) {
            if (!peer) {
                peer = await this.createPeerConnection(peerId, true);
            }
            if (!peer.dcReady && peer.connectPromise) {
                await peer.connectPromise;
            }
            if (!peer.dcReady) {
                throw new Error(`DataChannel not ready for peer ${peerId.substring(0, 12)}`);
            }
        }
        peer.lastSeen = Date.now();
        // Send — fragment if needed
        if (data.length <= DC_CHUNK_SIZE) {
            await this.dcSend(peer, data);
        }
        else {
            const seqId = this.nextSeqId++;
            let offset = 0;
            while (offset < data.length) {
                const chunkLen = Math.min(DC_PAYLOAD_PER_CHUNK, data.length - offset);
                const fragment = new Uint8Array(FRAG_HEADER_SIZE + chunkLen);
                const view = new DataView(fragment.buffer);
                fragment[0] = FRAG_MAGIC; // Magic prefix
                view.setUint32(1, data.length, false); // totalLen
                view.setUint32(5, offset, false); // offset
                view.setUint32(9, seqId, false); // seqId
                fragment.set(data.slice(offset, offset + chunkLen), FRAG_HEADER_SIZE);
                await this.dcSend(peer, fragment);
                offset += chunkLen;
            }
        }
    }
    async broadcast(data) {
        if (!this.running)
            throw new Error('Transport not running');
        const promises = [];
        for (const [peerId, peer] of this.peers) {
            if (peer.dcReady) {
                promises.push(this.sendTo(`webrtc:${peerId}`, data).catch((err) => {
                    this.log('Broadcast send failed', peerId.substring(0, 12), err);
                }));
            }
        }
        await Promise.allSettled(promises);
    }
    // ═══════════════════════════════════════
    // Events
    // ═══════════════════════════════════════
    on(event, handler) {
        if (!this.handlers.has(event))
            this.handlers.set(event, new Set());
        this.handlers.get(event).add(handler);
    }
    off(event, handler) {
        const set = this.handlers.get(event);
        if (set) {
            set.delete(handler);
            if (set.size === 0)
                this.handlers.delete(event);
        }
    }
    emit(event) {
        for (const key of [event.type, 'all']) {
            const set = this.handlers.get(key);
            if (set) {
                for (const h of set) {
                    try {
                        h(event);
                    }
                    catch { }
                }
            }
        }
    }
    // ═══════════════════════════════════════
    // Signaling Handler
    // ═══════════════════════════════════════
    async handleSignal(signal) {
        if (!this.running)
            return;
        if (signal.from === this.instanceIdHex)
            return;
        switch (signal.type) {
            case 'beacon':
                this.handleBeaconSignal(signal);
                break;
            case 'offer':
                await this.handleOffer(signal);
                break;
            case 'answer':
                await this.handleAnswer(signal);
                break;
            case 'ice':
                await this.handleIceCandidate(signal);
                break;
        }
    }
    handleBeaconSignal(signal) {
        const beaconBytes = signal.payload?.beacon
            ? this.base64ToBytes(signal.payload.beacon)
            : new Uint8Array(0);
        this.knownPeerIds.add(signal.from);
        this.emit({
            type: 'peer_discovered',
            peerAddress: `webrtc:${signal.from}`,
            data: beaconBytes,
            transport: this.name,
            timestamp: Date.now(),
        });
        // Auto-connect: higher ID initiates (prevents simultaneous offers)
        // Only if we have NO existing peer entry at all (connected, in-progress, or failed)
        const existingPeer = this.peers.get(signal.from);
        if (existingPeer) {
            // Keep the peer alive — refresh lastSeen so stale cleanup doesn't remove it
            // while reconnection is in progress
            existingPeer.lastSeen = Date.now();
        }
        else if (this.instanceIdHex > signal.from) {
            this.createPeerConnection(signal.from, true).catch((err) => {
                this.log('Auto-connect failed for', signal.from.substring(0, 12), err);
            });
        }
    }
    async handleOffer(signal) {
        const peerId = signal.from;
        this.log('Received offer from', peerId.substring(0, 12));
        // Polite peer conflict resolution: lower ID yields
        let peer = this.peers.get(peerId);
        // Guard: if we already have a connection as responder, check state
        if (peer && !peer.isInitiator) {
            if (peer.dcReady) {
                this.log('Ignoring offer — already connected to', peerId.substring(0, 12));
                return;
            }
            if (peer.negotiating) {
                this.log('Ignoring offer — negotiation in progress with', peerId.substring(0, 12));
                return;
            }
            const state = peer.pc.signalingState;
            if (state === 'have-remote-offer' || state === 'have-local-pranswer') {
                this.log('Ignoring offer — signaling state:', state, 'for', peerId.substring(0, 12));
                return;
            }
            // Stable but not connected — previous attempt failed. Clean up and retry.
            this.log('Re-accepting offer from', peerId.substring(0, 12), '(previous attempt stale)');
            peer.intentionalClose = true;
            this.rejectSendQueue(peer, new Error('Re-accepting fresh offer'));
            this.closePeer(peerId, peer);
            this.peers.delete(peerId);
            peer = undefined;
        }
        if (peer && peer.isInitiator) {
            if (this.instanceIdHex < peerId) {
                peer.intentionalClose = true;
                this.rejectSendQueue(peer, new Error('Yielding to remote offer'));
                this.closePeer(peerId, peer);
                this.peers.delete(peerId);
                peer = undefined;
            }
            else {
                return; // They should yield
            }
        }
        if (!peer) {
            peer = await this.createPeerConnection(peerId, false);
        }
        peer.negotiating = true;
        try {
            const desc = new this.rtc.RTCSessionDescription(signal.payload);
            await peer.pc.setRemoteDescription(desc);
            for (const candidate of peer.pendingCandidates) {
                await peer.pc.addIceCandidate(candidate).catch(() => { });
            }
            peer.pendingCandidates = [];
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            await this.signaling.send({
                type: 'answer',
                from: this.instanceIdHex,
                to: peerId,
                payload: peer.pc.localDescription,
                timestamp: Date.now(),
            });
            this.log('Answer sent to', peerId.substring(0, 12));
        }
        catch (err) {
            this.log('Error handling offer', err);
            // Don't destroyPeer — keep the entry so the guard prevents
            // infinite retry loops from beacon-triggered offers.
            // Stale check timer will clean up after 60s.
        }
        finally {
            peer.negotiating = false;
        }
    }
    async handleAnswer(signal) {
        const peerId = signal.from;
        const peer = this.peers.get(peerId);
        if (!peer)
            return;
        this.log('Received answer from', peerId.substring(0, 12));
        // Guard: only accept answers when we're waiting for one
        const state = peer.pc.signalingState;
        if (state !== 'have-local-offer') {
            this.log('Ignoring stale answer — signalingState:', state, 'for', peerId.substring(0, 12));
            return;
        }
        // Guard: skip if already connected
        if (peer.dcReady) {
            this.log('Ignoring answer — already connected to', peerId.substring(0, 12));
            return;
        }
        try {
            const desc = new this.rtc.RTCSessionDescription(signal.payload);
            await peer.pc.setRemoteDescription(desc);
            for (const candidate of peer.pendingCandidates) {
                await peer.pc.addIceCandidate(candidate).catch(() => { });
            }
            peer.pendingCandidates = [];
            this.log('Remote description set for', peerId.substring(0, 12));
        }
        catch (err) {
            this.log('Error handling answer', err);
            // Don't destroyPeer — keep the entry to prevent infinite retry loops.
        }
    }
    async handleIceCandidate(signal) {
        const peerId = signal.from;
        const peer = this.peers.get(peerId);
        if (!peer)
            return;
        try {
            const candidate = new this.rtc.RTCIceCandidate(signal.payload);
            if (peer.pc.remoteDescription) {
                await peer.pc.addIceCandidate(candidate);
            }
            else {
                peer.pendingCandidates.push(candidate);
            }
        }
        catch (err) {
            this.log('Error adding ICE candidate', err);
        }
    }
    // ═══════════════════════════════════════
    // RTCPeerConnection Management
    // ═══════════════════════════════════════
    async createPeerConnection(peerId, isInitiator) {
        const existing = this.peers.get(peerId);
        if (existing && existing.dcReady)
            return existing;
        // If existing connection is stale, clean it up first
        if (existing) {
            existing.intentionalClose = true;
            this.rejectSendQueue(existing, new Error('Replacing stale connection'));
            this.closePeer(peerId, existing);
            this.peers.delete(peerId);
        }
        this.log(isInitiator ? 'Initiating connection to' : 'Accepting connection from', peerId.substring(0, 12));
        const pc = new this.rtc.RTCPeerConnection({
            iceServers: this.activeIceServers,
        });
        let connectResolve;
        let connectReject;
        const connectPromise = new Promise((resolve, reject) => {
            connectResolve = resolve;
            connectReject = reject;
        });
        // Prevent unhandled rejection when auto-connecting from beacons
        // (nobody awaits connectPromise in that path)
        connectPromise.catch(() => { });
        const peer = {
            instanceId: peerId,
            pc,
            dc: null,
            dcReady: false,
            isInitiator,
            lastSeen: Date.now(),
            pendingCandidates: [],
            connectPromise,
            connectResolve,
            connectReject,
            // Backpressure
            sendQueue: [],
            sendQueueBytes: 0,
            draining: false,
            // Reconnection
            reconnectAttempts: 0,
            reconnectTimer: null,
            intentionalClose: false,
            // ICE restart
            iceRestartTimer: null,
            iceRestartCount: 0,
            // Negotiation lock
            negotiating: false,
        };
        this.peers.set(peerId, peer);
        // ── ICE candidate trickle ──
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.signaling.send({
                    type: 'ice',
                    from: this.instanceIdHex,
                    to: peerId,
                    payload: event.candidate.toJSON(),
                    timestamp: Date.now(),
                }).catch(() => { });
            }
        };
        // ── Connection state monitoring with ICE restart ──
        pc.onconnectionstatechange = () => {
            this.log(`Connection state [${peerId.substring(0, 12)}]:`, pc.connectionState);
            if (pc.connectionState === 'connected') {
                peer.iceRestartCount = 0;
                peer.reconnectAttempts = 0;
            }
            if (pc.connectionState === 'failed') {
                this.handleConnectionFailure(peerId, peer);
            }
            else if (pc.connectionState === 'closed') {
                if (!peer.intentionalClose) {
                    this.scheduleReconnect(peerId, peer.reconnectAttempts);
                }
            }
        };
        pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState;
            this.log(`ICE state [${peerId.substring(0, 12)}]:`, state);
            if (state === 'disconnected') {
                // Grace period — ICE often recovers from 'disconnected'
                if (peer.iceRestartTimer)
                    clearTimeout(peer.iceRestartTimer);
                peer.iceRestartTimer = setTimeout(() => {
                    peer.iceRestartTimer = null;
                    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                        this.attemptIceRestart(peerId, peer);
                    }
                }, ICE_RESTART_GRACE_MS);
            }
            else if (state === 'failed') {
                if (peer.iceRestartTimer) {
                    clearTimeout(peer.iceRestartTimer);
                    peer.iceRestartTimer = null;
                }
                this.attemptIceRestart(peerId, peer);
            }
            else if (state === 'connected' || state === 'completed') {
                if (peer.iceRestartTimer) {
                    clearTimeout(peer.iceRestartTimer);
                    peer.iceRestartTimer = null;
                }
            }
        };
        // ── DataChannel handling ──
        if (isInitiator) {
            const dc = pc.createDataChannel(CMP_DC_LABEL, { ordered: true });
            dc.binaryType = 'arraybuffer';
            peer.dc = dc;
            this.setupDataChannel(peerId, peer, dc);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                await this.signaling.send({
                    type: 'offer',
                    from: this.instanceIdHex,
                    to: peerId,
                    payload: pc.localDescription,
                    timestamp: Date.now(),
                });
            }
            catch (err) {
                this.log('Error creating offer', err);
                this.destroyPeer(peerId);
                throw err;
            }
        }
        else {
            pc.ondatachannel = (event) => {
                const dc = event.channel;
                dc.binaryType = 'arraybuffer';
                peer.dc = dc;
                this.setupDataChannel(peerId, peer, dc);
            };
        }
        // ── Connection timeout ──
        setTimeout(() => {
            if (!peer.dcReady && this.peers.has(peerId)) {
                this.log('Connection timeout for', peerId.substring(0, 12));
                peer.connectReject?.(new Error('WebRTC connection timeout'));
                // Close the PC but keep the peer entry in the map.
                // This prevents the next beacon from immediately re-creating it.
                // The stale cleanup timer (60s) will eventually remove it,
                // and scheduleReconnect will try again with backoff.
                this.closePeer(peerId, peer);
                peer.dc = null;
                peer.dcReady = false;
                peer.lastSeen = Date.now(); // Reset stale timer
                // Schedule a proper reconnect with backoff
                this.scheduleReconnect(peerId, peer.reconnectAttempts);
            }
        }, this.config.iceTimeoutMs + this.config.dcOpenTimeoutMs);
        return peer;
    }
    setupDataChannel(peerId, peer, dc) {
        // Set backpressure threshold
        try {
            dc.bufferedAmountLowThreshold = DC_LOW_WATER_MARK;
        }
        catch {
            // Not supported in all implementations — fallback to polling in drainSendQueue
        }
        dc.onopen = () => {
            this.log('DataChannel open with', peerId.substring(0, 12));
            peer.dcReady = true;
            peer.lastSeen = Date.now();
            peer.reconnectAttempts = 0;
            peer.connectResolve?.();
            this.emit({
                type: 'peer_discovered',
                peerAddress: `webrtc:${peerId}`,
                transport: this.name,
                timestamp: Date.now(),
            });
            // Drain any queued messages
            this.drainSendQueue(peer);
        };
        dc.onclose = () => {
            this.log('DataChannel closed with', peerId.substring(0, 12));
            const wasReady = peer.dcReady;
            peer.dcReady = false;
            this.rejectSendQueue(peer, new Error('DataChannel closed'));
            if (!peer.intentionalClose && wasReady) {
                this.scheduleReconnect(peerId, peer.reconnectAttempts);
            }
            this.destroyPeer(peerId);
        };
        dc.onerror = (event) => {
            this.log('DataChannel error with', peerId.substring(0, 12), event);
            this.emit({
                type: 'error',
                peerAddress: `webrtc:${peerId}`,
                data: new TextEncoder().encode(`DataChannel error: ${peerId}`),
                transport: this.name,
                timestamp: Date.now(),
            });
        };
        // ── Backpressure: bufferedamountlow event → drain queue ──
        dc.onbufferedamountlow = () => {
            this.drainSendQueue(peer);
        };
        dc.onmessage = (event) => {
            peer.lastSeen = Date.now();
            let bytes;
            if (event.data instanceof ArrayBuffer) {
                bytes = new Uint8Array(event.data);
            }
            else if (event.data instanceof Uint8Array) {
                bytes = event.data;
            }
            else {
                bytes = new TextEncoder().encode(event.data);
            }
            this.handleIncomingData(peerId, bytes);
        };
    }
    // ═══════════════════════════════════════
    // Backpressure — Queue & Drain
    // ═══════════════════════════════════════
    /**
     * Send data via DataChannel with backpressure support.
     * If the channel's buffer is above the high-water mark, the message
     * is queued and the returned promise resolves when it's actually sent.
     */
    dcSend(peer, data) {
        if (!peer.dc || peer.dc.readyState !== 'open') {
            return Promise.reject(new Error('DataChannel not open'));
        }
        // Convert to ArrayBuffer
        const buf = new ArrayBuffer(data.byteLength);
        new Uint8Array(buf).set(data);
        // If under high-water mark, send immediately
        if (peer.dc.bufferedAmount < DC_HIGH_WATER_MARK) {
            try {
                peer.dc.send(buf);
                return Promise.resolve();
            }
            catch (err) {
                return Promise.reject(err);
            }
        }
        // Above high-water mark → queue the message
        if (peer.sendQueueBytes + buf.byteLength > DC_MAX_QUEUE_BYTES) {
            return Promise.reject(new Error(`Send queue full (${(peer.sendQueueBytes / 1024 / 1024).toFixed(1)}MB queued)`));
        }
        return new Promise((resolve, reject) => {
            peer.sendQueue.push({ data: buf, resolve, reject });
            peer.sendQueueBytes += buf.byteLength;
            this.log(`Queued ${buf.byteLength}B for ${peer.instanceId.substring(0, 12)} (${peer.sendQueue.length} pending)`);
        });
    }
    /**
     * Drain the send queue when bufferedAmount drops below the low-water mark.
     * Called from the `onbufferedamountlow` event or after DC opens.
     */
    drainSendQueue(peer) {
        if (peer.draining || !peer.dc || peer.dc.readyState !== 'open')
            return;
        peer.draining = true;
        try {
            while (peer.sendQueue.length > 0) {
                if (peer.dc.bufferedAmount >= DC_HIGH_WATER_MARK) {
                    break; // Wait for next bufferedamountlow event
                }
                const item = peer.sendQueue.shift();
                peer.sendQueueBytes -= item.data.byteLength;
                try {
                    peer.dc.send(item.data);
                    item.resolve();
                }
                catch (err) {
                    item.reject(err instanceof Error ? err : new Error(String(err)));
                }
            }
        }
        finally {
            peer.draining = false;
        }
    }
    /**
     * Reject all queued sends (called on DC close or transport stop).
     */
    rejectSendQueue(peer, error) {
        for (const item of peer.sendQueue) {
            item.reject(error);
        }
        peer.sendQueue = [];
        peer.sendQueueBytes = 0;
    }
    // ═══════════════════════════════════════
    // ICE Restart
    // ═══════════════════════════════════════
    /**
     * Attempt ICE restart to recover from transient network changes
     * (e.g. Wi-Fi ↔ mobile switch, brief disconnection).
     * Only the initiator side triggers the restart; the responder
     * handles the new offer automatically via handleOffer().
     */
    async attemptIceRestart(peerId, peer) {
        if (!this.running)
            return;
        if (!peer.isInitiator)
            return; // Only initiator triggers restart
        // Cap at 3 ICE restarts before falling back to full reconnection
        if (peer.iceRestartCount >= 3) {
            this.log('ICE restart limit reached, full reconnect for', peerId.substring(0, 12));
            this.handleConnectionFailure(peerId, peer);
            return;
        }
        peer.iceRestartCount++;
        this.log(`ICE restart #${peer.iceRestartCount} for`, peerId.substring(0, 12));
        try {
            const offer = await peer.pc.createOffer({ iceRestart: true });
            await peer.pc.setLocalDescription(offer);
            await this.signaling.send({
                type: 'offer',
                from: this.instanceIdHex,
                to: peerId,
                payload: peer.pc.localDescription,
                timestamp: Date.now(),
            });
        }
        catch (err) {
            this.log('ICE restart failed', err);
            this.handleConnectionFailure(peerId, peer);
        }
    }
    // ═══════════════════════════════════════
    // Peer Reconnection (Exponential Backoff)
    // ═══════════════════════════════════════
    /**
     * Handle a connection failure — destroy the peer and schedule reconnect.
     */
    handleConnectionFailure(peerId, peer) {
        if (peer.intentionalClose)
            return;
        const attempts = peer.reconnectAttempts;
        this.destroyPeer(peerId);
        this.scheduleReconnect(peerId, attempts);
    }
    /**
     * Schedule a reconnection attempt with exponential backoff + jitter.
     * Only reconnects to peers we've seen beacons from.
     */
    scheduleReconnect(peerId, previousAttempts) {
        if (!this.running)
            return;
        if (!this.knownPeerIds.has(peerId))
            return;
        // Don't double-schedule
        const existing = this.peers.get(peerId);
        if (existing?.reconnectTimer)
            return;
        const attempts = previousAttempts + 1;
        if (attempts > this.config.maxReconnectAttempts) {
            this.log(`Max reconnect attempts (${this.config.maxReconnectAttempts}) reached for`, peerId.substring(0, 12));
            this.knownPeerIds.delete(peerId);
            return;
        }
        // Exponential backoff with 0-30% jitter
        const baseDelay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempts - 1), RECONNECT_MAX_DELAY_MS);
        const jitter = Math.random() * baseDelay * 0.3;
        const delay = baseDelay + jitter;
        this.log(`Reconnecting to ${peerId.substring(0, 12)} in ${Math.round(delay)}ms (attempt ${attempts}/${this.config.maxReconnectAttempts})`);
        const timer = setTimeout(async () => {
            if (!this.running)
                return;
            try {
                const peer = await this.createPeerConnection(peerId, true);
                peer.reconnectAttempts = attempts;
            }
            catch (err) {
                this.log('Reconnection failed', peerId.substring(0, 12), err);
            }
        }, delay);
        // Store timer so it can be cancelled on stop()
        if (existing) {
            existing.reconnectTimer = timer;
        }
    }
    // ═══════════════════════════════════════
    // Incoming Data — Reassembly
    // ═══════════════════════════════════════
    handleIncomingData(peerId, data) {
        if (!this.running)
            return;
        // Fragments are prefixed with FRAG_MAGIC (0xFF).
        // CMP protocol messages start with 0x43 ("C"), so there's no collision.
        if (data.length >= FRAG_HEADER_SIZE && data[0] === FRAG_MAGIC) {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const totalLen = view.getUint32(1, false);
            const offset = view.getUint32(5, false);
            const seqId = view.getUint32(9, false);
            if (totalLen > DC_CHUNK_SIZE && offset < totalLen) {
                this.handleFragment(peerId, totalLen, offset, seqId, data.slice(FRAG_HEADER_SIZE));
                return;
            }
        }
        // Complete message — emit directly
        this.emit({
            type: 'message',
            peerAddress: `webrtc:${peerId}`,
            data,
            transport: this.name,
            timestamp: Date.now(),
        });
    }
    handleFragment(peerId, totalLen, offset, seqId, chunk) {
        const key = `${peerId}:${seqId}`;
        let buf = this.reassemblyBuffers.get(key);
        if (!buf) {
            buf = { totalLen, chunks: new Map(), receivedBytes: 0, startTime: Date.now(), seqId };
            this.reassemblyBuffers.set(key, buf);
        }
        if (!buf.chunks.has(offset)) {
            buf.chunks.set(offset, chunk);
            buf.receivedBytes += chunk.length;
        }
        if (buf.receivedBytes >= totalLen) {
            const assembled = new Uint8Array(totalLen);
            const sortedOffsets = [...buf.chunks.keys()].sort((a, b) => a - b);
            for (const off of sortedOffsets) {
                assembled.set(buf.chunks.get(off), off);
            }
            this.reassemblyBuffers.delete(key);
            this.emit({
                type: 'message',
                peerAddress: `webrtc:${peerId}`,
                data: assembled,
                transport: this.name,
                timestamp: Date.now(),
            });
        }
        // Cleanup old buffers
        const now = Date.now();
        for (const [k, b] of this.reassemblyBuffers) {
            if (now - b.startTime > REASSEMBLY_TIMEOUT_MS) {
                this.reassemblyBuffers.delete(k);
            }
        }
    }
    // ═══════════════════════════════════════
    // Beacon Broadcasting
    // ═══════════════════════════════════════
    broadcastBeacon() {
        if (!this.signaling.isReady() || !this.beaconData)
            return;
        this.signaling.send({
            type: 'beacon',
            from: this.instanceIdHex,
            payload: { beacon: this.bytesToBase64(this.beaconData) },
            timestamp: Date.now(),
        }).catch(() => { });
    }
    // ═══════════════════════════════════════
    // RTCStats Collection
    // ═══════════════════════════════════════
    /**
     * Collect RTCStats from all active peer connections.
     * Extracts: RTT, bytes/packets sent/received, packet loss, candidate types.
     */
    async collectAllStats() {
        if (!this.running)
            return;
        for (const [peerId, peer] of this.peers) {
            if (!peer.dcReady)
                continue;
            try {
                const report = await peer.pc.getStats();
                const stats = this.parseStatsReport(peerId, peer, report);
                this.peerStats.set(peerId, stats);
            }
            catch {
                // Stats collection is best-effort — never crash
            }
        }
    }
    parseStatsReport(peerId, peer, report) {
        const stats = {
            peerId,
            connected: peer.dcReady,
            roundTripTimeMs: null,
            bytesSent: 0,
            bytesReceived: 0,
            packetsSent: 0,
            packetsReceived: 0,
            packetsLost: 0,
            localCandidateType: null,
            remoteCandidateType: null,
            sendQueueBytes: peer.sendQueueBytes,
            reconnectAttempts: peer.reconnectAttempts,
            iceRestartCount: peer.iceRestartCount,
            timestamp: Date.now(),
        };
        report.forEach((entry) => {
            // Candidate pair stats (RTT, bytes)
            if (entry.type === 'candidate-pair' && entry.state === 'succeeded') {
                if (entry.currentRoundTripTime != null) {
                    stats.roundTripTimeMs = entry.currentRoundTripTime * 1000;
                }
                if (entry.bytesSent != null)
                    stats.bytesSent = entry.bytesSent;
                if (entry.bytesReceived != null)
                    stats.bytesReceived = entry.bytesReceived;
                if (entry.packetsSent != null)
                    stats.packetsSent = entry.packetsSent;
                if (entry.packetsReceived != null)
                    stats.packetsReceived = entry.packetsReceived;
                // Resolve candidate types from the report
                report.forEach((c) => {
                    if (c.id === entry.localCandidateId && c.type === 'local-candidate') {
                        stats.localCandidateType = c.candidateType || null;
                    }
                    if (c.id === entry.remoteCandidateId && c.type === 'remote-candidate') {
                        stats.remoteCandidateType = c.candidateType || null;
                    }
                });
            }
            // Inbound RTP stats (packet loss)
            if (entry.type === 'inbound-rtp' && entry.packetsLost != null) {
                stats.packetsLost += entry.packetsLost;
            }
        });
        return stats;
    }
    // ═══════════════════════════════════════
    // TURN Credential Refresh
    // ═══════════════════════════════════════
    /**
     * Refresh TURN server credentials via the configured callback.
     * Updates activeIceServers and reconfigures all existing peer connections
     * using setConfiguration() where supported.
     */
    async refreshTurnCredentials() {
        if (!this.config.refreshIceServers)
            return;
        try {
            const freshServers = await this.config.refreshIceServers();
            this.activeIceServers = freshServers;
            this.log('TURN credentials refreshed', `${freshServers.length} servers`);
            // Hot-update existing connections
            for (const [peerId, peer] of this.peers) {
                try {
                    if (typeof peer.pc.setConfiguration === 'function') {
                        peer.pc.setConfiguration({ iceServers: freshServers });
                    }
                }
                catch {
                    this.log('setConfiguration not supported for', peerId.substring(0, 12));
                }
            }
        }
        catch (err) {
            this.log('TURN credential refresh failed', err);
        }
    }
    // ═══════════════════════════════════════
    // Peer Cleanup
    // ═══════════════════════════════════════
    closePeer(peerId, peer) {
        try {
            if (peer.iceRestartTimer) {
                clearTimeout(peer.iceRestartTimer);
                peer.iceRestartTimer = null;
            }
            if (peer.reconnectTimer) {
                clearTimeout(peer.reconnectTimer);
                peer.reconnectTimer = null;
            }
            if (peer.dc) {
                peer.dc.onopen = null;
                peer.dc.onclose = null;
                peer.dc.onerror = null;
                peer.dc.onmessage = null;
                peer.dc.onbufferedamountlow = null;
                try {
                    peer.dc.close();
                }
                catch { }
            }
            peer.pc.onicecandidate = null;
            peer.pc.onconnectionstatechange = null;
            peer.pc.oniceconnectionstatechange = null;
            peer.pc.ondatachannel = null;
            try {
                peer.pc.close();
            }
            catch { }
        }
        catch { }
    }
    destroyPeer(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer)
            return;
        this.rejectSendQueue(peer, new Error('Peer connection destroyed'));
        this.closePeer(peerId, peer);
        this.peers.delete(peerId);
        for (const key of this.reassemblyBuffers.keys()) {
            if (key.startsWith(peerId + ':')) {
                this.reassemblyBuffers.delete(key);
            }
        }
        this.peerStats.delete(peerId);
        this.emit({
            type: 'peer_lost',
            peerAddress: `webrtc:${peerId}`,
            transport: this.name,
            timestamp: Date.now(),
        });
    }
    cleanupStalePeers() {
        const now = Date.now();
        for (const [peerId, peer] of this.peers) {
            if (now - peer.lastSeen > PEER_STALE_TIMEOUT_MS) {
                this.log('Stale peer timeout', peerId.substring(0, 12));
                peer.intentionalClose = true;
                this.destroyPeer(peerId);
            }
        }
    }
    // ═══════════════════════════════════════
    // Public Accessors
    // ═══════════════════════════════════════
    /** Number of peers with an open DataChannel */
    get connectedPeerCount() {
        let count = 0;
        for (const peer of this.peers.values()) {
            if (peer.dcReady)
                count++;
        }
        return count;
    }
    /** Get addresses of all connected peers */
    getConnectedPeers() {
        const result = [];
        for (const [id, peer] of this.peers) {
            if (peer.dcReady)
                result.push(`webrtc:${id}`);
        }
        return result;
    }
    /** Get our instance ID */
    getInstanceId() {
        return this.instanceIdHex;
    }
    /** Manually trigger a connection to a known peer ID */
    async connectToPeer(peerId) {
        const cleanId = this.extractPeerId(peerId);
        const peer = await this.createPeerConnection(cleanId, true);
        if (peer.connectPromise) {
            await peer.connectPromise;
        }
    }
    /**
     * Get stats for a specific peer or all peers.
     * Returns the latest collected stats snapshot.
     */
    getStats(peerId) {
        if (peerId) {
            const cleanId = this.extractPeerId(peerId);
            return this.peerStats.get(cleanId) ?? null;
        }
        return [...this.peerStats.values()];
    }
    /**
     * Force stats collection now (async).
     * Returns fresh stats for all connected peers.
     */
    async collectStatsNow() {
        await this.collectAllStats();
        return [...this.peerStats.values()];
    }
    /** Get the active ICE server configuration */
    getActiveIceServers() {
        return [...this.activeIceServers];
    }
    // ═══════════════════════════════════════
    // Utilities
    // ═══════════════════════════════════════
    extractPeerId(address) {
        return address.startsWith('webrtc:') ? address.slice(7) : address;
    }
    bytesToHex(bytes) {
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    bytesToBase64(bytes) {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bytes).toString('base64');
        }
        let binary = '';
        for (let i = 0; i < bytes.length; i++)
            binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }
    base64ToBytes(b64) {
        if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(b64, 'base64'));
        }
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    log(...args) {
        if (this.config.debug) {
            console.log('[WebRTC]', ...args);
        }
    }
}
exports.WebRTCTransport = WebRTCTransport;
//# sourceMappingURL=webrtc-transport.js.map