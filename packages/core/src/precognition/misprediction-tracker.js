"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MispredictionTracker = void 0;
const precognition_1 = require("../types/precognition");
/** Default rolling window size for rate calculation */
const DEFAULT_WINDOW_SIZE = 100;
class MispredictionTracker {
    windowSize;
    baseAggressiveness;
    recentResults = [];
    // Cumulative stats
    totalPredictions = 0;
    totalHits = 0;
    totalMisses = 0;
    totalCcuSpent = 0;
    totalCcuSaved = 0;
    // Per-pattern tracking
    patternHits = new Map();
    patternTotal = new Map();
    constructor(windowSize, initialAggressiveness) {
        this.windowSize = windowSize ?? DEFAULT_WINDOW_SIZE;
        this.baseAggressiveness = initialAggressiveness ?? 0.3;
        // Initialize all patterns
        for (const pattern of Object.values(precognition_1.PredictionPattern)) {
            this.patternHits.set(pattern, 0);
            this.patternTotal.set(pattern, 0);
        }
    }
    /**
     * Record a cache hit — prediction was correct.
     */
    recordHit(pattern, ccuSaved) {
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
    recordMiss(pattern, ccuWasted) {
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
    calculateAggressiveness() {
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
    getWindowHitRate() {
        if (this.recentResults.length === 0)
            return 0;
        const hits = this.recentResults.filter(r => r.hit).length;
        return hits / this.recentResults.length;
    }
    /**
     * Get per-pattern hit rates.
     */
    getPatternHitRates() {
        const rates = new Map();
        for (const pattern of Object.values(precognition_1.PredictionPattern)) {
            const total = this.patternTotal.get(pattern) ?? 0;
            const hits = this.patternHits.get(pattern) ?? 0;
            rates.set(pattern, total > 0 ? hits / total : 0);
        }
        return rates;
    }
    /**
     * Get full stats snapshot.
     */
    getStats() {
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
    reset() {
        this.totalPredictions = 0;
        this.totalHits = 0;
        this.totalMisses = 0;
        this.totalCcuSpent = 0;
        this.totalCcuSaved = 0;
        this.recentResults = [];
        for (const pattern of Object.values(precognition_1.PredictionPattern)) {
            this.patternHits.set(pattern, 0);
            this.patternTotal.set(pattern, 0);
        }
    }
    // ── Internals ──
    trimWindow() {
        while (this.recentResults.length > this.windowSize) {
            this.recentResults.shift();
        }
    }
}
exports.MispredictionTracker = MispredictionTracker;
//# sourceMappingURL=misprediction-tracker.js.map