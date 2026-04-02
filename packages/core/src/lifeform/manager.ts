/**
 * CMP v1.4 — Lifeform Manager (Fully Integrated)
 *
 * Integrates ALL subsystems:
 *   - Lifecycle, CauseQueue, CausalExecutor, CRDTState
 *   - HostSelector, Migration, Replication, DNS, Synapses
 *   - Persistence (SQLite auto-save on spawn/kill, auto-recover on start)
 *   - WASM Runtime (real genome execution when valid WASM provided)
 *   - Delta Replication (sends deltas to replica hosts via transport)
 *
 * @module lifeform/manager
 * @author Agent Viscro
 */

import { LifeformSoul, LifeformState, LifeformConfig, LifeformInstance } from '../types/lifeform';
import { Cause, CauseType, CauseBilling, DEFAULT_CAUSE_BILLING, calculateCauseCost } from '../types/causal';
import { CRDTState } from './crdt/crdt-state';
import { CauseQueue, EnqueueResult } from './cause-queue';
import { CausalExecutor, CauseHandler } from './causal-executor';
import { LifeformLifecycle } from './lifecycle';
import { LifeformDNS } from './dns';
import { SynapseManager } from './synapse';
import { ReplicationManager } from './replication';
import { MigrationManager, MigrationReason } from './migration';
import { HostSelector, HostCandidate } from './host-selector';
import { generateKeypair, generateId, hashGenome } from './crypto';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// ─── Hosted Lifeform ───

export interface HostedLifeform {
  lifecycle: LifeformLifecycle;
  state: CRDTState;
  causeQueue: CauseQueue;
  executor: CausalExecutor;
  causeHandler: CauseHandler | null;
  /** Real WASM exports (when genome is real WASM) */
  wasmExports: any | null;
}

// ─── Manager Config ───

export interface LifeformManagerConfig {
  maxHostedLifeforms: number;
  deviceId: string;
  billing: CauseBilling;
  hostingChargeIntervalMs: number;
  /** Auto-snapshot every N causes (0 = disabled) */
  snapshotEveryNCauses: number;
}

const DEFAULT_CONFIG: LifeformManagerConfig = {
  maxHostedLifeforms: 20,
  deviceId: 'unknown',
  billing: DEFAULT_CAUSE_BILLING,
  hostingChargeIntervalMs: 3600000,
  snapshotEveryNCauses: 100,
};

// ═══════════════════════════════════════

export class LifeformManager {
  private lifeforms = new Map<string, HostedLifeform>();
  private nameIndex = new Map<string, string>();

  private config: LifeformManagerConfig;
  private dns: LifeformDNS;
  private synapses: SynapseManager;
  private replication: ReplicationManager;
  private migration: MigrationManager;
  private hostSelector: HostSelector;

  private hostingTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Remote cause delivery callback */
  private sendCauseFn: ((targetHost: string, cause: Cause) => Promise<void>) | null = null;
  /** Remote delta replication callback */
  private sendDeltaFn: ((targetHost: string, lifeformIdHex: string, delta: any) => Promise<void>) | null = null;
  /** Persistence database (optional) */
  private db: any | null = null;

  constructor(config?: Partial<LifeformManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dns = new LifeformDNS();
    this.synapses = new SynapseManager();
    this.replication = new ReplicationManager();
    this.migration = new MigrationManager();
    this.hostSelector = new HostSelector();
  }

  // ═══════════════════════════════════════
  // Hooks
  // ═══════════════════════════════════════

  onSendCause(fn: (targetHost: string, cause: Cause) => Promise<void>): void { this.sendCauseFn = fn; }
  onSendDelta(fn: (targetHost: string, lfId: string, delta: any) => Promise<void>): void { this.sendDeltaFn = fn; }
  setDatabase(db: any): void { this.db = db; }

  // ═══════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════

  start(): void {
    this.running = true;
    this.dns.start();
    this.hostingTimer = setInterval(() => this.chargeHostingCosts(), this.config.hostingChargeIntervalMs);
  }

