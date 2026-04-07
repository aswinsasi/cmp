"use strict";
/**
 * CMP Incentive Types
 * Credit accounting and reputation system.
 *
 * @module types/incentive
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPUTATION_WEIGHTS = exports.REPUTATION_DECAY_RATE = exports.REPUTATION_EXCLUDED = exports.REPUTATION_LOW_PRIORITY = exports.REPUTATION_DEFAULT = exports.REPUTATION_MAX = exports.REPUTATION_MIN = exports.CCU_DEFINITION = exports.BOOTSTRAP_CREDITS = void 0;
/** Bootstrap credits for new mesh participants */
exports.BOOTSTRAP_CREDITS = 100;
/** 1 CCU = 1 CPU-core-second at 1 GHz ARM Cortex-A76 equivalent */
exports.CCU_DEFINITION = '1 CPU-core-second @ 1GHz ARM Cortex-A76';
/** Reputation score range */
exports.REPUTATION_MIN = 0;
exports.REPUTATION_MAX = 10000;
exports.REPUTATION_DEFAULT = 5000;
/** Below this score, device is deprioritized in task assignment */
exports.REPUTATION_LOW_PRIORITY = 2000;
/** Below this score, device is excluded from mesh participation */
exports.REPUTATION_EXCLUDED = 500;
/** Weekly decay rate for inactive devices */
exports.REPUTATION_DECAY_RATE = 0.05;
/** Scoring weights for reputation factors */
exports.REPUTATION_WEIGHTS = {
    completionRate: 0.35,
    accuracyRate: 0.30,
    availabilityRate: 0.20,
    resourceHonesty: 0.15,
};
//# sourceMappingURL=incentive.js.map