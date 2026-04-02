/**
 * CMP v2.0 — Layer 12: Computation Spacetime Types
 *
 * Fork reality. Run parallel universes. Merge the best one back.
 *
 * Every cause execution becomes a node in a Merkle DAG — a complete,
 * content-addressed, immutable computation history. Timelines can be
 * forked into parallel branches, raced against each other, and merged
 * back using CRDT conflict-free merge.
 *
 * Wire Protocol: 0xE6-0xEB
 *
 * @module types/spacetime
 * @author Agent Viscro
 */

// ═══════════════════════════════════════
// Wire Protocol Messages (0xE6-0xEB)
// ═══════════════════════════════════════

export enum SpacetimeMessageType {
  /** Fork a Lifeform's timeline into a new branch */
  TIMELINE_FORK = 0xE6,
  /** Sync branch state to interested peers */
  BRANCH_STATE_SYNC = 0xE7,
  /** Start a branch race (N branches, best wins) */
  BRANCH_RACE_START = 0xE8,
  /** Branch fitness metrics update */
  BRANCH_METRICS = 0xE9,
  /** Merge a winning branch back into trunk */
  TIMELINE_MERGE = 0xEA,
  /** Query historical computation state from DAG */
  ARCHAEOLOGY_QUERY = 0xEB,
}

// ═══════════════════════════════════════
// Causal Merkle DAG
// ═══════════════════════════════════════

/** A single node in the causal Merkle DAG */
export interface DAGNode {
  /** Content hash of this node (SHA-256 of: parentHash + causeId + stateHash + resultHash) */
  hash: string;
  /** Parent node hash (empty string for genesis) */
  parentHash: string;
  /** Cause that triggered this computation */
  causeId: string;
  /** Hash of CRDT state snapshot AFTER this execution */
  stateHash: string;
  /** Hash of the execution result */
  resultHash: string;
  /** Branch this node belongs to */
  branchId: string;
  /** Sequence number within the branch (0-indexed) */
  sequence: number;
  /** Timestamp of execution */
  timestamp: number;
  /** Execution time in ms */
  executionTimeMs: number;
  /** CCU cost of this execution */
  ccuCost: number;
  /** Compact state snapshot (for reconstruction) */
  stateSnapshot?: any;
}

/** Metadata about the DAG */
export interface DAGInfo {
  /** Total nodes in the DAG */
  totalNodes: number;
  /** Number of branches */
  branchCount: number;
  /** Current head hashes per branch */
  heads: Map<string, string>;
  /** Genesis node hash */
  genesisHash: string;
  /** Total computation time across all nodes */
  totalComputeMs: number;
  /** Total CCU spent across all nodes */
  totalCcu: number;
}

// ═══════════════════════════════════════
// Temporal Forking
// ═══════════════════════════════════════

/** A timeline branch */
export interface Branch {
  /** Unique branch ID */
  id: string;
  /** Human-readable label */
  label: string;
  /** Parent branch ID ('trunk' for first-level forks) */
  parentBranchId: string;
  /** DAG node hash where this branch forked from */
  forkPointHash: string;
  /** Current head node hash */
  headHash: string;
  /** Number of nodes in this branch since fork */
  length: number;
  /** When the branch was created */
  createdAt: number;
  /** Branch state */
  state: BranchState;
  /** CRDT state snapshot at fork point */
  forkSnapshot?: any;
  /** Fitness metrics for racing */
  fitness?: BranchFitness;
}

export enum BranchState {
  /** Active and accepting causes */
  ACTIVE = 'active',
  /** Paused (not processing causes) */
  PAUSED = 'paused',
  /** Merged back into parent */
  MERGED = 'merged',
  /** Abandoned (lost a race or manually killed) */
  ABANDONED = 'abandoned',
  /** Racing against other branches */
  RACING = 'racing',
}

// ═══════════════════════════════════════
// Branch Racing
// ═══════════════════════════════════════

