/**
 * CMP v1.3 — Temporal Compute Futures Type Definitions
 * Devices pre-commit future idle compute capacity as tradeable
 * "Compute Futures" — cryptographically signed promises to provide
 * compute during specific time windows.
 *
 * @module types/futures
 * @author Agent Viscro
 */

import { Runtime } from './capability';

// ─── Capability Tier (simplified from CapMap) ───

export enum CapabilityTier {
  T1 = 1,  // CPU only, < 1GB RAM
  T2 = 2,  // Multi-core, 2-4GB
  T3 = 3,  // CPU + mobile GPU, 4-8GB
  T4 = 4,  // CPU + strong GPU, 8-16GB
  T5 = 5,  // CPU + discrete GPU, 16GB+
}

// ─── Future Contract ───

export interface ComputeFuture {
  /** Unique future ID */
  id: Uint8Array;                    // 16 bytes
  /** Seller's mesh ID */
  sellerId: Uint8Array;              // 16 bytes
  /** Buyer's mesh ID (null if not yet purchased) */
  buyerId: Uint8Array | null;
  /** Capability tier offered */
  tier: CapabilityTier;
  /** Specific resources promised */
  resources: FutureResources;
  /** Time window for delivery */
  windowStart: number;               // Unix ms
  windowEnd: number;                 // Unix ms
  /** CCU price (asking or agreed) */
  ccuPrice: number;
  /** Status */
  status: FutureStatus;
  /** Seller's Ed25519 signature over the commitment */
  sellerSignature: Uint8Array;       // 64 bytes
  /** Buyer's signature (after purchase) */
  buyerSignature: Uint8Array | null;
  /** Created timestamp */
  createdAt: number;
  /** Confidence that seller can deliver (from metabolic + reputation data) */
  deliveryConfidence: number;
}

export interface FutureResources {
  /** CPU cores offered */
  cores: number;
  /** Memory MB offered */
  memoryMb: number;
  /** Duration in minutes */
  durationMinutes: number;
  /** Estimated CCU capacity (cores * durationMinutes * tier_multiplier) */
  estimatedCcu: number;
  /** Runtimes supported */
  runtimes: Runtime[];
}

export enum FutureStatus {
  /** Listed on market, not yet purchased */
  LISTED = 'listed',
  /** Purchased but delivery window hasn't started */
  RESERVED = 'reserved',
  /** Currently in delivery window */
  ACTIVE = 'active',
  /** Successfully delivered */
  SETTLED = 'settled',
  /** Seller failed to deliver */
  DEFAULTED = 'defaulted',
  /** Cancelled before purchase */
  CANCELLED = 'cancelled',
  /** Expired without being purchased */
  EXPIRED = 'expired',
}

export interface FutureOrder {
  /** Order ID */
  id: Uint8Array;
  /** Buy or sell */
  side: 'buy' | 'sell';
  /** The future being traded */
  futureId: Uint8Array;
  /** CCU offered/asked */
  ccuAmount: number;
  /** Expires at */
  expiresAt: number;
}

export interface FutureSettlementResult {
  futureId: Uint8Array;
  delivered: boolean;
  /** Actual CCU delivered */
  actualCcu: number;
  /** Promised CCU */
  promisedCcu: number;
  /** Delivery ratio (actual/promised) */
  deliveryRatio: number;
  /** Reputation adjustment */
  reputationDelta: number;
  /** CCU transferred (or refunded) */
  ccuTransferred: number;
  /** Settlement timestamp */
  settledAt: number;
}

export interface FutureMarketConfig {
  /** Maximum time in advance a future can be listed (ms, default: 7 days) */
  maxFutureHorizonMs: number;
  /** Minimum duration for a future window (ms, default: 30 minutes) */
  minWindowDurationMs: number;
  /** Maximum listed futures per device (default: 10) */
  maxListedPerDevice: number;
  /** Delivery ratio threshold for SETTLED vs DEFAULTED (default: 0.8) */
  deliveryThreshold: number;
  /** Reputation penalty for default (default: -500) */
  defaultReputationPenalty: number;
  /** Reputation bonus for successful delivery (default: +100) */
  deliveryReputationBonus: number;
}

// ─── Wire Protocol ───

export enum FutureMessageType {
  FUTURE_LIST = 0xA0,
  FUTURE_BUY = 0xA1,
  FUTURE_CONFIRM = 0xA2,
  FUTURE_CANCEL = 0xA3,
  FUTURE_SETTLE = 0xA4,
  FUTURE_QUERY = 0xA5,
}
