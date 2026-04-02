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

import { CMPNode } from './cmp-node';
import { ConsciousnessLayer, EmergenceEvent } from './consciousness';
import { SpacetimeLayer } from './spacetime';
import { WormholeLayer } from './wormhole';
import { MeshBehavior, PheromoneType, ConsciousnessMessageType } from './types/consciousness';
import { SpacetimeMessageType } from './types/spacetime';
import { WormholeMessageType, TeleportReason } from './types/wormhole';
import { encodeMessage, encodeJSON, decodeJSON } from './layers/serializer';
import { Logger } from './utils/logger';

const log = new Logger('V2Bridge');

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── V2 Status ───

export interface V2Status {
  /** Layer 11: Current mesh behavior */
  behavior: MeshBehavior;
  /** Layer 11: Active pheromone count */
  pheromoneCount: number;
  /** Layer 11: Dominant pheromone type */
  dominantPheromone: string | null;
  /** Layer 11: Active quorum signals */
  activeQuorums: number;
  /** Layer 11: Pending swarm decisions */
  pendingDecisions: number;
  /** Layer 12: DAG node count (trunk) */
  dagNodes: number;
  /** Layer 12: Active branches */
  activeBranches: number;
  /** Layer 12: Active races */
  activeRaces: number;
  /** Layer 13: Known remote meshes */
  remoteMeshes: number;
  /** Layer 13: Active wormholes */
  activeWormholes: number;
  /** Layer 13: Active teleports */
  activeTeleports: number;
  /** Layer 13: Cross-mesh synapses */
  crossSynapses: number;
}

// ─── V2 Bridge ───

export class V2Bridge {
  /** Layer 11: Collective Consciousness */
  readonly consciousness: ConsciousnessLayer;
  /** Layer 12: Computation Spacetime */
  readonly spacetime: SpacetimeLayer;
  /** Layer 13: Cross-Mesh Wormholes */
  readonly wormhole: WormholeLayer;

  private node: CMPNode;
  private started = false;

  /** Event listeners */
  private emergenceListeners = new Set<(event: EmergenceEvent) => void>();

  constructor(node: CMPNode) {
    this.node = node;
    const meshId = node.meshIdHex();
    const meshFingerprint = meshId.substring(0, 16);

    // ── Create Layer 11 ──
    this.consciousness = new ConsciousnessLayer(meshId, {
      emergenceEvalIntervalMs: 10000,
      pheromoneCleanupIntervalMs: 5000,
    });

    // ── Create Layer 12 ──
    this.spacetime = new SpacetimeLayer(meshId, {
      maxDAGNodes: 1000,
      snapshotEveryN: 10,
    });

    // ── Create Layer 13 ──
    this.wormhole = new WormholeLayer(meshId, meshFingerprint);

    // ── Wire Transport Callbacks ──
    // Each layer can broadcast messages via the node's transport
    const transport = node.getTransport();

    this.consciousness.setTransport((msgType: number, payload: any) => {
      const msg = encodeMessage(msgType, encodeJSON(payload));
      transport.broadcast(msg).catch(() => {});
    });

    this.spacetime.setTransport((msgType: number, payload: any) => {
      const msg = encodeMessage(msgType, encodeJSON(payload));
      transport.broadcast(msg).catch(() => {});
    });

    this.wormhole.setTransport(
      // Broadcast
      (msgType: number, payload: any) => {
        const msg = encodeMessage(msgType, encodeJSON(payload));
        transport.broadcast(msg).catch(() => {});
      },
      // Send to specific wormhole node
      (wormholeNodeId: string, msgType: number, payload: any) => {
        const msg = encodeMessage(msgType, encodeJSON(payload));
        // Resolve address from peer table
        const peers = node.getPeers();
        const peer = peers.find(p => p.meshId.startsWith(wormholeNodeId));
        if (peer) {
          const addresses = node.getPeerTable().getActive();
          const entry = addresses.find(a => toHex(a.meshId).startsWith(wormholeNodeId));
          if (entry && entry.transports.length > 0) {
            transport.sendTo(entry.transports[0], msg).catch(() => {});
          }
        }
      },
    );

    // ── Wire Event Bus ──
    // Auto-deposit pheromones on task events
    const bus = node.events();

    bus.on('chunk:executed', (data: any) => {
      if (data.status === 0) { // SUCCESS
        this.consciousness.recordSuccess(data.taskType);
      } else {
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
        try { listener(event); } catch {}
      }
    });

    log.info('V2 Bridge created: Consciousness + Spacetime + Wormholes');
  }

  // ══════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════

  /** Start all v2.0 layers */
  start(): void {
    if (this.started) return;
    this.consciousness.start();
    this.wormhole.start();
    this.started = true;
    this.updateMeshSize();
    log.info('V2 Bridge started: Layers 11-13 active');
  }

  /** Stop all v2.0 layers */
  stop(): void {
    if (!this.started) return;
    this.consciousness.stop();
    this.spacetime.stop();
    this.wormhole.stop();
    this.started = false;
    log.info('V2 Bridge stopped');
  }

  /** Check if running */
  isStarted(): boolean {
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
  handleMessage(msgType: number, payload: Uint8Array): void {
    const json = decodeJSON(payload);
    if (!json) return;

    if (msgType >= 0xE1 && msgType <= 0xE5) {
      // Layer 11: Consciousness
      this.consciousness.handleMessage(msgType, json);
    } else if (msgType >= 0xE6 && msgType <= 0xEB) {
      // Layer 12: Spacetime
      this.spacetime.handleMessage(msgType, json);
    } else if (msgType >= 0xEC && msgType <= 0xF1) {
      // Layer 13: Wormholes
      this.wormhole.handleMessage(msgType, json);
    }
  }

  // ══════════════════════════════════════
  // Status
  // ══════════════════════════════════════

  /** Get comprehensive v2.0 status */
  getStatus(): V2Status {
    const cStatus = this.consciousness.getStatus();
    const sStatus = this.spacetime.getStatus();
    const wStatus = this.wormhole.getStatus();

    return {
      behavior: cStatus.behavior,
      pheromoneCount: cStatus.pheromoneCount,
      dominantPheromone: cStatus.dominantPheromone?.type || null,
      activeQuorums: cStatus.quorumStates.filter((s: any) => s.thresholdReached).length,
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
  onEmergence(listener: (event: EmergenceEvent) => void): void {
    this.emergenceListeners.add(listener);
  }

  // ══════════════════════════════════════
  // Internal
  // ══════════════════════════════════════

  private updateMeshSize(): void {
    const peers = this.node.getStatus().peers;
    this.consciousness.setMeshSize(peers + 1); // +1 for ourselves
  }
}
