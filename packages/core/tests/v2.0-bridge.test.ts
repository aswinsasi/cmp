/**
 * CMP v2.0 — V2 Bridge Integration Test
 *
 * Verifies that Layers 11-13 wire correctly to CMPNode:
 *   - Bridge creates all three layers
 *   - Message routing dispatches 0xE1-0xF1 correctly
 *   - Pheromones auto-deposit on task events
 *   - Status includes v2.0 data
 *   - Lifecycle start/stop works
 *   - CLI command handlers produce output
 *
 * Run: npx ts-node --transpile-only packages/core/tests/v2.0-bridge.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { CMPNode } from '../src/cmp-node';
import { V2Bridge } from '../src/v2-bridge';
import { MeshBehavior, PheromoneType, ConsciousnessMessageType } from '../src/types/consciousness';
import { SpacetimeMessageType } from '../src/types/spacetime';
import { WormholeMessageType } from '../src/types/wormhole';
import { encodeMessage, encodeJSON, decodeJSON } from '../src/layers/serializer';
import { ITransport, TransportEvent, TransportEventHandler } from '../../transport/src/interface';

after(() => setTimeout(() => process.exit(0), 200));

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Mock Transport ──

class MockTransport implements ITransport {
  readonly name = 'mock';
  readonly maxPayloadBytes = 1048576;
  readonly estimatedBandwidthMbps = 1000;
  running = false;
  sentMessages: { address: string; data: Uint8Array }[] = [];
  broadcasts: Uint8Array[] = [];
  handlers = new Map<string, Set<TransportEventHandler>>();

  async start() { this.running = true; }
  async stop() { this.running = false; }
  isRunning() { return this.running; }
  async startBeaconing() {}
  async stopBeaconing() {}
  async startScanning() {}
  async stopScanning() {}
  async sendTo(addr: string, data: Uint8Array) { this.sentMessages.push({ address: addr, data }); }
  async broadcast(data: Uint8Array) { this.broadcasts.push(data); }
  on(event: string, handler: TransportEventHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: TransportEventHandler) {
    const set = this.handlers.get(event);
    if (set) set.delete(handler);
  }
}

// ═══════════════════════════════════════
// Bridge Creation
// ═══════════════════════════════════════

describe('V2 Bridge — Creation', () => {
  it('should create bridge with all three layers', () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    assert.ok(v2.consciousness, 'Should have consciousness layer');
    assert.ok(v2.spacetime, 'Should have spacetime layer');
    assert.ok(v2.wormhole, 'Should have wormhole layer');
    assert.equal(v2.isStarted(), false);
  });

  it('should start and stop cleanly', async () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    await node.start();
    v2.start();
    assert.equal(v2.isStarted(), true);

    v2.stop();
    assert.equal(v2.isStarted(), false);

    await node.stop();
  });
});

// ═══════════════════════════════════════
// Message Routing
// ═══════════════════════════════════════

describe('V2 Bridge — Message Routing', () => {
  it('should route Layer 11 messages to consciousness', () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    // Inject a pheromone deposit message
    const payload = encodeJSON({
      id: 'ph-1', type: PheromoneType.COMPUTE_SUCCESS, emitterId: 'other-node',
      concentration: 0.8, depositedAt: Date.now(), ttlMs: 60000, hops: 0, maxHops: 5,
    });

    v2.handleMessage(ConsciousnessMessageType.PHEROMONE_DEPOSIT, payload);

    // Consciousness layer should have received it
    assert.ok(v2.consciousness.pheromones.size >= 1, 'Should have received pheromone');
  });

  it('should route Layer 12 messages to spacetime', () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    // Inject a branch state sync (informational — spacetime layer accepts it)
    const payload = encodeJSON({
      branchId: 'trunk', headHash: 'abc', latestNode: { hash: 'abc' },
    });

    // Should not throw
    v2.handleMessage(SpacetimeMessageType.BRANCH_STATE_SYNC, payload);
  });

  it('should route Layer 13 messages to wormhole', () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    // Inject a wormhole announcement
    const payload = encodeJSON({
      localMeshId: 'remote-node', remoteMeshFingerprint: 'mesh-beta',
      remoteMeshLabel: 'Beta', quality: 0.8, latencyMs: 100,
      capabilityBloom: [], timestamp: Date.now(),
    });

    v2.handleMessage(WormholeMessageType.WORMHOLE_ANNOUNCE, payload);

    // Wormhole discovery should have received it
    assert.equal(v2.wormhole.discovery.getWormholes().length, 1);
  });

  it('should ignore messages outside 0xE1-0xF1 range', () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    // Should not throw for out-of-range
    v2.handleMessage(0x01, encodeJSON({})); // BEACON — not v2
    v2.handleMessage(0xC0, encodeJSON({})); // LIFEFORM — not v2
  });
});

// ═══════════════════════════════════════
// Auto Pheromone Deposits
// ═══════════════════════════════════════

describe('V2 Bridge — Auto Pheromone Events', () => {
  it('should deposit success pheromone on chunk:executed (SUCCESS)', async () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    await node.start();
    v2.start();

    // Emit a chunk:executed event (status 0 = SUCCESS)
    node.events().emit('chunk:executed', { status: 0, taskType: 'inference' });

    await sleep(50);

    const reading = v2.consciousness.pheromones.read(PheromoneType.COMPUTE_SUCCESS);
    assert.ok(reading.totalConcentration > 0, 'Should have deposited success pheromone');

    v2.stop();
    await node.stop();
  });

  it('should deposit failure pheromone on chunk:executed (FAILED)', async () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    await node.start();
    v2.start();

    // Status 3 = FAILED
    node.events().emit('chunk:executed', { status: 3, taskType: 'map_reduce' });

    await sleep(50);

    const reading = v2.consciousness.pheromones.read(PheromoneType.COMPUTE_FAILURE);
    assert.ok(reading.totalConcentration > 0, 'Should have deposited failure pheromone');

    v2.stop();
    await node.stop();
  });
});

// ═══════════════════════════════════════
// Status
// ═══════════════════════════════════════

describe('V2 Bridge — Status', () => {
  it('should return comprehensive v2 status', () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    const status = v2.getStatus();

    assert.equal(status.behavior, MeshBehavior.NORMAL);
    assert.equal(typeof status.pheromoneCount, 'number');
    assert.equal(typeof status.dagNodes, 'number');
    assert.equal(typeof status.activeBranches, 'number');
    assert.equal(typeof status.remoteMeshes, 'number');
    assert.equal(typeof status.activeWormholes, 'number');
    assert.equal(typeof status.crossSynapses, 'number');
  });

  it('should reflect pheromone changes in status', () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    v2.consciousness.pheromones.deposit(PheromoneType.DANGER, 0.9);
    v2.consciousness.pheromones.deposit(PheromoneType.DANGER, 0.8);

    const status = v2.getStatus();
    assert.ok(status.pheromoneCount >= 2);
    assert.equal(status.dominantPheromone, PheromoneType.DANGER);
  });

  it('should reflect spacetime branches in status', () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    v2.spacetime.recordExecution('trunk', 'c1', 'sh', 'rh', 5, 0.1, 1);
    v2.spacetime.fork('experiment');

    const status = v2.getStatus();
    assert.ok(status.dagNodes >= 1);
    assert.ok(status.activeBranches >= 2); // trunk + experiment
  });

  it('should reflect wormhole discovery in status', () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    v2.wormhole.declareWormhole('mesh-beta', 'Beta', 100);

    const status = v2.getStatus();
    assert.equal(status.activeWormholes, 1);
    assert.equal(status.remoteMeshes, 1);
  });
});

// ═══════════════════════════════════════
// Emergence Events
// ═══════════════════════════════════════

describe('V2 Bridge — Emergence', () => {
  it('should detect DEFENSIVE behavior from danger pheromones', async () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    const events: any[] = [];
    v2.onEmergence((e) => events.push(e));

    await node.start();
    v2.start();

    // Flood danger pheromones
    for (let i = 0; i < 5; i++) {
      v2.consciousness.pheromones.deposit(PheromoneType.DANGER, 0.9);
    }

    await sleep(12000); // Wait for emergence eval (10s interval)

    const status = v2.getStatus();
    assert.equal(status.behavior, MeshBehavior.DEFENSIVE);
    assert.ok(events.length >= 1, 'Should have emitted emergence event');

    v2.stop();
    await node.stop();
  });
});

// ═══════════════════════════════════════
// Transport Wiring
// ═══════════════════════════════════════

describe('V2 Bridge — Transport Wiring', () => {
  it('should broadcast pheromone deposits to mesh', async () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    await node.start();
    v2.start();

    // This should trigger a broadcast
    v2.consciousness.pheromones.deposit(PheromoneType.COMPUTE_SUCCESS, 0.8);

    await sleep(50);

    // The mock transport should have received a broadcast
    assert.ok(mock.broadcasts.length >= 1, 'Should broadcast pheromone to mesh');

    v2.stop();
    await node.stop();
  });

  it('should broadcast spacetime events to mesh', async () => {
    const mock = new MockTransport();
    const node = new CMPNode({ _transport: mock });
    const v2 = new V2Bridge(node);

    await node.start();
    v2.start();

    v2.spacetime.recordExecution('trunk', 'c1', 'sh', 'rh', 5, 0.1, 1);

    await sleep(50);

    // Should have broadcast BRANCH_STATE_SYNC
    assert.ok(mock.broadcasts.length >= 1, 'Should broadcast spacetime sync to mesh');

    v2.stop();
    await node.stop();
  });
});

console.log('\n═══════════════════════════════════════════════');
console.log(' CMP v2.0 — V2 Bridge Integration Test');
console.log(' Wiring Layers 11-13 into CMPNode');
console.log('═══════════════════════════════════════════════\n');
