/**
 * CMP v3.0 — Mesh Data Collector
 * Gathers real-time state from all CMP subsystems for the visualizer.
 *
 * Produces a MeshSnapshot every intervalMs that contains:
 *   - Device topology (nodes + connections)
 *   - Lifeform positions and states
 *   - Synapse connections + strengths
 *   - Cause flow rates
 *   - Pheromone concentrations
 *   - CCU economy flow
 *   - GPU availability
 *   - Memory pool usage
 *   - Metabolic states
 *   - Dream state
 *
 * @module visualizer/mesh-data-collector
 * @author Agent Viscro
 */

// ─── Mesh Snapshot (sent to visualizer) ───

export interface MeshSnapshot {
  timestamp: number;
  localDeviceId: string;

  /** Devices in the mesh */
  devices: DeviceSnapshot[];
  /** Connections between devices */
  connections: ConnectionSnapshot[];
  /** Lifeforms hosted across the mesh */
  lifeforms: LifeformSnapshot[];
  /** Synapse connections between Lifeforms */
  synapses: SynapseSnapshot[];
  /** Recent cause flow (last 100) */
  causeFlow: CauseFlowEntry[];
  /** Mesh-wide stats */
  stats: MeshStats;
}

export interface DeviceSnapshot {
  deviceId: string;
  isLocal: boolean;
  latencyMs: number;
  hostedLifeforms: number;
  metabolicState: string;
  cpuCores: number;
  memoryMB: number;
  batteryPercent: number;
  hasGPU: boolean;
  gpuName: string;
}

export interface ConnectionSnapshot {
  fromDevice: string;
  toDevice: string;
  transport: string;
  latencyMs: number;
  bytesPerSec: number;
}

export interface LifeformSnapshot {
  name: string;
  state: string;
  hostDevice: string;
  ccuBalance: number;
  causesProcessed: number;
  generation: number;
  isFused: boolean;
  entangledWith: string[];
  stateKeys: number;
}

export interface SynapseSnapshot {
  from: string;
  to: string;
  strength: number;
  causesTransmitted: number;
}

export interface CauseFlowEntry {
  from: string;
  to: string;
  causeType: string;
  ccuAttached: number;
  timestamp: number;
}

export interface MeshStats {
  totalDevices: number;
  totalLifeforms: number;
  totalSynapses: number;
  causesPerSec: number;
  ccuFlowPerSec: number;
  meshBehavior: string;
  pheromones: Record<string, number>;
  memoryPoolBytes: number;
  memoryPoolUsed: number;
  gpuDevices: number;
  dreamState: string;
  neuromorphicConnections: number;
  neuromorphicAvgWeight: number;
  protocolGeneration: number;
}

// ─── Data Source Interface ───

export interface MeshDataSource {
  getLocalDeviceId(): string;
  getDevices(): DeviceSnapshot[];
  getConnections(): ConnectionSnapshot[];
  getLifeforms(): LifeformSnapshot[];
  getSynapses(): SynapseSnapshot[];
  getRecentCauses(limit: number): CauseFlowEntry[];
  getStats(): MeshStats;
}

// ─── Collector ───

export class MeshDataCollector {
  private source: MeshDataSource;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private subscribers: Set<(snapshot: MeshSnapshot) => void> = new Set();
  private lastSnapshot: MeshSnapshot | null = null;

  constructor(source: MeshDataSource) {
    this.source = source;
  }

  /** Start collecting snapshots at intervalMs */
  start(intervalMs: number = 1000): void {
    if (this.intervalTimer) return;
    this.collect(); // immediate first
    this.intervalTimer = setInterval(() => this.collect(), intervalMs);
  }

  /** Stop collecting */
  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /** Subscribe to snapshot updates */
  subscribe(callback: (snapshot: MeshSnapshot) => void): () => void {
    this.subscribers.add(callback);
    // Send last snapshot immediately
    if (this.lastSnapshot) callback(this.lastSnapshot);
    return () => this.subscribers.delete(callback);
  }

  /** Get the latest snapshot */
  getLatest(): MeshSnapshot | null {
    return this.lastSnapshot;
  }

  /** Collect a snapshot now */
  collect(): MeshSnapshot {
    const snapshot: MeshSnapshot = {
      timestamp: Date.now(),
      localDeviceId: this.source.getLocalDeviceId(),
      devices: this.source.getDevices(),
      connections: this.source.getConnections(),
      lifeforms: this.source.getLifeforms(),
      synapses: this.source.getSynapses(),
      causeFlow: this.source.getRecentCauses(100),
      stats: this.source.getStats(),
    };

    this.lastSnapshot = snapshot;
    for (const cb of this.subscribers) {
      try { cb(snapshot); } catch {}
    }

    return snapshot;
  }
}

// ─── Mock Data Source (for demo / testing) ───

export class MockMeshDataSource implements MeshDataSource {
  private tick = 0;

  getLocalDeviceId(): string { return 'local-001'; }

