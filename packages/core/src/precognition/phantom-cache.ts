/**
 * CMP v1.3 — Phantom Cache
 * Content-addressed cache for speculative pre-computation results.
 * Stores results from the DreamScheduler's predictions, serving them
 * instantly when the predicted task actually arrives.
 *
 * Eviction policy:
 *   1. TTL expiry (periodic sweep)
 *   2. Lowest confidence first (when over maxEntries or maxCacheSizeBytes)
 *
 * @module precognition/phantom-cache
 * @author Agent Viscro
 */

import { PhantomCacheEntry, PhantomCacheConfig } from '../types/precognition';

const DEFAULT_CONFIG: PhantomCacheConfig = {
  maxEntries: 256,
  defaultTtlMs: 300000,       // 5 minutes
  minCacheConfidence: 0.6,
  maxCacheSizeBytes: 50 * 1024 * 1024, // 50MB
};

export class PhantomCache {
  private entries = new Map<string, PhantomCacheEntry>();
  private config: PhantomCacheConfig;
  private totalSizeBytes = 0;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  // Stats
  private lookupCount = 0;
  private hitCount = 0;

  constructor(config?: Partial<PhantomCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start periodic eviction sweep.
   */
  start(intervalMs: number = 30000): void {
    if (this.evictionTimer) return;
    this.evictionTimer = setInterval(() => this.evictExpired(), intervalMs);
  }

  /**
   * Generate cache key from task parameters.
   * key = hex(SHA-256(moduleHash || inputFingerprint || taskType))
   *
   * Uses a fast hash for key generation (not crypto-strength needed).
   */
  static generateKey(moduleHash: Uint8Array, inputFingerprint: Uint8Array, taskType: string): string {
    // Simple deterministic key: hex(moduleHash) + ":" + hex(inputFP) + ":" + taskType
    const mh = Array.from(moduleHash).map(b => b.toString(16).padStart(2, '0')).join('');
    const fp = Array.from(inputFingerprint).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${mh}:${fp}:${taskType}`;
  }

  /**
   * Generate input fingerprint from raw input data.
   * Returns first 32 bytes of a simple hash.
   */
  static fingerprint(inputData: Uint8Array): Uint8Array {
    // Simple FNV-1a-inspired hash spread across 32 bytes
    const fp = new Uint8Array(32);
    let h = 0x811c9dc5;
    for (let i = 0; i < inputData.length; i++) {
      h ^= inputData[i];
      h = Math.imul(h, 0x01000193);
      fp[i % 32] ^= (h >>> 0) & 0xFF;
      fp[(i + 7) % 32] ^= ((h >>> 8) & 0xFF);
      fp[(i + 13) % 32] ^= ((h >>> 16) & 0xFF);
      fp[(i + 23) % 32] ^= ((h >>> 24) & 0xFF);
    }
    // Mix in length
    const lenBytes = new DataView(new ArrayBuffer(4));
    lenBytes.setUint32(0, inputData.length, false);
    for (let i = 0; i < 4; i++) fp[28 + i] ^= lenBytes.getUint8(i);
    return fp;
  }

  /**
   * Store a speculative result in the cache.
   *
   * Steps:
   * 1. Check minimum confidence threshold
   * 2. If entry exists, update only if higher confidence
   * 3. Enforce entry count limit — evict lowest-confidence
   * 4. Enforce size limit — evict lowest-confidence
   * 5. Store with TTL
   *
   * @returns true if stored, false if rejected
   */
  store(entry: PhantomCacheEntry): boolean {
    // Gate: minimum confidence
    if (entry.confidence < this.config.minCacheConfidence) {
      return false;
    }

    const entrySize = entry.resultData.length;

    // Check for existing entry
    const existing = this.entries.get(entry.cacheKey);
    if (existing) {
      if (entry.confidence <= existing.confidence) {
        return false; // Existing entry has equal or higher confidence
      }
      // Remove old entry's size contribution
      this.totalSizeBytes -= existing.resultData.length;
      this.entries.delete(entry.cacheKey);
    }

    // Enforce entry count limit
    while (this.entries.size >= this.config.maxEntries) {
      this.evictLowestConfidence();
    }

    // Enforce size limit
    while (this.totalSizeBytes + entrySize > this.config.maxCacheSizeBytes && this.entries.size > 0) {
      this.evictLowestConfidence();
    }

    // Final size check
    if (this.totalSizeBytes + entrySize > this.config.maxCacheSizeBytes) {
      return false; // Single entry too large
    }

    // Store
    this.entries.set(entry.cacheKey, { ...entry, hitCount: existing?.hitCount ?? 0 });
    this.totalSizeBytes += entrySize;
    return true;
  }

  /**
   * Look up a cached result by key.
   * Returns the entry if found and not expired, null otherwise.
   * Increments hitCount on successful lookup.
   */
  lookup(cacheKey: string): PhantomCacheEntry | null {
    this.lookupCount++;

    const entry = this.entries.get(cacheKey);
    if (!entry) return null;

    // Check TTL
    const now = Date.now();
    if (now - entry.cachedAt > entry.ttlMs) {
      this.removeEntry(cacheKey);
      return null;
    }

    // Cache hit
    entry.hitCount++;
    this.hitCount++;
    return entry;
  }

  /**
   * Lookup by task parameters (convenience wrapper).
   */
  lookupByTask(moduleHash: Uint8Array, inputFingerprint: Uint8Array, taskType: string): PhantomCacheEntry | null {
    const key = PhantomCache.generateKey(moduleHash, inputFingerprint, taskType);
    return this.lookup(key);
  }

  /**
   * Evict all expired entries.
   * @returns Number of entries evicted
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.entries) {
      if (now - entry.cachedAt > entry.ttlMs) {
        this.removeEntry(key);
        evicted++;
      }
    }

    return evicted;
  }

  /**
   * Invalidate all entries for a specific prediction.
   * Called when a prediction is determined to be wrong.
   * @returns Number of entries invalidated
   */
  invalidatePrediction(predictionId: Uint8Array): number {
    const pidHex = Array.from(predictionId).map(b => b.toString(16).padStart(2, '0')).join('');
    let count = 0;

    for (const [key, entry] of this.entries) {
      const entryPidHex = Array.from(entry.predictionId).map(b => b.toString(16).padStart(2, '0')).join('');
      if (entryPidHex === pidHex) {
        this.removeEntry(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Check if the cache has an entry for the given key (without incrementing hit count).
   */
  has(cacheKey: string): boolean {
    const entry = this.entries.get(cacheKey);
    if (!entry) return false;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.removeEntry(cacheKey);
      return false;
    }
    return true;
  }

  /**
   * Cache statistics.
   */
  getStats(): {
    entryCount: number;
    totalSizeBytes: number;
    hitRate: number;
    avgConfidence: number;
  } {
    let totalConfidence = 0;
    for (const entry of this.entries.values()) {
      totalConfidence += entry.confidence;
    }

    return {
      entryCount: this.entries.size,
      totalSizeBytes: this.totalSizeBytes,
      hitRate: this.lookupCount > 0 ? this.hitCount / this.lookupCount : 0,
      avgConfidence: this.entries.size > 0 ? totalConfidence / this.entries.size : 0,
    };
  }

  /**
   * Get all entries (for CLI display / debugging).
   */
  getEntries(): PhantomCacheEntry[] {
    return [...this.entries.values()];
  }

  /** Clear entire cache */
  clear(): void {
    this.entries.clear();
    this.totalSizeBytes = 0;
  }

  /** Stop eviction timer */
  destroy(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    this.clear();
  }

  /** Entry count */
  get size(): number {
    return this.entries.size;
  }

  // ── Internals ──

  private removeEntry(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.totalSizeBytes -= entry.resultData.length;
      this.entries.delete(key);
    }
  }

  private evictLowestConfidence(): void {
    let lowestKey: string | null = null;
    let lowestConf = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.confidence < lowestConf) {
        lowestConf = entry.confidence;
        lowestKey = key;
      }
    }

    if (lowestKey) {
      this.removeEntry(lowestKey);
    }
  }
}
