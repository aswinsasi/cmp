/**
 * CMP v4.0 — Data Catalog
 *
 * Global index of data locations across the mesh.
 * Tracks which devices hold which data shards, enabling the
 * Gravity Planner to decide whether to move code or data.
 *
 * Built on top of Holographic Memory's shard model:
 *   - Every write records: key → list of devices holding shards
 *   - Gossip-based catalog sync between devices
 *   - Bloom filter for fast "does this device have data X?" checks
 *
 * @module gravity/data-catalog
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';

const log = new Logger('DataCatalog');

// ─── Data Entry ───

export interface DataEntry {
  /** Unique data key (e.g., "sensors/today.csv") */
  key: string;
  /** Total size in bytes across all shards */
  totalSizeBytes: number;
  /** Devices holding shards of this data: deviceId → shard info */
  shards: Map<string, ShardInfo>;
  /** When this entry was last updated */
  updatedAt: number;
}

export interface ShardInfo {
  /** Size of this shard in bytes */
  sizeBytes: number;
  /** Fraction of total data held (0-1) */
  fraction: number;
  /** When this shard was last verified */
  verifiedAt: number;
}

// ─── Data Location Summary ───

export interface DataLocation {
  key: string;
  totalSizeBytes: number;
  /** Devices sorted by fraction held (most data first) */
  devices: Array<{
    deviceId: string;
    sizeBytes: number;
    fraction: number;
  }>;
  /** Device holding the most data */
  primaryDevice: string | null;
  /** Fraction of data on the primary device */
  primaryFraction: number;
  /** Whether data is concentrated (>60% on one device) */
  isConcentrated: boolean;
  /** Whether data is spread evenly across devices */
  isDistributed: boolean;
}

// ─── Gossip Wire ───

export interface CatalogGossipWire {
  senderId: string;
  entries: Array<{
    key: string;
    totalSize: number;
    shards: Array<{ deviceId: string; sizeBytes: number; fraction: number }>;
    updatedAt: number;
  }>;
  timestamp: number;
}

// ─── Bloom Filter (simple) ───

class SimpleBloomFilter {
  private bits: Uint8Array;
  private hashCount: number;

  constructor(size: number = 1024, hashCount: number = 3) {
    this.bits = new Uint8Array(size);
    this.hashCount = hashCount;
  }

  add(key: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(key, i) % (this.bits.length * 8);
      this.bits[Math.floor(idx / 8)] |= (1 << (idx % 8));
    }
  }

  mightContain(key: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(key, i) % (this.bits.length * 8);
      if ((this.bits[Math.floor(idx / 8)] & (1 << (idx % 8))) === 0) return false;
    }
    return true;
  }

  clear(): void {
    this.bits.fill(0);
  }

  private hash(key: string, seed: number): number {
    let h = seed * 0x9e3779b9;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
    }
    return h;
  }
}

// ─── Data Catalog ───

export class DataCatalog {
  private entries = new Map<string, DataEntry>();
  private deviceIndex = new Map<string, Set<string>>(); // deviceId → set of data keys
  private bloom = new SimpleBloomFilter(2048, 3);
  private localDeviceId: string;
  private broadcastFn: ((msgType: number, payload: any) => void) | null = null;
  private gossipIntervalMs: number;
  private gossipTimer: ReturnType<typeof setInterval> | null = null;

  constructor(localDeviceId: string, config: { gossipIntervalMs?: number } = {}) {
    this.localDeviceId = localDeviceId;
    this.gossipIntervalMs = config.gossipIntervalMs ?? 15000;
  }

  /**
   * Set transport for gossip broadcasts.
   */
  setTransport(broadcast: (msgType: number, payload: any) => void): void {
    this.broadcastFn = broadcast;
  }

  /**
   * Start gossip timer.
   */
  start(): void {
    if (this.gossipTimer) return;
    this.gossipTimer = setInterval(() => this.broadcastGossip(), this.gossipIntervalMs);
  }

  /**
   * Stop gossip timer.
   */
  stop(): void {
    if (this.gossipTimer) {
      clearInterval(this.gossipTimer);
      this.gossipTimer = null;
    }
  }

  // ══════════════════════════════════════
  // Registration
  // ══════════════════════════════════════

