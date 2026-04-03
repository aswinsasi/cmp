/**
 * CMP v3.0 — V3 Bridge
 *
 * Attaches Layer 14 (Cortex), Layer 15 (Holographic), Layer 16 (GPU),
 * and cross-cutting systems (Neuromorphic, Entanglement, Meta-Evolution,
 * Dreaming) to an existing CMPNode instance.
 *
 * Follows the same pattern as V2Bridge:
 *   const v3 = new V3Bridge(node, lfManager);
 *   v3.start();
 *
 * What the bridge does:
 *   - Creates all v3.0 subsystem instances
 *   - Wires transport callbacks
 *   - Hooks into LifeformManager for entanglement sync
 *   - Starts idle monitoring for dreaming
 *   - Exposes all subsystems for CLI commands
 *
 * @module v3-bridge
 * @author Agent Viscro
 */

import { MeshMemory } from './holographic/mesh-memory';
import type { MeshMemoryTransport, MeshMemoryPeer } from './holographic/mesh-memory';
import type { ShardDescriptor } from './types/holographic';

import { NeuromorphicRouter } from './neuromorphic/router';

import { EntanglementManager } from './entanglement/manager';
import type { EntanglementStateAccessor } from './entanglement/manager';
import type { StateDelta } from './lifeform/crdt/crdt-state';

import { MeshCortex } from './cortex/mesh-cortex';
import type { CortexTransport } from './cortex/mesh-cortex';
import type { DeviceCapacity } from './cortex/partitioner';
import type { Tensor } from './types/cortex';

import { MeshGPU } from './gpu/mesh-gpu';
import type { MeshGPUTransport, GPUPeerInfo } from './gpu/mesh-gpu';
import type { GPUCapability } from './types/gpu';
import { NO_GPU } from './types/gpu';

import { ProtocolEvolver } from './meta-evolution/evolver';
import type { FitnessCollector } from './meta-evolution/evolver';
import type { ProtocolGenome, ProtocolFitness } from './types/meta-evolution';

import { DreamManager } from './dreaming/manager';
import type { DreamSubsystems } from './dreaming/manager';

// ─── V3 Status ───

export interface V3Status {
  /** Layer 14: Loaded models */
  cortexModels: number;
  cortexInferences: number;
  /** Layer 15: Keys in mesh memory */
  memoryKeys: number;
  memoryLocalShards: number;
  memoryLocalBytes: number;
  /** Layer 16: GPU devices */
  gpuDevices: number;
  gpuCompleted: number;
  /** Neuromorphic: connections and avg weight */
  neuralNodes: number;
  neuralConnections: number;
  neuralAvgWeight: number;
  /** Entanglement: active pairs */
  entanglements: number;
  entanglementSyncs: number;
  /** Meta-Evolution: generation */
  protocolGeneration: number;
  mutantWinRate: number;
  /** Dreaming */
  dreamState: string;
  totalDreams: number;
  fossils: number;
}

// ═══════════════════════════════════════

export class V3Bridge {
  /** Layer 14: Distributed neural inference */
  readonly cortex: MeshCortex;
  /** Layer 15: Erasure-coded shared memory */
  readonly memory: MeshMemory;
  /** Layer 16: GPU compute sharing */
  readonly gpu: MeshGPU;
  /** Cross-cutting: Spiking neural network routing */
  readonly router: NeuromorphicRouter;
  /** Cross-cutting: Bidirectional CRDT mirroring */
  readonly entanglement: EntanglementManager;
  /** Cross-cutting: Self-modifying protocol parameters */
  readonly evolver: ProtocolEvolver;
  /** Cross-cutting: Idle-time self-optimization */
  readonly dreaming: DreamManager;

  private started = false;

