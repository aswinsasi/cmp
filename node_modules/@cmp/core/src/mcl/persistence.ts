/**
 * CMP MER Persistence — SQLite Storage
 * Saves MERs to disk so they survive node restarts.
 *
 * Uses sql.js (pure JS SQLite via WebAssembly) for maximum
 * portability — no native compilation required.
 *
 * Architecture:
 *   - MERs stored in a single `mers` table with all fields
 *   - Binary fields (merId, meshSignature, etc.) stored as hex strings
 *   - Database file written to disk on every mutation (auto-flush)
 *   - Loaded from disk on initialization
 *
 * Integration:
 *   - MERStore accepts an optional MERPersistence instance
 *   - When set, all store/remove/purge operations are persisted
 *   - When not set, everything stays in-memory (existing behavior)
 *
 * @module mcl/persistence
 * @author Agent Viscro
 */

import fs from 'fs';
import path from 'path';
import { toHex, Logger } from '../';
import type { CMP_MER } from '../types/mcl';
import { merToWire, merFromWire } from './mer';

const log = new Logger('MERPersist');

/** Persistence interface — allows swapping SQLite for other backends */
export interface IMERPersistence {
  /** Load all MERs from storage */
  loadAll(): CMP_MER[];
  /** Save a single MER */
  save(mer: CMP_MER): void;
  /** Delete a MER by ID */
  delete(merIdHex: string): void;
  /** Delete multiple MERs by ID */
  deleteMany(merIdHexes: string[]): void;
  /** Get count of stored MERs */
  count(): number;
  /** Close the database connection */
  close(): void;
}

/**
 * SQLite-based MER persistence using sql.js.
 *
 * The database file is written to disk after every mutation.
 * On startup, the file is loaded into memory if it exists.
 */
