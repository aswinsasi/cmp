/**
 * CMP Code Cache
 * Content-addressed cache for WASM modules and ONNX models.
 * Modules are identified by their SHA-256 hash.
 *
 * @module runtime/code-cache
 * @author Agent Viscro
 */

import { hash256 } from '../../core/src';
import { toHex, bytesEqual } from '../../core/src';

export class CodeCache {
  /** hash hex → module bytes */
  private cache = new Map<string, Uint8Array>();
  /** hash hex → last access timestamp (for LRU) */
  private accessTimes = new Map<string, number>();
  private maxSizeMb: number;

  constructor(maxSizeMb: number = 100) {
    this.maxSizeMb = maxSizeMb;
  }

  /**
   * Check if a module exists in cache.
   */
  has(moduleHash: Uint8Array): boolean {
    return this.cache.has(toHex(moduleHash));
  }

  /**
   * Get a module from cache by hash.
   */
  get(moduleHash: Uint8Array): Uint8Array | null {
    const hex = toHex(moduleHash);
    const module = this.cache.get(hex);
    if (module) {
      this.accessTimes.set(hex, Date.now());
      return module;
    }
    return null;
  }

  /**
   * Store a module in cache. Returns its hash.
   */
  store(moduleBytes: Uint8Array): Uint8Array {
    const moduleHash = hash256(moduleBytes);
    const hex = toHex(moduleHash);

    if (this.cache.has(hex)) return moduleHash;

    // Evict LRU entries if over size limit
    while (this.currentSizeMb() + moduleBytes.length / (1024 * 1024) > this.maxSizeMb) {
      this.evictLRU();
      if (this.cache.size === 0) break;
    }

    this.cache.set(hex, moduleBytes);
    this.accessTimes.set(hex, Date.now());
    return moduleHash;
  }

  /**
   * Verify a module's integrity against its expected hash.
   */
  verify(expectedHash: Uint8Array, moduleBytes: Uint8Array): boolean {
    const actualHash = hash256(moduleBytes);
    return bytesEqual(actualHash, expectedHash);
  }

  /**
   * Remove a specific module from cache.
   */
  remove(moduleHash: Uint8Array): boolean {
    const hex = toHex(moduleHash);
    this.accessTimes.delete(hex);
    return this.cache.delete(hex);
  }

  /**
   * Current cache size in MB.
   */
  currentSizeMb(): number {
    let total = 0;
    for (const bytes of this.cache.values()) {
      total += bytes.length;
    }
    return total / (1024 * 1024);
  }

  /**
   * Number of cached modules.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clear all cached modules.
   */
  clear(): void {
    this.cache.clear();
    this.accessTimes.clear();
  }

  /**
   * Evict the least recently used entry.
   */
  private evictLRU(): void {
    let oldestHex = '';
    let oldestTime = Infinity;

    for (const [hex, time] of this.accessTimes) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestHex = hex;
      }
    }

    if (oldestHex) {
      this.cache.delete(oldestHex);
      this.accessTimes.delete(oldestHex);
    }
  }
}
