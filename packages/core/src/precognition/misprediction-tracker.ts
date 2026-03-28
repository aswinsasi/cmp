/**
 * CMP v1.3 — Misprediction Tracker
 * Tracks hit/miss rates for precognition predictions and calculates
 * the optimal aggressiveness level for speculative computation.
 *
 * Aggressiveness controls:
 *   - DreamScheduler.maxPredictionsPerCycle = floor(8 * aggressiveness)
 *   - DreamScheduler.maxSpeculativeBudgetPerCycle = floor(50 * aggressiveness)
 *   - PhantomCache.minCacheConfidence = 1.0 - aggressiveness
 *
 * @module precognition/misprediction-tracker
 * @author Agent Viscro
 */

import { MispredictionStats, PredictionPattern } from '../types/precognition';

/** Default rolling window size for rate calculation */
const DEFAULT_WINDOW_SIZE = 100;

interface ResultEntry {
  hit: boolean;
  pattern: PredictionPattern;
  ccuAmount: number;
  timestamp: number;
}

export class MispredictionTracker {
  private windowSize: number;
  private baseAggressiveness: number;
  private recentResults: ResultEntry[] = [];

  // Cumulative stats
  private totalPredictions = 0;
  private totalHits = 0;
  private totalMisses = 0;
  private totalCcuSpent = 0;
  private totalCcuSaved = 0;

  // Per-pattern tracking
  private patternHits = new Map<PredictionPattern, number>();
  private patternTotal = new Map<PredictionPattern, number>();

  constructor(windowSize?: number, initialAggressiveness?: number) {
    this.windowSize = windowSize ?? DEFAULT_WINDOW_SIZE;
    this.baseAggressiveness = initialAggressiveness ?? 0.3;

    // Initialize all patterns
    for (const pattern of Object.values(PredictionPattern)) {
      this.patternHits.set(pattern, 0);
      this.patternTotal.set(pattern, 0);
    }
  }

  /**
   * Record a cache hit — prediction was correct.
   */
  recordHit(pattern: PredictionPattern, ccuSaved: number): void {
    this.totalPredictions++;
    this.totalHits++;
    this.totalCcuSaved += ccuSaved;

    this.patternHits.set(pattern, (this.patternHits.get(pattern) ?? 0) + 1);
    this.patternTotal.set(pattern, (this.patternTotal.get(pattern) ?? 0) + 1);

    this.recentResults.push({
      hit: true,
      pattern,
      ccuAmount: ccuSaved,
      timestamp: Date.now(),
    });

    this.trimWindow();
  }

  /**
   * Record a cache miss — prediction expired without a real task matching.
   */
  recordMiss(pattern: PredictionPattern, ccuWasted: number): void {
    this.totalPredictions++;
    this.totalMisses++;
    this.totalCcuSpent += ccuWasted;

    this.patternTotal.set(pattern, (this.patternTotal.get(pattern) ?? 0) + 1);

    this.recentResults.push({
      hit: false,
      pattern,
      ccuAmount: ccuWasted,
      timestamp: Date.now(),
    });

    this.trimWindow();
  }

  /**
   * Calculate current aggressiveness level.
   *
   * Formula:
   *   aggressiveness = clamp(baseAggressiveness * hitRateMultiplier, 0.05, 0.95)
   *
   * Where:
   *   hitRateMultiplier = hitRate / 0.5  (1.0 at 50% hit rate)
   *   If hitRate > 0.7 → increase by 10%
   *   If hitRate < 0.2 → decrease by 30%
   *   If netCcuBenefit < 0 → halve
   */
  calculateAggressiveness(): number {
    if (this.totalPredictions === 0) {
      return this.baseAggressiveness;
    }

    const hitRate = this.getWindowHitRate();
    const hitRateMultiplier = hitRate / 0.5; // 1.0 at 50%

    let aggressiveness = this.baseAggressiveness * hitRateMultiplier;

    // Boost for high hit rates
    if (hitRate > 0.7) {
      aggressiveness *= 1.1;
    }

    // Reduce for low hit rates
    if (hitRate < 0.2) {
      aggressiveness *= 0.7;
    }

    // Halve if we're losing CCU overall
    const netBenefit = this.totalCcuSaved - this.totalCcuSpent;
    if (netBenefit < 0) {
      aggressiveness *= 0.5;
    }

    // Clamp
    return Math.max(0.05, Math.min(0.95, aggressiveness));
  }

  /**
   * Get hit rate over the rolling window.
   */
  getWindowHitRate(): number {
    if (this.recentResults.length === 0) return 0;
    const hits = this.recentResults.filter(r => r.hit).length;
    return hits / this.recentResults.length;
  }

  /**
   * Get per-pattern hit rates.
   */
  getPatternHitRates(): Map<PredictionPattern, number> {
    const rates = new Map<PredictionPattern, number>();
    for (const pattern of Object.values(PredictionPattern)) {
      const total = this.patternTotal.get(pattern) ?? 0;
      const hits = this.patternHits.get(pattern) ?? 0;
      rates.set(pattern, total > 0 ? hits / total : 0);
    }
    return rates;
  }

  /**
   * Get full stats snapshot.
   */
  getStats(): MispredictionStats {
    const hitRate = this.totalPredictions > 0 ? this.totalHits / this.totalPredictions : 0;

    return {
      totalPredictions: this.totalPredictions,
      hits: this.totalHits,
      misses: this.totalMisses,
      hitRate,
      speculativeCcuSpent: this.totalCcuSpent,
      ccuSavedByHits: this.totalCcuSaved,
      netCcuBenefit: this.totalCcuSaved - this.totalCcuSpent,
      patternHitRates: this.getPatternHitRates(),
      aggressiveness: this.calculateAggressiveness(),
    };
  }

  /**
   * Reset all tracking.
   */
  reset(): void {
    this.totalPredictions = 0;
    this.totalHits = 0;
    this.totalMisses = 0;
    this.totalCcuSpent = 0;
    this.totalCcuSaved = 0;
    this.recentResults = [];

    for (const pattern of Object.values(PredictionPattern)) {
      this.patternHits.set(pattern, 0);
      this.patternTotal.set(pattern, 0);
    }
  }

  // ── Internals ──

  private trimWindow(): void {
    while (this.recentResults.length > this.windowSize) {
      this.recentResults.shift();
    }
  }
}
