/**
 * CMP v1.4 — Lifeform Core Type Definitions
 * Autonomous computational entities that live on the mesh.
 *
 * A Lifeform has:
 *   - Soul: cryptographic identity (Ed25519 keypair + mesh ID)
 *   - Genome: WASM binary defining behavior
 *   - State: CRDT-based replicated state
 *   - Economy: CCU balance for survival
 *
 * @module types/lifeform
 * @author Agent Viscro
 */

// ─── Lifeform Identity (Soul) ───

export interface LifeformSoul {
  /** Unique Lifeform ID (16 bytes) */
  id: Uint8Array;
  /** Human-readable name (unique within mesh, DNS-resolvable) */
  name: string;
  /** Ed25519 signing public key */
  publicKey: Uint8Array;             // 32 bytes
  /** Ed25519 secret key (only on host device) */
  secretKey: Uint8Array;             // 64 bytes
  /** Creator device mesh ID */
  creatorId: Uint8Array;
  /** Birth timestamp */
  bornAt: number;
  /** Generation number (0 = original, >0 = mutant descendant) */
  generation: number;
  /** Parent Lifeform ID (null for generation 0) */
  parentId: Uint8Array | null;
}

// ─── Lifeform Lifecycle ───

export enum LifeformState {
  /** Spawning — setting up WASM, state, identity */
  SPAWNING = 'spawning',
  /** Alive — actively processing causes */
  ALIVE = 'alive',
  /** Migrating — moving to a different host */
  MIGRATING = 'migrating',
  /** Fused — merged with another Lifeform (sub-state of ALIVE) */
  FUSED = 'fused',
  /** Hibernating — paused to save resources */
  HIBERNATING = 'hibernating',
  /** Dead — terminated, state archived */
  DEAD = 'dead',
}

// ─── Lifeform Configuration ───

export interface LifeformConfig {
  /** Human-readable name */
  name: string;
  /** WASM module binary (the genome) */
  wasmModule: Uint8Array;
  /** Initial CRDT state (key-value pairs) */
  initialState?: Record<string, any>;
  /** Initial CCU funding */
  initialCcu: number;
  /** Minimum replicas for fault tolerance (default: 1) */
  minReplicas: number;
  /** Maximum replicas (default: 3) */
  maxReplicas: number;
  /** Should this Lifeform auto-migrate to better hosts? */
  autoMigrate: boolean;
  /** Mutation library hash (null = no mutations allowed) */
  mutationLibraryHash: Uint8Array | null;
  /** Maximum causes per second (backpressure threshold) */
  maxCausesPerSecond: number;
  /** State size limit in bytes (default: 1MB) */
  maxStateSizeBytes: number;
}

// ─── Lifeform Runtime Instance ───

export interface LifeformInstance {
  /** Soul — identity */
  soul: LifeformSoul;
  /** Current lifecycle state */
  state: LifeformState;
  /** Configuration */
  config: LifeformConfig;
  /** WASM module hash (SHA-256) */
  genomeHash: Uint8Array;
  /** Current host device mesh ID */
  hostId: Uint8Array;
  /** Replica hosts (for fault tolerance) */
  replicaHosts: Uint8Array[];
  /** CCU balance */
  ccuBalance: number;
  /** Total causes processed */
  causesProcessed: number;
  /** Total CCU earned */
  ccuEarned: number;
  /** Total CCU spent */
  ccuSpent: number;
  /** Last active timestamp */
  lastActiveAt: number;
  /** Fusion info (null if not fused) */
  fusionInfo: FusionInfo | null;
}

// ─── Fusion Info (when in FUSED state) ───

export interface FusionInfo {
  /** Composite Lifeform ID */
  compositeId: Uint8Array;
  /** Partner Lifeform ID */
  partnerId: Uint8Array;
  /** Role in fusion: 'primary' | 'secondary' */
  role: 'primary' | 'secondary';
  /** Fused at timestamp */
  fusedAt: number;
}

// ─── Lifeform Spawn Request ───

export interface SpawnRequest {
  /** Configuration for the new Lifeform */
  config: LifeformConfig;
  /** Spawner's mesh ID */
  spawnerId: Uint8Array;
  /** Preferred host device (null = auto-select) */
  preferredHost: Uint8Array | null;
  /** Timestamp */
  requestedAt: number;
}

// ─── Lifeform Query ───

export interface LifeformQuery {
  /** Search by name pattern */
  namePattern?: string;
  /** Filter by state */
  state?: LifeformState;
  /** Filter by host */
  hostId?: Uint8Array;
  /** Maximum results */
  limit?: number;
}

// ─── Wire Protocol Message Types ───

export enum LifeformMessageType {
  // Core
  LIFEFORM_SPAWN = 0xC0,
  LIFEFORM_SPAWN_ACK = 0xC1,
  LIFEFORM_CAUSE = 0xC2,
  LIFEFORM_RESPONSE = 0xC3,
  LIFEFORM_STATE_DELTA = 0xC4,
  LIFEFORM_STATE_ACK = 0xC5,

  // Migration
  LIFEFORM_MIGRATE_OFFER = 0xC6,
  LIFEFORM_MIGRATE_ACK = 0xC7,
  LIFEFORM_HOST_CHANGE = 0xC8,

  // Replication
  LIFEFORM_REPLICATE_OFFER = 0xC9,
  LIFEFORM_REPLICA_RELEASE = 0xCA,

  // DNS
  LIFEFORM_DNS_UPDATE = 0xCB,
  LIFEFORM_DNS_QUERY = 0xCC,
  LIFEFORM_DNS_RESPONSE = 0xCD,

  // Synapse
  LIFEFORM_SYNAPSE_OFFER = 0xCE,
  LIFEFORM_SYNAPSE_ACK = 0xCF,

  // Lifecycle
  LIFEFORM_KILL = 0xD0,
  LIFEFORM_HEARTBEAT = 0xD1,
  LIFEFORM_CCU_TOPUP = 0xD2,
  LIFEFORM_QUERY = 0xD3,

  // Fusion
  LIFEFORM_FUSION_PROPOSE = 0xD4,
  LIFEFORM_FUSION_ACCEPT = 0xD5,
  LIFEFORM_FUSION_REJECT = 0xD6,
  LIFEFORM_FUSION_EXECUTE = 0xD7,
  LIFEFORM_FISSION_NOTIFY = 0xD8,

  // Evolution
  LIFEFORM_MUTATE = 0xD9,
  LIFEFORM_GENERATION_RESULT = 0xDA,

  // Intent
  LIFEFORM_INTENT_DECLARE = 0xDB,
  LIFEFORM_INTENT_REVOKE = 0xDC,
  INTENT_SAMPLE_REQUEST = 0xDD,
  INTENT_SAMPLE_RESPONSE = 0xDE,
  INTENT_VIOLATION = 0xDF,

  // State query
  LIFEFORM_STATE_READ = 0xE0,
}