/** A race between parallel branches */
export interface BranchRace {
  /** Unique race ID */
  id: string;
  /** Lifeform ID being raced */
  lifeformId: string;
  /** Branch IDs participating */
  branchIds: string[];
  /** When the race started */
  startedAt: number;
  /** Maximum duration before auto-judging (ms) */
  maxDurationMs: number;
  /** Minimum causes each branch must process before judging */
  minCausesPerBranch: number;
  /** Race state */
  state: RaceState;
  /** Fitness function to evaluate branches */
  fitnessMetric: FitnessMetric;
  /** Result */
  result?: RaceResult;
}

export enum RaceState {
  RUNNING = 'running',
  JUDGING = 'judging',
  DECIDED = 'decided',
  CANCELLED = 'cancelled',
}

export enum FitnessMetric {
  /** Lowest CCU cost per cause */
  CCU_EFFICIENCY = 'ccu_efficiency',
  /** Fastest execution time per cause */
  SPEED = 'speed',
  /** Highest state mutations (most productive) */
  PRODUCTIVITY = 'productivity',
  /** Custom scoring function */
  CUSTOM = 'custom',
}

/** Fitness measurements for a branch */
export interface BranchFitness {
  /** Total causes processed */
  causesProcessed: number;
  /** Total execution time (ms) */
  totalExecutionMs: number;
  /** Total CCU spent */
  totalCcu: number;
  /** Total state mutations */
  totalMutations: number;
  /** Average execution time per cause */
  avgExecutionMs: number;
  /** Average CCU per cause */
  avgCcuPerCause: number;
  /** Custom score (0.0 - 1.0) */
  customScore: number;
  /** Last updated */
  updatedAt: number;
}

export interface RaceResult {
  /** Winning branch ID */
  winnerId: string;
  /** Winning branch fitness */
  winnerFitness: BranchFitness;
  /** All branch fitness scores */
  allFitness: Map<string, BranchFitness>;
  /** When decided */
  decidedAt: number;
  /** Reason */
  reason: string;
}

// ═══════════════════════════════════════
// Wire Formats
// ═══════════════════════════════════════

export interface TimelineForkWire {
  lifeformId: string;
  branchId: string;
  label: string;
  forkPointHash: string;
  parentBranchId: string;
  timestamp: number;
}

export interface BranchStateSyncWire {
  branchId: string;
  headHash: string;
  latestNode: DAGNode;
  fitness?: BranchFitness;
}

export interface BranchRaceStartWire {
  raceId: string;
  lifeformId: string;
  branchIds: string[];
  maxDurationMs: number;
  minCausesPerBranch: number;
  fitnessMetric: FitnessMetric;
  startedAt: number;
}

export interface BranchMetricsWire {
  raceId: string;
  branchId: string;
  fitness: BranchFitness;
}

export interface TimelineMergeWire {
  sourceBranchId: string;
  targetBranchId: string;
  mergeNodeHash: string;
  timestamp: number;
}

export interface ArchaeologyQueryWire {
  /** Node hash to look up */
  nodeHash?: string;
  /** Branch ID to get history for */
  branchId?: string;
  /** Sequence range */
  fromSequence?: number;
  toSequence?: number;
  /** Requesting node */
  requesterId: string;
}

// ═══════════════════════════════════════
// Configuration
// ═══════════════════════════════════════

export interface SpacetimeConfig {
  /** Maximum DAG nodes to store per Lifeform (default: 1000) */
  maxDAGNodes: number;
  /** Maximum concurrent branches per Lifeform (default: 8) */
  maxBranches: number;
  /** Default race duration (ms, default: 30000) */
  defaultRaceDurationMs: number;
  /** Default minimum causes per branch before judging (default: 5) */
  defaultMinCausesPerBranch: number;
  /** Store full state snapshots every N nodes (default: 10) */
  snapshotEveryN: number;
  /** DAG node TTL in ms (0 = never expire, default: 3600000 = 1 hour) */
  dagNodeTtlMs: number;
}

export const DEFAULT_SPACETIME_CONFIG: SpacetimeConfig = {
  maxDAGNodes: 1000,
  maxBranches: 8,
  defaultRaceDurationMs: 30000,
  defaultMinCausesPerBranch: 5,
  snapshotEveryN: 10,
  dagNodeTtlMs: 3600000,
};
