"use strict";
/**
 * CMP v3.0 — Self-Modifying Protocol Type Definitions
 * Protocol parameters stored as CRDT state that evolve via natural selection.
 *
 * The ProtocolLifeform's genome IS the protocol configuration.
 * Every 24 hours: mutate → run parent vs mutant → winner survives.
 *
 * @module types/meta-evolution
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_META_EVOLUTION_CONFIG = exports.DEFAULT_PROTOCOL_GENOME = void 0;
exports.DEFAULT_PROTOCOL_GENOME = {
    fusionCcuThreshold: 1,
    intentSampleIntervalMs: 30000,
    catabolicThreshold: 0.30,
    hebbianIncrement: 0.02,
    synapseDecayPerHour: 0.05,
    maxCausesPerSecond: 100,
    replicationDeltaIntervalMs: 5000,
    precognitionConfidenceThreshold: 0.8,
    morphogenesisMinSpecialists: 3,
    neuromorphicLearningRate: 0.1,
    neuromorphicExplorationRate: 0.1,
};
exports.DEFAULT_META_EVOLUTION_CONFIG = {
    evaluationPeriodMs: 43200000, // 12 hours
    maxPerturbation: 0.2,
    minImprovementThreshold: 0.05,
    mutationsPerGeneration: 2,
    evolutionIntervalMs: 86400000, // 24 hours
};
//# sourceMappingURL=meta-evolution.js.map