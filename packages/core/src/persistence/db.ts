/**
 * CMP v1.4 — Persistence Layer
 * SQLite database for persisting Lifeform state across restarts.
 * Uses sql.js (pure JavaScript SQLite compiled to WASM).
 *
 * On platforms without sql.js or fs (React Native, browser),
 * the init() method will throw — callers should catch and operate
 * without persistence (in-memory only).
 *
 * Persists: Lifeform souls, CRDT state snapshots, intent contracts,
 * generation records, synapse connections, DNS records, migration history.
 *
 * @module persistence/db
 * @author Agent Viscro
 */

// Dynamic imports — resolved at init() time, not module load time.
// This allows the module to be imported on any platform without crashing.
let initSqlJs: any = null;
let fs: any = null;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ─── Schema ───

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lifeforms (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL,
  soul_json TEXT NOT NULL,
  config_json TEXT NOT NULL,
  genome_hash TEXT,
  host_id TEXT NOT NULL,
  ccu_balance REAL NOT NULL,
  causes_processed INTEGER DEFAULT 0,
  ccu_earned REAL DEFAULT 0,
  ccu_spent REAL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crdt_snapshots (
  lifeform_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (lifeform_id, sequence)
);

CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  lifeform_id TEXT NOT NULL,
  contract_json TEXT NOT NULL,
  consecutive_violations INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS generations (
  lifeform_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  record_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (lifeform_id, generation)
);

CREATE TABLE IF NOT EXISTS synapses (
  id TEXT PRIMARY KEY,
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL,
  strength REAL NOT NULL,
  causes_transmitted INTEGER DEFAULT 0,
  ccu_flowed REAL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dns_records (
  name TEXT PRIMARY KEY,
  lifeform_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  redirect TEXT,
  version INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_history (
  id TEXT PRIMARY KEY,
  lifeform_id TEXT NOT NULL,
  from_host TEXT NOT NULL,
  to_host TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  state_size INTEGER,
  error TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
`;

// ─── Serialization helpers for Uint8Array fields ───

function serializeSoul(soul: any): string {
  return JSON.stringify(soul, (key, value) => {
    if (value instanceof Uint8Array) return { _type: 'Uint8Array', hex: toHex(value) };
    return value;
  });
}

function deserializeSoul(json: string): any {
  return JSON.parse(json, (key, value) => {
    if (value && value._type === 'Uint8Array' && value.hex) return fromHex(value.hex);
    return value;
  });
}

// ─── CMP Database ───

export class CmpDatabase {
  private db: any | null = null;
  private filePath: string;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Initialize the database. Must be called before any operations.
   */
  async init(): Promise<void> {
    // Dynamic imports — allows this module to be imported on any platform
    if (!initSqlJs) initSqlJs = require('sql.js');
    if (!fs) try { fs = require('fs'); } catch {}

    const SQL = await initSqlJs();

    // Load existing database or create new
    if (fs && fs.existsSync(this.filePath)) {
      const buffer = fs.readFileSync(this.filePath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    // Create tables
    this.db.run(SCHEMA);

    // Auto-save every 30 seconds (only if filesystem available)
    if (fs) {
      this.autoSaveInterval = setInterval(() => this.saveToDisk(), 30000);
    }
  }

  /**
   * Save the in-memory database to disk.
   */
  saveToDisk(): void {
    if (!this.db || !fs) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.filePath, buffer);
  }

  /**
   * Close the database.
   */
  close(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
    this.saveToDisk();
    this.db?.close();
    this.db = null;
  }

  // ═══════════════════════════════════════
  // Lifeforms
  // ═══════════════════════════════════════

  saveLifeform(instance: any): void {
    if (!this.db) return;
    const idHex = toHex(instance.soul.id);
    this.db.run(
      `INSERT OR REPLACE INTO lifeforms (id, name, state, soul_json, config_json, genome_hash, host_id, ccu_balance, causes_processed, ccu_earned, ccu_spent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        idHex,
        instance.soul.name,
        instance.state,
        serializeSoul(instance.soul),
        JSON.stringify(instance.config, (k, v) => v instanceof Uint8Array ? { _type: 'Uint8Array', hex: toHex(v) } : v),
        instance.genomeHash ? toHex(instance.genomeHash) : null,
        toHex(instance.hostId),
        instance.ccuBalance,
        instance.causesProcessed,
        instance.ccuEarned,
        instance.ccuSpent,
        instance.soul.bornAt,
        Date.now(),
      ],
    );
  }

  loadLifeform(idHex: string): any | null {
    if (!this.db) return null;
    const results = this.db.exec(`SELECT * FROM lifeforms WHERE id = ?`, [idHex]);
    if (!results.length || !results[0].values.length) return null;

    const row = results[0].values[0];
    const columns = results[0].columns;
    const obj: any = {};
    columns.forEach((col, i) => obj[col] = row[i]);

    return {
      id: idHex,
      name: obj.name,
      state: obj.state,
      soul: deserializeSoul(obj.soul_json as string),
      config: JSON.parse(obj.config_json as string, (k, v) =>
        v && v._type === 'Uint8Array' ? fromHex(v.hex) : v),
      genomeHash: obj.genome_hash ? fromHex(obj.genome_hash as string) : null,
      hostId: obj.host_id,
      ccuBalance: obj.ccu_balance as number,
      causesProcessed: obj.causes_processed as number,
      ccuEarned: obj.ccu_earned as number,
      ccuSpent: obj.ccu_spent as number,
      createdAt: obj.created_at as number,
    };
  }

  loadAllLifeforms(): any[] {
    if (!this.db) return [];
    const results = this.db.exec(`SELECT id FROM lifeforms WHERE state != 'dead'`);
    if (!results.length) return [];
    return results[0].values.map(row => this.loadLifeform(row[0] as string)).filter(Boolean);
  }

  deleteLifeform(idHex: string): void {
    if (!this.db) return;
    this.db.run(`DELETE FROM lifeforms WHERE id = ?`, [idHex]);
  }

  updateLifeformState(idHex: string, state: string, ccuBalance: number, causesProcessed: number): void {
    if (!this.db) return;
    this.db.run(
      `UPDATE lifeforms SET state = ?, ccu_balance = ?, causes_processed = ?, updated_at = ? WHERE id = ?`,
      [state, ccuBalance, causesProcessed, Date.now(), idHex],
    );
  }

  // ═══════════════════════════════════════
  // CRDT Snapshots
  // ═══════════════════════════════════════

  saveSnapshot(lifeformIdHex: string, snapshotJson: string, sizeBytes: number, sequence: number): void {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO crdt_snapshots (lifeform_id, snapshot_json, size_bytes, sequence, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [lifeformIdHex, snapshotJson, sizeBytes, sequence, Date.now()],
    );
  }

  loadLatestSnapshot(lifeformIdHex: string): { snapshotJson: string; sequence: number } | null {
    if (!this.db) return null;
    const results = this.db.exec(
      `SELECT snapshot_json, sequence FROM crdt_snapshots WHERE lifeform_id = ? ORDER BY sequence DESC LIMIT 1`,
      [lifeformIdHex],
    );
    if (!results.length || !results[0].values.length) return null;
    const row = results[0].values[0];
    return { snapshotJson: row[0] as string, sequence: row[1] as number };
  }

  // ═══════════════════════════════════════
  // Intents
  // ═══════════════════════════════════════

  saveIntent(intentIdHex: string, lifeformIdHex: string, contractJson: string): void {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO intents (id, lifeform_id, contract_json, consecutive_violations, created_at)
       VALUES (?, ?, ?, 0, ?)`,
      [intentIdHex, lifeformIdHex, contractJson, Date.now()],
    );
  }

  loadIntentsForLifeform(lifeformIdHex: string): Array<{ id: string; contractJson: string; violations: number }> {
    if (!this.db) return [];
    const results = this.db.exec(
      `SELECT id, contract_json, consecutive_violations FROM intents WHERE lifeform_id = ?`,
      [lifeformIdHex],
    );
    if (!results.length) return [];
    return results[0].values.map(row => ({
      id: row[0] as string,
      contractJson: row[1] as string,
      violations: row[2] as number,
    }));
  }

  deleteIntent(intentIdHex: string): void {
    if (!this.db) return;
    this.db.run(`DELETE FROM intents WHERE id = ?`, [intentIdHex]);
  }

  // ═══════════════════════════════════════
  // Generations
  // ═══════════════════════════════════════

  saveGeneration(lifeformIdHex: string, generation: number, recordJson: string): void {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO generations (lifeform_id, generation, record_json, created_at) VALUES (?, ?, ?, ?)`,
      [lifeformIdHex, generation, recordJson, Date.now()],
    );
  }

  loadGenerations(lifeformIdHex: string): Array<{ generation: number; recordJson: string }> {
    if (!this.db) return [];
    const results = this.db.exec(
      `SELECT generation, record_json FROM generations WHERE lifeform_id = ? ORDER BY generation`,
      [lifeformIdHex],
    );
    if (!results.length) return [];
    return results[0].values.map(row => ({
      generation: row[0] as number,
      recordJson: row[1] as string,
    }));
  }

  // ═══════════════════════════════════════
  // Synapses
  // ═══════════════════════════════════════

  saveSynapse(idHex: string, fromName: string, toName: string, strength: number, causesTransmitted: number, ccuFlowed: number): void {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO synapses (id, from_name, to_name, strength, causes_transmitted, ccu_flowed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [idHex, fromName, toName, strength, causesTransmitted, ccuFlowed, Date.now(), Date.now()],
    );
  }

  loadAllSynapses(): Array<{ id: string; fromName: string; toName: string; strength: number; causesTransmitted: number }> {
    if (!this.db) return [];
    const results = this.db.exec(`SELECT id, from_name, to_name, strength, causes_transmitted FROM synapses`);
    if (!results.length) return [];
    return results[0].values.map(row => ({
      id: row[0] as string,
      fromName: row[1] as string,
      toName: row[2] as string,
      strength: row[3] as number,
      causesTransmitted: row[4] as number,
    }));
  }

  deleteSynapse(idHex: string): void {
    if (!this.db) return;
    this.db.run(`DELETE FROM synapses WHERE id = ?`, [idHex]);
  }

  // ═══════════════════════════════════════
  // DNS
  // ═══════════════════════════════════════

  saveDnsRecord(name: string, lifeformIdHex: string, hostId: string, redirect: string | null, version: number): void {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO dns_records (name, lifeform_id, host_id, redirect, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, lifeformIdHex, hostId, redirect, version, Date.now()],
    );
  }

  loadAllDnsRecords(): Array<{ name: string; lifeformId: string; hostId: string; redirect: string | null; version: number }> {
    if (!this.db) return [];
    const results = this.db.exec(`SELECT name, lifeform_id, host_id, redirect, version FROM dns_records`);
    if (!results.length) return [];
    return results[0].values.map(row => ({
      name: row[0] as string,
      lifeformId: row[1] as string,
      hostId: row[2] as string,
      redirect: row[3] as string | null,
      version: row[4] as number,
    }));
  }

  deleteDnsRecord(name: string): void {
    if (!this.db) return;
    this.db.run(`DELETE FROM dns_records WHERE name = ?`, [name]);
  }

  // ═══════════════════════════════════════
  // Migration History
  // ═══════════════════════════════════════

  saveMigration(record: any): void {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO migration_history (id, lifeform_id, from_host, to_host, status, reason, state_size, error, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        toHex(record.id), toHex(record.lifeformId),
        toHex(record.fromHostId), toHex(record.toHostId),
        record.status, record.reason, record.stateSize,
        record.error, record.startedAt, record.completedAt,
      ],
    );
  }

  // ═══════════════════════════════════════
  // Utility
  // ═══════════════════════════════════════

  /** Get table row counts for stats */
  getStats(): Record<string, number> {
    if (!this.db) return {};
    const tables = ['lifeforms', 'crdt_snapshots', 'intents', 'generations', 'synapses', 'dns_records', 'migration_history'];
    const stats: Record<string, number> = {};
    for (const table of tables) {
      const res = this.db.exec(`SELECT COUNT(*) FROM ${table}`);
      stats[table] = res.length ? (res[0].values[0][0] as number) : 0;
    }
    return stats;
  }

  /** Clear all data (for testing) */
  clear(): void {
    if (!this.db) return;
    const tables = ['lifeforms', 'crdt_snapshots', 'intents', 'generations', 'synapses', 'dns_records', 'migration_history'];
    for (const table of tables) {
      this.db.run(`DELETE FROM ${table}`);
    }
  }
}
