/**
 * CMP v1.3 — Future Market
 * Order book for compute futures. Sellers list capacity promises,
 * buyers purchase them with CCU escrow, and settlement happens
 * automatically after delivery windows close.
 *
 * @module futures/future-market
 * @author Agent Viscro
 */

import {
  ComputeFuture,
  FutureResources,
  FutureStatus,
  FutureMarketConfig,
  FutureSettlementResult,
  CapabilityTier,
} from '../types/futures';

// ── Helpers ──

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

const DEFAULT_CONFIG: FutureMarketConfig = {
  maxFutureHorizonMs: 7 * 24 * 3600 * 1000,  // 7 days
  minWindowDurationMs: 30 * 60 * 1000,         // 30 minutes
  maxListedPerDevice: 10,
  deliveryThreshold: 0.8,
  defaultReputationPenalty: -500,
  deliveryReputationBonus: 100,
};

/** Simplified ledger interface for escrow */
export interface ILedger {
  getBalance(deviceHex: string): number;
  deduct(deviceHex: string, amount: number): boolean;
  credit(deviceHex: string, amount: number): void;
  getReputation(deviceHex: string): number;
  adjustReputation(deviceHex: string, delta: number): void;
}

/** Tracks CCU delivered during a future's window */
export interface DeliveryTracker {
  /** Get total CCU that the seller earned from the buyer's tasks during the window */
  getCcuDelivered(sellerHex: string, buyerHex: string, windowStart: number, windowEnd: number): number;
}

export class FutureMarket {
  /** futureId hex → ComputeFuture */
  private listings = new Map<string, ComputeFuture>();

  /** Escrowed CCU: futureId hex → amount */
  private escrow = new Map<string, number>();

  private config: FutureMarketConfig;
  private ledger: ILedger;
  private deliveryTracker: DeliveryTracker | null = null;

