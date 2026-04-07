"use strict";
/**
 * CMP v3.0 — Computation Entanglement Type Definitions
 * Bidirectional symmetric CRDT state mirroring between two Lifeforms.
 *
 * Unlike replication (master → slave), entanglement is symmetric:
 * both Lifeforms are primaries. A change in either is immediately
 * reflected in the other via CRDT merge (guaranteed convergence).
 *
 * @module types/entanglement
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ENTANGLEMENT_CONFIG = void 0;
exports.DEFAULT_ENTANGLEMENT_CONFIG = {
    maxEntanglementsPerLifeform: 3,
    syncMode: 'immediate',
    batchIntervalMs: 100,
    crossDevice: false,
};
//# sourceMappingURL=entanglement.js.map