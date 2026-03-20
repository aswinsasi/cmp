/**
 * CMP Incentive Types
 * Credit accounting and reputation system.
 *
 * @module types/incentive
 * @author Agent Viscro
 */

import { CCU, Signature } from './primitives';

/**
 * Credit transaction between two mesh participants.
 */
export interface CreditTransaction {
  id: string;
  fromId: string;
  toId: string;
  amount: CCU;
  taskId: string;
  chunkId: string;
  timestamp: number;
  fromSignature: Uint8Array;
  toSignature: Uint8Array;
}

/**
 * Reputation factors used to compute reputation score.
 */
export interface ReputationFactors {
  /** Successful completions / total accepted assignments */
  completionRate: number;
  /** Verified correct results / total results */
  accuracyRate: number;
  /** Actual online time / advertised availability */
  availabilityRate: number;
  /** Actual resources delivered / advertised capabilities */
  resourceHonesty: number;
}

/** Bootstrap credits for new mesh participants */
export const BOOTSTRAP_CREDITS: CCU = 100;

/** 1 CCU = 1 CPU-core-second at 1 GHz ARM Cortex-A76 equivalent */
export const CCU_DEFINITION = '1 CPU-core-second @ 1GHz ARM Cortex-A76';

/** Reputation score range */
export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 10000;
export const REPUTATION_DEFAULT = 5000;

/** Below this score, device is deprioritized in task assignment */
export const REPUTATION_LOW_PRIORITY = 2000;

/** Below this score, device is excluded from mesh participation */
export const REPUTATION_EXCLUDED = 500;

/** Weekly decay rate for inactive devices */
export const REPUTATION_DECAY_RATE = 0.05;

/** Scoring weights for reputation factors */
export const REPUTATION_WEIGHTS = {
  completionRate: 0.35,
  accuracyRate: 0.30,
  availabilityRate: 0.20,
  resourceHonesty: 0.15,
};
