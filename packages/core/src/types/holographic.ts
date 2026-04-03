/**
 * CMP v3.0 — Holographic State Type Definitions
 * Erasure-coded distributed shared memory across mesh devices.
 *
 * "Holographic" because any k-of-n shards can reconstruct the full data —
 * like a hologram where any fragment contains the whole image.
 *
 * Each shard is backed by a Lifeform (gets migration, replication, DNS for free).
 *
 * Wire protocol message types: 0xF0-0xF5
 *
 * @module types/holographic
 * @author Agent Viscro
 */

// ─── Wire Protocol Messages (Layer 15) ───

export enum HolographicMessageType {
  /** Write shards to mesh memory */
  SHARD_WRITE = 0xF0,
  /** Read shard from a holder */
  SHARD_READ = 0xF1,
  /** Shard data response */
  SHARD_READ_RESPONSE = 0xF2,
  /** Request reconstruction from k peers */
  SHARD_RECONSTRUCT = 0xF3,
  /** Rebalance shards across devices */
  SHARD_REBALANCE = 0xF4,
  /** Mesh memory status query/response */
  MEMORY_STATUS = 0xF5,
}

// ─── Shard Descriptor ───

export interface ShardDescriptor {
  /** Key identifying the data this shard belongs to */
  key: string;
  /** This shard's index (0-based) */
  shardIndex: number;
  /** Total shards for this key (n) */
  totalShards: number;
  /** Minimum shards needed to reconstruct (k) */
  requiredShards: number;
  /** Shard data bytes */
  data: Uint8Array;
  /** SHA-512/32 checksum of shard data */
  checksum: Uint8Array;
  /** Original data size in bytes (before encoding) */
  originalSize: number;
  /** Timestamp of write */
  writtenAt: number;
  /** TTL in ms (0 = permanent) */
  ttlMs: number;
}

// ─── Mesh Memory Configuration ───

export interface MeshMemoryConfig {
  /** Redundancy: total shards / required shards. Default: 1.5 (k=2, n=3) */
  defaultRedundancy: number;
  /** Max bytes per shard. Default: 1MB */
  maxShardSizeBytes: number;
  /** Max total memory to contribute. Default: 256MB */
  maxContributionBytes: number;
  /** Eviction policy for cold data */
  evictionPolicy: 'lru' | 'lfu' | 'ttl';
  /** Default TTL for stored data in ms (0 = permanent) */
  defaultTtlMs: number;
}

export const DEFAULT_MESH_MEMORY_CONFIG: MeshMemoryConfig = {
  defaultRedundancy: 1.5,
  maxShardSizeBytes: 1048576,   // 1MB
  maxContributionBytes: 268435456, // 256MB
  evictionPolicy: 'lru',
  defaultTtlMs: 0,
};

// ─── Write Options ───

export interface WriteOptions {
  /** Number of required shards (k). Auto-calculated from redundancy if omitted. */
  requiredShards?: number;
  /** Number of total shards (n). Auto-calculated from redundancy if omitted. */
  totalShards?: number;
  /** Time-to-live in ms (0 = permanent) */
  ttlMs?: number;
}

// ─── Read Result ───

export interface ReadResult {
  /** The reconstructed data */
  data: Uint8Array;
  /** Key that was read */
  key: string;
  /** Number of shards used for reconstruction */
  shardsUsed: number;
  /** Total shards available */
  shardsAvailable: number;
  /** Reconstruction time in ms */
  reconstructionMs: number;
}

// ─── Memory Stats ───

export interface MeshMemoryStats {
  /** Total keys stored */
  totalKeys: number;
  /** Total shards hosted locally */
  localShards: number;
  /** Total bytes hosted locally */
  localBytes: number;
  /** Total bytes across all mesh devices (estimated) */
  meshBytes: number;
  /** Number of devices contributing memory */
  contributingDevices: number;
  /** Average redundancy factor across all keys */
  avgRedundancy: number;
}

// ─── Shard Location ───

export interface ShardLocation {
  /** Key this shard belongs to */
  key: string;
  /** Shard index */
  shardIndex: number;
  /** Device mesh ID hosting this shard */
  hostDeviceId: string;
  /** Lifeform name hosting this shard (if shard-as-Lifeform mode) */
  lifeformName: string | null;
  /** Last verified timestamp */
  lastVerified: number;
}

// ─── Wire Message Payloads ───

export interface ShardWriteMessage {
  key: string;
  shardIndex: number;
  totalShards: number;
  requiredShards: number;
  data: string;           // base64
  checksum: string;       // hex
  originalSize: number;
  ttlMs: number;
  senderDeviceId: string; // hex
}

export interface ShardReadMessage {
  key: string;
  shardIndex: number;
  requesterId: string;    // hex
  requestId: string;      // hex
}

export interface ShardReadResponseMessage {
  requestId: string;      // hex
  key: string;
  shardIndex: number;
  found: boolean;
  data: string | null;    // base64 (null if not found)
  checksum: string | null;
}

export interface ShardReconstructMessage {
  key: string;
  requesterId: string;    // hex
  requestId: string;      // hex
}

export interface MemoryStatusMessage {
  deviceId: string;       // hex
  localShards: number;
  localBytes: number;
  maxBytes: number;
  keys: string[];
}