  /**
   * Register that a device holds data for a key.
   */
  registerShard(key: string, deviceId: string, sizeBytes: number, totalSizeBytes: number): void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, totalSizeBytes, shards: new Map(), updatedAt: Date.now() };
      this.entries.set(key, entry);
    }

    entry.totalSizeBytes = totalSizeBytes;
    entry.shards.set(deviceId, {
      sizeBytes,
      fraction: totalSizeBytes > 0 ? sizeBytes / totalSizeBytes : 0,
      verifiedAt: Date.now(),
    });
    entry.updatedAt = Date.now();

    // Update device index
    let keys = this.deviceIndex.get(deviceId);
    if (!keys) {
      keys = new Set();
      this.deviceIndex.set(deviceId, keys);
    }
    keys.add(key);

    // Update bloom filter
    this.bloom.add(`${deviceId}:${key}`);
  }

  /**
   * Remove a shard registration.
   */
  removeShard(key: string, deviceId: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;

    entry.shards.delete(deviceId);
    entry.updatedAt = Date.now();

    if (entry.shards.size === 0) {
      this.entries.delete(key);
    }

    const keys = this.deviceIndex.get(deviceId);
    if (keys) {
      keys.delete(key);
      if (keys.size === 0) this.deviceIndex.delete(deviceId);
    }
  }

  /**
   * Remove all shards for a device (device left mesh).
   */
  removeDevice(deviceId: string): void {
    const keys = this.deviceIndex.get(deviceId);
    if (!keys) return;

    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry) {
        entry.shards.delete(deviceId);
        if (entry.shards.size === 0) this.entries.delete(key);
      }
    }
    this.deviceIndex.delete(deviceId);
  }

  // ══════════════════════════════════════
  // Query
  // ══════════════════════════════════════

  /**
   * Quick bloom filter check: might this device have this data?
   */
  mightHaveData(deviceId: string, key: string): boolean {
    return this.bloom.mightContain(`${deviceId}:${key}`);
  }

  /**
   * Get detailed location info for a data key.
   */
  locate(key: string): DataLocation | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    const devices = Array.from(entry.shards.entries())
      .map(([deviceId, shard]) => ({
        deviceId,
        sizeBytes: shard.sizeBytes,
        fraction: shard.fraction,
      }))
      .sort((a, b) => b.fraction - a.fraction);

    const primary = devices.length > 0 ? devices[0] : null;

    return {
      key,
      totalSizeBytes: entry.totalSizeBytes,
      devices,
      primaryDevice: primary?.deviceId ?? null,
      primaryFraction: primary?.fraction ?? 0,
      isConcentrated: (primary?.fraction ?? 0) > 0.6,
      isDistributed: devices.length > 1 && devices.every(d => d.fraction < 0.5),
    };
  }

  /**
   * Get all data keys held by a device.
   */
  getDeviceData(deviceId: string): string[] {
    return Array.from(this.deviceIndex.get(deviceId) ?? []);
  }

  /**
   * Get all tracked data keys.
   */
  getAllKeys(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Get entry count.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Get total bytes tracked across all entries.
   */
  get totalBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.totalSizeBytes;
    }
    return total;
  }

  // ══════════════════════════════════════
  // Gossip
  // ══════════════════════════════════════

  /**
   * Handle incoming gossip from a peer.
   */
  handleGossip(wire: CatalogGossipWire): void {
    if (wire.senderId === this.localDeviceId) return;

    for (const entry of wire.entries) {
      // Only accept if newer than what we have
      const existing = this.entries.get(entry.key);
      if (existing && entry.updatedAt <= existing.updatedAt) continue;

      for (const shard of entry.shards) {
        this.registerShard(entry.key, shard.deviceId, shard.sizeBytes, entry.totalSize);
      }
    }
  }

  /**
   * Broadcast our catalog state to peers.
   */
  private broadcastGossip(): void {
    if (!this.broadcastFn) return;

    // Only gossip entries where we hold shards
    const myEntries: CatalogGossipWire['entries'] = [];

    for (const [key, entry] of this.entries) {
      if (entry.shards.has(this.localDeviceId)) {
        myEntries.push({
          key,
          totalSize: entry.totalSizeBytes,
          shards: Array.from(entry.shards.entries()).map(([did, si]) => ({
            deviceId: did,
            sizeBytes: si.sizeBytes,
            fraction: si.fraction,
          })),
          updatedAt: entry.updatedAt,
        });
      }
    }

    if (myEntries.length > 0) {
      const wire: CatalogGossipWire = {
        senderId: this.localDeviceId,
        entries: myEntries,
        timestamp: Date.now(),
      };
      this.broadcastFn(0xFC, wire); // Using 0xFC for catalog gossip
    }
  }

  /**
   * Clear all catalog data.
   */
  clear(): void {
    this.entries.clear();
    this.deviceIndex.clear();
    this.bloom.clear();
  }
}
