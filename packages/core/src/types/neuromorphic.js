"use strict";
/**
 * CMP v3.0 — Neuromorphic Routing Type Definitions
 * Spiking neural network routing where task pathways learn from success/failure.
 *
 * Replaces static routing tables with a biological neural model:
 *   - Tasks generate "spikes" that propagate through weighted connections
 *   - Successful paths get reinforced (long-term potentiation)
 *   - Failed paths get weakened (long-term depression)
 *   - The routing topology literally learns over time
 *
 * Combined with Stigmergy (L11):
 *   Stigmergy = global, slow, collective (pheromone trails)
 *   Neuromorphic = local, fast, connection-specific (synaptic weights)
 *
 * @module types/neuromorphic
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NEUROMORPHIC_CONFIG = void 0;
exports.DEFAULT_NEUROMORPHIC_CONFIG = {
    activationThreshold: 0.05,
    learningRate: 0.1,
    decayRate: 0.01,
    spikeDecayPerHop: 0.15,
    maxHops: 10,
    initialWeight: 0.5,
    stdpWindowMs: 100,
    decayIntervalMs: 60000,
    explorationRate: 0.1,
};
//# sourceMappingURL=neuromorphic.js.map