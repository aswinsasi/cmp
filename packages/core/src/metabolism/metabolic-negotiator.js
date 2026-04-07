"use strict";
/**
 * CMP v1.3 — Metabolic Negotiator
 * Energy-aware bid scoring. Modifies the v1.2 scoring formula to include
 * metabolic state as a weighted factor.
 *
 * v1.2 scoring:
 *   score = resource_match * 0.40 + estimated_time * 0.25 + reputation * 0.20 + power * 0.15
 *
 * v1.3 scoring (with metabolism):
 *   score = resource_match * 0.30 + estimated_time * 0.20 + reputation * 0.20
 *         + metabolic_score * 0.20 + power * 0.10
 *
 * Metabolic score:
 *   ANABOLIC    → base 1.0
 *   HOMEOSTATIC → base 0.7
 *   CATABOLIC   → base 0.3 (only for HIGH+ priority)
 *   CHARGING    → base 0.5
 *   DORMANT     → base 0.0 (excluded)
 *
 *   metabolic_score = base * energyBudget * thermalEfficiency
 *                   + 0.1 * clamp(energyDelta, 0, 1)
 *
 * @module metabolism/metabolic-negotiator
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetabolicNegotiator = void 0;
const metabolism_1 = require("../types/metabolism");
const DEFAULT_CONFIG = {
    catabolicThreshold: 30,
    dormantThreshold: 10,
    energyBidWeight: 0.20,
    updateIntervalMs: 5000,
    historyHours: 24,
};
class MetabolicNegotiator {
    config;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Calculate the metabolic score for a peer based on their profile.
     * Returns 0.0-1.0. Returns -1 if the device should be excluded.
     */
    calculateMetabolicScore(profile, taskPriority) {
        // DORMANT devices are excluded
        if (profile.state === metabolism_1.MetabolicState.DORMANT) {
            return -1;
        }
        // CATABOLIC devices only participate for HIGH+ priority
        if (profile.state === metabolism_1.MetabolicState.CATABOLIC && taskPriority < 2) {
            return -1;
        }
        // Base score from metabolic state
        let base;
        switch (profile.state) {
            case metabolism_1.MetabolicState.ANABOLIC:
                base = 1.0;
                break;
            case metabolism_1.MetabolicState.HOMEOSTATIC:
                base = 0.7;
                break;
            case metabolism_1.MetabolicState.CATABOLIC:
                base = 0.3;
                break;
            case metabolism_1.MetabolicState.CHARGING:
                base = 0.5;
                break;
            default:
                base = 0.0;
        }
        // Modulate by energy budget and thermal efficiency
        const metabolicScore = base * profile.energyBudget * profile.thermalEfficiency;
        // Bonus for positive energy trend (charging/plugged)
        const deltaBonusFactor = Math.max(0, Math.min(1, profile.energyDelta));
        const deltaBonus = 0.1 * deltaBonusFactor;
        return Math.min(1.0, metabolicScore + deltaBonus);
    }
    /**
     * Calculate the full v1.3 bid score (replaces v1.2 formula).
     * Returns -1 if the device should be excluded from bidding.
     */
    scoreBid(inputs, metabolicProfile) {
        const metabolicScore = this.calculateMetabolicScore(metabolicProfile, inputs.taskPriority);
        // Excluded
        if (metabolicScore < 0)
            return -1;
        const w = this.config.energyBidWeight; // Default 0.20
        // Redistribute weights to accommodate metabolism
        // Original: resource=0.40, time=0.25, rep=0.20, power=0.15
        // New:      resource=0.30, time=0.20, rep=0.20, metabolic=w, power=0.30-w
        const resourceWeight = 0.30;
        const timeWeight = 0.20;
        const repWeight = 0.20;
        const metabolicWeight = w;
        const powerWeight = Math.max(0.05, 0.30 - w);
        const score = inputs.resourceMatch * resourceWeight
            + inputs.estimatedTime * timeWeight
            + inputs.reputation * repWeight
            + metabolicScore * metabolicWeight
            + inputs.powerStability * powerWeight;
        return Math.min(1.0, score);
    }
    /**
     * Check if a device should be allowed to bid based on metabolic state.
     * This is an additional gate for the 8-gate bid evaluation.
     */
    shouldAllowBid(profile, taskPriority) {
        if (profile.state === metabolism_1.MetabolicState.DORMANT)
            return false;
        if (profile.state === metabolism_1.MetabolicState.CATABOLIC && taskPriority < 2)
            return false;
        return true;
    }
    /**
     * Get the metabolic preference for bid order.
     * Higher = more preferred for accepting work.
     */
    getPreference(state) {
        switch (state) {
            case metabolism_1.MetabolicState.ANABOLIC: return 5;
            case metabolism_1.MetabolicState.HOMEOSTATIC: return 4;
            case metabolism_1.MetabolicState.CHARGING: return 3;
            case metabolism_1.MetabolicState.CATABOLIC: return 2;
            case metabolism_1.MetabolicState.DORMANT: return 0;
        }
    }
}
exports.MetabolicNegotiator = MetabolicNegotiator;
//# sourceMappingURL=metabolic-negotiator.js.map