"use strict";
/**
 * CMP v2.0 — Layer 13: Cross-Mesh Wormholes
 *
 * Bridge separate meshes. Teleport Lifeforms across reality boundaries.
 *
 * Orchestrates:
 *   - WormholeDiscovery: finds bridge nodes and remote meshes
 *   - LifeformTeleporter: serializes and transmits Lifeforms
 *   - CrossMeshSynapse: relays signals between meshes
 *
 * Wire Protocol: 0xEC-0xF1
 *
 * @module wormhole
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifeformTeleporter = exports.SimpleBloomFilter = exports.WormholeDiscovery = exports.WormholeLayer = void 0;
const discovery_1 = require("./discovery");
const teleporter_1 = require("./teleporter");
const wormhole_1 = require("../types/wormhole");
function randomId() {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < 8; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ─── Cross-Mesh Synapse Manager ───
class CrossSynapseManager {
    synapses = new Map();
    maxPerLifeform;
    constructor(maxPerLifeform = 10) {
        this.maxPerLifeform = maxPerLifeform;
    }
    /** Create a cross-mesh synapse */
    create(localLifeformName, remoteLifeformName, remoteMeshFingerprint, wormholeNodeId, weight = 1.0) {
        // Check per-lifeform limit
        const existing = [...this.synapses.values()].filter(s => s.localLifeformName === localLifeformName);
        if (existing.length >= this.maxPerLifeform)
            return null;
        const synapse = {
            id: `xsyn-${randomId()}`,
            localLifeformName,
            remoteLifeformName,
            remoteMeshFingerprint,
            wormholeNodeId,
            weight,
            signalCount: 0,
            createdAt: Date.now(),
            lastSignalAt: 0,
        };
        this.synapses.set(synapse.id, synapse);
        return synapse;
    }
    /** Record a signal through a synapse (Hebbian strengthening) */
    signal(synapseId) {
        const synapse = this.synapses.get(synapseId);
        if (!synapse)
            return null;
        synapse.signalCount++;
        synapse.lastSignalAt = Date.now();
        // Hebbian: strengthen on use (cap at 5.0)
        synapse.weight = Math.min(5.0, synapse.weight + 0.1);
        return synapse;
    }
    /** Get all synapses for a local Lifeform */
    getForLifeform(localLifeformName) {
        return [...this.synapses.values()].filter(s => s.localLifeformName === localLifeformName);
    }
    /** Get a synapse by ID */
    get(synapseId) {
        return this.synapses.get(synapseId) || null;
    }
    /** Get all synapses */
    getAll() {
        return [...this.synapses.values()];
    }
    /** Remove a synapse */
    remove(synapseId) {
        return this.synapses.delete(synapseId);
    }
    /** Count */
    get size() {
        return this.synapses.size;
    }
}
// ─── Wormhole Layer ───
class WormholeLayer {
    /** Wormhole discovery system */
    discovery;
    /** Lifeform teleporter */
    teleporter;
    /** Cross-mesh synapse manager */
    synapses;
    config;
    deviceId;
    localMeshFingerprint;
    /** Transport callback */
    sendMessage = null;
    /** Wormhole relay callback (send to specific wormhole node) */
    sendToWormhole = null;
    /** Listeners */
    discoveryListeners = new Set();
    teleportListeners = new Set();
    constructor(deviceId, localMeshFingerprint, config) {
        this.deviceId = deviceId;
        this.localMeshFingerprint = localMeshFingerprint;
        this.config = { ...wormhole_1.DEFAULT_WORMHOLE_CONFIG, ...config };
        this.discovery = new discovery_1.WormholeDiscovery(deviceId, localMeshFingerprint, config);
        this.teleporter = new teleporter_1.LifeformTeleporter(localMeshFingerprint, config);
        this.synapses = new CrossSynapseManager(this.config.maxCrossSynapses);
        // Forward events
        this.discovery.onEvent((e) => {
            for (const l of this.discoveryListeners)
                try {
                    l(e);
                }
                catch { }
        });
        this.teleporter.onEvent((e) => {
            for (const l of this.teleportListeners)
                try {
                    l(e);
                }
                catch { }
        });
    }
    /** Set transport callbacks */
    setTransport(broadcastFn, wormholeFn) {
        this.sendMessage = broadcastFn;
        this.sendToWormhole = wormholeFn || null;
        this.discovery.setBroadcast((wire) => {
            broadcastFn(wormhole_1.WormholeMessageType.WORMHOLE_ANNOUNCE, wire);
        });
        if (wormholeFn) {
            this.teleporter.setTransport(wormholeFn);
        }
    }
    /** Start the wormhole layer */
    start() {
        this.discovery.start();
    }
    /** Stop the wormhole layer */
    stop() {
        this.discovery.stop();
        this.teleporter.stop();
    }
    /** Subscribe to discovery events */
    onDiscoveryEvent(listener) {
        this.discoveryListeners.add(listener);
    }
    /** Subscribe to teleport events */
    onTeleportEvent(listener) {
        this.teleportListeners.add(listener);
    }
    // ══════════════════════════════════════
    // High-Level API
    // ══════════════════════════════════════
    /**
     * Declare this device as a wormhole to a remote mesh.
     */
    declareWormhole(remoteMeshFingerprint, remoteMeshLabel, latencyMs) {
        this.discovery.declareWormhole(remoteMeshFingerprint, remoteMeshLabel, latencyMs);
    }
    /**
     * Teleport a Lifeform to a remote mesh.
     * Automatically selects the best wormhole.
     */
    teleport(lifeformName, lifeformId, destMeshFingerprint, reason = wormhole_1.TeleportReason.MANUAL) {
        const wormhole = this.discovery.getBestWormholeTo(destMeshFingerprint);
        if (!wormhole)
            return null; // No wormhole available
        const request = this.teleporter.initiate(lifeformName, lifeformId, destMeshFingerprint, wormhole.localMeshId, reason);
        return request?.id || null;
    }
    /**
     * Create a cross-mesh synapse between a local and remote Lifeform.
     */
    createCrossSynapse(localLifeformName, remoteLifeformName, remoteMeshFingerprint) {
        const wormhole = this.discovery.getBestWormholeTo(remoteMeshFingerprint);
        if (!wormhole)
            return null;
        return this.synapses.create(localLifeformName, remoteLifeformName, remoteMeshFingerprint, wormhole.localMeshId);
    }
    /**
     * Send a signal through a cross-mesh synapse.
     */
    sendCrossSynapseSignal(synapseId, payload) {
        const synapse = this.synapses.signal(synapseId);
        if (!synapse)
            return false;
        const wire = {
            synapseId: synapse.id,
            fromLifeform: synapse.localLifeformName,
            toLifeform: synapse.remoteLifeformName,
            fromMeshFingerprint: this.localMeshFingerprint,
            toMeshFingerprint: synapse.remoteMeshFingerprint,
            payload,
            weight: synapse.weight,
            timestamp: Date.now(),
        };
        // Send through wormhole
        if (this.sendToWormhole) {
            this.sendToWormhole(synapse.wormholeNodeId, wormhole_1.WormholeMessageType.CROSS_SYNAPSE_RELAY, wire);
        }
        else if (this.sendMessage) {
            this.sendMessage(wormhole_1.WormholeMessageType.CROSS_SYNAPSE_RELAY, wire);
        }
        return true;
    }
    // ══════════════════════════════════════
    // Message Handling
    // ══════════════════════════════════════
    /** Handle an incoming Layer 13 message */
    handleMessage(msgType, payload) {
        switch (msgType) {
            case wormhole_1.WormholeMessageType.WORMHOLE_ANNOUNCE:
                this.discovery.receiveAnnounce(payload);
                break;
            case wormhole_1.WormholeMessageType.WORMHOLE_DIRECTORY:
                this.discovery.receiveDirectory(payload);
                break;
            case wormhole_1.WormholeMessageType.TELEPORT_INITIATE:
                // Remote mesh is sending us a Lifeform — handled by next message
                break;
            case wormhole_1.WormholeMessageType.TELEPORT_PAYLOAD:
                this.teleporter.receivePayload(payload);
                break;
            case wormhole_1.WormholeMessageType.TELEPORT_ACK:
                this.teleporter.receiveAck(payload);
                break;
            case wormhole_1.WormholeMessageType.CROSS_SYNAPSE_RELAY:
                // Cross-mesh synapse signal received — forward to local Lifeform
                // The caller (CMPNode) routes this to the LifeformManager
                break;
        }
    }
    // ══════════════════════════════════════
    // Status
    // ══════════════════════════════════════
    getStatus() {
        return {
            isWormhole: this.discovery.isWormholeNode(),
            localMeshFingerprint: this.localMeshFingerprint,
            activeWormholes: this.discovery.getWormholes().length,
            remoteMeshes: this.discovery.getRemoteMeshes().map(m => ({
                fingerprint: m.fingerprint,
                label: m.label,
                wormholeCount: m.wormholeNodes.length,
                bestLatencyMs: m.bestLatencyMs,
            })),
            activeTeleports: this.teleporter.getActiveOutgoing().length,
            crossSynapses: this.synapses.size,
            stats: {
                discovery: this.discovery.getStats(),
                teleporter: this.teleporter.getStats(),
            },
        };
    }
}
exports.WormholeLayer = WormholeLayer;
// ─── Re-exports ───
var discovery_2 = require("./discovery");
Object.defineProperty(exports, "WormholeDiscovery", { enumerable: true, get: function () { return discovery_2.WormholeDiscovery; } });
Object.defineProperty(exports, "SimpleBloomFilter", { enumerable: true, get: function () { return discovery_2.SimpleBloomFilter; } });
var teleporter_2 = require("./teleporter");
Object.defineProperty(exports, "LifeformTeleporter", { enumerable: true, get: function () { return teleporter_2.LifeformTeleporter; } });
//# sourceMappingURL=index.js.map