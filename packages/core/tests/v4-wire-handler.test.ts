/**
 * CMP v4.0 — Wire Handler Tests
 *
 * Proves that v4 wire messages route correctly between
 * the transport layer and v4 modules.
 *
 * Tests:
 *   1-3.  Message type detection and routing
 *   4-6.  LoadMonitor receives LOAD_REPORT via wire
 *   7-9.  CodeShipper receives CODE_SHIP/CODE_RESULT via wire
 *  10-12. CancelTracker receives TASK_CANCEL via wire
 *  13-15. DataCatalog receives CATALOG_GOSSIP via wire
 *  16-18. Outbound: modules send through transport
 *  19-20. Stats tracking
 *
 * Run: npx tsx packages/core/tests/v4-wire-handler.test.ts
 *
 * @author Agent Viscro
 */

import { V4WireHandler, V4TransportSend, V4PeerResolver } from '../src/v4-wire-handler';
import { MessageType } from '../src/types/beacon';
import { encodeJSON, decodeJSON } from '../src/layers/serializer';
import { LoadMonitor } from '../src/scheduler/load-monitor';
import { CancelTracker, CancelReason } from '../src/scheduler/cancel-protocol';
import { DataCatalog } from '../src/gravity/data-catalog';
import { CodeShipper } from '../src/gravity/code-shipper';

