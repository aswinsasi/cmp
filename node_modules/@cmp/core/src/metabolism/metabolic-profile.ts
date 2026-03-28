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

import {
  MetabolicState,
  MetabolicProfile,
  MetabolicTransition,
  MetabolicTrigger,
  MetabolismConfig,
} from '../types/metabolism';
import { PowerSource, ThermalState } from '../types/capability';

const DEFAULT_CONFIG: MetabolismConfig = {
  catabolicThreshold: 30,
  dormantThreshold: 10,
  energyBidWeight: 0.20,
  updateIntervalMs: 5000,
  historyHours: 24,
};

export interface DeviceEnergyInput {
  powerSource: PowerSource;
  batteryPercent: number;
  thermalState: ThermalState;
  cpuLoad: number;
}

export class MetabolicProfileManager {
  private config: MetabolismConfig;
  private currentState: MetabolicState = MetabolicState.HOMEOSTATIC;
  private transitions: MetabolicTransition[] = [];
  private lastUpdate = 0;
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  // Current device readings
  private batteryPercent = 100;
  private powerSource = PowerSource.PLUGGED;
  private thermalState = ThermalState.NOMINAL;
  private cpuLoad = 0;

  /** External callback to read device state */
  private readDeviceState: (() => DeviceEnergyInput) | null = null;

  constructor(config?: Partial<MetabolismConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the device state reader callback.
   * Called periodically to update metabolic state.
   */
  setDeviceStateReader(reader: () => DeviceEnergyInput): void {
    this.readDeviceState = reader;
  }

  /**
   * Start periodic updates.
   */
  start(): void {
    if (this.updateTimer) return;
    this.update(); // Initial evaluation
    this.updateTimer = setInterval(() => this.update(), this.config.updateIntervalMs);
  }

  /**
   * Stop periodic updates.
   */
  stop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Manual update with explicit device state.
   */
  updateFromInput(input: DeviceEnergyInput): void {
    this.batteryPercent = input.batteryPercent;
    this.powerSource = input.powerSource;
    this.thermalState = input.thermalState;
    this.cpuLoad = input.cpuLoad;
    this.evaluateState();
  }

  /**
   * Get the current metabolic profile.
   */
  getProfile(): MetabolicProfile {
    return {
      state: this.currentState,
      energyBudget: this.calculateEnergyBudget(),
      energyDelta: this.calculateEnergyDelta(),
      timeToStateChange: this.estimateTimeToStateChange(),
      thermalEfficiency: this.calculateThermalEfficiency(),
      powerSource: PowerSource[this.powerSource],
      batteryPercent: this.batteryPercent,
      predictedIdleWindowMs: this.cpuLoad < 0.15 ? 300000 : 0,
      energyCcuBudget: this.calculateCcuBudget(),
      recentTransitions: [...this.transitions],
    };
  }

  /**
   * Get the current metabolic state.
   */
  getState(): MetabolicState {
    return this.currentState;
  }

  /**
   * Get transition history.
   */
  getTransitions(): MetabolicTransition[] {
    return [...this.transitions];
  }

  // ═══════════════════════════════════════
  // State Machine
  // ═══════════════════════════════════════

  private update(): void {
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

  private evaluateState(): void {
    const oldState = this.currentState;
    let newState: MetabolicState;
    let trigger: MetabolicTrigger;

    // Thermal override — throttled devices go CATABOLIC regardless
    if (this.thermalState === ThermalState.THROTTLED) {
      newState = MetabolicState.CATABOLIC;
      trigger = MetabolicTrigger.THERMAL_THROTTLE;
    }
    // Plugged in
    else if (this.powerSource === PowerSource.PLUGGED || this.powerSource === PowerSource.SOLAR) {
      if (this.batteryPercent >= 80) {
        newState = MetabolicState.ANABOLIC;
        trigger = MetabolicTrigger.PLUGGED_IN;
      } else {
        newState = MetabolicState.CHARGING;
        trigger = MetabolicTrigger.PLUGGED_IN;
      }
    }
    // On battery
    else {
      if (this.batteryPercent <= this.config.dormantThreshold) {
        newState = MetabolicState.DORMANT;
        trigger = MetabolicTrigger.BATTERY_CRITICAL;
      } else if (this.batteryPercent <= this.config.catabolicThreshold) {
        newState = MetabolicState.CATABOLIC;
        trigger = MetabolicTrigger.BATTERY_LOW;
      } else {
        newState = MetabolicState.HOMEOSTATIC;
        trigger = MetabolicTrigger.UNPLUGGED;
      }
    }

    if (newState !== oldState) {
      this.transitionTo(newState, trigger);
    }
  }

  private transitionTo(newState: MetabolicState, trigger: MetabolicTrigger): void {
    const transition: MetabolicTransition = {
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
  private calculateEnergyBudget(): number {
    const batteryFactor = this.batteryPercent / 100;

    switch (this.currentState) {
      case MetabolicState.ANABOLIC:
        return Math.min(1.0, batteryFactor + 0.3); // Plugged = extra energy
      case MetabolicState.CHARGING:
        return Math.min(1.0, batteryFactor + 0.1);
      case MetabolicState.HOMEOSTATIC:
        return batteryFactor;
      case MetabolicState.CATABOLIC:
        return batteryFactor * 0.5; // Conserving
      case MetabolicState.DORMANT:
        return 0.05; // Nearly nothing
    }
  }

  /**
   * Energy delta: rate of change per hour.
   * Positive = charging, negative = draining.
   */
  private calculateEnergyDelta(): number {
    if (this.powerSource === PowerSource.PLUGGED) {
      if (this.batteryPercent < 100) return 0.5; // Charging at ~50%/hr
      return 0.0; // Full
    }
    if (this.powerSource === PowerSource.SOLAR) {
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
  private calculateThermalEfficiency(): number {
    switch (this.thermalState) {
      case ThermalState.NOMINAL: return 1.0;
      case ThermalState.WARM: return 0.7;
      case ThermalState.THROTTLED: return 0.3;
    }
  }

  /**
   * Estimate time until next state change (ms).
   */
  private estimateTimeToStateChange(): number {
    const delta = this.calculateEnergyDelta();

    if (this.currentState === MetabolicState.CHARGING && delta > 0) {
      // Time to reach 80% (ANABOLIC threshold)
      const remaining = (80 - this.batteryPercent) / 100;
      return remaining > 0 ? (remaining / delta) * 3600000 : 0;
    }

    if (this.currentState === MetabolicState.HOMEOSTATIC && delta < 0) {
      // Time to reach catabolic threshold
      const remaining = (this.batteryPercent - this.config.catabolicThreshold) / 100;
      return remaining > 0 ? (remaining / Math.abs(delta)) * 3600000 : 0;
    }

    if (this.currentState === MetabolicState.CATABOLIC && delta < 0) {
      // Time to reach dormant threshold
      const remaining = (this.batteryPercent - this.config.dormantThreshold) / 100;
      return remaining > 0 ? (remaining / Math.abs(delta)) * 3600000 : 0;
    }

    return Infinity; // Stable state
  }

  /**
   * CCU budget this device is willing to spend per hour.
   */
  private calculateCcuBudget(): number {
    switch (this.currentState) {
      case MetabolicState.ANABOLIC: return 50;
      case MetabolicState.CHARGING: return 20;
      case MetabolicState.HOMEOSTATIC: return 30;
      case MetabolicState.CATABOLIC: return 5;
      case MetabolicState.DORMANT: return 0;
    }
  }
}
