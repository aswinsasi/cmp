/**
 * CMP v2.0 — Layer 12 Test Suite: Computation Spacetime
 *
 * Tests:
 *   1. Causal Merkle DAG — append, branch, verify, prune, archaeology
 *   2. Temporal Forker — fork, record, race, judge, merge, abandon
 *   3. Spacetime Layer — orchestration, fork-race-merge lifecycle
 *
 * Run: npx ts-node --transpile-only packages/core/tests/v2.0-layer12.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { CausalMerkleDAG } from '../src/spacetime/causal-dag';
import { TemporalForker } from '../src/spacetime/temporal-forker';
import { SpacetimeLayer } from '../src/spacetime';
import {
  FitnessMetric,
  BranchState,
  RaceState,
  SpacetimeMessageType,
} from '../src/types/spacetime';

after(() => setTimeout(() => process.exit(0), 200));

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════
// Causal Merkle DAG Tests
// ═══════════════════════════════════════

describe('Causal DAG — Append & Query', () => {
  it('should append nodes and track head', () => {
    const dag = new CausalMerkleDAG();
    const node = dag.append('trunk', 'cause-1', 'state-1', 'result-1', 10, 0.5);

    assert.ok(node.hash, 'Should have content hash');
    assert.equal(node.branchId, 'trunk');
    assert.equal(node.sequence, 0);
    assert.equal(node.parentHash, '');
    assert.equal(dag.size, 1);

    const head = dag.getHead('trunk');
    assert.ok(head);
    assert.equal(head!.hash, node.hash);
  });

  it('should chain nodes with parent hashes', () => {
    const dag = new CausalMerkleDAG();
    const n1 = dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    const n2 = dag.append('trunk', 'c2', 's2', 'r2', 8, 0.2);
    const n3 = dag.append('trunk', 'c3', 's3', 'r3', 3, 0.1);

    assert.equal(n2.parentHash, n1.hash);
    assert.equal(n3.parentHash, n2.hash);
    assert.equal(n3.sequence, 2);
    assert.equal(dag.size, 3);
  });

  it('should get branch history in chronological order', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c1', 's1', 'r1', 1, 0.1);
    dag.append('trunk', 'c2', 's2', 'r2', 2, 0.1);
    dag.append('trunk', 'c3', 's3', 'r3', 3, 0.1);

    const history = dag.getBranchHistory('trunk');
    assert.equal(history.length, 3);
    assert.equal(history[0].causeId, 'c1');
    assert.equal(history[1].causeId, 'c2');
    assert.equal(history[2].causeId, 'c3');
  });

  it('should get recent nodes (most recent first)', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c1', 's1', 'r1', 1, 0.1);
    dag.append('trunk', 'c2', 's2', 'r2', 2, 0.1);
    dag.append('trunk', 'c3', 's3', 'r3', 3, 0.1);

    const recent = dag.getRecentNodes('trunk', 2);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].causeId, 'c3'); // Most recent first
    assert.equal(recent[1].causeId, 'c2');
  });

  it('should get node by hash', () => {
    const dag = new CausalMerkleDAG();
    const node = dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);

    const retrieved = dag.getNode(node.hash);
    assert.ok(retrieved);
    assert.equal(retrieved!.causeId, 'c1');
  });

  it('should return null for unknown hash', () => {
    const dag = new CausalMerkleDAG();
    assert.equal(dag.getNode('nonexistent'), null);
  });
});

describe('Causal DAG — Branching', () => {
  it('should create a branch from a node', () => {
    const dag = new CausalMerkleDAG();
    const n1 = dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    dag.append('trunk', 'c2', 's2', 'r2', 5, 0.1);

    const created = dag.createBranch('experiment', n1.hash);
    assert.equal(created, true);

    // Branch head should be at fork point
    const head = dag.getHead('experiment');
    assert.ok(head);
    assert.equal(head!.hash, n1.hash);
  });

  it('should allow independent appends on different branches', () => {
    const dag = new CausalMerkleDAG();
    const fork = dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    dag.createBranch('alt', fork.hash);

    // Append to trunk
    dag.append('trunk', 'c-trunk', 'st', 'rt', 5, 0.1);

    // Append to alt
    dag.append('alt', 'c-alt', 'sa', 'ra', 5, 0.1);

    assert.equal(dag.size, 3); // fork + trunk append + alt append
    assert.equal(dag.getBranchIds().length, 2);

    const trunkHead = dag.getHead('trunk')!;
    const altHead = dag.getHead('alt')!;
    assert.equal(trunkHead.causeId, 'c-trunk');
    assert.equal(altHead.causeId, 'c-alt');
  });

  it('should reject duplicate branch names', () => {
    const dag = new CausalMerkleDAG();
    const node = dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    dag.createBranch('alt', node.hash);
    assert.equal(dag.createBranch('alt', node.hash), false);
  });

  it('should remove a branch', () => {
    const dag = new CausalMerkleDAG();
    const fork = dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    dag.createBranch('alt', fork.hash);
    dag.append('alt', 'c-alt', 'sa', 'ra', 5, 0.1);

    const removed = dag.removeBranch('alt');
    assert.equal(removed, 1); // Only alt-exclusive node removed
    assert.equal(dag.getBranchIds().includes('alt'), false);
  });
});

describe('Causal DAG — Verification', () => {
  it('should verify a valid node', () => {
    const dag = new CausalMerkleDAG();
    const node = dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    assert.equal(dag.verifyNode(node), true);
  });

  it('should detect a tampered node', () => {
    const dag = new CausalMerkleDAG();
    const node = dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);

    // Tamper
    const tampered = { ...node, causeId: 'TAMPERED' };
    assert.equal(dag.verifyNode(tampered), false);
  });

  it('should verify an entire branch', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    dag.append('trunk', 'c2', 's2', 'r2', 5, 0.1);
    dag.append('trunk', 'c3', 's3', 'r3', 5, 0.1);

    const result = dag.verifyBranch('trunk');
    assert.equal(result.valid, true);
  });
});

describe('Causal DAG — Snapshots & Archaeology', () => {
  it('should store state snapshots at configured intervals', () => {
    const dag = new CausalMerkleDAG({ snapshotEveryN: 3 });

    // Nodes 0, 3, 6 should have snapshots (every 3rd)
    for (let i = 0; i < 7; i++) {
      dag.append('trunk', `c${i}`, `s${i}`, `r${i}`, 1, 0.01, { state: i });
    }

    const history = dag.getBranchHistory('trunk');
    assert.ok(history[0].stateSnapshot, 'Node 0 should have snapshot');
    assert.equal(history[1].stateSnapshot, undefined, 'Node 1 should NOT have snapshot');
    assert.equal(history[2].stateSnapshot, undefined, 'Node 2 should NOT');
    assert.ok(history[3].stateSnapshot, 'Node 3 should have snapshot');
    assert.ok(history[6].stateSnapshot, 'Node 6 should have snapshot');
  });

  it('should find nearest snapshot for archaeology', () => {
    const dag = new CausalMerkleDAG({ snapshotEveryN: 5 });

    for (let i = 0; i < 12; i++) {
      dag.append('trunk', `c${i}`, `s${i}`, `r${i}`, 1, 0.01, { val: i });
    }

    // Looking for state at sequence 7 → nearest snapshot is at 5
    const snapshot = dag.findNearestSnapshot('trunk', 7);
    assert.ok(snapshot, 'Should find a snapshot');
    assert.equal(snapshot!.sequence, 5);
    assert.equal(snapshot!.stateSnapshot.val, 5);
  });
});

describe('Causal DAG — Info', () => {
  it('should report comprehensive DAG info', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c1', 's1', 'r1', 10, 0.5);
    dag.append('trunk', 'c2', 's2', 'r2', 20, 1.0);

    const info = dag.getInfo();
    assert.equal(info.totalNodes, 2);
    assert.equal(info.branchCount, 1);
    assert.equal(info.totalComputeMs, 30);
    assert.equal(info.totalCcu, 1.5);
    assert.ok(info.genesisHash);
  });
});

// ═══════════════════════════════════════
// Temporal Forker Tests
// ═══════════════════════════════════════

describe('Temporal Forker — Fork', () => {
  it('should fork a new branch from trunk', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag);

    const branch = forker.fork('experiment-1');
    assert.ok(branch);
    assert.equal(branch!.label, 'experiment-1');
    assert.equal(branch!.parentBranchId, 'trunk');
    assert.equal(branch!.state, BranchState.ACTIVE);
  });

  it('should enforce max branches', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag, { maxBranches: 2 });

    // trunk is already 1, fork creates 2 → at limit
    forker.fork('b1');
    const third = forker.fork('b2');
    assert.equal(third, null, 'Should reject third branch (trunk + b1 = 2 active)');

    forker.stop();
  });

  it('should store fork snapshot', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag);

    const branch = forker.fork('with-snapshot', 'trunk', { key: 'value' });
    assert.ok(branch!.forkSnapshot);
    assert.equal(branch!.forkSnapshot.key, 'value');

    forker.stop();
  });

  it('should emit branch_created event', () => {
    const events: any[] = [];
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c1', 's1', 'r1', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag);
    forker.onEvent((e) => events.push(e));

    forker.fork('test');
    assert.ok(events.some(e => e.kind === 'branch_created'));

    forker.stop();
  });
});

describe('Temporal Forker — Record Execution', () => {
  it('should update branch fitness on execution', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c0', 's0', 'r0', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag);
    const branch = forker.fork('test')!;

    forker.recordExecution(branch.id, 'c1', 'sh1', 'rh1', 10, 0.5, 3);
    forker.recordExecution(branch.id, 'c2', 'sh2', 'rh2', 20, 1.0, 5);

    const updated = forker.getBranch(branch.id)!;
    assert.equal(updated.fitness!.causesProcessed, 2);
    assert.equal(updated.fitness!.totalExecutionMs, 30);
    assert.equal(updated.fitness!.totalCcu, 1.5);
    assert.equal(updated.fitness!.totalMutations, 8);
    assert.equal(updated.length, 2);

    forker.stop();
  });
});

describe('Temporal Forker — Race', () => {
  it('should start a race between branches', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c0', 's0', 'r0', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag, { defaultRaceDurationMs: 5000 });

    const b1 = forker.fork('fast')!;
    const b2 = forker.fork('slow')!;

    const race = forker.startRace([b1.id, b2.id], FitnessMetric.SPEED);
    assert.ok(race);
    assert.equal(race!.state, RaceState.RUNNING);
    assert.equal(race!.branchIds.length, 2);

    // Branches should be in RACING state
    assert.equal(forker.getBranch(b1.id)!.state, BranchState.RACING);
    assert.equal(forker.getBranch(b2.id)!.state, BranchState.RACING);

    forker.stop();
  });

  it('should judge a race and pick fastest branch', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c0', 's0', 'r0', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag, {
      defaultRaceDurationMs: 60000, // Long timeout so we judge manually
      defaultMinCausesPerBranch: 1,
    });

    const b1 = forker.fork('fast')!;
    const b2 = forker.fork('slow')!;

    forker.startRace([b1.id, b2.id], FitnessMetric.SPEED);
    const raceId = forker.getActiveRaces()[0].id;

    // Simulate: b1 is fast (5ms avg), b2 is slow (50ms avg)
    forker.recordExecution(b1.id, 'c1', 'sh', 'rh', 5, 0.1, 1);
    forker.recordExecution(b1.id, 'c2', 'sh', 'rh', 5, 0.1, 1);
    forker.recordExecution(b2.id, 'c1', 'sh', 'rh', 50, 0.1, 1);
    forker.recordExecution(b2.id, 'c2', 'sh', 'rh', 50, 0.1, 1);

    const result = forker.judgeRace(raceId);
    assert.ok(result);
    assert.equal(result!.winnerId, b1.id, 'Fast branch should win');

    // Winner should be ACTIVE, loser ABANDONED
    assert.equal(forker.getBranch(b1.id)!.state, BranchState.ACTIVE);
    assert.equal(forker.getBranch(b2.id)!.state, BranchState.ABANDONED);

    forker.stop();
  });

  it('should judge by CCU efficiency', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c0', 's0', 'r0', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag, {
      defaultRaceDurationMs: 60000,
      defaultMinCausesPerBranch: 1,
    });

    const b1 = forker.fork('cheap')!;
    const b2 = forker.fork('expensive')!;

    forker.startRace([b1.id, b2.id], FitnessMetric.CCU_EFFICIENCY);
    const raceId = forker.getActiveRaces()[0].id;

    // b1 is cheap (0.01 CCU/cause), b2 is expensive (1.0 CCU/cause)
    forker.recordExecution(b1.id, 'c1', 'sh', 'rh', 10, 0.01, 1);
    forker.recordExecution(b2.id, 'c1', 'sh', 'rh', 10, 1.0, 1);

    const result = forker.judgeRace(raceId);
    assert.equal(result!.winnerId, b1.id, 'Cheap branch should win');

    forker.stop();
  });

  it('should judge by productivity', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c0', 's0', 'r0', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag, {
      defaultRaceDurationMs: 60000,
      defaultMinCausesPerBranch: 1,
    });

    const b1 = forker.fork('productive')!;
    const b2 = forker.fork('lazy')!;

    forker.startRace([b1.id, b2.id], FitnessMetric.PRODUCTIVITY);
    const raceId = forker.getActiveRaces()[0].id;

    forker.recordExecution(b1.id, 'c1', 'sh', 'rh', 10, 0.5, 20); // 20 mutations
    forker.recordExecution(b2.id, 'c1', 'sh', 'rh', 10, 0.5, 2);  // 2 mutations

    const result = forker.judgeRace(raceId);
    assert.equal(result!.winnerId, b1.id, 'Productive branch should win');

    forker.stop();
  });

  it('should auto-judge after timeout', async () => {
    const events: any[] = [];
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c0', 's0', 'r0', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag, {
      defaultRaceDurationMs: 300,
      defaultMinCausesPerBranch: 0,
    });
    forker.onEvent((e) => events.push(e));

    const b1 = forker.fork('a')!;
    const b2 = forker.fork('b')!;

    forker.recordExecution(b1.id, 'c1', 'sh', 'rh', 5, 0.1, 1);
    forker.recordExecution(b2.id, 'c1', 'sh', 'rh', 50, 1.0, 1);

    forker.startRace([b1.id, b2.id], FitnessMetric.SPEED, 300);

    await sleep(500);

    assert.ok(events.some(e => e.kind === 'race_decided'), 'Should auto-judge');

    forker.stop();
  });

  it('should cancel a race', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c0', 's0', 'r0', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag);

    const b1 = forker.fork('a')!;
    const b2 = forker.fork('b')!;
    forker.startRace([b1.id, b2.id]);
    const raceId = forker.getActiveRaces()[0].id;

    const cancelled = forker.cancelRace(raceId);
    assert.equal(cancelled, true);
    assert.equal(forker.getRace(raceId)!.state, RaceState.CANCELLED);

    // Branches should return to ACTIVE
    assert.equal(forker.getBranch(b1.id)!.state, BranchState.ACTIVE);

    forker.stop();
  });
});

describe('Temporal Forker — Merge & Abandon', () => {
  it('should merge a branch and return snapshot', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c0', 's0', 'r0', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag);

    const branch = forker.fork('to-merge', 'trunk', { merged: true })!;
    forker.recordExecution(branch.id, 'c1', 'sh', 'rh', 10, 0.5, 3);

    const result = forker.merge(branch.id);
    assert.ok(result);
    assert.equal(result!.fitness.causesProcessed, 1);

    assert.equal(forker.getBranch(branch.id)!.state, BranchState.MERGED);

    forker.stop();
  });

  it('should not merge trunk', () => {
    const dag = new CausalMerkleDAG();
    const forker = new TemporalForker('lf-1', dag);

    assert.equal(forker.merge('trunk'), null);
    forker.stop();
  });

  it('should abandon a branch', () => {
    const dag = new CausalMerkleDAG();
    dag.append('trunk', 'c0', 's0', 'r0', 5, 0.1);
    const forker = new TemporalForker('lf-1', dag);

    const branch = forker.fork('doomed')!;
    assert.equal(forker.abandon(branch.id), true);
    assert.equal(forker.getBranch(branch.id)!.state, BranchState.ABANDONED);

    forker.stop();
  });
});

// ═══════════════════════════════════════
// Spacetime Layer Tests
// ═══════════════════════════════════════

describe('Spacetime Layer — Orchestration', () => {
  it('should create with DAG and forker', () => {
    const layer = new SpacetimeLayer('lf-1');
    assert.ok(layer.dag);
    assert.ok(layer.forker);
    layer.stop();
  });

  it('should record executions on trunk', () => {
    const layer = new SpacetimeLayer('lf-1');
    const node = layer.recordExecution('trunk', 'c1', 'sh', 'rh', 10, 0.5, 2);

    assert.ok(node.hash);
    assert.equal(layer.dag.size, 1);

    layer.stop();
  });

  it('should fork, record, and get status', () => {
    const layer = new SpacetimeLayer('lf-1');
    layer.recordExecution('trunk', 'c0', 'sh', 'rh', 5, 0.1, 1);

    const branchId = layer.fork('experiment');
    assert.ok(branchId);

    layer.recordExecution(branchId!, 'c1', 'sh1', 'rh1', 10, 0.5, 3);

    const status = layer.getStatus();
    assert.ok(status.dagNodes >= 2);
    assert.ok(status.activeBranches.length >= 2);

    layer.stop();
  });
});

describe('Spacetime Layer — Full Fork-Race-Merge Lifecycle', () => {
  it('should fork, race, judge, and merge winner', async () => {
    const events: any[] = [];
    const layer = new SpacetimeLayer('lf-1', {
      defaultRaceDurationMs: 60000,
      defaultMinCausesPerBranch: 1,
    });
    layer.onEvent((e) => events.push(e));

    // Seed trunk
    layer.recordExecution('trunk', 'c0', 'sh0', 'rh0', 5, 0.1, 1, { base: true });

    // Fork two branches
    const branchA = layer.fork('strategy-A', { strategy: 'A' })!;
    const branchB = layer.fork('strategy-B', { strategy: 'B' })!;
    assert.ok(branchA);
    assert.ok(branchB);

    // Race them
    const raceId = layer.startRace([branchA, branchB], FitnessMetric.SPEED)!;
    assert.ok(raceId);

    // Simulate: A is fast, B is slow
    layer.recordExecution(branchA, 'cA1', 'shA', 'rhA', 3, 0.1, 2);
    layer.recordExecution(branchA, 'cA2', 'shA2', 'rhA2', 4, 0.1, 1);
    layer.recordExecution(branchB, 'cB1', 'shB', 'rhB', 30, 0.5, 1);
    layer.recordExecution(branchB, 'cB2', 'shB2', 'rhB2', 40, 0.8, 1);

    // Judge
    const race = layer.forker.getActiveRaces()[0];
    const result = layer.forker.judgeRace(race.id);
    assert.ok(result);
    assert.equal(result!.winnerId, branchA, 'Fast branch A should win');

    // Merge winner back to trunk
    const mergeResult = layer.merge(branchA);
    assert.ok(mergeResult);
    assert.equal(mergeResult!.fitness.causesProcessed, 2);

    // Verify events
    assert.ok(events.some(e => e.kind === 'branch_created'));
    assert.ok(events.some(e => e.kind === 'race_started'));
    assert.ok(events.some(e => e.kind === 'race_decided'));
    assert.ok(events.some(e => e.kind === 'branch_merged'));

    layer.stop();
  });
});

describe('Spacetime Layer — Archaeology', () => {
  it('should retrieve historical state from snapshots', () => {
    const layer = new SpacetimeLayer('lf-1', { snapshotEveryN: 3 });

    for (let i = 0; i < 10; i++) {
      layer.recordExecution('trunk', `c${i}`, `sh${i}`, `rh${i}`, 1, 0.01, 1, { step: i });
    }

    // Get state at step 5 → nearest snapshot at 6 (sequence 6 % 3 == 0)
    const state = layer.getHistoricalState('trunk', 7);
    assert.ok(state, 'Should find a historical snapshot');
    assert.ok(typeof state.step === 'number');
  });

  it('should get timeline for a branch', () => {
    const layer = new SpacetimeLayer('lf-1');
    for (let i = 0; i < 5; i++) {
      layer.recordExecution('trunk', `c${i}`, `sh${i}`, `rh${i}`, 1, 0.01, 1);
    }

    const timeline = layer.getTimeline('trunk');
    assert.equal(timeline.length, 5);

    const limited = layer.getTimeline('trunk', 2);
    assert.equal(limited.length, 2);

    layer.stop();
  });

  it('should verify history integrity', () => {
    const layer = new SpacetimeLayer('lf-1');
    for (let i = 0; i < 5; i++) {
      layer.recordExecution('trunk', `c${i}`, `sh${i}`, `rh${i}`, 1, 0.01, 1);
    }

    const result = layer.verifyHistory('trunk');
    assert.equal(result.valid, true);

    layer.stop();
  });
});

describe('Spacetime Layer — Message Handling', () => {
  it('should broadcast fork and merge messages', () => {
    const sent: any[] = [];
    const layer = new SpacetimeLayer('lf-1');
    layer.setTransport((msgType, payload) => sent.push({ msgType, payload }));

    layer.recordExecution('trunk', 'c0', 'sh', 'rh', 5, 0.1, 1);
    const branchId = layer.fork('test');
    layer.merge(branchId!);

    assert.ok(sent.some(s => s.msgType === SpacetimeMessageType.TIMELINE_FORK));
    assert.ok(sent.some(s => s.msgType === SpacetimeMessageType.TIMELINE_MERGE));

    layer.stop();
  });

  it('should broadcast state sync on each execution', () => {
    const sent: any[] = [];
    const layer = new SpacetimeLayer('lf-1');
    layer.setTransport((msgType, payload) => sent.push({ msgType, payload }));

    layer.recordExecution('trunk', 'c1', 'sh', 'rh', 5, 0.1, 1);

    const syncs = sent.filter(s => s.msgType === SpacetimeMessageType.BRANCH_STATE_SYNC);
    assert.ok(syncs.length >= 1, 'Should broadcast state sync');

    layer.stop();
  });
});

console.log('\n═════════════════════════════════════════════════');
console.log(' CMP v2.0 — Layer 12: Computation Spacetime');
console.log(' Fork reality. Race parallel universes. Merge.');
console.log('═════════════════════════════════════════════════\n');