  getDevices(): DeviceSnapshot[] {
    return [
      { deviceId: 'local-001', isLocal: true, latencyMs: 0, hostedLifeforms: 3, metabolicState: 'HOMEOSTATIC', cpuCores: 8, memoryMB: 16384, batteryPercent: 85, hasGPU: true, gpuName: 'RTX 3060' },
      { deviceId: 'phone-002', isLocal: false, latencyMs: 5, hostedLifeforms: 2, metabolicState: 'HOMEOSTATIC', cpuCores: 8, memoryMB: 6144, batteryPercent: 72, hasGPU: false, gpuName: '' },
      { deviceId: 'tablet-003', isLocal: false, latencyMs: 8, hostedLifeforms: 1, metabolicState: 'CATABOLIC', cpuCores: 4, memoryMB: 4096, batteryPercent: 23, hasGPU: false, gpuName: '' },
    ];
  }

  getConnections(): ConnectionSnapshot[] {
    return [
      { fromDevice: 'local-001', toDevice: 'phone-002', transport: 'LAN', latencyMs: 5, bytesPerSec: 50000 },
      { fromDevice: 'local-001', toDevice: 'tablet-003', transport: 'LAN', latencyMs: 8, bytesPerSec: 30000 },
      { fromDevice: 'phone-002', toDevice: 'tablet-003', transport: 'BLE', latencyMs: 15, bytesPerSec: 10000 },
    ];
  }

  getLifeforms(): LifeformSnapshot[] {
    this.tick++;
    return [
      { name: 'sensor-alpha', state: 'ALIVE', hostDevice: 'local-001', ccuBalance: 87.5 - this.tick * 0.1, causesProcessed: 142 + this.tick, generation: 0, isFused: false, entangledWith: ['sensor-beta'], stateKeys: 5 },
      { name: 'sensor-beta', state: 'ALIVE', hostDevice: 'phone-002', ccuBalance: 65.2 - this.tick * 0.05, causesProcessed: 98 + this.tick, generation: 0, isFused: false, entangledWith: ['sensor-alpha'], stateKeys: 4 },
      { name: 'processor-1', state: 'ALIVE', hostDevice: 'local-001', ccuBalance: 120 + this.tick * 0.2, causesProcessed: 340 + this.tick * 2, generation: 3, isFused: false, entangledWith: [], stateKeys: 8 },
      { name: 'matcher', state: 'ALIVE', hostDevice: 'local-001', ccuBalance: 45.0, causesProcessed: 56, generation: 0, isFused: false, entangledWith: [], stateKeys: 12 },
      { name: 'monitor-1', state: 'ALIVE', hostDevice: 'phone-002', ccuBalance: 30.0, causesProcessed: 22, generation: 1, isFused: false, entangledWith: [], stateKeys: 3 },
      { name: 'edge-node', state: 'HIBERNATING', hostDevice: 'tablet-003', ccuBalance: 5.0, causesProcessed: 8, generation: 0, isFused: false, entangledWith: [], stateKeys: 2 },
    ];
  }

  getSynapses(): SynapseSnapshot[] {
    return [
      { from: 'sensor-alpha', to: 'processor-1', strength: 0.85, causesTransmitted: 120 },
      { from: 'sensor-beta', to: 'processor-1', strength: 0.72, causesTransmitted: 88 },
      { from: 'processor-1', to: 'matcher', strength: 0.60, causesTransmitted: 200 },
      { from: 'matcher', to: 'monitor-1', strength: 0.45, causesTransmitted: 40 },
      { from: 'sensor-alpha', to: 'sensor-beta', strength: 0.90, causesTransmitted: 150 },
    ];
  }

  getRecentCauses(limit: number): CauseFlowEntry[] {
    const types = ['MESSAGE', 'SYNAPSE_SIGNAL', 'TIMER', 'STATE_WATCH'];
    const names = ['sensor-alpha', 'sensor-beta', 'processor-1', 'matcher', 'monitor-1'];
    const entries: CauseFlowEntry[] = [];
    for (let i = 0; i < Math.min(limit, 20); i++) {
      entries.push({
        from: names[Math.floor(Math.random() * names.length)],
        to: names[Math.floor(Math.random() * names.length)],
        causeType: types[Math.floor(Math.random() * types.length)],
        ccuAttached: Math.random() * 2,
        timestamp: Date.now() - i * 500,
      });
    }
    return entries;
  }

  getStats(): MeshStats {
    return {
      totalDevices: 3,
      totalLifeforms: 6,
      totalSynapses: 5,
      causesPerSec: 42 + Math.floor(Math.random() * 20),
      ccuFlowPerSec: 3.2 + Math.random() * 2,
      meshBehavior: 'HIGH_DEMAND',
      pheromones: { compute_success: 1.2, danger: 0.3, idle: 0.1, resource_request: 0.8 },
      memoryPoolBytes: 268435456,
      memoryPoolUsed: 104857600,
      gpuDevices: 1,
      dreamState: 'AWAKE',
      neuromorphicConnections: 18,
      neuromorphicAvgWeight: 0.62,
      protocolGeneration: 7,
    };
  }
}
