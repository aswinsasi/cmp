/**
 * CMP v2.0 — Layer 11: Collective Consciousness Types
 *
 * The mesh thinks as one — without anyone being in charge.
 *
 * Three bio-inspired coordination mechanisms:
 *   1. Stigmergy: indirect coordination through pheromone trails
 *   2. Quorum Sensing: mesh-wide behavioral shift at signal threshold
 *   3. Swarm Decision: stochastic distributed decision without voting
 *
 * @module types/consciousness
 * @author Agent Viscro
 */

import { TaskType } from './task';

// ═══════════════════════════════════════
// Wire Protocol Messages (0xE1-0xE5)
// ═══════════════════════════════════════

/** Layer 11 message types — add to MessageType enum */
export enum ConsciousnessMessageType {
  /** Node deposits a pheromone trail into the mesh */
  PHEROMONE_DEPOSIT = 0xE1,
  /** Node detects quorum has been reached for a signal */
  QUORUM_SIGNAL = 0xE2,
  /** Swarm decision initiated — request sampling */
  SWARM_DECISION_INIT = 0xE3,
  /** Individual node's stochastic sample for a decision */
  SWARM_DECISION_SAMPLE = 0xE4,
  /** Mesh-wide emergent behavior notification */
  EMERGENCE_NOTIFY = 0xE5,
}

// ═══════════════════════════════════════
// Pheromone System (Stigmergy)
// ═══════════════════════════════════════

/** Types of pheromone trails nodes can deposit */
export enum PheromoneType {
  /** Computation completed successfully here — attract similar tasks */
  COMPUTE_SUCCESS = 'compute_success',
  /** High resource availability — attract compute-hungry tasks */
  RESOURCE_AVAILABLE = 'resource_available',
  /** Task failed / timed out — repel similar tasks */
  COMPUTE_FAILURE = 'compute_failure',
  /** Threat detected — warn others away */
  DANGER = 'danger',
  /** High network latency to this region — reroute */
  CONGESTION = 'congestion',
  /** Custom application-defined pheromone */
  CUSTOM = 'custom',
}

/** A pheromone deposit left in the mesh */
export interface Pheromone {
  /** Unique ID of this deposit */
  id: string;
  /** Type of signal */
  type: PheromoneType;
  /** Emitter device ID (hex) */
  emitterId: string;
  /** Signal concentration (0.0 - 1.0, decays over time) */
  concentration: number;
  /** Related task type (if applicable) */
  taskType?: TaskType;
  /** Custom payload (for CUSTOM type) */
  payload?: string;
  /** When deposited (ms since epoch) */
  depositedAt: number;
  /** Time-to-live in ms (after which it evaporates) */
  ttlMs: number;
  /** How many hops this pheromone has traveled */
  hops: number;
  /** Maximum hops before evaporation */
  maxHops: number;
}

/** Wire format for PHEROMONE_DEPOSIT message */
export interface PheromoneDepositWire {
  id: string;
  type: PheromoneType;
  emitterId: string;
  concentration: number;
  taskType?: string;
  payload?: string;
  depositedAt: number;
  ttlMs: number;
  hops: number;
  maxHops: number;
}

// ═══════════════════════════════════════
// Quorum Sensing
// ═══════════════════════════════════════

/** A signal that nodes observe independently */
export interface QuorumObservation {
  /** What pattern was observed */
  signalType: string;
  /** Which node observed it */
  observerId: string;
  /** Observation timestamp */
  observedAt: number;
  /** Strength of the observation (0.0-1.0) */
  strength: number;
  /** Evidence data (compact) */
  evidence?: string;
}

/** Quorum state for a specific signal */
export interface QuorumState {
  signalType: string;
  /** Unique observer count */
  observerCount: number;
  /** Total nodes in mesh (for calculating percentage) */
  meshSize: number;
  /** Current quorum percentage (observerCount / meshSize) */
  quorumPercent: number;
  /** Whether threshold has been reached */
  thresholdReached: boolean;
  /** When quorum was first reached */
  reachedAt?: number;
  /** Observations that make up this quorum */
  observations: QuorumObservation[];
}

/** Wire format for QUORUM_SIGNAL message */
export interface QuorumSignalWire {
  signalType: string;
  observerId: string;
  strength: number;
  evidence?: string;
  observedAt: number;
}

/** What happens when quorum is reached */
export enum QuorumAction {
  /** Mesh-wide alert broadcast */
  ALERT = 'alert',
  /** Trigger collective resource reallocation */
  REALLOCATE = 'reallocate',
  /** Activate/deactivate a mesh behavior */
  BEHAVIOR_SHIFT = 'behavior_shift',
  /** Trigger immune response */
  IMMUNE_RESPONSE = 'immune_response',
  /** Custom callback */
  CUSTOM = 'custom',
}

export interface QuorumRule {
  /** Signal type to watch for */
  signalType: string;
  /** Percentage of nodes that must observe (0.0 - 1.0) */
  threshold: number;
  /** Action to take when quorum is reached */
  action: QuorumAction;
  /** Minimum strength per observation to count */
  minStrength: number;
  /** Time window: only count observations within this window (ms) */
  windowMs: number;
  /** Cooldown after triggering (ms) — prevent rapid re-triggering */
  cooldownMs: number;
}

// ═══════════════════════════════════════
// Swarm Decision Making
// ═══════════════════════════════════════