export class SQLiteMERPersistence implements IMERPersistence {
  private db: any = null;
  private dbPath: string;
  private sqljs: any = null;
  private initialized = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Initialize the database. Must be called before any other method.
   * This is async because sql.js requires async initialization.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Dynamic import of sql.js
    const initSqlJs = require('sql.js');
    this.sqljs = await initSqlJs();

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing database or create new
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new this.sqljs.Database(fileBuffer);
      log.info(`Loaded MER database from ${this.dbPath}`);
    } else {
      this.db = new this.sqljs.Database();
      log.info(`Created new MER database at ${this.dbPath}`);
    }

    // Create table if not exists
    this.db.run(`
      CREATE TABLE IF NOT EXISTS mers (
        mer_id TEXT PRIMARY KEY,
        task_type INTEGER NOT NULL,
        mesh_signature TEXT NOT NULL,
        device_count INTEGER NOT NULL,
        strategy_used INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        avg_chunk_size_kb REAL NOT NULL,
        perf_total_time_ms INTEGER NOT NULL,
        perf_overhead_pct INTEGER NOT NULL,
        perf_efficiency INTEGER NOT NULL,
        perf_fault_events INTEGER NOT NULL,
        perf_reassignment_count INTEGER NOT NULL,
        hint_chunk_size_kb INTEGER NOT NULL,
        hint_device_count INTEGER NOT NULL,
        hint_tier_mapping TEXT NOT NULL,
        hint_bottleneck_flags INTEGER NOT NULL,
        environment_hash TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        generation INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        ttl_days INTEGER NOT NULL,
        origin_mesh_hash TEXT NOT NULL,
        signature TEXT NOT NULL
      )
    `);

    // Create indexes for common queries
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_mers_task_type ON mers(task_type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_mers_confidence ON mers(confidence)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_mers_created ON mers(created_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_mers_origin ON mers(origin_mesh_hash)`);

    this.initialized = true;
    this.flush();
  }

  /**
   * Load all MERs from the database.
   */
  loadAll(): CMP_MER[] {
    this.ensureInit();
    const results = this.db.exec('SELECT * FROM mers');
    if (results.length === 0) return [];

    const mers: CMP_MER[] = [];
    const cols = results[0].columns as string[];
    const rows = results[0].values as any[][];

    for (const row of rows) {
      const obj: any = {};
      cols.forEach((col, i) => { obj[col] = row[i]; });

      try {
        const mer = this.rowToMER(obj);
        mers.push(mer);
      } catch (err: any) {
        log.warn(`Failed to deserialize MER ${obj.mer_id}: ${err.message}`);
      }
    }

    log.info(`Loaded ${mers.length} MERs from SQLite`);
    return mers;
  }

  /**
   * Save a single MER to the database.
   */
  save(mer: CMP_MER): void {
    this.ensureInit();
    const merIdHex = toHex(mer.merId);

    this.db.run(`
      INSERT OR REPLACE INTO mers (
        mer_id, task_type, mesh_signature, device_count, strategy_used,
        chunk_count, avg_chunk_size_kb,
        perf_total_time_ms, perf_overhead_pct, perf_efficiency,
        perf_fault_events, perf_reassignment_count,
        hint_chunk_size_kb, hint_device_count, hint_tier_mapping, hint_bottleneck_flags,
        environment_hash, confidence, generation, created_at, ttl_days,
        origin_mesh_hash, signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      merIdHex,
      mer.taskType,
      toHex(mer.meshSignature),
      mer.deviceCount,
      mer.strategyUsed,
      mer.chunkCount,
      mer.avgChunkSizeKb,
      mer.performance.totalTimeMs,
      mer.performance.distributionOverheadPct,
      mer.performance.executionEfficiency,
      mer.performance.faultEvents,
      mer.performance.reassignmentCount,
      mer.learnedHints.optimalChunkSizeKb,
      mer.learnedHints.optimalDeviceCount,
      toHex(mer.learnedHints.bestTierMapping),
      mer.learnedHints.bottleneckFlags,
      toHex(mer.environmentHash),
      mer.confidence,
      mer.generation,
      mer.createdAt,
      mer.ttlDays,
      toHex(mer.originMeshHash),
      toHex(mer.signature),
    ]);

    this.flush();
    log.debug(`Saved MER ${merIdHex.substring(0, 8)} to SQLite`);
  }

  /**
   * Delete a MER by hex ID.
   */
  delete(merIdHex: string): void {
    this.ensureInit();
    this.db.run('DELETE FROM mers WHERE mer_id = ?', [merIdHex]);
    this.flush();
  }

  /**
   * Delete multiple MERs by hex IDs.
   */
  deleteMany(merIdHexes: string[]): void {
    this.ensureInit();
    if (merIdHexes.length === 0) return;

    // Use transaction for bulk delete
    this.db.run('BEGIN TRANSACTION');
    for (const hex of merIdHexes) {
      this.db.run('DELETE FROM mers WHERE mer_id = ?', [hex]);
    }
    this.db.run('COMMIT');
    this.flush();
  }

  /**
   * Get count of stored MERs.
   */
  count(): number {
    this.ensureInit();
    const result = this.db.exec('SELECT COUNT(*) FROM mers');
    return result.length > 0 ? result[0].values[0][0] as number : 0;
  }

  /**
   * Close the database and flush to disk.
   */
  close(): void {
    if (this.db) {
      this.flush();
      this.db.close();
      this.db = null;
      this.initialized = false;
      log.info('MER database closed');
    }
  }

  /**
   * Write the in-memory database to disk.
   */
  private flush(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (err: any) {
      log.warn(`Failed to flush MER database: ${err.message}`);
    }
  }

  /**
   * Convert a database row to a CMP_MER object.
   */
  private rowToMER(row: any): CMP_MER {
    const fromHexLocal = (hex: string): Uint8Array => {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      return bytes;
    };

    return {
      merId: fromHexLocal(row.mer_id),
      taskType: row.task_type,
      meshSignature: fromHexLocal(row.mesh_signature),
      deviceCount: row.device_count,
      strategyUsed: row.strategy_used,
      chunkCount: row.chunk_count,
      avgChunkSizeKb: row.avg_chunk_size_kb,
      performance: {
        totalTimeMs: row.perf_total_time_ms,
        distributionOverheadPct: row.perf_overhead_pct,
        executionEfficiency: row.perf_efficiency,
        faultEvents: row.perf_fault_events,
        reassignmentCount: row.perf_reassignment_count,
      },
      learnedHints: {
        optimalChunkSizeKb: row.hint_chunk_size_kb,
        optimalDeviceCount: row.hint_device_count,
        bestTierMapping: fromHexLocal(row.hint_tier_mapping),
        bottleneckFlags: row.hint_bottleneck_flags,
      },
      environmentHash: fromHexLocal(row.environment_hash),
      confidence: row.confidence,
      generation: row.generation,
      createdAt: row.created_at,
      ttlDays: row.ttl_days,
      originMeshHash: fromHexLocal(row.origin_mesh_hash),
      signature: fromHexLocal(row.signature),
    };
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error('MERPersistence not initialized. Call init() first.');
    }
  }
}