  /**
   * Recover all alive Lifeforms from persistence.
   * Call after start() when a database is set.
   */
  async recover(): Promise<number> {
    if (!this.db) return 0;
    let recovered = 0;

    try {
      const saved = this.db.loadAllLifeforms();
      for (const record of saved) {
        if (record.state === 'dead') continue;
        try {
          const soul: LifeformSoul = record.soul;
          const config: LifeformConfig = record.config;
          const idHex = record.id;

          const hostId = new TextEncoder().encode(this.config.deviceId).slice(0, 16);
          const lifecycle = new LifeformLifecycle(soul, config, hostId, this.config.billing);
          lifecycle.setGenomeHash(record.genomeHash || hashGenome(config.wasmModule));

          const state = new CRDTState(idHex);
          const snapshot = this.db.loadLatestSnapshot(idHex);
          if (snapshot) state.restore(JSON.parse(snapshot.snapshotJson));

          // Restore CCU
          const diff = record.ccuBalance - lifecycle.ccuBalance;
          if (diff > 0) lifecycle.earnCcu(diff);

          const causeQueue = new CauseQueue({ maxSize: 10000, maxCausesPerSecond: config.maxCausesPerSecond, maxChainDepth: 64 });
          const executor = new CausalExecutor(lifecycle, state, this.config.billing);
          executor.onTimer((tc) => causeQueue.enqueue(tc));

          const hosted: HostedLifeform = { lifecycle, state, causeQueue, executor, causeHandler: null, wasmExports: null };

          this.lifeforms.set(idHex, hosted);
          this.nameIndex.set(soul.name, idHex);
          this.dns.register(soul.name, idHex, this.config.deviceId);
          this.replication.initializeReplica(idHex, this.config.deviceId);
          lifecycle.transitionTo(LifeformState.ALIVE, 'Recovered');
          executor.start();

          recovered++;
        } catch { /* skip corrupted */ }
      }
    } catch {}

    // Restore synapses
    try {
      for (const syn of this.db.loadAllSynapses()) {
        this.synapses.createSynapse(syn.fromName, syn.toName);
      }
    } catch {}

    return recovered;
  }

  stop(): void {
    this.running = false;
    this.dns.stop();
    if (this.hostingTimer) { clearInterval(this.hostingTimer); this.hostingTimer = null; }
    for (const [, hosted] of this.lifeforms) {
      hosted.executor.stop();
      hosted.lifecycle.transitionTo(LifeformState.DEAD, 'Manager shutdown');
    }
  }

  // ═══════════════════════════════════════
  // Spawn
  // ═══════════════════════════════════════

  spawn(config: LifeformConfig, spawnerId?: Uint8Array): HostedLifeform | null {
    if (this.lifeforms.size >= this.config.maxHostedLifeforms) return null;
    if (!this.dns.isAvailable(config.name)) return null;

    const keypair = generateKeypair();
    const soul: LifeformSoul = {
      id: generateId(), name: config.name,
      publicKey: keypair.publicKey, secretKey: keypair.secretKey,
      creatorId: spawnerId ?? generateId(), bornAt: Date.now(),
      generation: 0, parentId: null,
    };

    const idHex = toHex(soul.id);
    const genomeHash = hashGenome(config.wasmModule);

    const hostId = new TextEncoder().encode(this.config.deviceId).slice(0, 16);
    const lifecycle = new LifeformLifecycle(soul, config, hostId, this.config.billing);
    lifecycle.setGenomeHash(genomeHash);

    const state = new CRDTState(idHex);
    if (config.initialState) {
      for (const [key, value] of Object.entries(config.initialState)) state.set(key, value);
    }

    const causeQueue = new CauseQueue({ maxSize: 10000, maxCausesPerSecond: config.maxCausesPerSecond, maxChainDepth: 64 });
    const executor = new CausalExecutor(lifecycle, state, this.config.billing);
    executor.onTimer((tc) => causeQueue.enqueue(tc));

    const hosted: HostedLifeform = { lifecycle, state, causeQueue, executor, causeHandler: null, wasmExports: null };

    this.lifeforms.set(idHex, hosted);
    this.nameIndex.set(config.name, idHex);
    this.dns.register(config.name, idHex, this.config.deviceId);
    this.replication.initializeReplica(idHex, this.config.deviceId);
    lifecycle.transitionTo(LifeformState.ALIVE, 'Spawned');
    executor.start();

    // WASM integration: auto-instantiate real WASM genomes
    this.tryWasmInit(hosted, config);

    // Persistence: auto-save on spawn
    this.persistLifeform(hosted, idHex);

    return hosted;
  }