  /** Settlement check timer */
  private settlementTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ledger: ILedger, config?: Partial<FutureMarketConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ledger = ledger;
  }

  /** Set the delivery tracker (for settlement) */
  setDeliveryTracker(tracker: DeliveryTracker): void {
    this.deliveryTracker = tracker;
  }

  /** Start periodic settlement checks and expiry sweeps */
  start(): void {
    this.settlementTimer = setInterval(() => {
      this.processSettlements();
      this.expireListings();
    }, 60000); // Check every minute
  }

  /** Stop settlement timer */
  stop(): void {
    if (this.settlementTimer) {
      clearInterval(this.settlementTimer);
      this.settlementTimer = null;
    }
  }

  // ═══════════════════════════════════════
  // Listing
  // ═══════════════════════════════════════

  /**
   * List a new compute future for sale.
   *
   * Validation:
   * 1. Window must be in the future and within maxFutureHorizonMs
   * 2. Duration must be >= minWindowDurationMs
   * 3. Seller must have reputation > 2000
   * 4. Seller must not exceed maxListedPerDevice
   *
   * @returns ComputeFuture or null if validation fails
   */
  listFuture(
    sellerId: Uint8Array,
    resources: FutureResources,
    windowStart: number,
    windowEnd: number,
    ccuPrice: number,
    tier: CapabilityTier = CapabilityTier.T3,
  ): ComputeFuture | null {
    const now = Date.now();
    const sellerHex = toHex(sellerId);

    // Validate window
    if (windowStart <= now) return null; // Must be in the future
    if (windowStart - now > this.config.maxFutureHorizonMs) return null; // Not too far ahead
    if (windowEnd - windowStart < this.config.minWindowDurationMs) return null; // Minimum duration
    if (ccuPrice <= 0) return null;
    if (resources.cores <= 0 || resources.memoryMb <= 0) return null;

    // Reputation check
    const rep = this.ledger.getReputation(sellerHex);
    if (rep < 2000) return null;

    // Listing cap per device
    const sellerListings = this.getListingsBySeller(sellerHex);
    if (sellerListings.length >= this.config.maxListedPerDevice) return null;

    // Calculate delivery confidence from reputation
    const deliveryConfidence = Math.min(0.95, rep / 10000);

    const future: ComputeFuture = {
      id: randomBytes(16),
      sellerId,
      buyerId: null,
      tier,
      resources,
      windowStart,
      windowEnd,
      ccuPrice,
      status: FutureStatus.LISTED,
      sellerSignature: new Uint8Array(64), // Placeholder — real impl uses Ed25519
      buyerSignature: null,
      createdAt: now,
      deliveryConfidence,
    };

    this.listings.set(toHex(future.id), future);
    return future;
  }

  // ═══════════════════════════════════════
  // Buying
  // ═══════════════════════════════════════

  /**
   * Purchase a listed future.
   *
   * Steps:
   * 1. Verify future is LISTED and not expired
   * 2. Verify buyer has sufficient CCU balance
   * 3. Escrow CCU from buyer
   * 4. Update future status to RESERVED
   */
  buyFuture(futureId: Uint8Array, buyerId: Uint8Array): boolean {
    const fidHex = toHex(futureId);
    const future = this.listings.get(fidHex);
    if (!future) return false;

    if (future.status !== FutureStatus.LISTED) return false;
    if (Date.now() >= future.windowStart) return false; // Window already started

    // Can't buy own future
    const buyerHex = toHex(buyerId);
    const sellerHex = toHex(future.sellerId);
    if (buyerHex === sellerHex) return false;

    // Check buyer balance
    const balance = this.ledger.getBalance(buyerHex);
    if (balance < future.ccuPrice) return false;

    // Escrow: deduct from buyer, hold in escrow
    if (!this.ledger.deduct(buyerHex, future.ccuPrice)) return false;
    this.escrow.set(fidHex, future.ccuPrice);

    // Update future
    future.buyerId = buyerId;
    future.buyerSignature = new Uint8Array(64); // Placeholder
    future.status = FutureStatus.RESERVED;

    return true;
  }

  // ═══════════════════════════════════════
  // Settlement
  // ═══════════════════════════════════════

  /**
   * Settle a future after delivery window ends.
   *
   * Steps:
   * 1. Calculate actual CCU delivered during window
   * 2. Calculate deliveryRatio
   * 3. If ratio >= threshold → SETTLED (release escrow to seller + rep bonus)
   * 4. If ratio < threshold → DEFAULTED (refund buyer + rep penalty for seller)
   */
  settleFuture(futureId: Uint8Array): FutureSettlementResult | null {
    const fidHex = toHex(futureId);
    const future = this.listings.get(fidHex);
    if (!future) return null;

    if (future.status !== FutureStatus.ACTIVE && future.status !== FutureStatus.RESERVED) return null;
    if (!future.buyerId) return null;

    const now = Date.now();
    const sellerHex = toHex(future.sellerId);
    const buyerHex = toHex(future.buyerId);
    const escrowed = this.escrow.get(fidHex) ?? 0;

    // Calculate actual delivery
    let actualCcu = 0;
    if (this.deliveryTracker) {
      actualCcu = this.deliveryTracker.getCcuDelivered(
        sellerHex, buyerHex, future.windowStart, future.windowEnd,
      );
    }

    const promisedCcu = future.resources.estimatedCcu;
    const deliveryRatio = promisedCcu > 0 ? actualCcu / promisedCcu : 0;
    const delivered = deliveryRatio >= this.config.deliveryThreshold;

    let reputationDelta: number;
    let ccuTransferred: number;

    if (delivered) {
      // SUCCESS — release escrow to seller
      future.status = FutureStatus.SETTLED;
      this.ledger.credit(sellerHex, escrowed);
      reputationDelta = this.config.deliveryReputationBonus;
      ccuTransferred = escrowed;
    } else {
      // DEFAULT — refund buyer, penalize seller
      future.status = FutureStatus.DEFAULTED;
      this.ledger.credit(buyerHex, escrowed);
      reputationDelta = this.config.defaultReputationPenalty;
      ccuTransferred = 0;
    }

    this.ledger.adjustReputation(sellerHex, reputationDelta);
    this.escrow.delete(fidHex);

    return {
      futureId,
      delivered,
      actualCcu,
      promisedCcu,
      deliveryRatio,
      reputationDelta,
      ccuTransferred,
      settledAt: now,
    };
  }

  // ═══════════════════════════════════════
  // Queries
  // ═══════════════════════════════════════

  /**
   * Query listed futures by criteria.
   */
  queryFutures(filter: {
    minTier?: CapabilityTier;
    afterTime?: number;
    beforeTime?: number;
    maxCcuPrice?: number;
    statusFilter?: FutureStatus;
  } = {}): ComputeFuture[] {
    const results: ComputeFuture[] = [];

    for (const future of this.listings.values()) {
      const status = filter.statusFilter ?? FutureStatus.LISTED;
      if (future.status !== status) continue;

      if (filter.minTier && future.tier < filter.minTier) continue;
      if (filter.afterTime && future.windowStart < filter.afterTime) continue;
      if (filter.beforeTime && future.windowEnd > filter.beforeTime) continue;
      if (filter.maxCcuPrice && future.ccuPrice > filter.maxCcuPrice) continue;

      results.push(future);
    }

    return results.sort((a, b) => a.ccuPrice - b.ccuPrice); // Cheapest first
  }

  /**
   * Cancel a listed future (only if not yet RESERVED).
   */
  cancelFuture(futureId: Uint8Array, sellerId: Uint8Array): boolean {
    const fidHex = toHex(futureId);
    const future = this.listings.get(fidHex);
    if (!future) return false;

    if (future.status !== FutureStatus.LISTED) return false;
    if (toHex(future.sellerId) !== toHex(sellerId)) return false;

    future.status = FutureStatus.CANCELLED;
    return true;
  }

  /**
   * Get all futures involving this device (as seller or buyer).
   */
  getMyFutures(deviceId: Uint8Array): ComputeFuture[] {
    const hex = toHex(deviceId);
    const results: ComputeFuture[] = [];

    for (const future of this.listings.values()) {
      if (toHex(future.sellerId) === hex) results.push(future);
      else if (future.buyerId && toHex(future.buyerId) === hex) results.push(future);
    }

    return results;
  }

  /**
   * Get a specific future by ID.
   */
  getFuture(futureId: Uint8Array): ComputeFuture | null {
    return this.listings.get(toHex(futureId)) ?? null;
  }

  /**
   * Get all listings (for CLI).
   */
  getAllListings(): ComputeFuture[] {
    return [...this.listings.values()];
  }

  /**
   * Get escrow amount for a future.
   */
  getEscrow(futureId: Uint8Array): number {
    return this.escrow.get(toHex(futureId)) ?? 0;
  }

  /** Total listings count */
  get size(): number {
    return this.listings.size;
  }

  // ═══════════════════════════════════════
  // Internals
  // ═══════════════════════════════════════

  private getListingsBySeller(sellerHex: string): ComputeFuture[] {
    const results: ComputeFuture[] = [];
    for (const future of this.listings.values()) {
      if (toHex(future.sellerId) === sellerHex &&
          (future.status === FutureStatus.LISTED || future.status === FutureStatus.RESERVED)) {
        results.push(future);
      }
    }
    return results;
  }

  /**
   * Process settlements for all futures whose windows have ended.
   */
  private processSettlements(): void {
    const now = Date.now();

    for (const future of this.listings.values()) {
      // Activate reserved futures whose window has started
      if (future.status === FutureStatus.RESERVED && now >= future.windowStart && now < future.windowEnd) {
        future.status = FutureStatus.ACTIVE;
      }

      // Settle active futures whose window has ended
      if ((future.status === FutureStatus.ACTIVE || future.status === FutureStatus.RESERVED) &&
          now >= future.windowEnd && future.buyerId) {
        this.settleFuture(future.id);
      }
    }
  }

  /**
   * Expire old LISTED futures that were never purchased.
   */
  private expireListings(): void {
    const now = Date.now();

    for (const future of this.listings.values()) {
      if (future.status === FutureStatus.LISTED && now >= future.windowStart) {
        future.status = FutureStatus.EXPIRED;
      }
    }
  }
}
