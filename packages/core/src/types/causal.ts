/**
 * CMP v1.4 — Causal Reactive Execution Types
 * Lifeforms compute ONLY when CAUSED to compute. Causes propagate
 * through synapse networks creating emergent cascading behavior.
 *
 * Key innovations:
 *   - Causal chain tracking across the mesh
 *   - CCU-per-cause billing (not per-tick)
 *   - Causal backpressure (circuit-breaking at causal level)
 *   - Causal deadlines (end-to-end propagation)
 *
 * @module types/causal
 * @author Agent Viscro
 */

// ─── Cause Types ───

export enum CauseType {
  /** External message from a device */
  MESSAGE = 'message',
  /** Synapse signal from another Lifeform */
  SYNAPSE_SIGNAL = 'synapse_signal',
  /** Timer expiration (one-shot or recurring) */
  TIMER = 'timer',
  /** State change on a watched CRDT key */
  STATE_WATCH = 'state_watch',
  /** Mesh event: peer joined, peer left, lifeform migrated */
  MESH_EVENT = 'mesh_event',
  /** CCU balance crossed a threshold */
  CCU_THRESHOLD = 'ccu_threshold',
  /** Intent violation detected */
  INTENT_VIOLATION = 'intent_violation',
  /** Fusion request from another Lifeform */
  FUSION_REQUEST = 'fusion_request',
  /** Distributed computation result returned */
  DISTRIBUTION_RESULT = 'distribution_result',
}

// ─── Cause — the fundamental unit of "why a Lifeform computes" ───

export interface Cause {
  /** Unique cause ID (16 bytes) */
  id: Uint8Array;
  /** Type of cause */
  type: CauseType;
  /** The causal chain this belongs to */
  chainId: Uint8Array;               // 16 bytes (same across all linked causes)
  /** Depth in the causal chain (0 = original trigger) */
  chainDepth: number;
  /** Maximum allowed chain depth before backpressure (default: 64) */
  maxChainDepth: number;
  /** Deadline: entire chain must finish by this time (Unix ms, 0 = no deadline) */
  deadlineMs: number;
  /** Source: who/what emitted this cause */
  sourceId: Uint8Array;              // Mesh ID or Lifeform ID
  sourceType: 'device' | 'lifeform' | 'system' | 'timer';
  /** Target Lifeform ID */
  targetId: Uint8Array;
  /** Payload data */
  payload: Uint8Array;
  /** CCU attached to this cause */
  ccuAttached: number;
  /** Expects response? */
  expectsResponse: boolean;
  /** Correlation ID for request-response */
  correlationId: Uint8Array | null;
  /** Timestamp */
  emittedAt: number;
}

// ─── Causal Chain — tracks an entire cascade of computations ───

export interface CausalChain {
  /** Chain ID */
  chainId: Uint8Array;
  /** Original cause that started the chain */
  originCauseId: Uint8Array;
  /** Total causes in this chain so far */
  totalCauses: number;
  /** Total Lifeforms touched */
  lifeformsTouched: Set<string>;
  /** Total CCU spent across the chain */
  totalCcuSpent: number;
  /** Chain start time */
  startedAt: number;
  /** Deadline (0 = none) */
  deadlineMs: number;
  /** Is backpressure active? */
  backpressureActive: boolean;
  /** Current maximum depth reached */
  maxDepthReached: number;
}

// ─── Causal Chain Stats ───

export interface CausalChainStats {
  /** Total chains tracked */
  totalChains: number;
  /** Active chains (not yet completed) */
  activeChains: number;
  /** Chains that hit backpressure */
  backpressuredChains: number;
  /** Chains that missed deadline */
  deadlineMissedChains: number;
  /** Average chain depth */
  avgChainDepth: number;
  /** Average chain CCU cost */
  avgChainCcu: number;
}

// ─── Timer — self-set by a Lifeform ───

export interface LifeformTimer {
  /** Timer ID (16 bytes) */
  id: Uint8Array;
  /** Lifeform that set this timer */
  lifeformId: Uint8Array;
  /** Fire at this time (Unix ms) */
  fireAt: number;
  /** Recurring interval (0 = one-shot) */
  intervalMs: number;
  /** Payload to include when timer fires */
  payload: Uint8Array;
  /** Maximum firings (0 = unlimited for recurring) */
  maxFirings: number;
  /** Current firing count */
  firingCount: number;
}

// ─── StateWatch — wake when a CRDT key changes ───

export interface StateWatch {
  /** Watch ID (16 bytes) */
  id: Uint8Array;
  /** CRDT key to watch */
  key: string;
  /** Condition: wake on any change, or only when value crosses threshold */
  condition: WatchCondition;
  /** Threshold value (for THRESHOLD_ABOVE/BELOW) */
  threshold?: number;
  /** Lifeform to wake */
  lifeformId: Uint8Array;
}

export enum WatchCondition {
  ANY_CHANGE = 'any_change',
  THRESHOLD_ABOVE = 'threshold_above',
  THRESHOLD_BELOW = 'threshold_below',
  MEMBERSHIP_CHANGE = 'membership_change',
}

// ─── CCU Billing ───

export interface CauseBilling {
  /** Base cost per cause wake-up */
  baseCostCcu: number;               // default: 0.01
  /** Cost per ms of execution */
  computeCostPerMs: number;           // default: 0.001
  /** Cost per state mutation */
  stateMutationCost: number;          // default: 0.002
  /** State hosting cost per MB per hour */
  stateHostingCostPerMbHour: number;  // default: 0.5
}

export const DEFAULT_CAUSE_BILLING: CauseBilling = {
  baseCostCcu: 0.01,
  computeCostPerMs: 0.001,
  stateMutationCost: 0.002,
  stateHostingCostPerMbHour: 0.5,
};

/**
 * Calculate the CCU cost of a single cause execution.
 */
export function calculateCauseCost(
  billing: CauseBilling,
  executionTimeMs: number,
  stateMutations: number,
): number {
  return billing.baseCostCcu +
         (executionTimeMs * billing.computeCostPerMs) +
         (stateMutations * billing.stateMutationCost);
}

/**
 * Calculate hourly state hosting cost.
 */
export function calculateHostingCost(
  billing: CauseBilling,
  stateSizeBytes: number,
): number {
  const sizeMb = stateSizeBytes / (1024 * 1024);
  return sizeMb * billing.stateHostingCostPerMbHour;
}
