/**
 * CMP v3.0 — Mesh Dreaming Tests
 *
 * Tests idle-time self-optimization: dream lifecycle, phase execution,
 * wake interruption, fossil discovery, and reporting.
 *
 * Run: npx tsx packages/core/tests/dreaming.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

// Force exit after tests — dream timers keep the event loop alive
after(() => setTimeout(() => process.exit(0), 500));

import { DreamManager, NOOP_SUBSYSTEMS } from '../src/dreaming/manager';
import type { DreamSubsystems } from '../src/dreaming/manager';
import { DreamPhase, DreamState } from '../src/types/dreaming';
import type { ComputationFossil } from '../src/types/dreaming';

// ─── Mock Subsystems ───

function makeMockSubsystems(overrides?: Partial<DreamSubsystems>): DreamSubsystems {
  return {
    async defragment() {
      return { lifeformsMoved: 2, tombstonesRemoved: 15, synapsesMerged: 3 };
    },
    async speculate() {
      return { predictionsGenerated: 5, cachedResults: 3 };
    },
    async evolve() {
      return { mutationsEvaluated: 4, improvementsFound: 1 };
    },
    async optimize() {
      return { connectionsPruned: 8, organsAdjusted: 1 };
    },
    async discover(): Promise<ComputationFossil[]> {
      return [{
        id: 'fossil-1',
        patternType: 'periodic',
        description: 'Tasks arrive every 300s with 95% regularity',
        confidence: 0.92,
        discoveredAt: Date.now(),
        evidence: { interval: 300000, samples: 48 },
      }];
    },
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════

describe('DreamManager', () => {

  describe('State Lifecycle', () => {
    it('should start in AWAKE state', () => {
      const dm = new DreamManager();
      assert.equal(dm.getState(), DreamState.AWAKE);
      assert.ok(!dm.isDreaming);
    });

    it('should transition to DREAMING and back to AWAKE', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        enabledPhases: [DreamPhase.DEFRAGMENT],
        phaseTimeMs: 100,
        maxDreamDurationMs: 1000,
        idleThresholdMs: 100000,
      });

      assert.equal(dm.getState(), DreamState.AWAKE);

      const report = await dm.startDreaming();

      assert.equal(dm.getState(), DreamState.AWAKE);
      assert.ok(report.durationMs >= 0);
      assert.ok(!report.interrupted);
    });

    it('should not double-dream', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        enabledPhases: [DreamPhase.DEFRAGMENT],
        phaseTimeMs: 50,
      });

      // Start dreaming
      const p1 = dm.startDreaming();

      // Try to start again while still dreaming
      const p2 = dm.startDreaming();
      const [r1, r2] = await Promise.all([p1, p2]);

      // Second one should be an empty interrupted report
      assert.ok(r2.interrupted || r2.phasesCompleted.length === 0);
    });
  });

  describe('Phase Execution', () => {
    it('should run all 5 dream phases', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        phaseTimeMs: 200,
        maxDreamDurationMs: 10000,
        idleThresholdMs: 100000,
      });

      const report = await dm.startDreaming();

      assert.equal(report.phasesCompleted.length, 5);
      assert.ok(report.phasesCompleted.includes(DreamPhase.DEFRAGMENT));
      assert.ok(report.phasesCompleted.includes(DreamPhase.SPECULATE));
      assert.ok(report.phasesCompleted.includes(DreamPhase.EVOLVE));
      assert.ok(report.phasesCompleted.includes(DreamPhase.OPTIMIZE));
      assert.ok(report.phasesCompleted.includes(DreamPhase.DISCOVER));
    });

    it('should run only enabled phases', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        enabledPhases: [DreamPhase.DEFRAGMENT, DreamPhase.OPTIMIZE],
        phaseTimeMs: 100,
        maxDreamDurationMs: 5000,
      });

      const report = await dm.startDreaming();

      assert.equal(report.phasesCompleted.length, 2);
      assert.ok(report.phasesCompleted.includes(DreamPhase.DEFRAGMENT));
      assert.ok(report.phasesCompleted.includes(DreamPhase.OPTIMIZE));
      assert.ok(!report.phasesCompleted.includes(DreamPhase.SPECULATE));
    });

    it('should record phase results with metrics', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        enabledPhases: [DreamPhase.DEFRAGMENT],
        phaseTimeMs: 100,
      });

      const report = await dm.startDreaming();

      const defragResult = report.phaseResults.get(DreamPhase.DEFRAGMENT);
      assert.ok(defragResult);
      assert.equal(defragResult!.phase, DreamPhase.DEFRAGMENT);
      assert.equal(defragResult!.metrics.lifeformsMoved, 2);
      assert.equal(defragResult!.metrics.tombstonesRemoved, 15);
      assert.ok(defragResult!.summary.includes('2'));
      assert.ok(defragResult!.durationMs >= 0);
    });

    it('should handle phase failure gracefully', async () => {
      const dm = new DreamManager({
        ...makeMockSubsystems(),
        async defragment() { throw new Error('Disk full'); },
      }, {
        enabledPhases: [DreamPhase.DEFRAGMENT, DreamPhase.OPTIMIZE],
        phaseTimeMs: 100,
      });

      const report = await dm.startDreaming();

      // Defragment failed but optimize should still run
      const defragResult = report.phaseResults.get(DreamPhase.DEFRAGMENT);
      assert.ok(defragResult!.summary.includes('Failed'));

      assert.ok(report.phasesCompleted.includes(DreamPhase.OPTIMIZE));
    });
  });

  describe('Wake Interruption', () => {
    it('should interrupt dream when wake() is called', async () => {
      const dm = new DreamManager({
        ...makeMockSubsystems(),
        // Make defragment slow so we can interrupt it
        async defragment() {
          await delay(500);
          return { lifeformsMoved: 0, tombstonesRemoved: 0, synapsesMerged: 0 };
        },
      }, {
        enabledPhases: [DreamPhase.DEFRAGMENT, DreamPhase.SPECULATE, DreamPhase.EVOLVE],
        phaseTimeMs: 2000,
        maxDreamDurationMs: 10000,
      });

      // Start dreaming in background
      const dreamPromise = dm.startDreaming();

      // Wait a bit then wake
      await delay(100);
      dm.wake();

      const report = await dreamPromise;

      // Should be interrupted — not all phases completed
      assert.ok(report.interrupted);
      assert.ok(report.phasesCompleted.length < 3);
    });

    it('should interrupt via recordActivity()', async () => {
      const dm = new DreamManager({
        ...makeMockSubsystems(),
        async defragment() {
          await delay(300);
          return { lifeformsMoved: 0, tombstonesRemoved: 0, synapsesMerged: 0 };
        },
      }, {
        enabledPhases: [DreamPhase.DEFRAGMENT, DreamPhase.SPECULATE],
        phaseTimeMs: 2000,
      });

      const dreamPromise = dm.startDreaming();

      await delay(50);
      dm.recordActivity(); // This should wake the dreamer

      const report = await dreamPromise;
      assert.ok(report.interrupted);
    });
  });

  describe('Computation Fossils', () => {
    it('should collect fossils from discover phase', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        enabledPhases: [DreamPhase.DISCOVER],
        phaseTimeMs: 100,
      });

      assert.equal(dm.getFossils().length, 0);

      await dm.startDreaming();

      const fossils = dm.getFossils();
      assert.equal(fossils.length, 1);
      assert.equal(fossils[0].patternType, 'periodic');
      assert.ok(fossils[0].confidence > 0.9);
    });

    it('should accumulate fossils across multiple dreams', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        enabledPhases: [DreamPhase.DISCOVER],
        phaseTimeMs: 50,
      });

      await dm.startDreaming();
      await dm.startDreaming();
      await dm.startDreaming();

      assert.equal(dm.getFossils().length, 3);
    });
  });

  describe('Idle Monitoring', () => {
    it('should auto-dream after idle threshold', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        idleThresholdMs: 100,
        enabledPhases: [DreamPhase.DEFRAGMENT],
        phaseTimeMs: 50,
        maxDreamDurationMs: 200,
      });

      dm.startMonitoring();

      // Wait for idle threshold + dream to complete
      await delay(400);

      // Should have dreamed at least once
      const stats = dm.getStats();
      assert.ok(stats.totalDreams >= 1, `Should have dreamed: ${stats.totalDreams}`);

      dm.stopMonitoring();
    });

    it('should reset idle timer on activity', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        idleThresholdMs: 200,
        enabledPhases: [DreamPhase.DEFRAGMENT],
        phaseTimeMs: 50,
      });

      dm.startMonitoring();

      // Keep resetting before threshold
      await delay(100);
      dm.recordActivity();
      await delay(100);
      dm.recordActivity();
      await delay(100);

      const stats = dm.getStats();
      assert.equal(stats.totalDreams, 0, 'Should not have dreamed yet');

      dm.stopMonitoring();
    });

    it('should track idle time', () => {
      const dm = new DreamManager();
      dm.recordActivity();

      const idleMs = dm.getIdleTimeMs();
      assert.ok(idleMs >= 0 && idleMs < 100);
    });
  });

  describe('Reports', () => {
    it('should store dream reports', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        enabledPhases: [DreamPhase.DEFRAGMENT],
        phaseTimeMs: 50,
      });

      await dm.startDreaming();
      await dm.startDreaming();

      const reports = dm.getReports();
      assert.equal(reports.length, 2);

      const last = dm.getLastReport();
      assert.ok(last !== null);
      assert.ok(last!.durationMs >= 0);
    });

    it('should return null when no reports', () => {
      const dm = new DreamManager();
      assert.equal(dm.getLastReport(), null);
    });
  });

  describe('Stats', () => {
    it('should report accurate stats', async () => {
      const dm = new DreamManager(makeMockSubsystems(), {
        enabledPhases: [DreamPhase.DEFRAGMENT, DreamPhase.DISCOVER],
        phaseTimeMs: 50,
      });

      await dm.startDreaming();

      const stats = dm.getStats();
      assert.equal(stats.state, DreamState.AWAKE);
      assert.equal(stats.totalDreams, 1);
      assert.equal(stats.totalPhases, 2);
      assert.ok(stats.totalDreamTimeMs >= 0);
      assert.equal(stats.fossils, 1);
    });
  });

  describe('NOOP Subsystems', () => {
    it('should work with no-op subsystems', async () => {
      const dm = new DreamManager(NOOP_SUBSYSTEMS, {
        enabledPhases: [DreamPhase.DEFRAGMENT, DreamPhase.SPECULATE],
        phaseTimeMs: 50,
      });

      const report = await dm.startDreaming();
      assert.equal(report.phasesCompleted.length, 2);
      assert.ok(!report.interrupted);
    });
  });
});
