"use strict";
/**
 * CMP Negotiation Types
 * Layer 3: Bidding, assignment, and scoring.
 *
 * @module types/negotiation
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NEGOTIATION_CONFIG = void 0;
exports.DEFAULT_NEGOTIATION_CONFIG = {
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
//# sourceMappingURL=negotiation.js.map