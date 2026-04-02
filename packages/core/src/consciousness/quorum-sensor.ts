/**
 * CMP v2.0 — Quorum Sensor
 *
 * Bacterial quorum sensing for distributed systems.
 * When N% of nodes independently observe the same signal, the mesh
 * collectively shifts behavior — without consensus, voting, or leaders.
 *
 * Each node broadcasts its observations. The QuorumSensor on each node
 * independently tracks observations and fires when the threshold is met.
 * Because all nodes see the same observations (via gossip), they all
 * reach the same conclusion simultaneously — emergent agreement.
 *
 * This is NOT consensus. No node proposes, no node votes, no node leads.
 * Each node independently computes whether "enough of us see the same
 * thing" and acts accordingly. The coordination is an emergent property.
 *
 * @module consciousness/quorum-sensor
 * @author Agent Viscro
 */

import {
  QuorumObservation,
  QuorumState,
  QuorumRule,
  QuorumAction,
  QuorumSignalWire,
  ConsciousnessConfig,
  DEFAULT_CONSCIOUSNESS_CONFIG,
} from '../types/consciousness';

// ─── Quorum Sensor ───

export interface QuorumEvent {
  kind: 'observation_added' | 'threshold_reached' | 'threshold_lost';
  signalType: string;
  state: QuorumState;
  rule?: QuorumRule;
}

export class QuorumSensor {
  /** Signal type → list of observations */
  private observations = new Map<string, QuorumObservation[]>();
  /** Registered rules */
  private rules = new Map<string, QuorumRule>();
  /** Signal type → last trigger timestamp (for cooldown) */
  private lastTriggered = new Map<string, number>();
  /** Signal type → whether currently in quorum */
  private inQuorum = new Set<string>();

  private config: ConsciousnessConfig;
  private deviceId: string;
  private meshSize: number = 1;

  /** Callback when quorum threshold is reached */
  private listeners = new Set<(event: QuorumEvent) => void>();

  /** Callback to broadcast our observations to mesh */
  private onBroadcastObservation: ((wire: QuorumSignalWire) => void) | null = null;

  /** Stats */
  private stats = {
    observationsRecorded: 0,
    quorumsReached: 0,
    quorumsLost: 0,
  };

  constructor(deviceId: string, config?: Partial<ConsciousnessConfig>) {
    this.deviceId = deviceId;
    this.config = { ...DEFAULT_CONSCIOUSNESS_CONFIG, ...config };
  }

  /** Update the known mesh size (affects quorum percentage calculations) */
  setMeshSize(size: number): void {
    this.meshSize = Math.max(1, size);
  }

  /** Set broadcast callback */
  onBroadcast(fn: (wire: QuorumSignalWire) => void): void {
    this.onBroadcastObservation = fn;
  }

  /** Subscribe to quorum events */
  onEvent(listener: (event: QuorumEvent) => void): void {
    this.listeners.add(listener);
  }

  // ── Rules ──

  /**
   * Register a quorum rule.
   * When enough observations match this signal type, the action fires.
   */
  addRule(rule: QuorumRule): void {
    this.rules.set(rule.signalType, rule);
  }

  /** Remove a rule */
  removeRule(signalType: string): void {
    this.rules.delete(signalType);
  }

  /** Get all rules */
  getRules(): QuorumRule[] {
    return [...this.rules.values()];
  }

  // ── Observation ──

  /**
   * Record a local observation. This node observed something.
   * Automatically broadcasts to the mesh.
   */
  observe(signalType: string, strength: number = 1.0, evidence?: string): void {
    const observation: QuorumObservation = {
      signalType,
      observerId: this.deviceId,
      observedAt: Date.now(),
      strength: Math.min(1.0, Math.max(0.0, strength)),
      evidence,
    };

    this.addObservation(observation);

    // Broadcast to mesh
    if (this.onBroadcastObservation) {
      this.onBroadcastObservation({
        signalType,
        observerId: this.deviceId,
        strength: observation.strength,
        evidence,
        observedAt: observation.observedAt,
      });
    }
  }

