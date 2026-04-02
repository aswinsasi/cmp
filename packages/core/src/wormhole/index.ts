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

import { WormholeDiscovery, WormholeDiscoveryEvent, SimpleBloomFilter } from './discovery';
import { LifeformTeleporter, TeleportEvent } from './teleporter';
import {
  WormholeConfig,
  DEFAULT_WORMHOLE_CONFIG,
  WormholeMessageType,
  WormholeAnnounceWire,
  WormholeDirectoryWire,
  TeleportPayload,
  TeleportAckWire,
  TeleportInitiateWire,
  CrossMeshSynapse,
  CrossSynapseRelayWire,
  TeleportReason,
} from '../types/wormhole';

function randomId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Cross-Mesh Synapse Manager ───

class CrossSynapseManager {
  private synapses = new Map<string, CrossMeshSynapse>();
  private maxPerLifeform: number;

  constructor(maxPerLifeform: number = 10) {
    this.maxPerLifeform = maxPerLifeform;
  }

  /** Create a cross-mesh synapse */
  create(
    localLifeformName: string,
    remoteLifeformName: string,
    remoteMeshFingerprint: string,
    wormholeNodeId: string,
    weight: number = 1.0,
  ): CrossMeshSynapse | null {
    // Check per-lifeform limit
    const existing = [...this.synapses.values()].filter(
      s => s.localLifeformName === localLifeformName,
    );
    if (existing.length >= this.maxPerLifeform) return null;

    const synapse: CrossMeshSynapse = {
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
  signal(synapseId: string): CrossMeshSynapse | null {
    const synapse = this.synapses.get(synapseId);
    if (!synapse) return null;

    synapse.signalCount++;
    synapse.lastSignalAt = Date.now();
    // Hebbian: strengthen on use (cap at 5.0)
    synapse.weight = Math.min(5.0, synapse.weight + 0.1);

    return synapse;
  }

  /** Get all synapses for a local Lifeform */
  getForLifeform(localLifeformName: string): CrossMeshSynapse[] {
    return [...this.synapses.values()].filter(s => s.localLifeformName === localLifeformName);
  }

  /** Get a synapse by ID */
  get(synapseId: string): CrossMeshSynapse | null {
    return this.synapses.get(synapseId) || null;
  }

  /** Get all synapses */
  getAll(): CrossMeshSynapse[] {
    return [...this.synapses.values()];
  }

  /** Remove a synapse */
  remove(synapseId: string): boolean {
    return this.synapses.delete(synapseId);
  }

  /** Count */
  get size(): number {
    return this.synapses.size;
  }
}

// ─── Wormhole Layer ───

export class WormholeLayer {
  /** Wormhole discovery system */
  readonly discovery: WormholeDiscovery;
  /** Lifeform teleporter */
  readonly teleporter: LifeformTeleporter;
  /** Cross-mesh synapse manager */
  readonly synapses: CrossSynapseManager;

  private config: WormholeConfig;
  private deviceId: string;
  private localMeshFingerprint: string;

  /** Transport callback */
  private sendMessage: ((msgType: number, payload: any) => void) | null = null;
  /** Wormhole relay callback (send to specific wormhole node) */
  private sendToWormhole: ((wormholeNodeId: string, msgType: number, payload: any) => void) | null = null;

  /** Listeners */
  private discoveryListeners = new Set<(event: WormholeDiscoveryEvent) => void>();
  private teleportListeners = new Set<(event: TeleportEvent) => void>();

  constructor(deviceId: string, localMeshFingerprint: string, config?: Partial<WormholeConfig>) {
    this.deviceId = deviceId;
    this.localMeshFingerprint = localMeshFingerprint;
    this.config = { ...DEFAULT_WORMHOLE_CONFIG, ...config };

    this.discovery = new WormholeDiscovery(deviceId, localMeshFingerprint, config);
    this.teleporter = new LifeformTeleporter(localMeshFingerprint, config);
    this.synapses = new CrossSynapseManager(this.config.maxCrossSynapses);

    // Forward events
    this.discovery.onEvent((e) => {
      for (const l of this.discoveryListeners) try { l(e); } catch {}
    });
    this.teleporter.onEvent((e) => {
      for (const l of this.teleportListeners) try { l(e); } catch {}
    });
  }

  /** Set transport callbacks */
  setTransport(
    broadcastFn: (msgType: number, payload: any) => void,
    wormholeFn?: (wormholeNodeId: string, msgType: number, payload: any) => void,
  ): void {
    this.sendMessage = broadcastFn;
    this.sendToWormhole = wormholeFn || null;

    this.discovery.setBroadcast((wire) => {
      broadcastFn(WormholeMessageType.WORMHOLE_ANNOUNCE, wire);
    });

    if (wormholeFn) {
      this.teleporter.setTransport(wormholeFn);
    }
  }

  /** Start the wormhole layer */
  start(): void {
    this.discovery.start();
  }

  /** Stop the wormhole layer */
  stop(): void {
    this.discovery.stop();
    this.teleporter.stop();
  }

  /** Subscribe to discovery events */
  onDiscoveryEvent(listener: (event: WormholeDiscoveryEvent) => void): void {
    this.discoveryListeners.add(listener);
  }

  /** Subscribe to teleport events */
  onTeleportEvent(listener: (event: TeleportEvent) => void): void {
    this.teleportListeners.add(listener);
  }

  // ══════════════════════════════════════
  // High-Level API
  // ══════════════════════════════════════

  /**
   * Declare this device as a wormhole to a remote mesh.
   */
  declareWormhole(remoteMeshFingerprint: string, remoteMeshLabel: string, latencyMs: number): void {
    this.discovery.declareWormhole(remoteMeshFingerprint, remoteMeshLabel, latencyMs);
  }

  /**
   * Teleport a Lifeform to a remote mesh.
   * Automatically selects the best wormhole.
   */
  teleport(
    lifeformName: string,
    lifeformId: string,
    destMeshFingerprint: string,
    reason: TeleportReason = TeleportReason.MANUAL,
  ): string | null {
    const wormhole = this.discovery.getBestWormholeTo(destMeshFingerprint);
    if (!wormhole) return null; // No wormhole available

    const request = this.teleporter.initiate(
      lifeformName, lifeformId, destMeshFingerprint,
      wormhole.localMeshId, reason,
    );

    return request?.id || null;
  }

  /**
   * Create a cross-mesh synapse between a local and remote Lifeform.
   */
  createCrossSynapse(
    localLifeformName: string,
    remoteLifeformName: string,
    remoteMeshFingerprint: string,
  ): CrossMeshSynapse | null {
    const wormhole = this.discovery.getBestWormholeTo(remoteMeshFingerprint);
    if (!wormhole) return null;

    return this.synapses.create(
      localLifeformName, remoteLifeformName,
      remoteMeshFingerprint, wormhole.localMeshId,
    );
  }

  /**
   * Send a signal through a cross-mesh synapse.
   */
  sendCrossSynapseSignal(synapseId: string, payload: string): boolean {
    const synapse = this.synapses.signal(synapseId);
    if (!synapse) return false;

    const wire: CrossSynapseRelayWire = {
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
      this.sendToWormhole(synapse.wormholeNodeId, WormholeMessageType.CROSS_SYNAPSE_RELAY, wire);
    } else if (this.sendMessage) {
      this.sendMessage(WormholeMessageType.CROSS_SYNAPSE_RELAY, wire);
    }

    return true;
  }

  // ══════════════════════════════════════
  // Message Handling
  // ══════════════════════════════════════

  /** Handle an incoming Layer 13 message */
  handleMessage(msgType: number, payload: any): void {
    switch (msgType) {
      case WormholeMessageType.WORMHOLE_ANNOUNCE:
        this.discovery.receiveAnnounce(payload as WormholeAnnounceWire);
        break;

      case WormholeMessageType.WORMHOLE_DIRECTORY:
        this.discovery.receiveDirectory(payload as WormholeDirectoryWire);
        break;

      case WormholeMessageType.TELEPORT_INITIATE:
        // Remote mesh is sending us a Lifeform — handled by next message
        break;

      case WormholeMessageType.TELEPORT_PAYLOAD:
        this.teleporter.receivePayload(payload as TeleportPayload);
        break;

      case WormholeMessageType.TELEPORT_ACK:
        this.teleporter.receiveAck(payload as TeleportAckWire);
        break;

      case WormholeMessageType.CROSS_SYNAPSE_RELAY:
        // Cross-mesh synapse signal received — forward to local Lifeform
        // The caller (CMPNode) routes this to the LifeformManager
        break;
    }
  }

  // ══════════════════════════════════════
  // Status
  // ══════════════════════════════════════

  getStatus(): WormholeStatus {
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

export interface WormholeStatus {
  isWormhole: boolean;
  localMeshFingerprint: string;
  activeWormholes: number;
  remoteMeshes: { fingerprint: string; label: string; wormholeCount: number; bestLatencyMs: number }[];
  activeTeleports: number;
  crossSynapses: number;
  stats: { discovery: any; teleporter: any };
}

// ─── Re-exports ───

export { WormholeDiscovery, WormholeDiscoveryEvent, SimpleBloomFilter } from './discovery';
export { LifeformTeleporter, TeleportEvent } from './teleporter';
