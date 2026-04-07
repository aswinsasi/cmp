"use strict";
/**
 * CMP v1.3 — Computation Metabolism Type Definitions
 * Energy-aware state machine that transforms binary battery gates
 * into continuous metabolic variables shaping mesh behavior.
 *
 * @module types/metabolism
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetabolicTrigger = exports.MetabolicState = exports.ThermalState = exports.PowerSource = void 0;
// Re-export power source from capability types
var capability_1 = require("./capability");
Object.defineProperty(exports, "PowerSource", { enumerable: true, get: function () { return capability_1.PowerSource; } });
Object.defineProperty(exports, "ThermalState", { enumerable: true, get: function () { return capability_1.ThermalState; } });
// ─── Metabolic State Machine ───
var MetabolicState;
(function (MetabolicState) {
    /** Plugged in, excess energy, actively seeking work */
    MetabolicState["ANABOLIC"] = "anabolic";
    /** Normal operation, balanced energy */
    MetabolicState["HOMEOSTATIC"] = "homeostatic";
    /** On battery, conserving, selective about tasks */
    MetabolicState["CATABOLIC"] = "catabolic";
    /** Near-zero contribution, passive mesh member */
    MetabolicState["DORMANT"] = "dormant";
    /** Charging rapidly — will transition to ANABOLIC soon */
    MetabolicState["CHARGING"] = "charging";
})(MetabolicState || (exports.MetabolicState = MetabolicState = {}));
var MetabolicTrigger;
(function (MetabolicTrigger) {
    MetabolicTrigger["PLUGGED_IN"] = "plugged_in";
    MetabolicTrigger["UNPLUGGED"] = "unplugged";
    MetabolicTrigger["BATTERY_LOW"] = "battery_low";
    MetabolicTrigger["BATTERY_CRITICAL"] = "battery_critical";
    MetabolicTrigger["THERMAL_THROTTLE"] = "thermal_throttle";
    MetabolicTrigger["THERMAL_RECOVERY"] = "thermal_recovery";
    MetabolicTrigger["IDLE_DETECTED"] = "idle_detected";
    MetabolicTrigger["ACTIVE_USAGE"] = "active_usage";
    MetabolicTrigger["SCHEDULED"] = "scheduled";
})(MetabolicTrigger || (exports.MetabolicTrigger = MetabolicTrigger = {}));
//# sourceMappingURL=metabolism.js.map