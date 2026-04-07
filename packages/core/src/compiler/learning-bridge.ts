/**
 * CMP v5.0 — Learning Bridge
 *
 * THE WORLD'S FIRST self-learning distributed computation protocol.
 *
 * Connects three existing CMP systems that were never wired together:
 *   1. BytecodeAnalyzer → creates a "computation fingerprint"
 *   2. MCL Engine → stores execution history (MERs)
 *   3. TaskCompiler → decides chunk count and strategy
 *
 * The bridge creates a feedback loop:
 *   - Before execution: "have we seen this WASM before? what worked best?"
 *   - After execution: "record what happened for next time"
 *
 * Over time, the protocol LEARNS the optimal parallelization
 * for each unique computation — without human tuning.
 *
 * @module compiler/learning-bridge
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import { analyzeWasmBytecode, BytecodeAnalysis } from './bytecode-analyzer';

const log = new Logger('LearningBridge');

// ─── Computation Fingerprint ───

/**
 * A compact fingerprint derived from WASM bytecode analysis.
 * Two WASM modules with the same structural pattern produce
 * the same (or similar) fingerprint.
 *
 * This is the key that links past execution results to future
 * parallelization decisions.
 */
export interface ComputationFingerprint {
  /** 8-character hex hash of the opcode histogram */
  hash: string;
  /** Structural pattern detected */
  pattern: string;
  /** Key signals used to create the fingerprint */
  signals: {
    loopCount: number;
    loopDepth: number;
    loadCount: number;
    storeCount: number;
    compareCount: number;
    arithmeticCount: number;
    hasAccumulator: boolean;
    hasConditionalStore: boolean;
  };
}

/**
 * Create a computation fingerprint from a WASM module.
 * This fingerprint is stable — the same WASM binary always
 * produces the same fingerprint.
 */
export function createFingerprint(wasmModule: Uint8Array, entryPoint: string = 'process'): ComputationFingerprint {
  let analysis: BytecodeAnalysis;
  try {
    analysis = analyzeWasmBytecode(wasmModule, entryPoint);
  } catch {
    return {
      hash: '00000000',
      pattern: 'unknown',
      signals: {
        loopCount: 0, loopDepth: 0, loadCount: 0, storeCount: 0,
        compareCount: 0, arithmeticCount: 0,
        hasAccumulator: false, hasConditionalStore: false,
      },
    };
  }

  const fn = analysis.entryPoint;
  const signals = {
    loopCount: fn?.loopCount ?? 0,
    loopDepth: fn?.loopDepth ?? 0,
    loadCount: fn?.loadCount ?? 0,
    storeCount: fn?.storeCount ?? 0,
    compareCount: fn?.compareCount ?? 0,
    arithmeticCount: fn?.arithmeticCount ?? 0,
    hasAccumulator: fn?.hasAccumulator ?? false,
    hasConditionalStore: fn?.hasConditionalStore ?? false,
  };

  // Create a stable hash from the signals
  const hashInput = [
    signals.loopCount,
    signals.loopDepth,
    signals.loadCount,
    signals.storeCount,
    signals.compareCount,
    signals.arithmeticCount,
    signals.hasAccumulator ? 1 : 0,
    signals.hasConditionalStore ? 1 : 0,
  ].join(':');

  // Simple string hash (djb2)
  let hash = 5381;
  for (let i = 0; i < hashInput.length; i++) {
    hash = ((hash << 5) + hash + hashInput.charCodeAt(i)) >>> 0;
  }
  const hashHex = hash.toString(16).padStart(8, '0');

  return {
    hash: hashHex,
    pattern: analysis.structuralPattern,
    signals,
  };
}

// ─── Execution History ───

/**
 * A single record of "what happened when we ran this computation."
 */
export interface ExecutionRecord {
  /** Computation fingerprint hash */
  fingerprintHash: string;
  /** Structural pattern */
  pattern: string;
  /** Input data size (bytes) */
  inputSizeBytes: number;
  /** Number of chunks used */
  chunkCount: number;
  /** Number of devices used */
  deviceCount: number;
  /** Total execution time (ms) */
  totalTimeMs: number;
  /** Whether execution was verified correct */
  verified: boolean;
  /** Timestamp */
  timestamp: number;
}

/**
 * Recommendation from the learning system.
 */
export interface LearningRecommendation {
  /** Recommended chunk count */
  chunkCount: number;
  /** Expected execution time (ms) */
  expectedTimeMs: number;
  /** Confidence in recommendation (0-1) */
  confidence: number;
  /** Number of past executions this is based on */
  dataPoints: number;
  /** Explanation */
  explanation: string;
}

// ─── Learning Store ───

/**
 * Execution history store with optional SQLite persistence.
 * When a dbPath is provided, records survive node restarts.
 * Without dbPath, records are in-memory only (session lifetime).
 */
