"use strict";
/**
 * CMP v2.0 — V2 Bridge
 *
 * Attaches Layer 11 (Consciousness), Layer 12 (Spacetime), and
 * Layer 13 (Wormholes) to an existing CMPNode instance.
 *
 * Usage:
 *   const node = new CMPNode({ transports: ['lan'] });
 *   const v2 = new V2Bridge(node);
 *   await node.start();
 *   v2.start();
 *
 * What the bridge does:
 *   - Creates Layer 11/12/13 instances
 *   - Wires transport callbacks (layers can broadcast/send messages)
 *   - Routes incoming messages 0xE1-0xF1 to the correct layer
 *   - Auto-deposits pheromones on task success/failure events
 *   - Updates mesh size in quorum sensor when peers change
 *   - Adds consciousness behavior to the status output
 *   - Manages lifecycle (start/stop)
 *
 * Designed to be non-invasive: requires only ONE line change in
 * cmp-node.ts (forwarding 0xE1-0xF1 messages) and ONE import in cli.ts.
 *
 * @module v2-bridge
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.V2Bridge = void 0;
const consciousness_1 = require("./consciousness");
const spacetime_1 = require("./spacetime");
const wormhole_1 = require("./wormhole");
const serializer_1 = require("./layers/serializer");
const logger_1 = require("./utils/logger");
const log = new logger_1.Logger('V2Bridge');
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ─── V2 Bridge ───
class V2Bridge {
    /** Layer 11: Collective Consciousness */
    consciousness;
    /** Layer 12: Computation Spacetime */
    spacetime;
    /** Layer 13: Cross-Mesh Wormholes */
    wormhole;
    node;
    started = false;
    /** Event listeners */
    emergenceListeners = new Set();
    constructor(node) {
        this.node = node;
        const meshId = node.meshIdHex();
        const meshFingerprint = meshId.substring(0, 16);
        // ── Create Layer 11 ──
        this.consciousness = new consciousness_1.ConsciousnessLayer(meshId, {
            emergenceEvalIntervalMs: 10000,
            pheromoneCleanupIntervalMs: 5000,
        });
        // ── Create Layer 12 ──
        this.spacetime = new spacetime_1.SpacetimeLayer(meshId, {
            maxDAGNodes: 1000,
            snapshotEveryN: 10,
        });
        // ── Create Layer 13 ──
        this.wormhole = new wormhole_1.WormholeLayer(meshId, meshFingerprint);
        // ── Wire Transport Callbacks ──
        // Each layer can broadcast messages via the node's transport
        const transport = node.getTransport();
        this.consciousness.setTransport((msgType, payload) => {
            const msg = (0, serializer_1.encodeMessage)(msgType, (0, serializer_1.encodeJSON)(payload));
            transport.broadcast(msg).catch(() => { });
        });
        this.spacetime.setTransport((msgType, payload) => {
            const msg = (0, serializer_1.encodeMessage)(msgType, (0, serializer_1.encodeJSON)(payload));
            transport.broadcast(msg).catch(() => { });
        });
        this.wormhole.setTransport(
        // Broadcast
        (msgType, payload) => {
            const msg = (0, serializer_1.encodeMessage)(msgType, (0, serializer_1.encodeJSON)(payload));
            transport.broadcast(msg).catch(() => { });
        }, 
        // Send to specific wormhole node
        (wormholeNodeId, msgType, payload) => {
            const msg = (0, serializer_1.encodeMessage)(msgType, (0, serializer_1.encodeJSON)(payload));
            // Resolve address from peer table
            const peers = node.getPeers();
            const peer = peers.find(p => p.meshId.startsWith(wormholeNodeId));
            if (peer) {
                const addresses = node.getPeerTable().getActive();
                const entry = addresses.find(a => toHex(a.meshId).startsWith(wormholeNodeId));
                if (entry && entry.transports.length > 0) {
                    transport.sendTo(entry.transports[0], msg).catch(() => { });
                }
            }
        });
        // ── Wire Event Bus ──
        // Auto-deposit pheromones on task events
        const bus = node.events();
        bus.on('chunk:executed', (data) => {
            if (data.status === 0) { // SUCCESS
                this.consciousness.recordSuccess(data.taskType);
            }
            else {
                this.consciousness.recordFailure(data.taskType);
            }
        });
        bus.on('node:started', () => {
            this.updateMeshSize();
        });
        bus.on('peer:discovered', () => {
            this.updateMeshSize();
        });
        bus.on('peer:lost', () => {
            this.updateMeshSize();
        });
        // Forward emergence events
        this.consciousness.onEmergence((event) => {
            log.info(`Mesh behavior shift: ${event.previousBehavior} → ${event.newBehavior} (${event.reason})`);
            for (const listener of this.emergenceListeners) {
                try {
                    listener(event);
                }
                catch { }
            }
        });
        log.info('V2 Bridge created: Consciousness + Spacetime + Wormholes');
    }
    // ══════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════
    /** Start all v2.0 layers */
    start() {
        if (this.started)
            return;
        this.consciousness.start();
        this.wormhole.start();
        this.started = true;
        this.updateMeshSize();
        log.info('V2 Bridge started: Layers 11-13 active');
    }
    /** Stop all v2.0 layers */
    stop() {
        if (!this.started)
            return;
        this.consciousness.stop();
        this.spacetime.stop();
        this.wormhole.stop();
        this.started = false;
        log.info('V2 Bridge stopped');
    }
    /** Check if running */
    isStarted() {
        return this.started;
    }
    // ══════════════════════════════════════
    // Message Routing
    // ══════════════════════════════════════
    /**
     * Route an incoming message to the correct v2.0 layer.
     * Call this from CMPNode.handleTransportMessage for types 0xE1-0xF1.
     *
     * @param msgType - Message type byte
     * @param payload - Raw payload bytes
     */
    handleMessage(msgType, payload) {
        const json = (0, serializer_1.decodeJSON)(payload);
        if (!json)
            return;
        if (msgType >= 0xE1 && msgType <= 0xE5) {
            // Layer 11: Consciousness
            this.consciousness.handleMessage(msgType, json);
        }
        else if (msgType >= 0xE6 && msgType <= 0xEB) {
            // Layer 12: Spacetime
            this.spacetime.handleMessage(msgType, json);
        }
        else if (msgType >= 0xEC && msgType <= 0xF1) {
            // Layer 13: Wormholes
            this.wormhole.handleMessage(msgType, json);
        }
    }
    // ══════════════════════════════════════
    // Status
    // ══════════════════════════════════════
    /** Get comprehensive v2.0 status */
    getStatus() {
        const cStatus = this.consciousness.getStatus();
        const sStatus = this.spacetime.getStatus();
        const wStatus = this.wormhole.getStatus();
        return {
            behavior: cStatus.behavior,
            pheromoneCount: cStatus.pheromoneCount,
            dominantPheromone: cStatus.dominantPheromone?.type || null,
            activeQuorums: cStatus.quorumStates.filter((s) => s.thresholdReached).length,
            pendingDecisions: cStatus.activeDecisions,
            dagNodes: sStatus.dagNodes,
            activeBranches: sStatus.activeBranches.length,
            activeRaces: sStatus.activeRaces,
            remoteMeshes: wStatus.remoteMeshes.length,
            activeWormholes: wStatus.activeWormholes,
            activeTeleports: wStatus.activeTeleports,
            crossSynapses: wStatus.crossSynapses,
        };
    }
    /** Subscribe to emergence events */
    onEmergence(listener) {
        this.emergenceListeners.add(listener);
    }
    // ══════════════════════════════════════
    // Internal
    // ══════════════════════════════════════
    updateMeshSize() {
        const peers = this.node.getStatus().peers;
        this.consciousness.setMeshSize(peers + 1); // +1 for ourselves
    }
}
exports.V2Bridge = V2Bridge;
//# sourceMappingURL=v2-bridge.js.map