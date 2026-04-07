"use strict";
/**
 * CMP Configuration
 * All protocol-level configurable parameters with sensible defaults.
 *
 * @module utils/config
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.resolveConfig = resolveConfig;
exports.DEFAULT_CONFIG = {
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
    bidWindowMs: 500,
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
    // Mesh Cognition Layer (v1.2)
    mcl: {
        enabled: true,
        maxMers: 1000,
        maxPerOrigin: 50,
        maxPerJoin: 50,
        minHintConfidence: 70,
        merTtlDays: 90,
        merDbPath: './cmp-data/mers.db',
    },
};
/**
 * Merge user config with defaults.
 */
function resolveConfig(partial) {
    return { ...exports.DEFAULT_CONFIG, ...partial };
}
//# sourceMappingURL=config.js.map