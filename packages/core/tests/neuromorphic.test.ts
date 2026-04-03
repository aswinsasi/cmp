/**
 * CMP v3.0 — Neuromorphic Routing Tests
 *
 * Tests spiking neural network router: routing, learning (LTP/LTD),
 * STDP, decay, exploration vs exploitation, topology analysis.
 *
 * Run: npx tsx packages/core/tests/neuromorphic.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NeuromorphicRouter } from '../src/neuromorphic/router';

// ─── Helpers ───

function buildLinearMesh(router: NeuromorphicRouter, nodes: string[]): void {
  for (const n of nodes) router.addNode(n);
  for (let i = 0; i < nodes.length - 1; i++) {
    router.ensureConnection(nodes[i], nodes[i + 1]);
  }
}

function buildFullMesh(router: NeuromorphicRouter, nodes: string[]): void {
  for (const n of nodes) router.addNode(n);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i !== j) router.ensureConnection(nodes[i], nodes[j]);
    }
  }
}

// ═══════════════════════════════════════

describe('NeuromorphicRouter', () => {

  describe('Network Management', () => {
    it('should add and track nodes', () => {
      const router = new NeuromorphicRouter();
      router.addNode('A');
      router.addNode('B');
      assert.equal(router.nodeCount, 2);
    });

    it('should create connections with initial weight', () => {
      const router = new NeuromorphicRouter();
      router.ensureConnection('A', 'B');
      assert.equal(router.getWeight('A', 'B'), 0.5); // default initial
      assert.equal(router.getWeight('B', 'A'), 0); // directional
      assert.equal(router.nodeCount, 2);
    });

    it('should remove node and all connections', () => {
      const router = new NeuromorphicRouter();
      router.ensureConnection('A', 'B');
      router.ensureConnection('B', 'C');
      router.ensureConnection('A', 'C');

      router.removeNode('B');
      assert.equal(router.nodeCount, 2);
      assert.equal(router.getWeight('A', 'B'), 0);
      assert.equal(router.getWeight('B', 'C'), 0);
      assert.ok(router.getWeight('A', 'C') > 0); // A→C still exists
    });

    it('should list outgoing connections above threshold', () => {
      const router = new NeuromorphicRouter({ activationThreshold: 0.1 });
      router.ensureConnection('A', 'B'); // 0.5
      router.ensureConnection('A', 'C'); // 0.5

      const outgoing = router.getOutgoing('A');
      assert.equal(outgoing.length, 2);
    });
  });

  describe('Routing (Spike Propagation)', () => {
    it('should route through a linear mesh', () => {
      const router = new NeuromorphicRouter({ explorationRate: 0 });
      buildLinearMesh(router, ['A', 'B', 'C', 'D']);

      const result = router.route('A', 'compute', 'task-1');
      assert.ok(result.path.length >= 2, 'Should traverse at least 2 nodes');
      assert.equal(result.path[0], 'A');
      assert.ok(result.totalWeight > 0);
      assert.ok(result.routingMs >= 0);
    });

    it('should reach target when filter matches', () => {
      const router = new NeuromorphicRouter({ explorationRate: 0 });
      buildLinearMesh(router, ['A', 'B', 'C', 'D']);

      const result = router.route('A', 'compute', 'task-1', (nodeId) => nodeId === 'C');
      assert.ok(result.path.includes('C'), 'Path should include target C');
      assert.equal(result.path[result.path.length - 1], 'C');
    });

    it('should avoid revisiting nodes (no loops)', () => {
      const router = new NeuromorphicRouter({ explorationRate: 0 });
      // Create a cycle: A→B→C→A
      router.ensureConnection('A', 'B');
      router.ensureConnection('B', 'C');
      router.ensureConnection('C', 'A');

      const result = router.route('A', 'compute', 'task-1');
      const unique = new Set(result.path);
      assert.equal(unique.size, result.path.length, 'No duplicate nodes in path');
    });

    it('should stop when spike energy depletes', () => {
      const router = new NeuromorphicRouter({
        explorationRate: 0,
        spikeDecayPerHop: 0.4, // Dies after ~2 hops
        maxHops: 10,
      });
      buildLinearMesh(router, ['A', 'B', 'C', 'D', 'E']);

      const result = router.route('A', 'compute', 'task-1');
      assert.ok(result.path.length <= 4, `Path too long: ${result.path.length}`);
    });

    it('should handle dead-end nodes', () => {
      const router = new NeuromorphicRouter({ explorationRate: 0 });
      router.ensureConnection('A', 'B');
      // B has no outgoing connections

      const result = router.route('A', 'compute', 'task-1');
      assert.deepEqual(result.path, ['A', 'B']);
    });

    it('should route in a full mesh', () => {
      const router = new NeuromorphicRouter({ explorationRate: 0 });
      buildFullMesh(router, ['A', 'B', 'C', 'D']);

      const result = router.route('A', 'compute', 'task-1');
      assert.ok(result.path.length >= 2);
    });
  });

  describe('Learning — Long-Term Potentiation (LTP)', () => {
    it('should increase weights on reinforced path', () => {
      const router = new NeuromorphicRouter();
      router.ensureConnection('A', 'B');
      router.ensureConnection('B', 'C');

      const before = router.getWeight('A', 'B');
      router.reinforce(['A', 'B', 'C'], 'compute');
      const after = router.getWeight('A', 'B');

      assert.ok(after > before, `Weight should increase: ${before} → ${after}`);
    });

    it('should cap weights at 1.0', () => {
      const router = new NeuromorphicRouter({ learningRate: 0.5 });
      router.ensureConnection('A', 'B');

      // Reinforce many times
      for (let i = 0; i < 50; i++) {
        router.reinforce(['A', 'B'], 'compute');
      }

      assert.ok(router.getWeight('A', 'B') <= 1.0);
    });

    it('should increment success count', () => {
      const router = new NeuromorphicRouter();
      const conn = router.ensureConnection('A', 'B');
      assert.equal(conn.successCount, 0);

      router.reinforce(['A', 'B'], 'compute');
      assert.equal(conn.successCount, 1);

      router.reinforce(['A', 'B'], 'compute');
      assert.equal(conn.successCount, 2);
    });
  });

  describe('Learning — Long-Term Depression (LTD)', () => {
    it('should decrease weights on weakened path', () => {
      const router = new NeuromorphicRouter();
      router.ensureConnection('A', 'B');

      const before = router.getWeight('A', 'B');
      router.weaken(['A', 'B'], 'compute');
      const after = router.getWeight('A', 'B');

      assert.ok(after < before, `Weight should decrease: ${before} → ${after}`);
    });

    it('should floor weights at 0', () => {
      const router = new NeuromorphicRouter({ learningRate: 0.5 });
      router.ensureConnection('A', 'B');

      for (let i = 0; i < 50; i++) {
        router.weaken(['A', 'B'], 'compute');
      }

      assert.ok(router.getWeight('A', 'B') >= 0);
    });

    it('should punish failures harder than rewarding success', () => {
      const router = new NeuromorphicRouter({ learningRate: 0.1 });
      const conn1 = router.ensureConnection('A', 'B');
      const conn2 = router.ensureConnection('C', 'D');

      const initial = conn1.weight;
      router.reinforce(['A', 'B'], 'compute');
      const gain = conn1.weight - initial;

      const initial2 = conn2.weight;
      router.weaken(['C', 'D'], 'compute');
      const loss = initial2 - conn2.weight;

      assert.ok(loss > gain, `Loss (${loss}) should exceed gain (${gain})`);
    });
  });

  describe('STDP (Spike-Timing Dependent Plasticity)', () => {
    it('should strengthen causal connections (pre before post)', () => {
      const router = new NeuromorphicRouter({ stdpWindowMs: 100 });
      router.ensureConnection('A', 'B');
      const before = router.getWeight('A', 'B');

      // A fires at t=0, B fires at t=20 (causal, within window)
      router.applySTDP(0, 20, 'A', 'B');
      const after = router.getWeight('A', 'B');

      assert.ok(after > before, `Causal STDP should strengthen: ${before} → ${after}`);
    });

    it('should weaken anti-causal connections (post before pre)', () => {
      const router = new NeuromorphicRouter({ stdpWindowMs: 100 });
      router.ensureConnection('A', 'B');
      const before = router.getWeight('A', 'B');

      // A fires at t=50, B fires at t=20 (anti-causal)
      router.applySTDP(50, 20, 'A', 'B');
      const after = router.getWeight('A', 'B');

      assert.ok(after < before, `Anti-causal STDP should weaken: ${before} → ${after}`);
    });

    it('should have stronger effect for shorter time gaps', () => {
      const router = new NeuromorphicRouter({ stdpWindowMs: 100, learningRate: 0.2 });

      router.ensureConnection('A', 'B');
      const w1Before = router.getWeight('A', 'B');
      router.applySTDP(0, 10, 'A', 'B'); // 10ms gap (close)
      const shortGapDelta = router.getWeight('A', 'B') - w1Before;

      router.ensureConnection('C', 'D');
      const w2Before = router.getWeight('C', 'D');
      router.applySTDP(0, 90, 'C', 'D'); // 90ms gap (far)
      const longGapDelta = router.getWeight('C', 'D') - w2Before;

      assert.ok(shortGapDelta > longGapDelta,
        `Short gap delta (${shortGapDelta}) should exceed long gap (${longGapDelta})`);
    });

    it('should ignore events outside STDP window', () => {
      const router = new NeuromorphicRouter({ stdpWindowMs: 100 });
      router.ensureConnection('A', 'B');
      const before = router.getWeight('A', 'B');

      router.applySTDP(0, 200, 'A', 'B'); // 200ms > 100ms window
      const after = router.getWeight('A', 'B');

      assert.equal(after, before, 'Should not change outside window');
    });
  });

  describe('Decay (Synaptic Pruning)', () => {
    it('should reduce all weights by decay rate', () => {
      const router = new NeuromorphicRouter({ decayRate: 0.05, activationThreshold: 0 });
      router.ensureConnection('A', 'B'); // 0.5

      router.decay();
      assert.ok(Math.abs(router.getWeight('A', 'B') - 0.45) < 0.001);
    });

    it('should prune connections below threshold', () => {
      const router = new NeuromorphicRouter({ decayRate: 0.1, activationThreshold: 0.1 });
      router.ensureConnection('A', 'B'); // starts at 0.5

      // Decay 5 times: 0.5 → 0.4 → 0.3 → 0.2 → 0.1 → 0.0
      for (let i = 0; i < 5; i++) router.decay();

      assert.equal(router.connectionCount, 0, 'Connection should be pruned');
    });

    it('should return count of pruned connections', () => {
      const router = new NeuromorphicRouter({ decayRate: 0.6, activationThreshold: 0.1 });
      router.ensureConnection('A', 'B');
      router.ensureConnection('A', 'C');

      const pruned = router.decay();
      assert.equal(pruned, 2);
    });
  });

  describe('Exploration vs Exploitation', () => {
    it('should explore with high exploration rate', () => {
      const router = new NeuromorphicRouter({ explorationRate: 1.0 });
      buildFullMesh(router, ['A', 'B', 'C', 'D']);

      const result = router.route('A', 'compute', 'task-1');
      assert.ok(result.explored, 'Should explore when rate is 1.0');
    });

    it('should exploit with zero exploration rate', () => {
      const router = new NeuromorphicRouter({ explorationRate: 0 });
      router.ensureConnection('A', 'B');
      router.ensureConnection('A', 'C');

      // Strengthen A→B
      for (let i = 0; i < 10; i++) router.reinforce(['A', 'B'], 'compute');

      const result = router.route('A', 'compute', 'task-1');
      assert.ok(!result.explored);
    });

    it('should prefer task-type-affine connections', () => {
      const router = new NeuromorphicRouter({ explorationRate: 0 });
      router.ensureConnection('A', 'B');
      router.ensureConnection('A', 'C');

      // Both have same weight, but B has been used for 'compute' before
      router.reinforce(['A', 'B'], 'compute');
      // Set weights so affinity bonus (0.2) is the deciding factor
      const connAB = router.ensureConnection('A', 'B');
      const connAC = router.ensureConnection('A', 'C');
      connAB.weight = 0.3;
      connAC.weight = 0.3;
      // A→B has taskType 'compute' in its set → effective 0.5
      // A→C does not → effective 0.3
      // B selection probability: 0.5/0.8 = 62.5%

      // Route many times — B should be chosen more often due to affinity
      let bCount = 0;
      for (let i = 0; i < 200; i++) {
        const result = router.route('A', 'compute', `task-${i}`);
        if (result.path.includes('B')) bCount++;
      }

      assert.ok(bCount > 100, `B should be preferred due to task affinity: ${bCount}/200`);
    });
  });

  describe('Topology Snapshot', () => {
    it('should return network topology', () => {
      const router = new NeuromorphicRouter();
      buildLinearMesh(router, ['A', 'B', 'C']);
      router.reinforce(['A', 'B', 'C'], 'compute');

      const topo = router.getTopology();
      assert.equal(topo.nodes.length, 3);
      assert.equal(topo.totalConnections, 2); // A→B, B→C
      assert.ok(topo.avgWeight > 0);
    });

    it('should find dominant paths per task type', () => {
      const router = new NeuromorphicRouter();
      buildLinearMesh(router, ['A', 'B', 'C']);

      // Reinforce for 'compute' type
      router.reinforce(['A', 'B', 'C'], 'compute');

      const topo = router.getTopology();
      assert.ok(topo.dominantPaths.has('compute'));
      const path = topo.dominantPaths.get('compute')!;
      assert.ok(path.length >= 2);
    });
  });

  describe('Learning Log', () => {
    it('should record learning events', () => {
      const router = new NeuromorphicRouter();
      router.ensureConnection('A', 'B');

      router.reinforce(['A', 'B'], 'compute');
      router.weaken(['A', 'B'], 'compute');

      const log = router.getLearningLog();
      assert.equal(log.length, 2);
      assert.equal(log[0].type, 'ltp');
      assert.equal(log[1].type, 'ltd');
    });
  });

  describe('Stats', () => {
    it('should track routing stats', () => {
      const router = new NeuromorphicRouter({ explorationRate: 0 });
      buildLinearMesh(router, ['A', 'B', 'C']);

      router.route('A', 'compute', 'task-1');
      router.route('A', 'compute', 'task-2');

      const stats = router.getStats();
      assert.equal(stats.totalRoutes, 2);
    });
  });

  describe('Integrated scenario', () => {
    it('should learn optimal path over repeated tasks', () => {
      const router = new NeuromorphicRouter({ explorationRate: 0, learningRate: 0.15 });

      // Create a mesh: A → B → D (fast) and A → C → D (slow)
      router.ensureConnection('A', 'B');
      router.ensureConnection('A', 'C');
      router.ensureConnection('B', 'D');
      router.ensureConnection('C', 'D');

      // Simulate: path through B succeeds, path through C fails
      for (let i = 0; i < 20; i++) {
        router.reinforce(['A', 'B', 'D'], 'compute');
        router.weaken(['A', 'C', 'D'], 'compute');
      }

      // Now route — should strongly prefer A→B→D
      const result = router.route('A', 'compute', 'final-task', (n) => n === 'D');
      assert.ok(result.path.includes('B'), `Should prefer B path: ${result.path}`);
      assert.ok(!result.path.includes('C'), `Should avoid C path: ${result.path}`);

      // Verify weights diverged
      const wAB = router.getWeight('A', 'B');
      const wAC = router.getWeight('A', 'C');
      assert.ok(wAB > wAC, `A→B (${wAB}) should be stronger than A→C (${wAC})`);
    });
  });
});