  constructor(
    private localDeviceId: string,
    private getPeers: () => Array<{ deviceId: string; address: string; latencyMs: number }>,
    private sendToPeer: (deviceId: string, data: Uint8Array) => Promise<void>,
    lifeformAccessor?: EntanglementStateAccessor,
  ) {
    // ── Create Memory transport adapter ──
    const memoryTransport: MeshMemoryTransport = {
      getLocalDeviceId: () => this.localDeviceId,
      getPeers: () => this.getPeers().map(p => ({
        deviceId: p.deviceId,
        availableBytes: 268435456,
        latencyMs: p.latencyMs,
      })),
      sendShard: async (peerId: string, shard: ShardDescriptor) => {
        // In full integration: encode + send via transport
        // For now: local-only storage
        return true;
      },
      requestShard: async () => null,
      queryShardLocations: async () => [],
    };

    // ── Create Cortex transport adapter ──
    const cortexTransport: CortexTransport = {
      getLocalDeviceId: () => this.localDeviceId,
      getDevices: () => {
        const peers = this.getPeers();
        const devices: DeviceCapacity[] = [
          { deviceId: this.localDeviceId, availableMemoryBytes: 536870912, computeSpeed: 1.0 },
        ];
        for (const p of peers) {
          devices.push({ deviceId: p.deviceId, availableMemoryBytes: 268435456, computeSpeed: 0.8 });
        }
        return devices;
      },
      sendActivation: async (deviceId, partitionId, activation, requestId) => {
        // In full integration: encode activation + send via transport + wait for response
        // For now: throw (forces local execution)
        throw new Error(`Remote execution not wired: ${deviceId}`);
      },
    };

    // ── Create GPU transport adapter ──
    const gpuTransport: MeshGPUTransport = {
      getLocalDeviceId: () => this.localDeviceId,
      getGPUPeers: () => {
        // In full integration: peers advertise GPU capability via L2
        return [];
      },
      sendGPUTask: async (deviceId, task) => {
        throw new Error(`Remote GPU not wired: ${deviceId}`);
      },
    };

    // ── Create subsystem instances ──
    this.memory = new MeshMemory(memoryTransport);
    this.cortex = new MeshCortex(cortexTransport);
    this.gpu = new MeshGPU(gpuTransport);
    this.router = new NeuromorphicRouter();
    this.entanglement = new EntanglementManager(
      lifeformAccessor ?? {
        applyDelta: () => false,
        isAlive: () => false,
        getStateKeys: () => [],
      }
    );
    this.evolver = new ProtocolEvolver();
    this.dreaming = new DreamManager();
  }

  // ═══════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════

  start(): void {
    if (this.started) return;
    this.started = true;

    // Register mesh peers as neuromorphic nodes
    this.router.addNode(this.localDeviceId);
    for (const p of this.getPeers()) {
      this.router.addNode(p.deviceId);
      this.router.ensureConnection(this.localDeviceId, p.deviceId);
      this.router.ensureConnection(p.deviceId, this.localDeviceId);
    }

    // Start neuromorphic decay
    this.router.startDecay();

    // Start dream monitoring
    this.dreaming.startMonitoring();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.router.stopDecay();
    this.dreaming.stopMonitoring();
    this.dreaming.destroy();
    this.entanglement.destroy();
  }

  // ═══════════════════════════════════════
  // Hooks (called by LifeformManager)
  // ═══════════════════════════════════════

  /** Called after every cause execution — triggers entanglement sync */
  onLifeformStateChange(lifeformName: string, delta: StateDelta): void {
    this.entanglement.onStateChange(lifeformName, delta);
    // Record activity for dreaming (prevents sleep)
    this.dreaming.recordActivity();
  }

  /** Called when a task completes — reinforces neuromorphic routes */
  onTaskSuccess(path: string[], taskType: string): void {
    this.router.reinforce(path, taskType);
  }

  /** Called when a task fails — weakens neuromorphic routes */
  onTaskFailure(path: string[], taskType: string): void {
    this.router.weaken(path, taskType);
  }

  /** Called when a peer joins */
  onPeerJoined(deviceId: string): void {
    this.router.addNode(deviceId);
    this.router.ensureConnection(this.localDeviceId, deviceId);
    this.router.ensureConnection(deviceId, this.localDeviceId);
  }

  /** Called when a peer leaves */
  onPeerLeft(deviceId: string): void {
    this.router.removeNode(deviceId);
  }

  // ═══════════════════════════════════════
  // Status
  // ═══════════════════════════════════════

  getStatus(): V3Status {
    const cortexStatus = this.cortex.getStatus();
    const memStats = this.memory.getStats();
    const gpuStatus = this.gpu.getStatus();
    const topo = this.router.getTopology();
    const entStats = this.entanglement.getStats();
    const evoStats = this.evolver.getStats();
    const dreamStats = this.dreaming.getStats();

    return {
      cortexModels: cortexStatus.models.length,
      cortexInferences: cortexStatus.completedInferences,
      memoryKeys: memStats.totalKeys,
      memoryLocalShards: memStats.localShards,
      memoryLocalBytes: memStats.localBytes,
      gpuDevices: gpuStatus.remoteGPUs.length + (gpuStatus.localGPU.available ? 1 : 0),
      gpuCompleted: gpuStatus.completedTasks,
      neuralNodes: topo.nodes.length,
      neuralConnections: topo.totalConnections,
      neuralAvgWeight: topo.avgWeight,
      entanglements: entStats.activeEntanglements,
      entanglementSyncs: entStats.totalDeltasSynced,
      protocolGeneration: evoStats.generation,
      mutantWinRate: evoStats.mutantWinRate,
      dreamState: dreamStats.state,
      totalDreams: dreamStats.totalDreams,
      fossils: dreamStats.fossils,
    };
  }
}
