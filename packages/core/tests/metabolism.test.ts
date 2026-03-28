/**
 * CMP v1.3 — Computation Metabolism Test Suite
 * Tests: MetabolicProfileManager (state machine transitions),
 * MetabolicNegotiator (bid scoring, exclusion), MeshBreathing
 * (mesh-wide aggregation, capacity forecast), and integration.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/metabolism.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { MetabolicProfileManager } from '../src/metabolism/metabolic-profile';
import { MetabolicNegotiator } from '../src/metabolism/metabolic-negotiator';
import { MeshBreathing } from '../src/metabolism/mesh-breathing';
import {
  MetabolicState,
  MetabolicProfile,
} from '../src/types/metabolism';
import { PowerSource, ThermalState } from '../src/types/capability';

// ── Helpers ──

function makeProfile(overrides?: Partial<MetabolicProfile>): MetabolicProfile {
  return {
    state: overrides?.state ?? MetabolicState.HOMEOSTATIC,
    energyBudget: overrides?.energyBudget ?? 0.7,
    energyDelta: overrides?.energyDelta ?? -0.1,
    timeToStateChange: overrides?.timeToStateChange ?? 3600000,
    thermalEfficiency: overrides?.thermalEfficiency ?? 1.0,
    powerSource: overrides?.powerSource ?? 'BATTERY',
    batteryPercent: overrides?.batteryPercent ?? 70,
    predictedIdleWindowMs: 0,
    energyCcuBudget: 30,
    recentTransitions: [],
  };
}

// ═══════════════════════════════════════
// MetabolicProfileManager Tests
// ═══════════════════════════════════════

describe('MetabolicProfileManager', () => {
  let manager: MetabolicProfileManager;

  beforeEach(() => {
    manager = new MetabolicProfileManager();
  });

  it('should start in HOMEOSTATIC state', () => {
    assert.equal(manager.getState(), MetabolicState.HOMEOSTATIC);
  });

  it('should transition to ANABOLIC when plugged with high battery', () => {
    manager.updateFromInput({
      powerSource: PowerSource.PLUGGED,
      batteryPercent: 90,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });
    assert.equal(manager.getState(), MetabolicState.ANABOLIC);
  });

  it('should transition to CHARGING when plugged with low battery', () => {
    manager.updateFromInput({
      powerSource: PowerSource.PLUGGED,
      batteryPercent: 40,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });
    assert.equal(manager.getState(), MetabolicState.CHARGING);
  });

  it('should transition to CATABOLIC when battery low', () => {
    manager.updateFromInput({
      powerSource: PowerSource.BATTERY,
      batteryPercent: 20,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });
    assert.equal(manager.getState(), MetabolicState.CATABOLIC);
  });

  it('should transition to DORMANT when battery critical', () => {
    manager.updateFromInput({
      powerSource: PowerSource.BATTERY,
      batteryPercent: 5,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });
    assert.equal(manager.getState(), MetabolicState.DORMANT);
  });

  it('should transition to CATABOLIC on thermal throttle regardless of battery', () => {
    manager.updateFromInput({
      powerSource: PowerSource.PLUGGED,
      batteryPercent: 100,
      thermalState: ThermalState.THROTTLED,
      cpuLoad: 0.9,
    });
    assert.equal(manager.getState(), MetabolicState.CATABOLIC);
  });

  it('should recover from throttle when thermal normalizes', () => {
    manager.updateFromInput({
      powerSource: PowerSource.PLUGGED,
      batteryPercent: 100,
      thermalState: ThermalState.THROTTLED,
      cpuLoad: 0.9,
    });
    assert.equal(manager.getState(), MetabolicState.CATABOLIC);

    manager.updateFromInput({
      powerSource: PowerSource.PLUGGED,
      batteryPercent: 100,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });
    assert.equal(manager.getState(), MetabolicState.ANABOLIC);
  });

  it('should track transitions', () => {
    manager.updateFromInput({
      powerSource: PowerSource.PLUGGED,
      batteryPercent: 90,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });
    // HOMEOSTATIC → ANABOLIC

    manager.updateFromInput({
      powerSource: PowerSource.BATTERY,
      batteryPercent: 20,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });
    // ANABOLIC → CATABOLIC

    const transitions = manager.getTransitions();
    assert.equal(transitions.length, 2);
    assert.equal(transitions[0].fromState, MetabolicState.HOMEOSTATIC);
    assert.equal(transitions[0].toState, MetabolicState.ANABOLIC);
    assert.equal(transitions[1].fromState, MetabolicState.ANABOLIC);
    assert.equal(transitions[1].toState, MetabolicState.CATABOLIC);
  });

  it('should calculate energy budget correctly', () => {
    manager.updateFromInput({
      powerSource: PowerSource.PLUGGED,
      batteryPercent: 90,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });

    const profile = manager.getProfile();
    assert.equal(profile.state, MetabolicState.ANABOLIC);
    assert.ok(profile.energyBudget > 0.9, `Budget ${profile.energyBudget} should be > 0.9`);
    assert.ok(profile.thermalEfficiency === 1.0);
    assert.ok(profile.energyDelta >= 0, 'Should be charging or stable');
  });

  it('should return low energy budget for DORMANT', () => {
    manager.updateFromInput({
      powerSource: PowerSource.BATTERY,
      batteryPercent: 5,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });

    const profile = manager.getProfile();
    assert.equal(profile.state, MetabolicState.DORMANT);
    assert.ok(profile.energyBudget <= 0.1, `Budget ${profile.energyBudget} should be <= 0.1`);
  });

  it('should handle solar power as ANABOLIC when battery high', () => {
    manager.updateFromInput({
      powerSource: PowerSource.SOLAR,
      batteryPercent: 85,
      thermalState: ThermalState.NOMINAL,
      cpuLoad: 0.1,
    });
    assert.equal(manager.getState(), MetabolicState.ANABOLIC);
  });
});

// ═══════════════════════════════════════
// MetabolicNegotiator Tests
// ═══════════════════════════════════════

describe('MetabolicNegotiator', () => {
  let negotiator: MetabolicNegotiator;

  beforeEach(() => {
    negotiator = new MetabolicNegotiator();
  });

  it('should give ANABOLIC the highest metabolic score', () => {
    const score = negotiator.calculateMetabolicScore(
      makeProfile({ state: MetabolicState.ANABOLIC, energyBudget: 1.0, thermalEfficiency: 1.0, energyDelta: 0.5 }),
      1, // NORMAL priority
    );
    assert.ok(score > 0.9, `ANABOLIC score ${score} should be > 0.9`);
  });

  it('should give HOMEOSTATIC a moderate metabolic score', () => {
    const score = negotiator.calculateMetabolicScore(
      makeProfile({ state: MetabolicState.HOMEOSTATIC, energyBudget: 0.7, thermalEfficiency: 1.0, energyDelta: -0.1 }),
      1,
    );
    assert.ok(score > 0.3 && score < 0.8, `HOMEOSTATIC score ${score} should be moderate`);
  });

  it('should exclude DORMANT devices (return -1)', () => {
    const score = negotiator.calculateMetabolicScore(
      makeProfile({ state: MetabolicState.DORMANT }),
      1,
    );
    assert.equal(score, -1);
  });

  it('should exclude CATABOLIC from LOW/NORMAL priority tasks', () => {
    const scoreLow = negotiator.calculateMetabolicScore(
      makeProfile({ state: MetabolicState.CATABOLIC, energyBudget: 0.3, thermalEfficiency: 0.7 }),
      0, // LOW
    );
    assert.equal(scoreLow, -1);

    const scoreNormal = negotiator.calculateMetabolicScore(
      makeProfile({ state: MetabolicState.CATABOLIC, energyBudget: 0.3, thermalEfficiency: 0.7 }),
      1, // NORMAL
    );
    assert.equal(scoreNormal, -1);
  });

  it('should allow CATABOLIC for HIGH/URGENT priority tasks', () => {
    const scoreHigh = negotiator.calculateMetabolicScore(
      makeProfile({ state: MetabolicState.CATABOLIC, energyBudget: 0.3, thermalEfficiency: 0.7 }),
      2, // HIGH
    );
    assert.ok(scoreHigh > 0, `CATABOLIC HIGH score ${scoreHigh} should be > 0`);

    const scoreUrgent = negotiator.calculateMetabolicScore(
      makeProfile({ state: MetabolicState.CATABOLIC, energyBudget: 0.3, thermalEfficiency: 0.7 }),
      3, // URGENT
    );
    assert.ok(scoreUrgent > 0, `CATABOLIC URGENT score ${scoreUrgent} should be > 0`);
  });

  it('should give bonus for positive energy delta', () => {
    const scoreCharging = negotiator.calculateMetabolicScore(
      makeProfile({ state: MetabolicState.HOMEOSTATIC, energyBudget: 0.7, thermalEfficiency: 1.0, energyDelta: 0.8 }),
      1,
    );
    const scoreDraining = negotiator.calculateMetabolicScore(
      makeProfile({ state: MetabolicState.HOMEOSTATIC, energyBudget: 0.7, thermalEfficiency: 1.0, energyDelta: -0.5 }),
      1,
    );
    assert.ok(scoreCharging > scoreDraining, `Charging ${scoreCharging} should score higher than draining ${scoreDraining}`);
  });

  it('should calculate full bid score', () => {
    const score = negotiator.scoreBid(
      { resourceMatch: 0.8, estimatedTime: 0.7, reputation: 0.9, powerStability: 0.8, taskPriority: 1 },
      makeProfile({ state: MetabolicState.ANABOLIC, energyBudget: 1.0, thermalEfficiency: 1.0, energyDelta: 0.3 }),
    );
    assert.ok(score > 0.5, `Full bid score ${score} should be substantial`);
    assert.ok(score <= 1.0, `Score should be <= 1.0`);
  });

  it('should return -1 for excluded device in full scoring', () => {
    const score = negotiator.scoreBid(
      { resourceMatch: 1.0, estimatedTime: 1.0, reputation: 1.0, powerStability: 1.0, taskPriority: 0 },
      makeProfile({ state: MetabolicState.DORMANT }),
    );
    assert.equal(score, -1);
  });

  it('should validate bid gate for metabolic state', () => {
    assert.equal(negotiator.shouldAllowBid(makeProfile({ state: MetabolicState.ANABOLIC }), 1), true);
    assert.equal(negotiator.shouldAllowBid(makeProfile({ state: MetabolicState.HOMEOSTATIC }), 1), true);
    assert.equal(negotiator.shouldAllowBid(makeProfile({ state: MetabolicState.DORMANT }), 1), false);
    assert.equal(negotiator.shouldAllowBid(makeProfile({ state: MetabolicState.CATABOLIC }), 0), false);
    assert.equal(negotiator.shouldAllowBid(makeProfile({ state: MetabolicState.CATABOLIC }), 2), true);
  });
});

// ═══════════════════════════════════════
// MeshBreathing Tests
// ═══════════════════════════════════════

describe('MeshBreathing', () => {
  let breathing: MeshBreathing;

  beforeEach(() => {
    breathing = new MeshBreathing();
  });

  it('should aggregate metabolic profiles from peers', () => {
    breathing.updateProfile('peer1', makeProfile({ state: MetabolicState.ANABOLIC, energyBudget: 1.0 }));
    breathing.updateProfile('peer2', makeProfile({ state: MetabolicState.HOMEOSTATIC, energyBudget: 0.7 }));
    breathing.updateProfile('peer3', makeProfile({ state: MetabolicState.CATABOLIC, energyBudget: 0.2 }));

    const summary = breathing.getSummary();
    assert.equal(summary.stateDistribution[MetabolicState.ANABOLIC], 1);
    assert.equal(summary.stateDistribution[MetabolicState.HOMEOSTATIC], 1);
    assert.equal(summary.stateDistribution[MetabolicState.CATABOLIC], 1);
    assert.ok(Math.abs(summary.totalEnergyBudget - 1.9) < 0.01);
  });

  it('should detect expansion phase when mesh is gaining energy', () => {
    breathing.updateProfile('peer1', makeProfile({ state: MetabolicState.ANABOLIC, energyDelta: 0.5 }));
    breathing.updateProfile('peer2', makeProfile({ state: MetabolicState.CHARGING, energyDelta: 0.4 }));

    const summary = breathing.getSummary();
    assert.equal(summary.meshPhase, 'expansion');
  });

  it('should detect contraction phase when mesh is losing energy', () => {
    breathing.updateProfile('peer1', makeProfile({ state: MetabolicState.CATABOLIC, energyDelta: -0.5 }));
    breathing.updateProfile('peer2', makeProfile({ state: MetabolicState.HOMEOSTATIC, energyDelta: -0.3 }));

    const summary = breathing.getSummary();
    assert.equal(summary.meshPhase, 'contraction');
  });

  it('should detect stable phase', () => {
    breathing.updateProfile('peer1', makeProfile({ energyDelta: 0.05 }));
    breathing.updateProfile('peer2', makeProfile({ energyDelta: -0.05 }));

    const summary = breathing.getSummary();
    assert.equal(summary.meshPhase, 'stable');
  });

  it('should generate 4-hour capacity forecast', () => {
    breathing.updateProfile('peer1', makeProfile({ energyBudget: 0.8, energyDelta: -0.1 }));
    breathing.updateProfile('peer2', makeProfile({ energyBudget: 0.6, energyDelta: -0.1 }));

    const summary = breathing.getSummary();
    assert.equal(summary.capacityForecast.length, 4);

    // Forecast should decrease over time (negative delta)
    assert.ok(summary.capacityForecast[0] <= summary.totalEnergyBudget);
  });

  it('should remove departed peers', () => {
    breathing.updateProfile('peer1', makeProfile());
    breathing.updateProfile('peer2', makeProfile());
    assert.equal(breathing.size, 2);

    breathing.removeProfile('peer1');
    assert.equal(breathing.size, 1);
  });

  it('should calculate mesh efficiency from thermal states', () => {
    breathing.updateProfile('peer1', makeProfile({ thermalEfficiency: 1.0 }));
    breathing.updateProfile('peer2', makeProfile({ thermalEfficiency: 0.5 }));

    const summary = breathing.getSummary();
    assert.ok(Math.abs(summary.meshEfficiency - 0.75) < 0.01, `Efficiency ${summary.meshEfficiency} should be ~0.75`);
  });
});