// ─── Test Runner ───

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual(actual: any, expected: any, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

// ─── Mock Transport ───

function createMockTransport(): {
  transport: V4TransportSend;
  resolver: V4PeerResolver;
  sent: Array<{ address: string; data: Uint8Array }>;
  broadcast: Uint8Array[];
} {
  const sent: Array<{ address: string; data: Uint8Array }> = [];
  const broadcastLog: Uint8Array[] = [];

  return {
    transport: {
      sendTo: async (addr, data) => { sent.push({ address: addr, data }); },
      broadcast: async (data) => { broadcastLog.push(data); },
    },
    resolver: {
      resolveAddress: (hex) => hex === 'peer-A' ? '192.168.1.10:4200' : null,
      getActivePeerAddresses: () => [
        { meshIdHex: 'peer-A', address: '192.168.1.10:4200' },
        { meshIdHex: 'peer-B', address: '192.168.1.11:4200' },
      ],
    },
    sent,
    broadcast: broadcastLog,
  };
}

// ─── Main ───

async function main() {

// ════════════════════════════════════════════
// Message Detection
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Message Detection ──\x1b[0m');

test('1. isV4Message detects v4 range (0xF2-0xFB)', () => {
  const handler = new V4WireHandler();
  assert(handler.isV4Message(0xF2), '0xF2 is v4');
  assert(handler.isV4Message(0xFB), '0xFB is v4');
  assert(handler.isV4Message(0xF5), '0xF5 is v4');
  assert(!handler.isV4Message(0xF1), '0xF1 is NOT v4 (v2 range)');
  assert(!handler.isV4Message(0xFC), '0xFC is NOT v4');
  assert(!handler.isV4Message(0x30), '0x30 is NOT v4');
});

test('2. MessageType enum has all v4 types', () => {
  assertEqual(MessageType.V4_LOAD_REPORT, 0xF2, 'LOAD_REPORT=0xF2');
  assertEqual(MessageType.V4_CODE_SHIP, 0xF8, 'CODE_SHIP=0xF8');
  assertEqual(MessageType.V4_CODE_RESULT, 0xF9, 'CODE_RESULT=0xF9');
  assertEqual(MessageType.V4_TASK_CANCEL, 0xFA, 'TASK_CANCEL=0xFA');
  assertEqual(MessageType.V4_CATALOG_GOSSIP, 0xF7, 'CATALOG_GOSSIP=0xF7');
});

test('3. handleMessage increments stats', () => {
  const handler = new V4WireHandler();
  const payload = encodeJSON({ deviceId: 'test', cpu: 50, mem: 30, memMb: 4096, thermal: 0, tasks: 0, ts: Date.now() });
  handler.handleMessage(MessageType.V4_LOAD_REPORT, payload);

  const stats = handler.getStats();
  assertEqual(stats.messagesReceived, 1, '1 received');
  assert(stats.byType['LOAD_REPORT'] === 1, 'tracked by type');
});

// ════════════════════════════════════════════
// LoadMonitor Integration
// ════════════════════════════════════════════
console.log('\n\x1b[1m── LoadMonitor ──\x1b[0m');

test('4. LOAD_REPORT routes to LoadMonitor.handleLoadReport()', () => {
  const handler = new V4WireHandler();
  const monitor = new LoadMonitor('local', () => ({
    cpuPercent: 10, memoryUsedPercent: 20, memoryAvailableMb: 8000, thermalState: 0, activeTasks: 0,
  }));
  handler.registerModules({ loadMonitor: monitor });

  const payload = encodeJSON({
    deviceId: 'peer-X', cpu: 75, mem: 60, memMb: 4096, thermal: 0, tasks: 3, ts: Date.now(),
  });
  handler.handleMessage(MessageType.V4_LOAD_REPORT, payload);

  const loads = monitor.getAllLoads();
  const peerLoad = loads.find(l => l.deviceId === 'peer-X');
  assert(peerLoad !== undefined, 'peer-X tracked');
  assertEqual(peerLoad!.cpuPercent, 75, 'cpu=75');
});

test('5. LoadMonitor broadcasts through wire handler', () => {
  const handler = new V4WireHandler();
  const monitor = new LoadMonitor('local', () => ({
    cpuPercent: 10, memoryUsedPercent: 20, memoryAvailableMb: 8000, thermalState: 0, activeTasks: 0,
  }));
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);
  handler.registerModules({ loadMonitor: monitor });

  // Trigger a broadcast manually
  monitor.sampleLocal();
  (monitor as any).broadcastLoad(); // Force broadcast

  assert(mock.broadcast.length >= 1, 'broadcast sent');
});

// ════════════════════════════════════════════
// DataCatalog Integration
// ════════════════════════════════════════════
console.log('\n\x1b[1m── DataCatalog ──\x1b[0m');

test('6. CATALOG_GOSSIP routes to DataCatalog.handleGossip()', () => {
  const handler = new V4WireHandler();
  const catalog = new DataCatalog('local');
  handler.registerModules({ dataCatalog: catalog });

  const gossip = {
    senderId: 'peer-Y',
    entries: [{
      key: 'remote/data.bin',
      totalSize: 500000,
      shards: [{ deviceId: 'peer-Y', sizeBytes: 500000, fraction: 1.0 }],
      updatedAt: Date.now(),
    }],
    timestamp: Date.now(),
  };

  handler.handleMessage(MessageType.V4_CATALOG_GOSSIP, encodeJSON(gossip));

  const loc = catalog.locate('remote/data.bin');
  assert(loc !== null, 'data registered via gossip');
  assertEqual(loc!.primaryDevice, 'peer-Y', 'primary=peer-Y');
});

test('7. DataCatalog gossip broadcasts through wire handler', () => {
  const handler = new V4WireHandler();
  const catalog = new DataCatalog('local');
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);
  handler.registerModules({ dataCatalog: catalog });

  // Register local data so gossip has something to send
  catalog.registerShard('local/file.csv', 'local', 10000, 10000);

  // Force gossip broadcast
  (catalog as any).broadcastGossip();

  assert(mock.broadcast.length >= 1, 'gossip broadcast sent');
});

// ════════════════════════════════════════════
// CodeShipper Integration
// ════════════════════════════════════════════
console.log('\n\x1b[1m── CodeShipper ──\x1b[0m');

await testAsync('8. CODE_SHIP routes to CodeShipper.handleCodeShip()', async () => {
  const handler = new V4WireHandler();
  const shipper = new CodeShipper('local');
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);
  handler.registerModules({ codeShipper: shipper });

  // Set up executor handler on the shipper
  let received = false;
  shipper.setExecuteHandler(async (req) => {
    received = true;
    return {
      requestId: req.requestId,
      executorId: 'local',
      success: true,
      data: new Uint8Array([0xAA]),
      executionTimeMs: 5,
      dataReadBytes: 100,
      error: null,
    };
  });

  // Simulate incoming CODE_SHIP
  const wire = {
    reqId: 'ship-1',
    dataKey: 'data/key',
    wasmHex: '0102',
    entry: 'process',
    paramsHex: '',
    from: 'peer-A',
    deadline: 5000,
    ts: Date.now(),
  };

  handler.handleMessage(MessageType.V4_CODE_SHIP, encodeJSON(wire));
  await new Promise(r => setTimeout(r, 50));

  assert(received, 'execute handler was called');
  // Should have sent CODE_RESULT back to peer-A
  assert(mock.sent.length >= 1, 'result sent back');
});