  /**
   * Receive an observation from a peer.
   */
  receiveObservation(wire: QuorumSignalWire): void {
    // Don't re-add our own observations
    if (wire.observerId === this.deviceId) return;

    const observation: QuorumObservation = {
      signalType: wire.signalType,
      observerId: wire.observerId,
      observedAt: wire.observedAt,
      strength: wire.strength,
      evidence: wire.evidence,
    };

    this.addObservation(observation);
  }

  // ── Query ──

  /**
   * Get the quorum state for a signal type.
   */
  getState(signalType: string): QuorumState {
    const rule = this.rules.get(signalType);
    const windowMs = rule?.windowMs || this.config.defaultQuorumWindowMs;
    const minStrength = rule?.minStrength || 0;
    const now = Date.now();

    const allObs = this.observations.get(signalType) || [];
    // Filter to window and minimum strength
    const validObs = allObs.filter(o =>
      (now - o.observedAt) <= windowMs && o.strength >= minStrength
    );

    // Count unique observers
    const uniqueObservers = new Set(validObs.map(o => o.observerId));
    const observerCount = uniqueObservers.size;
    const quorumPercent = this.meshSize > 0 ? observerCount / this.meshSize : 0;
    const threshold = rule?.threshold || this.config.defaultQuorumThreshold;
    const thresholdReached = quorumPercent >= threshold;

    return {
      signalType,
      observerCount,
      meshSize: this.meshSize,
      quorumPercent,
      thresholdReached,
      reachedAt: thresholdReached ? (validObs.length > 0 ? validObs[validObs.length - 1].observedAt : undefined) : undefined,
      observations: validObs,
    };
  }

  /**
   * Get all active quorum states.
   */
  getAllStates(): QuorumState[] {
    const states: QuorumState[] = [];
    const signalTypes = new Set([
      ...this.observations.keys(),
      ...this.rules.keys(),
    ]);

    for (const signalType of signalTypes) {
      states.push(this.getState(signalType));
    }

    return states;
  }

  /**
   * Check if quorum is currently reached for a signal.
   */
  isInQuorum(signalType: string): boolean {
    return this.inQuorum.has(signalType);
  }

  /** Get stats */
  getStats() {
    return {
      ...this.stats,
      activeSignals: this.observations.size,
      rulesRegistered: this.rules.size,
      activeQuorums: this.inQuorum.size,
    };
  }

  /** Clear all observations */
  clear(): void {
    this.observations.clear();
    this.inQuorum.clear();
    this.lastTriggered.clear();
  }

  // ── Internal ──

  private addObservation(observation: QuorumObservation): void {
    const { signalType } = observation;

    if (!this.observations.has(signalType)) {
      this.observations.set(signalType, []);
    }

    const list = this.observations.get(signalType)!;

    // Deduplicate: one observation per observer per window
    const existing = list.findIndex(o => o.observerId === observation.observerId);
    if (existing >= 0) {
      // Update if newer
      if (observation.observedAt > list[existing].observedAt) {
        list[existing] = observation;
      }
    } else {
      list.push(observation);
    }

    this.stats.observationsRecorded++;
    this.emit({ kind: 'observation_added', signalType, state: this.getState(signalType) });

    // Check quorum
    this.evaluateQuorum(signalType);
  }

  private evaluateQuorum(signalType: string): void {
    const state = this.getState(signalType);
    const rule = this.rules.get(signalType);
    const wasInQuorum = this.inQuorum.has(signalType);

    if (state.thresholdReached && !wasInQuorum) {
      // Check cooldown
      const lastTrigger = this.lastTriggered.get(signalType) || 0;
      const cooldown = rule?.cooldownMs || this.config.defaultQuorumCooldownMs;
      if (Date.now() - lastTrigger < cooldown) return;

      // Quorum reached!
      this.inQuorum.add(signalType);
      this.lastTriggered.set(signalType, Date.now());
      this.stats.quorumsReached++;

      this.emit({
        kind: 'threshold_reached',
        signalType,
        state,
        rule,
      });
    } else if (!state.thresholdReached && wasInQuorum) {
      // Quorum lost
      this.inQuorum.delete(signalType);
      this.stats.quorumsLost++;

      this.emit({ kind: 'threshold_lost', signalType, state });
    }
  }

  private emit(event: QuorumEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch {}
    }
  }
}
