"use strict";
/**
 * CMP v4.0 — V3 State Store
 *
 * SQLite-backed persistence for ALL v3 subsystem state.
 * Allows CMP nodes to survive restarts: state is checkpointed
 * periodically and restored on startup.
 *
 * Persisted subsystems:
 *   - Consciousness (pheromone field, quorum signals, behavior)
 *   - Spacetime (DAG snapshots, branch metadata)
 *   - Wormholes (known remote meshes, tunnel state)
 *   - Precognition (predictions, dream fossils)
 *   - Immune System (antibodies, quarantine list, threat history)
 *   - Metabolism (profiles, energy budgets)
 *   - Morphogenesis (affinities, organ state)
 *   - Cortex (model partitions, weight checkpoints) — via cortex-checkpoint.ts
 *   - Holographic Memory (local shard index)
 *   - Entanglement (pair state)
 *   - Meta-Evolution (genome state)
 *
 * Architecture:
 *   - Generic `v3_state` table: subsystem + key → JSON blob
 *   - Dedicated `cortex_checkpoints` table for binary model weights
 *   - Schema versioning via `schema_version` table + state-migrator.ts
 *   - Auto-save every 60s for crash recovery
 *   - Manual save/load/clear via CLI commands
 *
 * Uses sql.js (pure JS SQLite via WASM) — same as existing CmpDatabase.
 *
 * @module persistence/v3-state-store
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.V3StateStore = exports.Subsystem = void 0;
exports.serializeJSON = serializeJSON;
exports.deserializeJSON = deserializeJSON;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('V3State');
// ─── Hex Helpers ───
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}
// ─── Schema ───
const CURRENT_SCHEMA_VERSION = 1;
const V3_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS v3_state (
  subsystem TEXT NOT NULL,
  key TEXT NOT NULL,
  data_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (subsystem, key)
);

CREATE TABLE IF NOT EXISTS cortex_checkpoints (
  model_id TEXT NOT NULL,
  partition_id INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  weights_hex TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model_id, partition_id)
);

CREATE TABLE IF NOT EXISTS save_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  save_type TEXT NOT NULL,
  subsystems_saved INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v3_state_subsystem ON v3_state(subsystem);
CREATE INDEX IF NOT EXISTS idx_v3_state_updated ON v3_state(updated_at);
CREATE INDEX IF NOT EXISTS idx_cortex_model ON cortex_checkpoints(model_id);
`;
// ─── Subsystem Names ───
var Subsystem;
(function (Subsystem) {
    Subsystem["CONSCIOUSNESS"] = "consciousness";
    Subsystem["SPACETIME"] = "spacetime";
    Subsystem["WORMHOLE"] = "wormhole";
    Subsystem["PRECOGNITION"] = "precognition";
    Subsystem["IMMUNE"] = "immune";
    Subsystem["METABOLISM"] = "metabolism";
    Subsystem["MORPHOGENESIS"] = "morphogenesis";
    Subsystem["CORTEX"] = "cortex";
    Subsystem["HOLOGRAPHIC"] = "holographic";
    Subsystem["ENTANGLEMENT"] = "entanglement";
    Subsystem["META_EVOLUTION"] = "meta_evolution";
    Subsystem["DREAMING"] = "dreaming";
    Subsystem["MCL"] = "mcl";
})(Subsystem || (exports.Subsystem = Subsystem = {}));
// ─── JSON Serializer (handles Uint8Array) ───
function serializeJSON(data) {
    return JSON.stringify(data, (_key, value) => {
        if (value instanceof Uint8Array) {
            return { __t: 'u8', h: toHex(value) };
        }
        if (value instanceof Map) {
            return { __t: 'map', e: Array.from(value.entries()) };
        }
        if (value instanceof Set) {
            return { __t: 'set', v: Array.from(value) };
        }
        return value;
    });
}
function deserializeJSON(json) {
    return JSON.parse(json, (_key, value) => {
        if (value && typeof value === 'object') {
            if (value.__t === 'u8' && typeof value.h === 'string') {
                return fromHex(value.h);
            }
            if (value.__t === 'map' && Array.isArray(value.e)) {
                return new Map(value.e);
            }
            if (value.__t === 'set' && Array.isArray(value.v)) {
                return new Set(value.v);
            }
        }
        return value;
    });
}
// ─── V3 State Store ───
class V3StateStore {
    db = null;
    filePath;
    autoSaveInterval = null;
    initialized = false;
    dirty = false;
    constructor(filePath) {
        this.filePath = filePath;
    }
    // ══════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════
    /**
     * Initialize the database. Must be called before any operations.
     */
    async init() {
        if (this.initialized)
            return;
        let initSqlJs;
        let fs;
        try {
            initSqlJs = require('sql.js');
        }
        catch {
            throw new Error('sql.js is required for V3StateStore. Install: npm install sql.js');
        }
        try {
            fs = require('fs');
        }
        catch {
            // No filesystem — in-memory only
        }
        const SQL = await initSqlJs();
        // Load existing database or create new
        if (fs && fs.existsSync(this.filePath)) {
            const buffer = fs.readFileSync(this.filePath);
            this.db = new SQL.Database(buffer);
            log.info(`Loaded v3 state from ${this.filePath}`);
        }
        else {
            this.db = new SQL.Database();
            log.info(`Created new v3 state store`);
        }
        // Create tables
        this.db.run(V3_SCHEMA);
        // Insert or verify schema version
        const versionResult = this.db.exec('SELECT version FROM schema_version WHERE id = 1');
        if (versionResult.length === 0 || versionResult[0].values.length === 0) {
            this.db.run('INSERT INTO schema_version (id, version, created_at, updated_at) VALUES (1, ?, ?, ?)', [CURRENT_SCHEMA_VERSION, Date.now(), Date.now()]);
        }
        this.initialized = true;
        this.flush();
        // Auto-save every 60 seconds
        this.autoSaveInterval = setInterval(() => {
            if (this.dirty) {
                this.flush();
                this.dirty = false;
            }
        }, 60000);
        log.info('V3 State Store initialized');
    }
    /**
     * Close the database. Flushes to disk and cleans up.
     */
    close() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
        this.flush();
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        this.initialized = false;
        log.info('V3 State Store closed');
    }
    /**
     * Check if initialized.
     */
    isInitialized() {
        return this.initialized;
    }
    // ══════════════════════════════════════
    // Generic State API
    // ══════════════════════════════════════
    /**
     * Save any subsystem state to SQLite.
     * Data is JSON-serialized with Uint8Array/Map/Set support.
     */
    saveState(subsystem, key, data) {
        this.ensureInit();
        const json = serializeJSON(data);
        const sizeBytes = Buffer.byteLength(json, 'utf8');
        const now = Date.now();
        this.db.run(`INSERT OR REPLACE INTO v3_state (subsystem, key, data_json, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM v3_state WHERE subsystem = ? AND key = ?), ?), ?)`, [subsystem, key, json, sizeBytes, subsystem, key, now, now]);
        this.dirty = true;
    }
    /**
     * Load subsystem state from SQLite.
     * Returns null if key does not exist.
     */
    loadState(subsystem, key) {
        this.ensureInit();
        const results = this.db.exec('SELECT data_json FROM v3_state WHERE subsystem = ? AND key = ?', [subsystem, key]);
        if (results.length === 0 || results[0].values.length === 0)
            return null;
        return deserializeJSON(results[0].values[0][0]);
    }
    /**
     * Load all keys for a subsystem.
     */
    loadAllKeys(subsystem) {
        this.ensureInit();
        const results = this.db.exec('SELECT key FROM v3_state WHERE subsystem = ?', [subsystem]);
        if (results.length === 0)
            return [];
        return results[0].values.map((row) => row[0]);
    }
    /**
     * Load all state entries for a subsystem.
     */
    loadAll(subsystem) {
        this.ensureInit();
        const results = this.db.exec('SELECT key, data_json, updated_at FROM v3_state WHERE subsystem = ?', [subsystem]);
        if (results.length === 0)
            return [];
        return results[0].values.map((row) => ({
            key: row[0],
            data: deserializeJSON(row[1]),
            updatedAt: row[2],
        }));
    }
    /**
     * Delete a specific state entry.
     */
    deleteState(subsystem, key) {
        this.ensureInit();
        this.db.run('DELETE FROM v3_state WHERE subsystem = ? AND key = ?', [subsystem, key]);
        this.dirty = true;
    }
    /**
     * Delete all state for a subsystem.
     */
    clearSubsystem(subsystem) {
        this.ensureInit();
        this.db.run('DELETE FROM v3_state WHERE subsystem = ?', [subsystem]);
        this.dirty = true;
    }
    // ══════════════════════════════════════
    // Cortex Checkpoint API
    // ══════════════════════════════════════
    /**
     * Save a Cortex model partition checkpoint.
     */
    checkpointModel(modelId, partitionId, manifest, weights) {
        this.ensureInit();
        const manifestJson = JSON.stringify(manifest);
        const weightsHex = toHex(weights);
        const sizeBytes = weights.length;
        const now = Date.now();
        this.db.run(`INSERT OR REPLACE INTO cortex_checkpoints
       (model_id, partition_id, manifest_json, weights_hex, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM cortex_checkpoints WHERE model_id = ? AND partition_id = ?), ?), ?)`, [modelId, partitionId, manifestJson, weightsHex, sizeBytes, modelId, partitionId, now, now]);
        this.dirty = true;
        log.info(`Checkpointed model ${modelId} partition ${partitionId} (${(sizeBytes / 1024).toFixed(1)} KB)`);
    }
    /**
     * Restore a Cortex model partition checkpoint.
     */
    restoreModel(modelId, partitionId) {
        this.ensureInit();
        let query = 'SELECT * FROM cortex_checkpoints WHERE model_id = ?';
        const params = [modelId];
        if (partitionId !== undefined) {
            query += ' AND partition_id = ?';
            params.push(partitionId);
        }
        query += ' ORDER BY partition_id';
        const results = this.db.exec(query, params);
        if (results.length === 0)
            return [];
        const cols = results[0].columns;
        return results[0].values.map((row) => {
            const obj = {};
            cols.forEach((col, i) => { obj[col] = row[i]; });
            return {
                modelId: obj.model_id,
                partitionId: obj.partition_id,
                manifest: JSON.parse(obj.manifest_json),
                weights: fromHex(obj.weights_hex),
                sizeBytes: obj.size_bytes,
                createdAt: obj.created_at,
            };
        });
    }
    /**
     * List all checkpointed models.
     */
    listModels() {
        this.ensureInit();
        const results = this.db.exec(`SELECT model_id, COUNT(*) as parts, SUM(size_bytes) as total_bytes
       FROM cortex_checkpoints GROUP BY model_id`);
        if (results.length === 0)
            return [];
        return results[0].values.map((row) => ({
            modelId: row[0],
            partitions: row[1],
            totalBytes: row[2],
        }));
    }
    /**
     * Delete a model checkpoint.
     */
    deleteModel(modelId) {
        this.ensureInit();
        this.db.run('DELETE FROM cortex_checkpoints WHERE model_id = ?', [modelId]);
        this.dirty = true;
    }
    // ══════════════════════════════════════
    // Save History
    // ══════════════════════════════════════
    /**
     * Record a save operation in history.
     */
    recordSave(saveType, subsystemsSaved, totalBytes, durationMs) {
        this.ensureInit();
        this.db.run('INSERT INTO save_history (save_type, subsystems_saved, total_bytes, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)', [saveType, subsystemsSaved, totalBytes, durationMs, Date.now()]);
        // Keep only last 100 entries
        this.db.run(`DELETE FROM save_history WHERE id NOT IN (
        SELECT id FROM save_history ORDER BY created_at DESC LIMIT 100
      )`);
        this.dirty = true;
    }
    // ══════════════════════════════════════
    // Info & Stats
    // ══════════════════════════════════════
    /**
     * Get comprehensive state store info.
     */
    getInfo() {
        this.ensureInit();
        // Schema version
        const vResult = this.db.exec('SELECT version FROM schema_version WHERE id = 1');
        const schemaVersion = vResult.length > 0 ? vResult[0].values[0][0] : 0;
        // Subsystem counts
        const subResult = this.db.exec('SELECT subsystem, COUNT(*) FROM v3_state GROUP BY subsystem');
        const subsystemCounts = {};
        if (subResult.length > 0) {
            for (const row of subResult[0].values) {
                subsystemCounts[row[0]] = row[1];
            }
        }
        // Cortex checkpoint count
        const cResult = this.db.exec('SELECT COUNT(*) FROM cortex_checkpoints');
        const cortexCheckpoints = cResult.length > 0 ? cResult[0].values[0][0] : 0;
        // Total entries
        const tResult = this.db.exec('SELECT COUNT(*) FROM v3_state');
        const totalEntries = tResult.length > 0 ? tResult[0].values[0][0] : 0;
        // Last save
        const sResult = this.db.exec('SELECT save_type, duration_ms, created_at FROM save_history ORDER BY created_at DESC LIMIT 1');
        let lastSaveAt = null;
        let lastSaveType = null;
        let lastSaveDurationMs = null;
        if (sResult.length > 0 && sResult[0].values.length > 0) {
            lastSaveType = sResult[0].values[0][0];
            lastSaveDurationMs = sResult[0].values[0][1];
            lastSaveAt = sResult[0].values[0][2];
        }
        // Save history (last 10)
        const hResult = this.db.exec('SELECT save_type, subsystems_saved, total_bytes, duration_ms, created_at FROM save_history ORDER BY created_at DESC LIMIT 10');
        const saveHistory = [];
        if (hResult.length > 0) {
            for (const row of hResult[0].values) {
                saveHistory.push({
                    saveType: row[0],
                    subsystemsSaved: row[1],
                    totalBytes: row[2],
                    durationMs: row[3],
                    createdAt: row[4],
                });
            }
        }
        // DB size
        let dbSizeBytes = 0;
        try {
            const fs = require('fs');
            if (fs.existsSync(this.filePath)) {
                dbSizeBytes = fs.statSync(this.filePath).size;
            }
        }
        catch { /* no fs */ }
        return {
            schemaVersion,
            dbSizeBytes,
            subsystemCounts,
            cortexCheckpoints,
            totalEntries,
            lastSaveAt,
            lastSaveType,
            lastSaveDurationMs,
            saveHistory,
        };
    }
    /**
     * Get the current schema version.
     */
    getSchemaVersion() {
        this.ensureInit();
        const result = this.db.exec('SELECT version FROM schema_version WHERE id = 1');
        if (result.length === 0 || result[0].values.length === 0)
            return 0;
        return result[0].values[0][0];
    }
    /**
     * Update the schema version.
     */
    setSchemaVersion(version) {
        this.ensureInit();
        this.db.run('UPDATE schema_version SET version = ?, updated_at = ? WHERE id = 1', [version, Date.now()]);
        this.dirty = true;
    }
    // ══════════════════════════════════════
    // Bulk Operations
    // ══════════════════════════════════════
    /**
     * Save multiple state entries in a single transaction.
     * Much faster than individual saves for bulk operations.
     */
    saveStateBatch(entries) {
        this.ensureInit();
        const now = Date.now();
        let totalBytes = 0;
        this.db.run('BEGIN TRANSACTION');
        try {
            for (const { subsystem, key, data } of entries) {
                const json = serializeJSON(data);
                const sizeBytes = Buffer.byteLength(json, 'utf8');
                totalBytes += sizeBytes;
                this.db.run(`INSERT OR REPLACE INTO v3_state (subsystem, key, data_json, size_bytes, created_at, updated_at)
           VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM v3_state WHERE subsystem = ? AND key = ?), ?), ?)`, [subsystem, key, json, sizeBytes, subsystem, key, now, now]);
            }
            this.db.run('COMMIT');
        }
        catch (err) {
            this.db.run('ROLLBACK');
            throw err;
        }
        this.dirty = true;
        return totalBytes;
    }
    /**
     * Clear ALL state (all subsystems + cortex checkpoints).
     */
    clearAll() {
        this.ensureInit();
        this.db.run('DELETE FROM v3_state');
        this.db.run('DELETE FROM cortex_checkpoints');
        this.db.run('DELETE FROM save_history');
        this.flush();
        log.info('All v3 state cleared');
    }
    // ══════════════════════════════════════
    // Disk I/O
    // ══════════════════════════════════════
    /**
     * Flush in-memory database to disk.
     */
    flush() {
        if (!this.db)
            return;
        try {
            const fs = require('fs');
            const path = require('path');
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = this.db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.filePath, buffer);
        }
        catch {
            // No filesystem — in-memory only
        }
    }
    /**
     * Force save and flush to disk immediately.
     */
    forceSave() {
        this.flush();
        this.dirty = false;
    }
    // ══════════════════════════════════════
    // Internal
    // ══════════════════════════════════════
    ensureInit() {
        if (!this.initialized) {
            throw new Error('V3StateStore not initialized. Call init() first.');
        }
    }
}
exports.V3StateStore = V3StateStore;
//# sourceMappingURL=v3-state-store.js.map