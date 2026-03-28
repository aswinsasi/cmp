/**
 * CMP v1.3 — Computation Metabolism Type Definitions
 * Energy-aware state machine that transforms binary battery gates
 * into continuous metabolic variables shaping mesh behavior.
 *
 * @module types/metabolism
 * @author Agent Viscro
 */

// Re-export power source from capability types
export { PowerSource, ThermalState } from './capability';

// ─── Metabolic State Machine ───

export enum MetabolicState {
  /** Plugged in, excess energy, actively seeking work */
  ANABOLIC = 'anabolic',
  /** Normal operation, balanced energy */
  HOMEOSTATIC = 'homeostatic',
  /** On battery, conserving, selective about tasks */
  CATABOLIC = 'catabolic',
  /** Near-zero contribution, passive mesh member */
  DORMANT = 'dormant',
  /** Charging rapidly — will transition to ANABOLIC soon */
  CHARGING = 'charging',
}

export interface MetabolicProfile {
  state: MetabolicState;
  /** Energy budget: 0.0 (depleted) to 1.0 (full capacity) */
  energyBudget: number;
  /** Rate of energy change per hour (-1.0 to +1.0) */
  energyDelta: number;
  /** Estimated time until state change (ms) */
  timeToStateChange: number;
  /** Thermal contribution factor: 0.0 (throttled) to 1.0 (cool) */
  thermalEfficiency: number;
  /** Power source */
  powerSource: string;
  /** Battery percentage (0-100) */
  batteryPercent: number;
  /** Predicted idle window duration (ms) */
  predictedIdleWindowMs: number;
  /** Maximum CCU willing to spend per hour */
  energyCcuBudget: number;
  /** Metabolic history — state transitions in last 24 hours */
  recentTransitions: MetabolicTransition[];
}

export interface MetabolicTransition {
  fromState: MetabolicState;
  toState: MetabolicState;
  timestamp: number;
  trigger: MetabolicTrigger;
}

export enum MetabolicTrigger {
  PLUGGED_IN = 'plugged_in',
  UNPLUGGED = 'unplugged',
  BATTERY_LOW = 'battery_low',
  BATTERY_CRITICAL = 'battery_critical',
  THERMAL_THROTTLE = 'thermal_throttle',
  THERMAL_RECOVERY = 'thermal_recovery',
  IDLE_DETECTED = 'idle_detected',
  ACTIVE_USAGE = 'active_usage',
  SCHEDULED = 'scheduled',
}

// ─── Mesh-Wide Summary ───

export interface MeshMetabolicSummary {
  /** Count of devices in each metabolic state */
  stateDistribution: Record<MetabolicState, number>;
  /** Total available energy budget across mesh */
  totalEnergyBudget: number;
  /** Mesh-wide metabolic efficiency (0.0 to 1.0) */
  meshEfficiency: number;
  /** Predicted mesh capacity over next 4 hours (hourly buckets) */
  capacityForecast: number[];
  /** Is the mesh in a "high energy" or "low energy" phase? */
  meshPhase: 'expansion' | 'contraction' | 'stable';
}

// ─── Config ───

export interface MetabolismConfig {
  /** Battery threshold for CATABOLIC state (default: 30) */
  catabolicThreshold: number;
  /** Battery threshold for DORMANT state (default: 10) */
  dormantThreshold: number;
  /** How much to weight energy in bid scoring (default: 0.20) */
  energyBidWeight: number;
  /** Update interval for metabolic state (ms, default: 5000) */
  updateIntervalMs: number;
  /** Track metabolic history for this many hours (default: 24) */
  historyHours: number;
}
