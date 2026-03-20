/**
 * CMP Negotiation Types
 * Layer 3: Bidding, assignment, and scoring.
 *
 * @module types/negotiation
 * @author Agent Viscro
 */

import { TaskId, MeshId, ChunkId, SessionKey, Signature, CCU, Timestamp } from './primitives';
import { CMPCapability } from './capability';

/**
 * Bid - a device's offer to execute a task.
 */
export interface CMPBid {
  taskId: TaskId;
  bidderId: MeshId;
  offeredResources: Partial<CMPCapability>;
  estimatedTimeMs: number;
  /** Self-assessed reliability 0.0 - 1.0 */
  confidence: number;
  creditsRequested: CCU;
  signature: Signature;
}

/**
 * Assignment - sent to a winning bidder after selection.
 */
export interface CMPAssignment {
  taskId: TaskId;
  bidderId: MeshId;
  /** Chunk IDs assigned to this device */
  chunks: ChunkId[];
  /** Encrypted with bidder's public key */
  sessionKey: SessionKey;
  deadline: Timestamp;
  signature: Signature;
}

/**
 * Assignment acknowledgment.
 */
export interface CMPAssignmentAck {
  taskId: TaskId;
  bidderId: MeshId;
  accepted: boolean;
  signature: Signature;
}

/** Scored bid used internally during selection */
export interface ScoredBid {
  bid: CMPBid;
  score: number;
}

/** Negotiation configuration */
export interface NegotiationConfig {
  /** How long to collect bids (default: 500ms) */
  bidWindowMs: number;
  /** Minimum bids before proceeding */
  minBids: number;
  /** Stop collecting after this many bids */
  maxBids: number;
  /** Scoring weights (must sum to 1.0) */
  scoringWeights: ScoringWeights;
}

export interface ScoringWeights {
  resourceMatch: number;
  estimatedTime: number;
  reputation: number;
  powerStability: number;
}

export const DEFAULT_NEGOTIATION_CONFIG: NegotiationConfig = {
  bidWindowMs: 500,
  minBids: 2,
  maxBids: 20,
  scoringWeights: {
    resourceMatch: 0.40,
    estimatedTime: 0.25,
    reputation: 0.20,
    powerStability: 0.15,
  },
};