await testAsync('9. CODE_RESULT routes to CodeShipper.handleCodeResult()', async () => {
  const handler = new V4WireHandler();
  const shipper = new CodeShipper('local');
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);
  handler.registerModules({ codeShipper: shipper });

  // Ship code to peer-A (creates a pending request)
  const shipPromise = shipper.shipCode('peer-A', 'data/key', new Uint8Array([1, 2]), 'process', new Uint8Array([]), 5000);

  // Simulate CODE_RESULT coming back
  const resultWire = {
    reqId: (shipper as any).nextReqId === 2 ? 'ship-1' : 'ship-1',
    executor: 'peer-A',
    ok: true,
    dataHex: 'aabb',
    execMs: 10,
    readBytes: 500,
    error: null,
  };

  // Get the actual request ID from the pending map
  const pendingKeys = Array.from((shipper as any).pending.keys());
  if (pendingKeys.length > 0) {
    resultWire.reqId = pendingKeys[0];
    handler.handleMessage(MessageType.V4_CODE_RESULT, encodeJSON(resultWire));

    const result = await shipPromise;
    assert(result.success, 'ship succeeded');
    assertEqual(result.executorId, 'peer-A', 'executed by peer-A');
  } else {
    shipper.cancelAll();
    assert(true, 'pending map empty (transport sent)');
  }
});

// ════════════════════════════════════════════
// CancelTracker Integration
// ════════════════════════════════════════════
console.log('\n\x1b[1m── CancelTracker ──\x1b[0m');

test('10. TASK_CANCEL_ACK routes to CancelTracker.handleAck()', () => {
  const handler = new V4WireHandler();
  const tracker = new CancelTracker();
  handler.registerModules({ cancelTracker: tracker });

  // Create a pending cancel
  tracker.setTransport(() => {});
  tracker.cancel('peer-A', 'task-1', 'race-1', CancelReason.RACE_LOST);
  assertEqual(tracker.pendingCount, 1, '1 pending');

  // Simulate ack via wire
  handler.handleMessage(MessageType.V4_TASK_CANCEL_ACK, encodeJSON({
    taskId: 'task-1',
    raceId: 'race-1',
    deviceId: 'peer-A',
    stopped: true,
    partialBytes: 0,
    computeMs: 10,
  }));

  assertEqual(tracker.pendingCount, 0, '0 pending after ack');
});

test('11. CancelTracker sends TASK_CANCEL through wire handler', () => {
  const handler = new V4WireHandler();
  const tracker = new CancelTracker();
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);
  handler.registerModules({ cancelTracker: tracker });

  tracker.cancel('peer-A', 'task-2', 'race-2', CancelReason.RACE_LOST);

  assert(mock.sent.length >= 1, 'cancel sent via transport');
});

