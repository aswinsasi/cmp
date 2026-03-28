/**
 * CMP Bloom Filter
 * Used in MCL Profile to advertise which task types a device
 * has experience with, enabling efficient "do you have experience
 * with X?" queries without enumerating all MERs.
 *
 * Parameters: k=3 hash functions, m=256 bits (32 bytes).
 * False positive rate: ~2.4% at 10 items, ~11% at 30 items.
 * Acceptable for MER catalog queries where false positives
 * merely trigger a query that returns no results.
 *
 * @module mcl/bloom
 * @author Agent Viscro
 */

import { hash256 } from '../crypto';

/** Bloom filter bit count (m) */
const BLOOM_BITS = 256;
/** Bloom filter byte count */
export const BLOOM_BYTES = BLOOM_BITS / 8; // 32
/** Number of hash functions (k) */
const BLOOM_K = 3;

/**
 * Bloom filter backed by a 32-byte (256-bit) Uint8Array.
 * Supports add, test, and merge operations.
 */
export class BloomFilter {
  private bits: Uint8Array;

  constructor(existing?: Uint8Array) {
    if (existing) {
      if (existing.length !== BLOOM_BYTES) {
        throw new Error(`BloomFilter requires ${BLOOM_BYTES} bytes, got ${existing.length}`);
      }
      this.bits = new Uint8Array(existing);
    } else {
      this.bits = new Uint8Array(BLOOM_BYTES);
    }
  }

  /**
   * Add an item to the filter.
   * After adding, test() for this item will always return true.
   */
  add(item: Uint8Array | string): void {
    const positions = this.hashPositions(item);
    for (const pos of positions) {
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = pos % 8;
      this.bits[byteIndex] |= (1 << bitIndex);
    }
  }

  /**
   * Test if an item might be in the filter.
   * Returns true if the item was probably added (may be false positive).
   * Returns false if the item was definitely NOT added.
   */
  test(item: Uint8Array | string): boolean {
    const positions = this.hashPositions(item);
    for (const pos of positions) {
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = pos % 8;
      if ((this.bits[byteIndex] & (1 << bitIndex)) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Merge another bloom filter into this one (bitwise OR).
   * Useful when combining MER catalogs from multiple sources.
   */
  merge(other: BloomFilter): void {
    const otherBits = other.toBytes();
    for (let i = 0; i < BLOOM_BYTES; i++) {
      this.bits[i] |= otherBits[i];
    }
  }

  /**
   * Get the number of bits set (approximate fullness indicator).
   */
  popCount(): number {
    let count = 0;
    for (let i = 0; i < BLOOM_BYTES; i++) {
      let byte = this.bits[i];
      while (byte) {
        count += byte & 1;
        byte >>= 1;
      }
    }
    return count;
  }

  /**
   * Check if the filter is empty (no items added).
   */
  isEmpty(): boolean {
    for (let i = 0; i < BLOOM_BYTES; i++) {
      if (this.bits[i] !== 0) return false;
    }
    return true;
  }

  /**
   * Reset the filter to empty.
   */
  clear(): void {
    this.bits.fill(0);
  }

  /**
   * Get the raw bytes (32 bytes) for wire transmission.
   */
  toBytes(): Uint8Array {
    return new Uint8Array(this.bits);
  }

  /**
   * Create a bloom filter from wire bytes.
   */
  static fromBytes(bytes: Uint8Array): BloomFilter {
    return new BloomFilter(bytes);
  }

  /**
   * Compute k=3 bit positions for an item using double-hashing.
   * Uses SHA-256 hash split into two 16-bit values as h1 and h2,
   * then: position_i = (h1 + i * h2) mod m
   */
  private hashPositions(item: Uint8Array | string): number[] {
    const data = typeof item === 'string'
      ? new TextEncoder().encode(item)
      : item;

    const fullHash = hash256(data);
    const view = new DataView(fullHash.buffer, fullHash.byteOffset, fullHash.byteLength);

    // Extract two independent hash values from the SHA-256 output
    const h1 = view.getUint16(0, false);
    const h2 = view.getUint16(2, false);

    const positions: number[] = [];
    for (let i = 0; i < BLOOM_K; i++) {
      positions.push((h1 + i * h2) % BLOOM_BITS);
    }
    return positions;
  }
}
