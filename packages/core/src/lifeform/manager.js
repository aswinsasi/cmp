"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifeformManager = void 0;
const lifeform_1 = require("../types/lifeform");
const causal_1 = require("../types/causal");
const crdt_state_1 = require("./crdt/crdt-state");
const cause_queue_1 = require("./cause-queue");
const causal_executor_1 = require("./causal-executor");
const lifecycle_1 = require("./lifecycle");
const dns_1 = require("./dns");
const synapse_1 = require("./synapse");
const replication_1 = require("./replication");
const migration_1 = require("./migration");
const host_selector_1 = require("./host-selector");
const crypto_1 = require("./crypto");
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomBytes(n) {
    const bytes = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < n; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}
const DEFAULT_CONFIG = {
    maxHostedLifeforms: 20,
    deviceId: 'unknown',
    billing: causal_1.DEFAULT_CAUSE_BILLING,
    hostingChargeIntervalMs: 3600000,
    snapshotEveryNCauses: 100,
};
// ═══════════════════════════════════════
class LifeformManager {
    lifeforms = new Map();
    nameIndex = new Map();
    config;
    dns;
    synapses;
    replication;
    migration;
    hostSelector;
    hostingTimer = null;
    running = false;
    /** Remote cause delivery callback */
    sendCauseFn = null;
    /** Remote delta replication callback */
    sendDeltaFn = null;
    /** Persistence database (optional) */
    db = null;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.dns = new dns_1.LifeformDNS();
        this.synapses = new synapse_1.SynapseManager();
        this.replication = new replication_1.ReplicationManager();
        this.migration = new migration_1.MigrationManager();
        this.hostSelector = new host_selector_1.HostSelector();
    }
    // ═══════════════════════════════════════
    // Hooks
    // ═══════════════════════════════════════
    onSendCause(fn) { this.sendCauseFn = fn; }
    onSendDelta(fn) { this.sendDeltaFn = fn; }
    setDatabase(db) { this.db = db; }
    // ═══════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════
    start() {
        this.running = true;
        this.dns.start();
        this.hostingTimer = setInterval(() => this.chargeHostingCosts(), this.config.hostingChargeIntervalMs);
    }
    /**
     * Recover all alive Lifeforms from persistence.
     * Call after start() when a database is set.
     */
    async recover() {
        if (!this.db)
            return 0;
        let recovered = 0;
        try {
            const saved = this.db.loadAllLifeforms();
            for (const record of saved) {
                if (record.state === 'dead')
                    continue;
                try {
                    const soul = record.soul;
                    const config = record.config;
                    const idHex = record.id;
                    const hostId = new TextEncoder().encode(this.config.deviceId).slice(0, 16);
                    const lifecycle = new lifecycle_1.LifeformLifecycle(soul, config, hostId, this.config.billing);
                    lifecycle.setGenomeHash(record.genomeHash || (0, crypto_1.hashGenome)(config.wasmModule));
                    const state = new crdt_state_1.CRDTState(idHex);
                    const snapshot = this.db.loadLatestSnapshot(idHex);
                    if (snapshot)
                        state.restore(JSON.parse(snapshot.snapshotJson));
                    // Restore CCU
                    const diff = record.ccuBalance - lifecycle.ccuBalance;
                    if (diff > 0)
                        lifecycle.earnCcu(diff);
                    const causeQueue = new cause_queue_1.CauseQueue({ maxSize: 10000, maxCausesPerSecond: config.maxCausesPerSecond, maxChainDepth: 64 });
                    const executor = new causal_executor_1.CausalExecutor(lifecycle, state, this.config.billing);
                    executor.onTimer((tc) => causeQueue.enqueue(tc));
                    const hosted = { lifecycle, state, causeQueue, executor, causeHandler: null, wasmExports: null };
                    this.lifeforms.set(idHex, hosted);
                    this.nameIndex.set(soul.name, idHex);
                    this.dns.register(soul.name, idHex, this.config.deviceId);
                    this.replication.initializeReplica(idHex, this.config.deviceId);
                    lifecycle.transitionTo(lifeform_1.LifeformState.ALIVE, 'Recovered');
                    executor.start();
                    recovered++;
                }
                catch { /* skip corrupted */ }
            }
        }
        catch { }
        // Restore synapses
        try {
            for (const syn of this.db.loadAllSynapses()) {
                this.synapses.createSynapse(syn.fromName, syn.toName);
            }
        }
        catch { }
        return recovered;
    }
    stop() {
        this.running = false;
        this.dns.stop();
        if (this.hostingTimer) {
            clearInterval(this.hostingTimer);
            this.hostingTimer = null;
        }
        for (const [, hosted] of this.lifeforms) {
            hosted.executor.stop();
            hosted.lifecycle.transitionTo(lifeform_1.LifeformState.DEAD, 'Manager shutdown');
        }
    }
    // ═══════════════════════════════════════
    // Spawn
    // ═══════════════════════════════════════
    spawn(config, spawnerId) {
        if (this.lifeforms.size >= this.config.maxHostedLifeforms)
            return null;
        if (!this.dns.isAvailable(config.name))
            return null;
        const keypair = (0, crypto_1.generateKeypair)();
        const soul = {
            id: (0, crypto_1.generateId)(), name: config.name,
            publicKey: keypair.publicKey, secretKey: keypair.secretKey,
            creatorId: spawnerId ?? (0, crypto_1.generateId)(), bornAt: Date.now(),
            generation: 0, parentId: null,
        };
        const idHex = toHex(soul.id);
        const genomeHash = (0, crypto_1.hashGenome)(config.wasmModule);
        const hostId = new TextEncoder().encode(this.config.deviceId).slice(0, 16);
        const lifecycle = new lifecycle_1.LifeformLifecycle(soul, config, hostId, this.config.billing);
        lifecycle.setGenomeHash(genomeHash);
        const state = new crdt_state_1.CRDTState(idHex);
        if (config.initialState) {
            for (const [key, value] of Object.entries(config.initialState))
                state.set(key, value);
        }
        const causeQueue = new cause_queue_1.CauseQueue({ maxSize: 10000, maxCausesPerSecond: config.maxCausesPerSecond, maxChainDepth: 64 });
        const executor = new causal_executor_1.CausalExecutor(lifecycle, state, this.config.billing);
        executor.onTimer((tc) => causeQueue.enqueue(tc));
        const hosted = { lifecycle, state, causeQueue, executor, causeHandler: null, wasmExports: null };
        this.lifeforms.set(idHex, hosted);
        this.nameIndex.set(config.name, idHex);
        this.dns.register(config.name, idHex, this.config.deviceId);
        this.replication.initializeReplica(idHex, this.config.deviceId);
        lifecycle.transitionTo(lifeform_1.LifeformState.ALIVE, 'Spawned');
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
    tryWasmInit(hosted, config) {
        try {
            if (config.wasmModule.length <= 8)
                return;
            if (config.wasmModule[0] !== 0x00 || config.wasmModule[1] !== 0x61)
                return;
            const module = new WebAssembly.Module(config.wasmModule);
            const instance = new WebAssembly.Instance(module);
            const exports = instance.exports;
            if (typeof exports.onCause === 'function') {
                hosted.wasmExports = exports;
                hosted.causeHandler = async (cause) => {
                    const result = exports.onCause(cause.type);
                    hosted.state.set('wasm_last_result', result);
                    hosted.state.set('wasm_cause_count', (hosted.state.get('wasm_cause_count') ?? 0) + 1);
                    return { stateMutations: 2, outgoingCauses: [] };
                };
                hosted.executor.setHandler(hosted.causeHandler);
            }
        }
        catch { /* Not valid WASM — use JS handler */ }
    }
    // ═══════════════════════════════════════
    // Cause Handling
    // ═══════════════════════════════════════
    setHandler(lifeformName, handler) {
        const hosted = this.getByName(lifeformName);
        if (!hosted)
            return false;
        hosted.causeHandler = handler;
        hosted.executor.setHandler(handler);
        return true;
    }
    async deliverCause(targetName, cause) {
        const resolved = this.dns.resolve(targetName);
        if (!resolved.record)
            return false;
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
    async processLocalCause(lifeformIdHex, cause) {
        const hosted = this.lifeforms.get(lifeformIdHex);
        if (!hosted || !hosted.lifecycle.isProcessable || !hosted.causeHandler)
            return false;
        const enqResult = hosted.causeQueue.enqueue(cause);
        if (enqResult !== cause_queue_1.EnqueueResult.OK)
            return false;
        const nextCause = hosted.causeQueue.dequeue();
        if (!nextCause)
            return false;
        const result = await hosted.executor.executeCause(nextCause);
        if (!result.success)
            return false;
        // Bill CCU
        hosted.lifecycle.recordCauseExecution(result.ccuCost);
        if (nextCause.ccuAttached > 0)
            hosted.lifecycle.earnCcu(nextCause.ccuAttached);
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
                try {
                    await this.sendDeltaFn(hostId, lifeformIdHex, delta);
                }
                catch { }
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
    kill(name, reason = 'manual') {
        const idHex = this.nameIndex.get(name);
        if (!idHex)
            return false;
        const hosted = this.lifeforms.get(idHex);
        if (!hosted)
            return false;
        hosted.executor.stop();
        hosted.lifecycle.transitionTo(lifeform_1.LifeformState.DEAD, reason);
        // Persist death
        if (this.db) {
            try {
                this.db.updateLifeformState(idHex, 'dead', hosted.lifecycle.ccuBalance, hosted.lifecycle.causesProcessed);
            }
            catch { }
        }
        this.synapses.removeAllFor(name);
        this.dns.unregister(name);
        this.replication.removeAll(idHex);
        this.lifeforms.delete(idHex);
        this.nameIndex.delete(name);
        return true;
    }
    createSynapse(fromName, toName) {
        const syn = this.synapses.createSynapse(fromName, toName);
        if (syn && this.db) {
            try {
                this.db.saveSynapse(toHex(syn.id), fromName, toName, syn.strength, 0, 0);
            }
            catch { }
        }
        return syn !== null;
    }
    getByName(name) {
        const idHex = this.nameIndex.get(name);
        if (!idHex)
            return null;
        return this.lifeforms.get(idHex) ?? null;
    }
    getById(idHex) { return this.lifeforms.get(idHex) ?? null; }
    getAllInstances() { return [...this.lifeforms.values()].map(h => h.lifecycle.getInstance()); }
    getNames() { return [...this.nameIndex.keys()]; }
    // ═══════════════════════════════════════
    // Persistence
    // ═══════════════════════════════════════
    persistLifeform(hosted, idHex) {
        if (!this.db)
            return;
        try {
            this.db.saveLifeform(hosted.lifecycle.getInstance());
            this.persistSnapshot(hosted, idHex);
        }
        catch { }
    }
    persistSnapshot(hosted, idHex) {
        if (!this.db)
            return;
        try {
            const snap = hosted.state.snapshot();
            this.db.saveSnapshot(idHex, JSON.stringify(snap), snap.sizeBytes, hosted.lifecycle.causesProcessed);
        }
        catch { }
    }
    /** Force-persist all Lifeforms and DNS (call before shutdown) */
    persistAll() {
        if (!this.db)
            return;
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
    getDNS() { return this.dns; }
    getSynapses() { return this.synapses; }
    getReplication() { return this.replication; }
    getMigration() { return this.migration; }
    get hostedCount() { return this.lifeforms.size; }
    get remainingCapacity() { return this.config.maxHostedLifeforms - this.lifeforms.size; }
    getStats() {
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
    chargeHostingCosts() {
        for (const [, hosted] of this.lifeforms) {
            if (hosted.lifecycle.isDead)
                continue;
            const cost = hosted.lifecycle.chargeHostingCost(hosted.state.estimateSize());
            if (cost === -1)
                this.kill(hosted.lifecycle.name, 'Cannot afford hosting cost');
        }
    }
}
exports.LifeformManager = LifeformManager;
//# sourceMappingURL=manager.js.map