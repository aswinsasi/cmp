"use strict";
/**
 * CMP Peer Table
 * Manages the list of known mesh participants with their capabilities,
 * connection state, and liveness tracking.
 *
 * @module mesh/peer-table
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PeerTable = void 0;
const capability_1 = require("../types/capability");
const helpers_1 = require("../utils/helpers");
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('PeerTable');
class PeerTable {
    bus;
    staleMs;
    deadMs;
    peers = new Map();
    cleanupTimer;
    constructor(bus, staleMs = 30000, deadMs = 60000) {
        this.bus = bus;
        this.staleMs = staleMs;
        this.deadMs = deadMs;
        this.startCleanupLoop();
    }
    /**
     * Add or update a peer in the table.
     */
    upsert(meshId, update) {
        const hex = (0, helpers_1.toHex)(meshId);
        const existing = this.peers.get(hex);
        const entry = {
            meshId,
            hexId: hex,
            state: 'discovered',
            transports: [],
            latencyMs: 0,
            reputationScore: 5000,
            lastSeen: Date.now(),
            ...existing,
            ...update,
        };
        // Always update lastSeen to now
        entry.lastSeen = Date.now();
        // Classify tier if capability is available
        if (entry.capability) {
            entry.tier = (0, capability_1.classifyTier)(entry.capability);
        }
        const isNew = !existing;
        this.peers.set(hex, entry);
        if (isNew) {
            log.info(`New peer: ${(0, helpers_1.shortId)(meshId)} (${entry.state})`, {
                transports: entry.transports,
            });
            this.bus.emit('peer:discovered', {
                meshId,
                transport: entry.transports[0] || 'unknown',
            });
        }
        return entry;
    }
    /**
     * Get a peer by MeshId.
     */
    get(meshId) {
        return this.peers.get((0, helpers_1.toHex)(meshId));
    }
    /**
     * Get a peer by hex ID string.
     */
    getByHex(hexId) {
        return this.peers.get(hexId);
    }
    /**
     * Remove a peer from the table.
     */
    remove(meshId) {
        const hex = (0, helpers_1.toHex)(meshId);
        const existed = this.peers.has(hex);
        this.peers.delete(hex);
        if (existed) {
            this.bus.emit('peer:lost', { meshId, reason: 'removed' });
        }
        return existed;
    }
    /**
     * Get all peers in the 'active' state.
     */
    getActive() {
        return [...this.peers.values()].filter((p) => p.state === 'active');
    }
    /**
     * Get all peers at or above a minimum capability tier.
     */
    getByMinTier(minTier) {
        return this.getActive().filter((p) => p.tier !== undefined && p.tier >= minTier);
    }
    /**
     * Get all known peers regardless of state.
     */
    getAll() {
        return [...this.peers.values()];
    }
    /**
     * Total number of peers in the table.
     */
    get size() {
        return this.peers.size;
    }
    /**
     * Number of active peers.
     */
    get activeCount() {
        return this.getActive().length;
    }
    /**
     * Mark a peer's transport as having been seen via beacon.
     */
    touchBeacon(meshId, transport) {
        const hex = (0, helpers_1.toHex)(meshId);
        const entry = this.peers.get(hex);
        if (entry) {
            entry.lastSeen = Date.now();
            if (!entry.transports.includes(transport)) {
                entry.transports.push(transport);
            }
        }
    }
    /**
     * Cleanup: mark stale peers, remove dead peers.
     */
    startCleanupLoop() {
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [hex, peer] of this.peers) {
                const age = now - peer.lastSeen;
                if (age > this.deadMs) {
                    log.info(`Peer dead: ${(0, helpers_1.shortId)(peer.meshId)} (${age}ms inactive)`);
                    this.peers.delete(hex);
                    this.bus.emit('peer:lost', { meshId: peer.meshId, reason: 'timeout' });
                }
                else if (age > this.staleMs && peer.state === 'active') {
                    peer.state = 'stale';
                    log.debug(`Peer stale: ${(0, helpers_1.shortId)(peer.meshId)}`);
                    this.bus.emit('peer:stale', { meshId: peer.meshId });
                }
            }
        }, 5000);
    }
    /**
     * Stop the cleanup loop.
     */
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        this.peers.clear();
    }
}
exports.PeerTable = PeerTable;
//# sourceMappingURL=peer-table.js.map