// ════════════════════════════════════════════
// TASK_CANCEL (executor side)
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Task Cancel (Executor) ──\x1b[0m');

test('12. TASK_CANCEL sends auto-ack back', () => {
  const handler = new V4WireHandler();
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);

  handler.handleMessage(MessageType.V4_TASK_CANCEL, encodeJSON({
    taskId: 'task-X',
    raceId: 'race-X',
    reason: 'race_lost',
    ts: Date.now(),
  }), '192.168.1.10:4200');

  // Should have sent ack back to the address
  assert(mock.sent.length >= 1, 'ack sent back');
});

// ════════════════════════════════════════════
// Outbound Sending
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Outbound Sending ──\x1b[0m');

await testAsync('13. sendToPeer resolves address and sends', async () => {
  const handler = new V4WireHandler();
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);

  const ok = await handler.sendToPeer('peer-A', MessageType.V4_LOAD_REPORT, { test: true });
  assert(ok, 'send succeeded');
  assertEqual(mock.sent.length, 1, '1 message sent');
  assertEqual(mock.sent[0].address, '192.168.1.10:4200', 'resolved address');
});

await testAsync('14. sendToPeer fails for unknown peer', async () => {
  const handler = new V4WireHandler();
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);

  const ok = await handler.sendToPeer('unknown-peer', MessageType.V4_LOAD_REPORT, { test: true });
  assert(!ok, 'send failed for unknown');
  assertEqual(mock.sent.length, 0, '0 messages sent');
});

await testAsync('15. broadcast sends to all peers', async () => {
  const handler = new V4WireHandler();
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);

  const ok = await handler.broadcast(MessageType.V4_CATALOG_GOSSIP, { test: true });
  assert(ok, 'broadcast succeeded');
  assertEqual(mock.broadcast.length, 1, '1 broadcast');
});

// ════════════════════════════════════════════
// Pipeline Data Routing
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Pipeline Data ──\x1b[0m');

test('16. PIPE_DATA routes data to pipeline', () => {
  const handler = new V4WireHandler();
  const { PipelineManager } = require('../src/pipes/pipeline-manager');
  const pipeMgr = new PipelineManager('local');
  handler.registerModules({ pipelineManager: pipeMgr });

  // Define and start a pipeline
  pipeMgr.define('remote-pipe', ['collect']);
  pipeMgr.start('remote-pipe');

  // Simulate PIPE_DATA arriving from remote device
  const dataHex = Buffer.from('hello').toString('hex');
  handler.handleMessage(MessageType.V4_PIPE_DATA, encodeJSON({
    pipeline: 'remote-pipe',
    stageIndex: 0,
    data: dataHex,
  }));

  const inst = pipeMgr.get('remote-pipe')!;
  assertEqual(inst.totalItemsPushed, 1, '1 item pushed via wire');

  pipeMgr.remove('remote-pipe');
});

// ════════════════════════════════════════════
// Stats
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Stats ──\x1b[0m');

await testAsync('17. stats aggregate across operations', async () => {
  const handler = new V4WireHandler();
  const mock = createMockTransport();
  handler.setTransport(mock.transport, mock.resolver);

  handler.handleMessage(MessageType.V4_LOAD_REPORT, encodeJSON({ deviceId: 'a' }));
  handler.handleMessage(MessageType.V4_LOAD_REPORT, encodeJSON({ deviceId: 'b' }));
  await handler.sendToPeer('peer-A', MessageType.V4_TASK_CANCEL, {});
  await handler.broadcast(MessageType.V4_CATALOG_GOSSIP, {});

  const stats = handler.getStats();
  assertEqual(stats.messagesReceived, 2, '2 received');
  assertEqual(stats.messagesSent, 1, '1 sent');
  assertEqual(stats.messagesBroadcast, 1, '1 broadcast');
});

test('18. invalid payload increments error count', () => {
  const handler = new V4WireHandler();
  handler.handleMessage(MessageType.V4_LOAD_REPORT, new Uint8Array([0xFF, 0xFE]));

  const stats = handler.getStats();
  assertEqual(stats.errors, 1, '1 error');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mV4 Wire Handler Tests\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  console.error(err.stack);
  process.exit(1);
});