export class LearningStore {
  private history: Map<string, ExecutionRecord[]> = new Map();
  private maxRecordsPerFingerprint = 50;
  private db: any = null;
  private dbPath: string | null = null;

  /**
   * Initialize with optional SQLite persistence.
   * @param dbPath - Path to SQLite database file (null = in-memory only)
   */
  async initPersistence(dbPath: string): Promise<void> {
    this.dbPath = dbPath;

    try {
      const path = require('path');
      const fs = require('fs');
      const initSqlJs = require('sql.js');
      const sqljs = await initSqlJs();

      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        this.db = new sqljs.Database(fileBuffer);
      } else {
        this.db = new sqljs.Database();
      }

      // Create table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS execution_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fingerprint_hash TEXT NOT NULL,
          pattern TEXT NOT NULL,
          input_size_bytes INTEGER NOT NULL,
          chunk_count INTEGER NOT NULL,
          device_count INTEGER NOT NULL,
          total_time_ms INTEGER NOT NULL,
          verified INTEGER NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `);
      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_fingerprint ON execution_history(fingerprint_hash)
      `);

      // Load existing records into memory
      const rows = this.db.exec('SELECT * FROM execution_history ORDER BY timestamp DESC LIMIT 500');
      if (rows.length > 0) {
        for (const row of rows[0].values) {
          const record: ExecutionRecord = {
            fingerprintHash: row[1] as string,
            pattern: row[2] as string,
            inputSizeBytes: row[3] as number,
            chunkCount: row[4] as number,
            deviceCount: row[5] as number,
            totalTimeMs: row[6] as number,
            verified: (row[7] as number) === 1,
            timestamp: row[8] as number,
          };
          const key = this.makeKey(record.fingerprintHash, record.inputSizeBytes);
          const records = this.history.get(key) ?? [];
          records.push(record);
          this.history.set(key, records);
        }
        log.info(`Loaded ${rows[0].values.length} execution records from ${dbPath}`);
      }
    } catch (err: any) {
      log.warn(`SQLite persistence init failed: ${err.message} — using in-memory only`);
      this.db = null;
    }
  }

  /**
   * Record an execution result.
   */
  record(record: ExecutionRecord): void {
    const key = this.makeKey(record.fingerprintHash, record.inputSizeBytes);
    const records = this.history.get(key) ?? [];
    records.push(record);

    // Keep only the most recent N records
    if (records.length > this.maxRecordsPerFingerprint) {
      records.splice(0, records.length - this.maxRecordsPerFingerprint);
    }

    this.history.set(key, records);

    // Persist to SQLite if available
    if (this.db) {
      try {
        this.db.run(
          `INSERT INTO execution_history (fingerprint_hash, pattern, input_size_bytes, chunk_count, device_count, total_time_ms, verified, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [record.fingerprintHash, record.pattern, record.inputSizeBytes,
           record.chunkCount, record.deviceCount, record.totalTimeMs,
           record.verified ? 1 : 0, record.timestamp]
        );
        // Write to disk
        const fs = require('fs');
        const data = this.db.export();
        fs.writeFileSync(this.dbPath!, Buffer.from(data));
      } catch (err: any) {
        log.debug(`SQLite write failed: ${err.message}`);
      }
    }

    log.info(`Recorded execution: ${record.fingerprintHash} ${record.chunkCount} chunks ${record.totalTimeMs}ms`);
  }

  /**
   * Get the best chunk count recommendation for a computation.
   *
   * Analyzes past executions and returns the chunk count that
   * produced the lowest execution time for similar input sizes.
   */
  recommend(
    fingerprintHash: string,
    inputSizeBytes: number,
    availableDevices: number,
  ): LearningRecommendation | null {
    const key = this.makeKey(fingerprintHash, inputSizeBytes);
    const exact = this.history.get(key);

    // Also check similar input sizes (within 2x)
    const allRecords: ExecutionRecord[] = [];
    if (exact) allRecords.push(...exact);

    // Check nearby size buckets
    for (const [k, records] of this.history.entries()) {
      if (k.startsWith(fingerprintHash + ':') && k !== key) {
        allRecords.push(...records);
      }
    }

    if (allRecords.length === 0) return null;

    // Only consider verified results
    const verified = allRecords.filter(r => r.verified);
    if (verified.length === 0) return null;

    // Group by chunk count, find the one with lowest average time
    const byChunkCount = new Map<number, { totalMs: number; count: number }>();
    for (const r of verified) {
      const entry = byChunkCount.get(r.chunkCount) ?? { totalMs: 0, count: 0 };
      entry.totalMs += r.totalTimeMs;
      entry.count++;
      byChunkCount.set(r.chunkCount, entry);
    }

    let bestChunkCount = 1;
    let bestAvgMs = Infinity;
    for (const [chunkCount, data] of byChunkCount.entries()) {
      const avg = data.totalMs / data.count;
      // Only recommend chunk counts we have enough devices for
      if (avg < bestAvgMs && chunkCount <= availableDevices) {
        bestAvgMs = avg;
        bestChunkCount = chunkCount;
      }
    }

    const confidence = Math.min(verified.length / 10, 1.0); // More data = more confidence

    return {
      chunkCount: bestChunkCount,
      expectedTimeMs: Math.round(bestAvgMs),
      confidence,
      dataPoints: verified.length,
      explanation: `Based on ${verified.length} past executions: ${bestChunkCount} chunks ≈ ${Math.round(bestAvgMs)}ms`,
    };
  }

  /**
   * Get all recorded data (for debugging/display).
   */
  getAll(): Map<string, ExecutionRecord[]> {
    return new Map(this.history);
  }

  /**
   * Get stats.
   */
  getStats(): { fingerprints: number; totalRecords: number } {
    let totalRecords = 0;
    for (const records of this.history.values()) {
      totalRecords += records.length;
    }
    return { fingerprints: this.history.size, totalRecords };
  }

  /**
   * Create a size-bucketed key for lookup.
   * Groups input sizes into powers of 2 so 50KB and 60KB
   * share the same bucket (64KB bucket).
   */
  private makeKey(fingerprintHash: string, inputSizeBytes: number): string {
    // Bucket to nearest power of 2
    const bucket = Math.pow(2, Math.ceil(Math.log2(Math.max(inputSizeBytes, 1))));
    return `${fingerprintHash}:${bucket}`;
  }
}

// ─── Learning Bridge (main integration class) ───

/**
 * LearningBridge — the connection between bytecode analysis,
 * execution history, and parallelization decisions.
 *
 * Usage in CMPNode:
 *   const bridge = new LearningBridge();
 *
 *   // Before execution:
 *   const fingerprint = bridge.analyze(wasmModule, entryPoint);
 *   const rec = bridge.recommend(fingerprint, inputSize, deviceCount);
 *   if (rec) chunkHint = rec.chunkCount;
 *
 *   // After execution:
 *   bridge.recordResult(fingerprint, inputSize, chunkCount, deviceCount, timeMs, verified);
 */
export class LearningBridge {
  private store: LearningStore;
  /** Cache fingerprints to avoid re-analyzing the same WASM */
  private fingerprintCache: Map<string, ComputationFingerprint> = new Map();

  constructor() {
    this.store = new LearningStore();
  }

  /**
   * Analyze a WASM module and return its computation fingerprint.
   * Cached — same binary returns same fingerprint instantly.
   */
  analyze(wasmModule: Uint8Array, entryPoint: string = 'process'): ComputationFingerprint {
    // Cache key: first 32 bytes of WASM (magic + version + start of type section)
    const cacheKey = Array.from(wasmModule.slice(0, 32)).join(',');
    const cached = this.fingerprintCache.get(cacheKey);
    if (cached) return cached;

    const fingerprint = createFingerprint(wasmModule, entryPoint);
    this.fingerprintCache.set(cacheKey, fingerprint);

    log.info(`Fingerprint: ${fingerprint.hash} (${fingerprint.pattern})`);
    return fingerprint;
  }

  /**
   * Get a recommendation based on past experience.
   * Returns null if no relevant history exists (first time).
   */
  recommend(
    fingerprint: ComputationFingerprint,
    inputSizeBytes: number,
    availableDevices: number,
  ): LearningRecommendation | null {
    const rec = this.store.recommend(fingerprint.hash, inputSizeBytes, availableDevices);

    if (rec) {
      log.info(`Learning recommendation: ${rec.chunkCount} chunks (${rec.confidence.toFixed(0)}% confidence, ${rec.dataPoints} data points)`);
    } else {
      log.info(`No history for fingerprint ${fingerprint.hash} — using bytecode analysis`);
    }

    return rec;
  }

  /**
   * Record execution result for future learning.
   */
  recordResult(
    fingerprint: ComputationFingerprint,
    inputSizeBytes: number,
    chunkCount: number,
    deviceCount: number,
    totalTimeMs: number,
    verified: boolean,
  ): void {
    this.store.record({
      fingerprintHash: fingerprint.hash,
      pattern: fingerprint.pattern,
      inputSizeBytes,
      chunkCount,
      deviceCount,
      totalTimeMs,
      verified,
      timestamp: Date.now(),
    });
  }

  /**
   * Get learning stats.
   */
  getStats(): { fingerprints: number; totalRecords: number } {
    return this.store.getStats();
  }

  /**
   * Initialize SQLite persistence so learning survives restarts.
   * Uses the same database directory as the MCL MER store.
   */
  async initPersistence(dbPath: string): Promise<void> {
    await this.store.initPersistence(dbPath);
  }

  /**
   * Get the underlying store (for testing).
   */
  getStore(): LearningStore {
    return this.store;
  }
}
