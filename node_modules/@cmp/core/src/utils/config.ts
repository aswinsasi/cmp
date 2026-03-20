/**
 * CMP Configuration
 * All protocol-level configurable parameters with sensible defaults.
 *
 * @module utils/config
 * @author Agent Viscro
 */

import { ScoringWeights } from '../types/negotiation';

export interface CMPConfig {
  // ── Discovery ──
  transports: string[];
  beaconIntervalMs: number;
  peerStaleMs: number;
  peerDeadMs: number;

  // ── Resource Sharing ──
  maxResourceShare: number;
  maxConcurrentTasks: number;
  minBatteryPct: number;
  acceptingTasks: boolean;

  // ── Negotiation ──
  bidWindowMs: number;
  minBids: number;
  maxBids: number;
  scoringWeights: ScoringWeights;

  // ── Execution ──
  defaultRedundancy: number;
  maxWASMMemoryMb: number;

  // ── Fault Tolerance ──
  heartbeatIntervalMs: number;
  suspectThreshold: number;
  deadThreshold: number;
  checkpointIntervalMs: number;
  checkpointReplicas: number;

  // ── Incentive ──
  bootstrapCredits: number;
  reputationDecayRate: number;
  minReputationToParticipate: number;

  // ── Storage ──
  dbPath: string;
}

export const DEFAULT_CONFIG: CMPConfig = {
  // Discovery
  transports: ['lan'],
  beaconIntervalMs: 5000,
  peerStaleMs: 30000,
  peerDeadMs: 60000,

  // Resource Sharing
  maxResourceShare: 0.5,
  maxConcurrentTasks: 3,
  minBatteryPct: 15,
  acceptingTasks: true,

  // Negotiation
  bidWindowMs: 3000,
  minBids: 1,
  maxBids: 20,
  scoringWeights: {
    resourceMatch: 0.40,
    estimatedTime: 0.25,
    reputation: 0.20,
    powerStability: 0.15,
  },

  // Execution
  defaultRedundancy: 1,
  maxWASMMemoryMb: 512,

  // Fault Tolerance
  heartbeatIntervalMs: 2000,
  suspectThreshold: 3,
  deadThreshold: 5,
  checkpointIntervalMs: 10000,
  checkpointReplicas: 2,

  // Incentive
  bootstrapCredits: 100,
  reputationDecayRate: 0.05,
  minReputationToParticipate: 500,

  // Storage
  dbPath: './cmp-data/ledger.db',
};

/**
 * Merge user config with defaults.
 */
export function resolveConfig(partial: Partial<CMPConfig>): CMPConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
