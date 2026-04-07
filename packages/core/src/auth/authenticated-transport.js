"use strict";
/**
 * CMP v1.5 — Authenticated Transport
 *
 * ITransport wrapper that transparently signs all outgoing messages
 * and verifies all incoming messages using Ed25519.
 *
 * Usage:
 *   const raw = new LANTransport();
 *   const auth = new AuthenticatedTransport(raw);
 *   await auth.start();
 *   // All messages are now signed/verified automatically
 *
 * Behavior:
 *   - sendTo / broadcast: signs the data before forwarding to inner transport
 *   - message events: verifies signature, drops invalid, strips trailer
 *   - peer_discovered events: pass through unmodified (beacons are unsigned
 *     in v1.5 — the handshake phase establishes identity)
 *   - key mismatch (TOFU violation): emits 'auth_violation' event and drops
 *
 * The caller sees the exact same ITransport interface. Data flowing
 * through event handlers has the auth trailer stripped — the caller
 * never sees raw signatures.
 *
 * @module auth/authenticated-transport
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthenticatedTransport = void 0;
const message_auth_1 = require("./message-auth");
// ─── Authenticated Transport ───
class AuthenticatedTransport {
    name;
    maxPayloadBytes;
    estimatedBandwidthMbps;
    inner;
    keypair;
    peerRegistry;
    handlers = new Map();
    violationHandlers = new Set();
    /** Stats */
    stats = {
        messagesSigned: 0,
        messagesVerified: 0,
        messagesRejectedBadSig: 0,
        messagesRejectedKeyMismatch: 0,
        peersRegistered: 0,
    };
    /**
     * @param inner - The raw transport to wrap
     * @param keypair - Optional pre-generated keypair (generates new if not provided)
     */
    constructor(inner, keypair) {
        this.inner = inner;
        this.keypair = keypair || (0, message_auth_1.generateAuthKeypair)();
        this.peerRegistry = new message_auth_1.PeerKeyRegistry();
        // Adjust max payload to account for auth trailer
        this.name = `auth(${inner.name})`;
        this.maxPayloadBytes = inner.maxPayloadBytes - message_auth_1.AUTH_TRAILER_SIZE;
        this.estimatedBandwidthMbps = inner.estimatedBandwidthMbps;
        // Subscribe to inner transport events
        this.inner.on('message', (event) => this.handleIncomingMessage(event));
        this.inner.on('peer_discovered', (event) => this.emit(event));
        this.inner.on('peer_lost', (event) => this.emit(event));
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
    // ── Discovery (pass-through, beacons are unsigned) ──
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
    // ── Data Transfer (signed) ──
    async sendTo(peerAddress, data) {
        const signed = (0, message_auth_1.signFrame)(data, this.keypair.secretKey, this.keypair.publicKey);
        this.stats.messagesSigned++;
        return this.inner.sendTo(peerAddress, signed);
    }
    async broadcast(data) {
        const signed = (0, message_auth_1.signFrame)(data, this.keypair.secretKey, this.keypair.publicKey);
        this.stats.messagesSigned++;
        return this.inner.broadcast(signed);
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
    /**
     * Subscribe to authentication violation events.
     * These fire when a peer sends a message with an invalid signature
     * or when a known peer's key changes (potential MITM).
     */
    onAuthViolation(handler) {
        this.violationHandlers.add(handler);
    }
    // ── Public Accessors ──
    /** Get this node's public key */
    getPublicKey() {
        return this.keypair.publicKey;
    }
    /** Get the peer key registry */
    getPeerRegistry() {
        return this.peerRegistry;
    }
    /** Get authentication statistics */
    getStats() {
        return { ...this.stats, peersRegistered: this.peerRegistry.size };
    }
    /** Get the inner (raw) transport */
    getInnerTransport() {
        return this.inner;
    }
    // ── Internals ──
    handleIncomingMessage(event) {
        if (!event.data || event.data.length === 0)
            return;
        // Check if this message has an auth trailer
        if (!(0, message_auth_1.hasAuthTrailer)(event.data)) {
            // Unsigned message — in v1.5, we still accept unsigned messages
            // for backward compatibility but could flag them in the future
            this.emit(event);
            return;
        }
        // Verify signature
        const result = (0, message_auth_1.verifyFrame)(event.data);
        if (!result.valid) {
            // Bad signature — drop and report
            this.stats.messagesRejectedBadSig++;
            for (const handler of this.violationHandlers) {
                try {
                    handler({
                        type: 'bad_signature',
                        peerAddress: event.peerAddress || 'unknown',
                        timestamp: Date.now(),
                        receivedKey: result.senderKey,
                    });
                }
                catch { }
            }
            return;
        }
        // TOFU key registration/verification
        const address = event.peerAddress || 'unknown';
        const keyTrusted = this.peerRegistry.registerKey(address, result.senderKey);
        if (!keyTrusted) {
            // Key mismatch! This address previously used a different key.
            this.stats.messagesRejectedKeyMismatch++;
            const expectedKey = this.peerRegistry.getKey(address);
            for (const handler of this.violationHandlers) {
                try {
                    handler({
                        type: 'key_mismatch',
                        peerAddress: address,
                        timestamp: Date.now(),
                        expectedKey: expectedKey || undefined,
                        receivedKey: result.senderKey,
                    });
                }
                catch { }
            }
            return;
        }
        this.stats.messagesVerified++;
        // Emit with stripped frame (no auth trailer)
        this.emit({
            ...event,
            data: result.frame,
        });
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
exports.AuthenticatedTransport = AuthenticatedTransport;
//# sourceMappingURL=authenticated-transport.js.map