"use strict";
/**
 * CMP v1.5 — Credit-Based Flow Control
 *
 * Prevents a fast sender from overwhelming a slow receiver.
 * Each peer is given N message credits. Sending a message costs 1 credit.
 * When credits reach 0, sends are queued. The receiver sends REPLENISH
 * messages to restore credits after processing.
 *
 * Flow Control Protocol:
 *   - On peer discovery: grant INITIAL_CREDITS (default 32) credits
 *   - On sendTo: if peer has credits → send immediately, deduct 1 credit
 *                if peer has 0 credits → queue the message
 *   - On receiving REPLENISH: add credits, flush queued messages
 *   - Auto-replenish: receiver sends REPLENISH after processing N messages
 *
 * Credit Replenish Message Format:
 *   First byte: 0xFF (flow control marker)
 *   Bytes 1-4:  uint32 big-endian — credits to replenish
 *
 * This wraps any ITransport and sits between AuthenticatedTransport
 * and the raw transport (or can wrap AuthenticatedTransport itself).
 *
 * @module auth/flow-control
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowControlledTransport = void 0;
/** Flow control message marker byte */
const FC_MARKER = 0xFF;
/** Flow control message size: 1 marker + 4 credits */
const FC_MESSAGE_SIZE = 5;
/** Default credits per peer */
const DEFAULT_INITIAL_CREDITS = 32;
/** Credits to replenish when sending a REPLENISH message */
const DEFAULT_REPLENISH_AMOUNT = 16;
/** Process this many messages before sending REPLENISH */
const DEFAULT_REPLENISH_THRESHOLD = 16;
const DEFAULT_CONFIG = {
    initialCredits: DEFAULT_INITIAL_CREDITS,
    replenishAmount: DEFAULT_REPLENISH_AMOUNT,
    replenishThreshold: DEFAULT_REPLENISH_THRESHOLD,
    maxQueuePerPeer: 256,
};
// ─── Flow-Controlled Transport ───
class FlowControlledTransport {
    name;
    maxPayloadBytes;
    estimatedBandwidthMbps;
    inner;
    config;
    peers = new Map();
    handlers = new Map();
    replenishSent = 0;
    replenishReceived = 0;
    constructor(inner, config) {
        this.inner = inner;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.name = `fc(${inner.name})`;
        this.maxPayloadBytes = inner.maxPayloadBytes;
        this.estimatedBandwidthMbps = inner.estimatedBandwidthMbps;
        // Subscribe to inner transport events
        this.inner.on('message', (event) => this.handleIncomingMessage(event));
        this.inner.on('peer_discovered', (event) => {
            this.ensurePeerState(event.peerAddress || 'unknown');
            this.emit(event);
        });
        this.inner.on('peer_lost', (event) => {
            if (event.peerAddress)
                this.peers.delete(event.peerAddress);
            this.emit(event);
        });
        this.inner.on('error', (event) => this.emit(event));
    }
    // ── Lifecycle ──
    async start() {
        return this.inner.start();
    }
    async stop() {
        return this.inner.stop();
    }
    isRunning() {
        return this.inner.isRunning();
    }
    // ── Discovery (pass-through) ──
    async startBeaconing(beaconData, intervalMs) {
        return this.inner.startBeaconing(beaconData, intervalMs);
    }
    async stopBeaconing() {
        return this.inner.stopBeaconing();
    }
    async startScanning() {
        return this.inner.startScanning();
    }
    async stopScanning() {
        return this.inner.stopScanning();
    }
    // ── Data Transfer (flow-controlled) ──
    async sendTo(peerAddress, data) {
        const state = this.ensurePeerState(peerAddress);
        if (state.sendCredits > 0) {
            // Have credits — send immediately
            state.sendCredits--;
            state.totalSent++;
            return this.inner.sendTo(peerAddress, data);
        }
        // No credits — queue
        if (state.sendQueue.length >= this.config.maxQueuePerPeer) {
            // Queue overflow — drop oldest
            state.sendQueue.shift();
            state.totalDropped++;
        }
        state.sendQueue.push(data);
        state.totalQueued++;
    }
    async broadcast(data) {
        // Broadcast bypasses flow control (beacons, announcements)
        // Individual peers will send REPLENISH as needed
        return this.inner.broadcast(data);
    }
    // ── Events ──
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
    // ── Public Accessors ──
    /** Get flow control stats */
    getStats() {
        let totalSent = 0, totalReceived = 0, totalQueued = 0, totalDropped = 0;
        for (const [, state] of this.peers) {
            totalSent += state.totalSent;
            totalReceived += state.totalReceived;
            totalQueued += state.sendQueue.length;
            totalDropped += state.totalDropped;
        }
        return {
            trackedPeers: this.peers.size,
            totalSent,
            totalReceived,
            totalQueued,
            totalDropped,
            replenishSent: this.replenishSent,
            replenishReceived: this.replenishReceived,
        };
    }
    /** Get credits remaining for a specific peer */
    getPeerCredits(peerAddress) {
        const state = this.peers.get(peerAddress);
        return state ? state.sendCredits : 0;
    }
    /** Get queued message count for a specific peer */
    getPeerQueueSize(peerAddress) {
        const state = this.peers.get(peerAddress);
        return state ? state.sendQueue.length : 0;
    }
    /** Manually grant credits to a peer (for testing or manual flow) */
    grantCredits(peerAddress, credits) {
        const state = this.ensurePeerState(peerAddress);
        state.sendCredits += credits;
        this.flushQueue(peerAddress, state);
    }
    /** Get the inner transport */
    getInnerTransport() {
        return this.inner;
    }
    // ── Internals ──
    ensurePeerState(address) {
        let state = this.peers.get(address);
        if (!state) {
            state = {
                sendCredits: this.config.initialCredits,
                receivedSinceReplenish: 0,
                sendQueue: [],
                totalSent: 0,
                totalReceived: 0,
                totalQueued: 0,
                totalDropped: 0,
            };
            this.peers.set(address, state);
        }
        return state;
    }
    handleIncomingMessage(event) {
        if (!event.data || event.data.length === 0)
            return;
        // Check if this is a flow control message
        if (event.data.length === FC_MESSAGE_SIZE && event.data[0] === FC_MARKER) {
            this.handleReplenish(event);
            return;
        }
        // Regular message — count and maybe send REPLENISH
        const address = event.peerAddress || 'unknown';
        const state = this.ensurePeerState(address);
        state.totalReceived++;
        state.receivedSinceReplenish++;
        // Auto-replenish: after processing N messages, tell sender they have more credits
        if (state.receivedSinceReplenish >= this.config.replenishThreshold) {
            this.sendReplenish(address, this.config.replenishAmount);
            state.receivedSinceReplenish = 0;
        }
        // Forward to caller
        this.emit(event);
    }
    handleReplenish(event) {
        if (!event.data || event.data.length < FC_MESSAGE_SIZE)
            return;
        const view = new DataView(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        const credits = view.getUint32(1, false);
        const address = event.peerAddress || 'unknown';
        const state = this.ensurePeerState(address);
        state.sendCredits += credits;
        this.replenishReceived++;
        // Flush queued messages now that we have credits
        this.flushQueue(address, state);
    }
    async sendReplenish(peerAddress, credits) {
        const msg = new Uint8Array(FC_MESSAGE_SIZE);
        msg[0] = FC_MARKER;
        const view = new DataView(msg.buffer);
        view.setUint32(1, credits, false);
        try {
            // Send directly on inner transport — replenish messages bypass flow control
            await this.inner.sendTo(peerAddress, msg);
            this.replenishSent++;
        }
        catch {
            // Failed to send replenish — peer may be disconnected
        }
    }
    async flushQueue(address, state) {
        while (state.sendCredits > 0 && state.sendQueue.length > 0) {
            const msg = state.sendQueue.shift();
            state.sendCredits--;
            state.totalSent++;
            try {
                await this.inner.sendTo(address, msg);
            }
            catch {
                // Send failed — don't re-queue, it's already counted as sent
            }
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
}
exports.FlowControlledTransport = FlowControlledTransport;
//# sourceMappingURL=flow-control.js.map