  // ═══════════════════════════════════════
  // WASM Integration
  // ═══════════════════════════════════════

  private tryWasmInit(hosted: HostedLifeform, config: LifeformConfig): void {
    try {
      if (config.wasmModule.length <= 8) return;
      if (config.wasmModule[0] !== 0x00 || config.wasmModule[1] !== 0x61) return;

      const module = new WebAssembly.Module(config.wasmModule);
      const instance = new WebAssembly.Instance(module);
      const exports = instance.exports as any;

      if (typeof exports.onCause === 'function') {
        hosted.wasmExports = exports;
        hosted.causeHandler = async (cause: Cause) => {
          const result = exports.onCause(cause.type);
          hosted.state.set('wasm_last_result', result);
          hosted.state.set('wasm_cause_count', (hosted.state.get('wasm_cause_count') ?? 0) + 1);
          return { stateMutations: 2, outgoingCauses: [] };
        };
        hosted.executor.setHandler(hosted.causeHandler);
      }
    } catch { /* Not valid WASM — use JS handler */ }
  }

  // ═══════════════════════════════════════
  // Cause Handling
  // ═══════════════════════════════════════

  setHandler(lifeformName: string, handler: CauseHandler): boolean {
    const hosted = this.getByName(lifeformName);
    if (!hosted) return false;
    hosted.causeHandler = handler;
    hosted.executor.setHandler(handler);
    return true;
  }

  async deliverCause(targetName: string, cause: Cause): Promise<boolean> {
    const resolved = this.dns.resolve(targetName);
    if (!resolved.record) return false;
    const targetHost = resolved.record.hostId;

    if (targetHost === this.config.deviceId) {
      return this.processLocalCause(resolved.record.lifeformId, cause);
    }
    if (this.sendCauseFn) {
      cause.targetId = new TextEncoder().encode(resolved.record.lifeformId).slice(0, 16);
      await this.sendCauseFn(targetHost, cause);
      return true;
    }
    return false;
  }

  async processLocalCause(lifeformIdHex: string, cause: Cause): Promise<boolean> {
    const hosted = this.lifeforms.get(lifeformIdHex);
    if (!hosted || !hosted.lifecycle.isProcessable || !hosted.causeHandler) return false;

    const enqResult = hosted.causeQueue.enqueue(cause);
    if (enqResult !== EnqueueResult.OK) return false;

    const nextCause = hosted.causeQueue.dequeue();
    if (!nextCause) return false;

    const result = await hosted.executor.executeCause(nextCause);
    if (!result.success) return false;

    // Bill CCU
    hosted.lifecycle.recordCauseExecution(result.ccuCost);
    if (nextCause.ccuAttached > 0) hosted.lifecycle.earnCcu(nextCause.ccuAttached);

    // CCU death check
    if (hosted.lifecycle.ccuBalance <= 0) {
      this.kill(hosted.lifecycle.name, 'CCU depleted');
      return true;
    }

    // Outgoing causes via synapses
    for (const outgoing of result.outgoingCauses) {
      const targetName = new TextDecoder().decode(outgoing.targetId).replace(/\0/g, '');
      if (targetName) {
        this.synapses.transmit(hosted.lifecycle.name, targetName, outgoing.ccuAttached);
        await this.deliverCause(targetName, outgoing);
      }
    }

    // Delta replication to remote secondaries
    const delta = hosted.state.extractDelta();
    if (delta.changedKeys.length > 0 && this.sendDeltaFn) {
      const secondaries = this.replication.getSecondaryHosts(lifeformIdHex);
      for (const hostId of secondaries) {
        try { await this.sendDeltaFn(hostId, lifeformIdHex, delta); } catch {}
      }
    }

    // Auto-snapshot for persistence
    if (this.db && this.config.snapshotEveryNCauses > 0 &&
        hosted.lifecycle.causesProcessed % this.config.snapshotEveryNCauses === 0) {
      this.persistSnapshot(hosted, lifeformIdHex);
    }

    return true;
  }

  // ═══════════════════════════════════════
  // Operations
  // ═══════════════════════════════════════

