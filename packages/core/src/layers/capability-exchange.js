"use strict";
/**
 * CMP Capability Exchange Layer
 * Layer 2: After handshake completes, peers exchange full capability
 * profiles. This layer manages the exchange, periodic refresh,
 * and feeds the CapabilityMap.
 *
 * Flow:
 *   1. peer:handshake_complete event fires
 *   2. Send our capability profile to the new peer
 *   3. Receive their profile → store in CapabilityMap
 *   4. Every CAPABILITY_REFRESH_MS, re-profile and re-send if changed
 *
 * @module layers/capability-exchange
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilityExchange = void 0;
const capability_1 = require("../types/capability");
const beacon_1 = require("../types/beacon");
const serializer_1 = require("./serializer");
const helpers_1 = require("../utils/helpers");
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('CapExchange');
class CapabilityExchange {
    profiler;
    capMap;
    peerTable;
    bus;
    transport;
    meshId;
    running = false;
    /** Addresses resolved from discovery layer */
    resolveAddress;
    /** Track which peers we've exchanged with */
    exchanged = new Set();
    /** Periodic refresh timer */
    refreshTimer;
    constructor(meshId, transport, bus, peerTable, capMap, profiler, resolveAddress) {
        this.meshId = meshId;
        this.transport = transport;
        this.bus = bus;
        this.peerTable = peerTable;
        this.capMap = capMap;
        this.profiler = profiler;
        this.resolveAddress = resolveAddress;
    }
    /**
     * Start capability exchange layer.
     * Listens for handshake completions and incoming capability messages.
     */
    async start() {
        if (this.running)
            return;
        // Listen for new peer handshakes
        this.bus.on('peer:handshake_complete', (data) => {
            this.onHandshakeComplete(data.meshId);
        });
        // Listen for incoming messages
        this.transport.on('message', (event) => {
            this.onMessage(event);
        });
        // Listen for peer departures → remove from map
        this.bus.on('peer:lost', (data) => {
            this.capMap.remove(data.meshId);
            this.exchanged.delete((0, helpers_1.toHex)(data.meshId));
        });
        // Profile ourselves initially
        await this.profiler.profile(this.meshId);
        // Start periodic refresh
        this.startRefreshLoop();
        // Register profiler change callback
        this.profiler.onChange((cap) => {
            this.broadcastCapability(cap);
        });
        this.running = true;
        log.info('Capability exchange started');
    }
    /**
     * Stop the capability exchange layer.
     */
    async stop() {
        this.running = false;
        this.stopRefreshLoop();
        this.exchanged.clear();
    }
    /**
     * Get the capability map.
     */
    getCapabilityMap() {
        return this.capMap;
    }
    /**
     * Get the profiler.
     */
    getProfiler() {
        return this.profiler;
    }
    // ── Event Handlers ──
    async onHandshakeComplete(peerId) {
        const hex = (0, helpers_1.toHex)(peerId);
        if (this.exchanged.has(hex))
            return;
        log.debug(`Exchanging capability with ${(0, helpers_1.shortId)(peerId)}`);
        // Send our capability to the new peer
        const myCapability = await this.profiler.profile(this.meshId);
        await this.sendCapabilityTo(peerId, myCapability);
        this.exchanged.add(hex);
    }
    onMessage(event) {
        if (!this.running || !event.data)
            return;
        const msg = (0, serializer_1.decodeMessage)(event.data);
        if (!msg || msg.type !== beacon_1.MessageType.CAPABILITY_EXCHANGE)
            return;
        this.handleCapabilityMessage(msg.payload, event.peerAddress);
    }
    handleCapabilityMessage(payload, peerAddress) {
        const capability = (0, serializer_1.decodeCapability)(payload);
        if (!capability) {
            log.warn('Failed to decode capability message');
            return;
        }
        const peerId = capability.meshId;
        const hex = (0, helpers_1.toHex)(peerId);
        // Store in capability map
        this.capMap.update(peerId, capability);
        // Update peer table with network info
        const peer = this.peerTable.get(peerId);
        if (peer) {
            this.peerTable.upsert(peerId, {
                capability,
            });
        }
        // Mark as exchanged
        if (!this.exchanged.has(hex)) {
            this.exchanged.add(hex);
            // If they sent first, send ours back
            this.sendCapabilityTo(peerId, this.profiler.getLastProfile()).catch(() => { });
        }
        log.debug(`Received capability from ${(0, helpers_1.shortId)(peerId)}`, {
            tier: capability.cpu.coresAvailable > 0 ? 'T' + Math.ceil(capability.memory.availableMb / 4096) : '?',
            cores: capability.cpu.coresAvailable,
            memMb: capability.memory.availableMb,
        });
        this.bus.emit('capability:updated', { meshId: peerId });
    }
    // ── Sending ──
    async sendCapabilityTo(peerId, capability) {
        const addr = this.resolveAddress(peerId);
        if (!addr) {
            log.warn(`Cannot resolve address for ${(0, helpers_1.shortId)(peerId)}`);
            return;
        }
        const payload = (0, serializer_1.encodeCapability)(capability);
        const msg = (0, serializer_1.encodeMessage)(beacon_1.MessageType.CAPABILITY_EXCHANGE, payload);
        try {
            await this.transport.sendTo(addr, msg);
        }
        catch (err) {
            log.warn(`Failed to send capability to ${(0, helpers_1.shortId)(peerId)}: ${err.message}`);
        }
    }
    async broadcastCapability(capability) {
        const payload = (0, serializer_1.encodeCapability)(capability);
        const msg = (0, serializer_1.encodeMessage)(beacon_1.MessageType.CAPABILITY_EXCHANGE, payload);
        try {
            await this.transport.broadcast(msg);
        }
        catch (err) {
            log.warn(`Failed to broadcast capability: ${err.message}`);
        }
    }
    // ── Periodic Refresh ──
    startRefreshLoop() {
        this.refreshTimer = setInterval(async () => {
            if (!this.running)
                return;
            // Re-profile
            const cap = await this.profiler.profile(this.meshId);
            // If capability changed significantly, broadcast to all peers
            const prev = this.profiler.getLastProfile();
            if (prev && this.profiler.hasSignificantChange(prev, cap)) {
                await this.broadcastCapability(cap);
            }
        }, capability_1.CAPABILITY_REFRESH_MS);
    }
    stopRefreshLoop() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }
}
exports.CapabilityExchange = CapabilityExchange;
//# sourceMappingURL=capability-exchange.js.map