"use strict";
/**
 * CMP v1.3 — Metabolic Profile
 * Per-device energy state machine. Determines metabolic state from
 * power source, battery level, and thermal state. Tracks transitions
 * over time for mesh-wide capacity forecasting.
 *
 * State transitions:
 *   PLUGGED_IN   → ANABOLIC (if battery > 80%) or CHARGING
 *   UNPLUGGED    → HOMEOSTATIC (if battery > catabolicThreshold) or CATABOLIC
 *   BATTERY_LOW  → CATABOLIC
 *   BATTERY_CRIT → DORMANT
 *   THERMAL_THR  → CATABOLIC (regardless of battery)
 *   THERMAL_REC  → re-evaluate based on battery/power
 *
 * @module metabolism/metabolic-profile
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetabolicProfileManager = void 0;
const metabolism_1 = require("../types/metabolism");
const capability_1 = require("../types/capability");
const DEFAULT_CONFIG = {
    catabolicThreshold: 30,
    dormantThreshold: 10,
    energyBidWeight: 0.20,
    updateIntervalMs: 5000,
    historyHours: 24,
};
class MetabolicProfileManager {
    config;
    currentState = metabolism_1.MetabolicState.HOMEOSTATIC;
    transitions = [];
    lastUpdate = 0;
    updateTimer = null;
    // Current device readings
    batteryPercent = 100;
    powerSource = capability_1.PowerSource.PLUGGED;
    thermalState = capability_1.ThermalState.NOMINAL;
    cpuLoad = 0;
    /** External callback to read device state */
    readDeviceState = null;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Set the device state reader callback.
     * Called periodically to update metabolic state.
     */
    setDeviceStateReader(reader) {
        this.readDeviceState = reader;
    }
    /**
     * Start periodic updates.
     */
    start() {
        if (this.updateTimer)
            return;
        this.update(); // Initial evaluation
        this.updateTimer = setInterval(() => this.update(), this.config.updateIntervalMs);
    }
    /**
     * Stop periodic updates.
     */
    stop() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
    }
    /**
     * Manual update with explicit device state.
     */
    updateFromInput(input) {
        this.batteryPercent = input.batteryPercent;
        this.powerSource = input.powerSource;
        this.thermalState = input.thermalState;
        this.cpuLoad = input.cpuLoad;
        this.evaluateState();
    }
    /**
     * Get the current metabolic profile.
     */
    getProfile() {
        return {
            state: this.currentState,
            energyBudget: this.calculateEnergyBudget(),
            energyDelta: this.calculateEnergyDelta(),
            timeToStateChange: this.estimateTimeToStateChange(),
            thermalEfficiency: this.calculateThermalEfficiency(),
            powerSource: capability_1.PowerSource[this.powerSource],
            batteryPercent: this.batteryPercent,
            predictedIdleWindowMs: this.cpuLoad < 0.15 ? 300000 : 0,
            energyCcuBudget: this.calculateCcuBudget(),
            recentTransitions: [...this.transitions],
        };
    }
    /**
     * Get the current metabolic state.
     */
    getState() {
        return this.currentState;
    }
    /**
     * Get transition history.
     */
    getTransitions() {
        return [...this.transitions];
    }
    // ═══════════════════════════════════════
    // State Machine
    // ═══════════════════════════════════════
    update() {
        if (this.readDeviceState) {
            const input = this.readDeviceState();
            this.batteryPercent = input.batteryPercent;
            this.powerSource = input.powerSource;
            this.thermalState = input.thermalState;
            this.cpuLoad = input.cpuLoad;
        }
        this.evaluateState();
        this.lastUpdate = Date.now();
    }
    evaluateState() {
        const oldState = this.currentState;
        let newState;
        let trigger;
        // Thermal override — throttled devices go CATABOLIC regardless
        if (this.thermalState === capability_1.ThermalState.THROTTLED) {
            newState = metabolism_1.MetabolicState.CATABOLIC;
            trigger = metabolism_1.MetabolicTrigger.THERMAL_THROTTLE;
        }
        // Plugged in
        else if (this.powerSource === capability_1.PowerSource.PLUGGED || this.powerSource === capability_1.PowerSource.SOLAR) {
            if (this.batteryPercent >= 80) {
                newState = metabolism_1.MetabolicState.ANABOLIC;
                trigger = metabolism_1.MetabolicTrigger.PLUGGED_IN;
            }
            else {
                newState = metabolism_1.MetabolicState.CHARGING;
                trigger = metabolism_1.MetabolicTrigger.PLUGGED_IN;
            }
        }
        // On battery
        else {
            if (this.batteryPercent <= this.config.dormantThreshold) {
                newState = metabolism_1.MetabolicState.DORMANT;
                trigger = metabolism_1.MetabolicTrigger.BATTERY_CRITICAL;
            }
            else if (this.batteryPercent <= this.config.catabolicThreshold) {
                newState = metabolism_1.MetabolicState.CATABOLIC;
                trigger = metabolism_1.MetabolicTrigger.BATTERY_LOW;
            }
            else {
                newState = metabolism_1.MetabolicState.HOMEOSTATIC;
                trigger = metabolism_1.MetabolicTrigger.UNPLUGGED;
            }
        }
        if (newState !== oldState) {
            this.transitionTo(newState, trigger);
        }
    }
    transitionTo(newState, trigger) {
        const transition = {
            fromState: this.currentState,
            toState: newState,
            timestamp: Date.now(),
            trigger,
        };
        this.transitions.push(transition);
        this.currentState = newState;
        // Trim history beyond configured window
        const cutoff = Date.now() - this.config.historyHours * 3600 * 1000;
        this.transitions = this.transitions.filter(t => t.timestamp >= cutoff);
    }
    // ═══════════════════════════════════════
    // Calculations
    // ═══════════════════════════════════════
    /**
     * Energy budget: 0.0 (depleted) to 1.0 (full).
     * Based on battery + power source.
     */
    calculateEnergyBudget() {
        const batteryFactor = this.batteryPercent / 100;
        switch (this.currentState) {
            case metabolism_1.MetabolicState.ANABOLIC:
                return Math.min(1.0, batteryFactor + 0.3); // Plugged = extra energy
            case metabolism_1.MetabolicState.CHARGING:
                return Math.min(1.0, batteryFactor + 0.1);
            case metabolism_1.MetabolicState.HOMEOSTATIC:
                return batteryFactor;
            case metabolism_1.MetabolicState.CATABOLIC:
                return batteryFactor * 0.5; // Conserving
            case metabolism_1.MetabolicState.DORMANT:
                return 0.05; // Nearly nothing
        }
    }
    /**
     * Energy delta: rate of change per hour.
     * Positive = charging, negative = draining.
     */
    calculateEnergyDelta() {
        if (this.powerSource === capability_1.PowerSource.PLUGGED) {
            if (this.batteryPercent < 100)
                return 0.5; // Charging at ~50%/hr
            return 0.0; // Full
        }
        if (this.powerSource === capability_1.PowerSource.SOLAR) {
            return 0.1; // Slow charge
        }
        // On battery — drain rate depends on CPU load
        const baseDrain = -0.1; // ~10%/hr idle
        const loadDrain = -0.3 * this.cpuLoad; // Up to 30%/hr at full load
        return baseDrain + loadDrain;
    }
    /**
     * Thermal efficiency: 0.0 (throttled) to 1.0 (cool).
     */
    calculateThermalEfficiency() {
        switch (this.thermalState) {
            case capability_1.ThermalState.NOMINAL: return 1.0;
            case capability_1.ThermalState.WARM: return 0.7;
            case capability_1.ThermalState.THROTTLED: return 0.3;
        }
    }
    /**
     * Estimate time until next state change (ms).
     */
    estimateTimeToStateChange() {
        const delta = this.calculateEnergyDelta();
        if (this.currentState === metabolism_1.MetabolicState.CHARGING && delta > 0) {
            // Time to reach 80% (ANABOLIC threshold)
            const remaining = (80 - this.batteryPercent) / 100;
            return remaining > 0 ? (remaining / delta) * 3600000 : 0;
        }
        if (this.currentState === metabolism_1.MetabolicState.HOMEOSTATIC && delta < 0) {
            // Time to reach catabolic threshold
            const remaining = (this.batteryPercent - this.config.catabolicThreshold) / 100;
            return remaining > 0 ? (remaining / Math.abs(delta)) * 3600000 : 0;
        }
        if (this.currentState === metabolism_1.MetabolicState.CATABOLIC && delta < 0) {
            // Time to reach dormant threshold
            const remaining = (this.batteryPercent - this.config.dormantThreshold) / 100;
            return remaining > 0 ? (remaining / Math.abs(delta)) * 3600000 : 0;
        }
        return Infinity; // Stable state
    }
    /**
     * CCU budget this device is willing to spend per hour.
     */
    calculateCcuBudget() {
        switch (this.currentState) {
            case metabolism_1.MetabolicState.ANABOLIC: return 50;
            case metabolism_1.MetabolicState.CHARGING: return 20;
            case metabolism_1.MetabolicState.HOMEOSTATIC: return 30;
            case metabolism_1.MetabolicState.CATABOLIC: return 5;
            case metabolism_1.MetabolicState.DORMANT: return 0;
        }
    }
}
exports.MetabolicProfileManager = MetabolicProfileManager;
//# sourceMappingURL=metabolic-profile.js.map