  kill(name: string, reason: string = 'manual'): boolean {
    const idHex = this.nameIndex.get(name);
    if (!idHex) return false;
    const hosted = this.lifeforms.get(idHex);
    if (!hosted) return false;

    hosted.executor.stop();
    hosted.lifecycle.transitionTo(LifeformState.DEAD, reason);

    // Persist death
    if (this.db) {
      try { this.db.updateLifeformState(idHex, 'dead', hosted.lifecycle.ccuBalance, hosted.lifecycle.causesProcessed); } catch {}
    }

    this.synapses.removeAllFor(name);
    this.dns.unregister(name);
    this.replication.removeAll(idHex);
    this.lifeforms.delete(idHex);
    this.nameIndex.delete(name);
    return true;
  }

  createSynapse(fromName: string, toName: string): boolean {
    const syn = this.synapses.createSynapse(fromName, toName);
    if (syn && this.db) {
      try { this.db.saveSynapse(toHex(syn.id), fromName, toName, syn.strength, 0, 0); } catch {}
    }
    return syn !== null;
  }

  getByName(name: string): HostedLifeform | null {
    const idHex = this.nameIndex.get(name);
    if (!idHex) return null;
    return this.lifeforms.get(idHex) ?? null;
  }

  getById(idHex: string): HostedLifeform | null { return this.lifeforms.get(idHex) ?? null; }
  getAllInstances(): LifeformInstance[] { return [...this.lifeforms.values()].map(h => h.lifecycle.getInstance()); }
  getNames(): string[] { return [...this.nameIndex.keys()]; }

  // ═══════════════════════════════════════
  // Persistence
  // ═══════════════════════════════════════

  private persistLifeform(hosted: HostedLifeform, idHex: string): void {
    if (!this.db) return;
    try {
      this.db.saveLifeform(hosted.lifecycle.getInstance());
      this.persistSnapshot(hosted, idHex);
    } catch {}
  }

  private persistSnapshot(hosted: HostedLifeform, idHex: string): void {
    if (!this.db) return;
    try {
      const snap = hosted.state.snapshot();
      this.db.saveSnapshot(idHex, JSON.stringify(snap), snap.sizeBytes, hosted.lifecycle.causesProcessed);
    } catch {}
  }

  /** Force-persist all Lifeforms and DNS (call before shutdown) */
  persistAll(): void {
    if (!this.db) return;
    for (const [idHex, hosted] of this.lifeforms) {
      this.db.saveLifeform(hosted.lifecycle.getInstance());
      this.persistSnapshot(hosted, idHex);
    }
    for (const record of this.dns.getAll()) {
      this.db.saveDnsRecord(record.name, record.lifeformId, record.hostId, record.redirect, record.version);
    }
    this.db.saveToDisk();
  }

  // ═══════════════════════════════════════
  // Subsystems
  // ═══════════════════════════════════════

  getDNS(): LifeformDNS { return this.dns; }
  getSynapses(): SynapseManager { return this.synapses; }
  getReplication(): ReplicationManager { return this.replication; }
  getMigration(): MigrationManager { return this.migration; }

  get hostedCount(): number { return this.lifeforms.size; }
  get remainingCapacity(): number { return this.config.maxHostedLifeforms - this.lifeforms.size; }

  getStats(): { hosted: number; capacity: number; totalCausesProcessed: number; totalCcuBalance: number; dnsEntries: number; synapses: number } {
    let totalCauses = 0, totalCcu = 0;
    for (const hosted of this.lifeforms.values()) {
      totalCauses += hosted.lifecycle.causesProcessed;
      totalCcu += hosted.lifecycle.ccuBalance;
    }
    return { hosted: this.lifeforms.size, capacity: this.config.maxHostedLifeforms, totalCausesProcessed: totalCauses, totalCcuBalance: totalCcu, dnsEntries: this.dns.size, synapses: this.synapses.totalCount };
  }

  // ═══════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════

  private chargeHostingCosts(): void {
    for (const [, hosted] of this.lifeforms) {
      if (hosted.lifecycle.isDead) continue;
      const cost = hosted.lifecycle.chargeHostingCost(hosted.state.estimateSize());
      if (cost === -1) this.kill(hosted.lifecycle.name, 'Cannot afford hosting cost');
    }
  }
}
