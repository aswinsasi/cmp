/**
 * CMP v1.3 — Morphogen Signaler
 * Emits and responds to chemical-gradient-inspired signals.
 * Specialized devices emit morphogen signals advertising their affinity.
 * Nearby devices with matching affinities respond, creating concentration
 * gradients that drive organ formation.
 *
 * Signal Lifecycle:
 *   1. Device with high specialization emits MORPHOGEN_SIGNAL
 *   2. Signal propagates through mesh, losing concentration per hop
 *   3. Devices receiving strong matching signals join or form organs
 *   4. Signals decay naturally over time
 *
 * @module morphogenesis/morphogen-signaler
 * @author Agent Viscro
 */

import { TaskType } from '../types/task';
import {
  MorphogenSignal,
  MorphogenesisConfig,
} from '../types/morphogenesis';
import { AffinityTracker } from './affinity-tracker';

const DEFAULT_CONFIG: Partial<MorphogenesisConfig> = {
  signalIntervalMs: 10000,
  morphogenDecayRate: 0.3,
  maxMorphogenTtl: 5,
  minSpecializationScore: 0.6,
};

export class MorphogenSignaler {
  private affinityTracker: AffinityTracker;
  private config: Partial<MorphogenesisConfig>;

  /** Received signals: emitterId → latest signal */
  private receivedSignals = new Map<string, MorphogenSignal>();

  /** Concentration per task type from all received signals */
  private concentrationMap = new Map<TaskType, number>();

  /** Signal emission timer */
  private signalTimer: ReturnType<typeof setInterval> | null = null;

  /** Our device ID (hex) */
  private deviceId: string;

  /** Callback for emitting signals to the mesh */
  private emitFn: ((signal: MorphogenSignal) => void) | null = null;

  constructor(
    deviceId: string,
    affinityTracker: AffinityTracker,
    config?: Partial<MorphogenesisConfig>,
  ) {
    this.deviceId = deviceId;
    this.affinityTracker = affinityTracker;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Set callback for emitting signals to the transport layer */
  onEmit(fn: (signal: MorphogenSignal) => void): void {
    this.emitFn = fn;
  }

  /** Start periodic signal emission */
  start(): void {
    const interval = this.config.signalIntervalMs ?? 10000;
    this.signalTimer = setInterval(() => this.emitSignal(), interval);
  }

  /** Stop signal emission */
  stop(): void {
    if (this.signalTimer) {
      clearInterval(this.signalTimer);
      this.signalTimer = null;
    }
  }

  /**
   * Emit a morphogen signal if this device is specialized enough.
   * Called periodically by the timer.
   */
  emitSignal(): MorphogenSignal | null {
    const affinity = this.affinityTracker.getAffinity(this.deviceId);
    if (!affinity) return null;

    const minScore = this.config.minSpecializationScore ?? 0.6;
    if (affinity.specializationScore < minScore) return null;

    const signal: MorphogenSignal = {
      emitterId: this.deviceId,
      taskType: affinity.primaryAffinity,
      concentration: affinity.specializationScore,
      organId: null, // Will be set by OrganManager if device is in an organ
      ttl: this.config.maxMorphogenTtl ?? 5,
      emittedAt: Date.now(),
    };

    if (this.emitFn) {
      this.emitFn(signal);
    }

    return signal;
  }

  /**
   * Receive a morphogen signal from another device.
   * Applies hop decay and updates concentration map.
   */
  receiveSignal(signal: MorphogenSignal): void {
    // Ignore own signals
    if (signal.emitterId === this.deviceId) return;

    // Ignore expired signals
    if (signal.ttl <= 0) return;

    // Apply hop decay
    const decayRate = this.config.morphogenDecayRate ?? 0.3;
    const decayedConcentration = signal.concentration * (1 - decayRate);

    // Store with decayed concentration
    const received: MorphogenSignal = {
      ...signal,
      concentration: decayedConcentration,
      ttl: signal.ttl - 1,
    };

    this.receivedSignals.set(signal.emitterId, received);

    // Update concentration map
    this.updateConcentrationMap();
  }

  /**
   * Get the total morphogen concentration for a task type.
   * High concentration means many nearby specialists for this type.
   */
  getConcentration(taskType: TaskType): number {
    return this.concentrationMap.get(taskType) ?? 0;
  }

  /**
   * Get all task types with concentration above a threshold.
   */
  getStrongSignals(minConcentration: number = 0.5): Array<{ taskType: TaskType; concentration: number }> {
    const results: Array<{ taskType: TaskType; concentration: number }> = [];

    for (const [taskType, concentration] of this.concentrationMap) {
      if (concentration >= minConcentration) {
        results.push({ taskType, concentration });
      }
    }

    return results.sort((a, b) => b.concentration - a.concentration);
  }

  /**
   * Get all received signals (for CLI display).
   */
  getReceivedSignals(): MorphogenSignal[] {
    return [...this.receivedSignals.values()];
  }

  /**
   * Forward a signal (relay) with decremented TTL.
   * Used by CirculatoryRelay nodes to propagate signals.
   */
  forwardSignal(signal: MorphogenSignal): MorphogenSignal | null {
    if (signal.ttl <= 1) return null; // Don't forward dying signals

    const decayRate = this.config.morphogenDecayRate ?? 0.3;
    const forwarded: MorphogenSignal = {
      ...signal,
      concentration: signal.concentration * (1 - decayRate),
      ttl: signal.ttl - 1,
    };

    if (this.emitFn) {
      this.emitFn(forwarded);
    }

    return forwarded;
  }

  /**
   * Clean up expired signals (older than 2x signal interval).
   */
  cleanup(): number {
    const maxAge = (this.config.signalIntervalMs ?? 10000) * 2;
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const [id, signal] of this.receivedSignals) {
      if (signal.emittedAt < cutoff) {
        this.receivedSignals.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.updateConcentrationMap();
    }
    return removed;
  }

  // ── Internals ──

  private updateConcentrationMap(): void {
    this.concentrationMap.clear();

    for (const signal of this.receivedSignals.values()) {
      const current = this.concentrationMap.get(signal.taskType) ?? 0;
      this.concentrationMap.set(signal.taskType, current + signal.concentration);
    }
  }
}
