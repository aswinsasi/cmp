"use strict";
/**
 * CMP WebRTC Signaling Abstractions
 * Provides pluggable signaling strategies for WebRTC peer connection setup.
 *
 * Two modes:
 *   1. WebSocket Signaling — Lightweight relay server for NAT traversal
 *   2. In-Band CMP Signaling — Uses an existing CMP transport (LAN/BLE)
 *      as the signaling channel → fully serverless WebRTC
 *
 * Signal wire format (JSON over the chosen channel):
 *   { type: "offer"|"answer"|"ice"|"beacon", from: string, to?: string, payload: any }
 *
 * @module transport/webrtc-signaling
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InBandSignaling = exports.WebSocketSignaling = void 0;
// ═══════════════════════════════════════
// Strategy 1: WebSocket Signaling Server
// ═══════════════════════════════════════
/**
 * Connects to a lightweight WebSocket signaling server for
 * exchanging SDP offers/answers and ICE candidates.
 *
 * The signaling server is a dumb relay — it forwards messages
 * between peers based on the `to` field. No state is stored.
 *
 * Works in both browser (native WebSocket) and Node.js (ws package).
 */
class WebSocketSignaling {
    serverUrl;
    options;
    ws = null; // WebSocket instance
    localId = '';
    handlers = new Set();
    ready = false;
    reconnectTimer = null;
    reconnectAttempts = 0;
    maxReconnectAttempts = 5;
    constructor(serverUrl, options = {}) {
        this.serverUrl = serverUrl;
        this.options = options;
    }
    async start(localId) {
        this.localId = localId;
        await this.connect();
    }
    async stop() {
        this.ready = false;
        this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.close();
            }
            catch { }
            this.ws = null;
        }
    }
    async send(signal) {
        if (!this.ws || !this.ready) {
            throw new Error('WebSocket signaling not connected');
        }
        const raw = JSON.stringify({ ...signal, from: this.localId });
        this.ws.send(raw);
    }
    onSignal(handler) {
        this.handlers.add(handler);
    }
    offSignal(handler) {
        this.handlers.delete(handler);
    }
    isReady() {
        return this.ready;
    }
    // ── Internals ──
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                // Works in browser (global WebSocket) and Node.js (ws package)
                const WS = typeof WebSocket !== 'undefined'
                    ? WebSocket
                    : (() => { try {
                        return require('ws');
                    }
                    catch {
                        return null;
                    } })();
                if (!WS) {
                    reject(new Error('No WebSocket implementation available. Install "ws" for Node.js.'));
                    return;
                }
                const url = `${this.serverUrl}?id=${this.localId}`;
                this.ws = new WS(url);
                this.ws.onopen = () => {
                    this.ready = true;
                    this.reconnectAttempts = 0;
                    resolve();
                };
                this.ws.onmessage = (event) => {
                    try {
                        const raw = typeof event.data === 'string' ? event.data : event.data.toString();
                        const signal = JSON.parse(raw);
                        // Ignore our own messages
                        if (signal.from === this.localId)
                            return;
                        // Dispatch to handlers
                        for (const handler of this.handlers) {
                            try {
                                handler(signal);
                            }
                            catch { }
                        }
                    }
                    catch { }
                };
                this.ws.onclose = () => {
                    this.ready = false;
                    this.maybeReconnect();
                };
                this.ws.onerror = (err) => {
                    if (!this.ready)
                        reject(err);
                    this.ready = false;
                };
            }
            catch (err) {
                reject(err);
            }
        });
    }
    maybeReconnect() {
        if (!this.options.reconnect)
            return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts)
            return;
        const interval = this.options.reconnectIntervalMs ?? 3000;
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectAttempts++;
            try {
                await this.connect();
            }
            catch { }
        }, interval * (this.reconnectAttempts + 1)); // Linear backoff
    }
}
exports.WebSocketSignaling = WebSocketSignaling;
// ═══════════════════════════════════════
// Strategy 2: In-Band CMP Transport Relay
// ═══════════════════════════════════════
/**
 * Uses an existing CMP transport (e.g. LAN, BLE) as the signaling
 * channel for WebRTC. Signals are serialized as JSON and sent/received
 * as regular CMP messages with a distinguishing prefix byte.
 *
 * This enables fully serverless WebRTC — peers discover each other
 * over LAN/BLE, exchange SDP/ICE via the existing transport, and then
 * upgrade to a WebRTC DataChannel for higher performance.
 *
 * Wire format: [0xFC (CMP_WEBRTC_SIGNAL prefix)][JSON signal payload]
 */
class InBandSignaling {
    transport;
    /** Magic prefix to distinguish WebRTC signals from regular CMP messages */
    static SIGNAL_PREFIX = 0xFC;
    localId = '';
    handlers = new Set();
    ready = false;
    transportHandler = null;
    constructor(transport) {
        this.transport = transport;
    }
    async start(localId) {
        this.localId = localId;
        // Listen for incoming CMP messages that carry our signal prefix
        this.transportHandler = (event) => {
            if (event.type !== 'message' || !event.data)
                return;
            if (event.data.length < 2)
                return;
            // Check for our magic prefix
            if (event.data[0] !== InBandSignaling.SIGNAL_PREFIX)
                return;
            try {
                const json = new TextDecoder().decode(event.data.slice(1));
                const signal = JSON.parse(json);
                // Ignore our own messages
                if (signal.from === this.localId)
                    return;
                // If targeted to someone else, skip
                if (signal.to && signal.to !== this.localId)
                    return;
                for (const handler of this.handlers) {
                    try {
                        handler(signal);
                    }
                    catch { }
                }
            }
            catch { }
        };
        this.transport.on('message', this.transportHandler);
        this.ready = true;
    }
    async stop() {
        this.ready = false;
        if (this.transportHandler) {
            this.transport.off('message', this.transportHandler);
            this.transportHandler = null;
        }
    }
    async send(signal) {
        if (!this.ready)
            throw new Error('In-band signaling not started');
        const json = JSON.stringify({ ...signal, from: this.localId });
        const encoded = new TextEncoder().encode(json);
        // Prepend our magic prefix
        const payload = new Uint8Array(1 + encoded.length);
        payload[0] = InBandSignaling.SIGNAL_PREFIX;
        payload.set(encoded, 1);
        if (signal.to) {
            // Targeted — but we may not know the peer's transport address yet.
            // Broadcast the signal so the right peer picks it up by ID.
            await this.transport.broadcast(payload);
        }
        else {
            await this.transport.broadcast(payload);
        }
    }
    onSignal(handler) {
        this.handlers.add(handler);
    }
    offSignal(handler) {
        this.handlers.delete(handler);
    }
    isReady() {
        return this.ready;
    }
}
exports.InBandSignaling = InBandSignaling;
//# sourceMappingURL=webrtc-signaling.js.map