/** A decision the mesh needs to make collectively */
export interface SwarmDecision {
  /** Unique decision ID */
  id: string;
  /** What we're deciding */
  question: string;
  /** Available options */
  options: string[];
  /** Who initiated the decision */
  initiatorId: string;
  /** When initiated */
  initiatedAt: number;
  /** How long to collect samples (ms) */
  samplingWindowMs: number;
  /** Minimum samples needed for validity */
  minSamples: number;
  /** Current state */
  state: SwarmDecisionState;
  /** Collected samples */
  samples: SwarmSample[];
  /** Final result (once decided) */
  result?: SwarmDecisionResult;
}

export enum SwarmDecisionState {
  /** Collecting samples from nodes */
  SAMPLING = 'sampling',
  /** Enough samples, computing result */
  COMPUTING = 'computing',
  /** Decision reached */
  DECIDED = 'decided',
  /** Not enough samples — inconclusive */
  INCONCLUSIVE = 'inconclusive',
  /** Decision expired */
  EXPIRED = 'expired',
}

/** Individual node's stochastic sample */
export interface SwarmSample {
  decisionId: string;
  voterId: string;
  /** The option this node selected */
  selectedOption: string;
  /** Weight of this vote (based on reputation, capability, etc.) */
  weight: number;
  /** Nonce for randomness verification */
  nonce: string;
  /** Timestamp */
  sampledAt: number;
}

export interface SwarmDecisionResult {
  /** Winning option */
  winner: string;
  /** Confidence (0.0 - 1.0) */
  confidence: number;
  /** How many samples were collected */
  totalSamples: number;
  /** Score per option */
  scores: Map<string, number>;
  /** When decided */
  decidedAt: number;
}

/** Wire format for SWARM_DECISION_INIT */
export interface SwarmDecisionInitWire {
  id: string;
  question: string;
  options: string[];
  initiatorId: string;
  initiatedAt: number;
  samplingWindowMs: number;
  minSamples: number;
}

/** Wire format for SWARM_DECISION_SAMPLE */
export interface SwarmDecisionSampleWire {
  decisionId: string;
  voterId: string;
  selectedOption: string;
  weight: number;
  nonce: string;
  sampledAt: number;
}

// ═══════════════════════════════════════
// Emergent Behavior
// ═══════════════════════════════════════

/** Mesh-wide behavioral states that emerge from collective signals */
export enum MeshBehavior {
  /** Normal operation */
  NORMAL = 'normal',
  /** High demand detected — mesh enters performance mode */
  HIGH_DEMAND = 'high_demand',
  /** Threat detected — mesh enters defensive mode */
  DEFENSIVE = 'defensive',
  /** Low energy collective — mesh enters conservation mode */
  CONSERVATION = 'conservation',
  /** Learning mode — mesh is consolidating patterns (dreaming) */
  DREAMING = 'dreaming',
  /** Growth mode — mesh is actively recruiting/forming organs */
  GROWTH = 'growth',
}

/** Wire format for EMERGENCE_NOTIFY */
export interface EmergenceNotifyWire {
  behavior: MeshBehavior;
  reason: string;
  triggeredBy: string; // signal type that triggered it
  confidence: number;
  timestamp: number;
}

// ═══════════════════════════════════════
// Configuration
// ═══════════════════════════════════════

export interface ConsciousnessConfig {
  /** Pheromone evaporation rate per second (0.0 - 1.0, default: 0.05) */
  pheromoneDecayRate: number;
  /** Pheromone diffusion rate to neighbors (0.0 - 1.0, default: 0.3) */
  pheromoneDiffusionRate: number;
  /** Max pheromone hops (default: 5) */
  maxPheromoneHops: number;
  /** Default pheromone TTL in ms (default: 60000) */
  defaultPheromoneTtlMs: number;
  /** Pheromone cleanup interval (default: 5000) */
  pheromoneCleanupIntervalMs: number;
  /** Max pheromones stored per node (default: 500) */
  maxPheromonesPerNode: number;

  /** Default quorum threshold (0.0-1.0, default: 0.5 = 50% of nodes) */
  defaultQuorumThreshold: number;
  /** Quorum observation window (default: 30000ms) */
  defaultQuorumWindowMs: number;
  /** Quorum cooldown (default: 60000ms) */
  defaultQuorumCooldownMs: number;

  /** Swarm decision sampling window (default: 5000ms) */
  defaultSamplingWindowMs: number;
  /** Minimum samples for a valid swarm decision (default: 3) */
  defaultMinSamples: number;
  /** Confidence threshold for swarm decision (default: 0.6) */
  swarmConfidenceThreshold: number;

  /** How often to evaluate emergent behavior (default: 10000ms) */
  emergenceEvalIntervalMs: number;
}

export const DEFAULT_CONSCIOUSNESS_CONFIG: ConsciousnessConfig = {
  pheromoneDecayRate: 0.05,
  pheromoneDiffusionRate: 0.3,
  maxPheromoneHops: 5,
  defaultPheromoneTtlMs: 60000,
  pheromoneCleanupIntervalMs: 5000,
  maxPheromonesPerNode: 500,

  defaultQuorumThreshold: 0.5,
  defaultQuorumWindowMs: 30000,
  defaultQuorumCooldownMs: 60000,

  defaultSamplingWindowMs: 5000,
  defaultMinSamples: 3,
  swarmConfidenceThreshold: 0.6,

  emergenceEvalIntervalMs: 10000,
};
