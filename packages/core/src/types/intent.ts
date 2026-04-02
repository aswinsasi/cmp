/**
 * CMP v1.4 — Intent Contract Types
 * A Lifeform declares machine-verifiable INTENTs — formal promises
 * about what it will achieve. The mesh verifies via probabilistic
 * sampling without re-execution or global consensus.
 *
 * @module types/intent
 * @author Agent Viscro
 */

// ─── Intent Contract ───

export interface IntentContract {
  /** Intent ID (16 bytes) */
  id: Uint8Array;
  /** Lifeform that committed to this intent */
  lifeformId: Uint8Array;
  /** Human-readable description */
  description: string;
  /** Formal predicate — evaluated against Lifeform's CRDT state */
  predicate: IntentPredicate;
  /** How often to sample (ms) */
  sampleIntervalMs: number;
  /** How many random peers sample per interval */
  samplesPerInterval: number;
  /** What happens on violation */
  violationAction: ViolationAction;
  /** CCU staked (slashed on violation) */
  ccuStaked: number;
  /** Beneficiary: who receives slashed CCU */
  beneficiaryId: Uint8Array;
  /** Active since */
  activeSince: number;
  /** Expiry (0 = permanent) */
  expiresAt: number;
  /** Lifeform's signature committing to this intent */
  commitment: Uint8Array;            // 64 bytes
  /** Consecutive violations before action (default: 3) */
  violationThreshold: number;
  /** Current consecutive violation count */
  consecutiveViolations: number;
}

// ─── Intent Predicate ───

export interface IntentPredicate {
  /** The type of check */
  type: PredicateType;
  /** CRDT key to evaluate */
  stateKey: string;
  /** Comparison operator */
  operator: 'lt' | 'gt' | 'eq' | 'lte' | 'gte' | 'between' | 'contains' | 'not_empty';
  /** Threshold value */
  value: number | string | [number, number];
  /** For compound predicates: AND/OR of sub-predicates */
  children?: IntentPredicate[];
  logicOperator?: 'and' | 'or';
}

export enum PredicateType {
  /** Simple value comparison on a single CRDT key */
  VALUE_CHECK = 'value_check',
  /** Rate check: value change per time window */
  RATE_CHECK = 'rate_check',
  /** Freshness: key was updated within N ms */
  FRESHNESS_CHECK = 'freshness_check',
  /** Compound: AND/OR of sub-predicates */
  COMPOUND = 'compound',
}

// ─── Violation Actions ───

export enum ViolationAction {
  /** Emit INTENT_VIOLATION cause to the Lifeform (self-correct) */
  NOTIFY = 'notify',
  /** Slash staked CCU and notify beneficiary */
  SLASH = 'slash',
  /** Kill the Lifeform */
  KILL = 'kill',
  /** Force fission if composite */
  FORCE_FISSION = 'force_fission',
}

// ─── Intent Sample (verification) ───

export interface IntentSample {
  /** Sample ID (16 bytes) */
  id: Uint8Array;
  /** Intent being sampled */
  intentId: Uint8Array;
  /** Sampling peer mesh ID */
  samplerId: Uint8Array;
  /** State value observed */
  observedValue: string;
  /** Predicate result */
  satisfied: boolean;
  /** Timestamp */
  sampledAt: number;
  /** Sampler's Ed25519 signature over the result */
  signature: Uint8Array;
}

// ─── Intent Evaluation Result ───

export interface IntentEvaluationResult {
  intentId: Uint8Array;
  satisfied: boolean;
  samplesCollected: number;
  satisfiedCount: number;
  violatedCount: number;
  evaluatedAt: number;
}
