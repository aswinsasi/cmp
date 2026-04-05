/**
 * CMP v4.0 — Phase 6: Computation Gravity Tests
 *
 * 26 tests covering:
 *   - DataCatalog: shard registration, location queries, bloom filter, gossip, device removal
 *   - CodeShipper: ship/result wire protocol, timeout, stats
 *   - GravityPlanner: PULL/SCATTER/PUSH decisions, savings calculation, edge cases
 *
 * Run: npx tsx packages/core/tests/v4-gravity.test.ts
 *
 * @author Agent Viscro
 */

import { DataCatalog, DataLocation } from '../src/gravity/data-catalog';
import { CodeShipper, CODE_SHIP_MSG, CODE_RESULT_MSG } from '../src/gravity/code-shipper';
import { GravityPlanner, GravityStrategy } from '../src/gravity/gravity-planner';

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

// ─── Main ───

async function main() {

// ════════════════════════════════════════════
// Data Catalog
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Data Catalog ──\x1b[0m');

test('1. register and locate a shard', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('sensors/temp.csv', 'dev-B', 2_000_000, 2_000_000);

  const loc = catalog.locate('sensors/temp.csv');
  assert(loc !== null, 'found');
  assertEqual(loc!.totalSizeBytes, 2_000_000, 'totalSize=2MB');
  assertEqual(loc!.primaryDevice, 'dev-B', 'primary=dev-B');
  assertEqual(loc!.primaryFraction, 1.0, 'fraction=1.0');
  assert(loc!.isConcentrated, 'concentrated');
});

test('2. track multiple shards across devices', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('data/big.bin', 'dev-A', 500_000, 2_000_000);
  catalog.registerShard('data/big.bin', 'dev-B', 800_000, 2_000_000);
  catalog.registerShard('data/big.bin', 'dev-C', 700_000, 2_000_000);

  const loc = catalog.locate('data/big.bin')!;
  assertEqual(loc.devices.length, 3, '3 devices');
  assertEqual(loc.primaryDevice, 'dev-B', 'B has most');
  assert(loc.isDistributed, 'distributed across devices');
  assert(!loc.isConcentrated, 'not concentrated');
});

test('3. getDeviceData returns all keys for a device', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('file1', 'dev-B', 1000, 1000);
  catalog.registerShard('file2', 'dev-B', 2000, 2000);
  catalog.registerShard('file3', 'dev-C', 3000, 3000);

  const bData = catalog.getDeviceData('dev-B');
  assertEqual(bData.length, 2, 'B has 2 files');
  assert(bData.includes('file1'), 'has file1');
  assert(bData.includes('file2'), 'has file2');
});

test('4. bloom filter quick check', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('known-key', 'dev-B', 1000, 1000);

  assert(catalog.mightHaveData('dev-B', 'known-key'), 'bloom says maybe');
  // Note: bloom filter may have false positives, but registered keys should always return true
});

test('5. removeShard updates catalog', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('temp', 'dev-B', 1000, 1000);
  assertEqual(catalog.size, 1, 'has entry');

  catalog.removeShard('temp', 'dev-B');
  assertEqual(catalog.size, 0, 'entry removed (no shards left)');
});

test('6. removeDevice cleans up all entries', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('f1', 'dev-X', 1000, 1000);
  catalog.registerShard('f2', 'dev-X', 2000, 2000);
  catalog.registerShard('f3', 'dev-Y', 3000, 3000);

  catalog.removeDevice('dev-X');

  assertEqual(catalog.getDeviceData('dev-X').length, 0, 'X data gone');
  assertEqual(catalog.size, 1, 'only Y remains');
});

test('7. locate returns null for unknown key', () => {
  const catalog = new DataCatalog('dev-A');
  assertEqual(catalog.locate('nope'), null, 'null for unknown');
});

test('8. gossip handler merges remote catalog data', () => {
  const catalog = new DataCatalog('dev-A');

  catalog.handleGossip({
    senderId: 'dev-B',
    entries: [
      {
        key: 'remote-data',
        totalSize: 5_000_000,
        shards: [
          { deviceId: 'dev-B', sizeBytes: 3_000_000, fraction: 0.6 },
          { deviceId: 'dev-C', sizeBytes: 2_000_000, fraction: 0.4 },
        ],
        updatedAt: Date.now(),
      },
    ],
    timestamp: Date.now(),
  });

  const loc = catalog.locate('remote-data');
  assert(loc !== null, 'gossip data received');
  assertEqual(loc!.devices.length, 2, '2 devices from gossip');
  assertEqual(loc!.primaryDevice, 'dev-B', 'B has most');
});

test('9. totalBytes tracks aggregate', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('a', 'dev-A', 1000, 1000);
  catalog.registerShard('b', 'dev-A', 2000, 2000);
  assertEqual(catalog.totalBytes, 3000, 'total=3000');
});

test('10. getAllKeys returns all tracked keys', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('x', 'dev-A', 100, 100);
  catalog.registerShard('y', 'dev-B', 200, 200);

  const keys = catalog.getAllKeys();
  assertEqual(keys.length, 2, '2 keys');
  assert(keys.includes('x'), 'has x');
  assert(keys.includes('y'), 'has y');
});

// ════════════════════════════════════════════
// Code Shipper
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Code Shipper ──\x1b[0m');

test('11. ship sends CODE_SHIP message', () => {
  const shipper = new CodeShipper('dev-A');
  const sent: any[] = [];
  shipper.setTransport((deviceId, msgType, payload) => {
    sent.push({ deviceId, msgType, payload });
  });

  // Don't await — just check message was sent
  const promise = shipper.shipCode('dev-B', 'data/key', new Uint8Array([1, 2, 3]), 'process', new Uint8Array([]), 5000);
  promise.catch(() => {}); // Suppress unhandled rejection (will timeout)

  assertEqual(sent.length, 1, '1 message sent');
  assertEqual(sent[0].deviceId, 'dev-B', 'sent to dev-B');
  assertEqual(sent[0].msgType, CODE_SHIP_MSG, 'CODE_SHIP');
  assertEqual(sent[0].payload.dataKey, 'data/key', 'dataKey');

  shipper.cancelAll();
});

await testAsync('12. ship + result round-trip', async () => {
  const shipper = new CodeShipper('dev-A');
  const messages: any[] = [];

  shipper.setTransport((deviceId, msgType, payload) => {
    messages.push({ deviceId, msgType, payload });

    // Simulate remote device sending result back immediately
    if (msgType === CODE_SHIP_MSG) {
      setTimeout(() => {
        shipper.handleCodeResult({
          reqId: payload.reqId,
          executor: deviceId,
          ok: true,
          dataHex: '4f4b', // "OK"
          execMs: 42,
          readBytes: 10000,
          error: null,
        });
      }, 10);
    }
  });

  const result = await shipper.shipCode('dev-B', 'data/key', new Uint8Array([1, 2]), 'process');

  assert(result.success, 'success');
  assertEqual(result.executorId, 'dev-B', 'executor=dev-B');
  assertEqual(result.executionTimeMs, 42, 'execMs=42');
  assertEqual(result.dataReadBytes, 10000, 'readBytes=10000');
  assert(result.data !== null, 'has data');
  assertEqual(result.data!.length, 2, 'result is 2 bytes');
});

await testAsync('13. ship timeout rejects', async () => {
  const shipper = new CodeShipper('dev-A');
  shipper.setTransport(() => {}); // Silently drops — no response

  try {
    await shipper.shipCode('dev-B', 'data/key', new Uint8Array([1]), 'process', new Uint8Array([]), 100); // 100ms timeout
    assert(false, 'should have thrown');
  } catch (err: any) {
    assert(err.message.includes('timeout'), 'timeout error');
  }
});

test('14. code shipper tracks stats', () => {
  const shipper = new CodeShipper('dev-A');
  shipper.setTransport(() => {});

  shipper.shipCode('dev-B', 'k1', new Uint8Array(50), 'p').catch(() => {});
  shipper.shipCode('dev-C', 'k2', new Uint8Array(30), 'p').catch(() => {});

  const stats = shipper.getStats();
  assertEqual(stats.codeShipped, 2, 'shipped=2');
  assertEqual(stats.codeShippedBytes, 80, 'bytes=80');
  assertEqual(stats.pendingRequests, 2, 'pending=2');

  shipper.cancelAll();
});

await testAsync('15. executor side handles CODE_SHIP', async () => {
  const executor = new CodeShipper('dev-B');
  const responses: any[] = [];

  executor.setTransport((deviceId, msgType, payload) => {
    responses.push({ deviceId, msgType, payload });
  });

  executor.setExecuteHandler(async (req) => {
    return {
      requestId: req.requestId,
      executorId: 'dev-B',
      success: true,
      data: new Uint8Array([0xAA, 0xBB]),
      executionTimeMs: 25,
      dataReadBytes: 50000,
      error: null,
    };
  });

  await executor.handleCodeShip({
    reqId: 'req-1',
    dataKey: 'sensors/data',
    wasmHex: '0102',
    entry: 'filter',
    paramsHex: '',
    from: 'dev-A',
    deadline: 5000,
    ts: Date.now(),
  });

  assertEqual(responses.length, 1, '1 response sent');
  assertEqual(responses[0].deviceId, 'dev-A', 'response to dev-A');
  assertEqual(responses[0].msgType, CODE_RESULT_MSG, 'CODE_RESULT');
  assert(responses[0].payload.ok, 'success');
});

// ════════════════════════════════════════════
// Gravity Planner
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Gravity Planner ──\x1b[0m');

test('16. PULL: code ships to device holding large data', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('big-data', 'dev-B', 2_000_000_000, 2_000_000_000); // 2GB

  const planner = new GravityPlanner(catalog);
  const decision = planner.plan('big-data', 50, 4000, 'dev-A'); // 50B code, 4KB result

  assertEqual(decision.strategy, GravityStrategy.PULL, 'PULL');
  assertEqual(decision.targetDevices[0], 'dev-B', 'target=dev-B');
  assert(decision.savingsRatio > 0.99, `savings > 99% (got ${(decision.savingsRatio * 100).toFixed(2)}%)`);
  assert(decision.networkCostBytes < 10000, `network < 10KB (got ${decision.networkCostBytes})`);
});

test('17. PUSH: small data moves to compute', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('tiny', 'dev-B', 100, 100); // 100 bytes

  const planner = new GravityPlanner(catalog, { minDataSizeBytes: 50 });
  const decision = planner.plan('tiny', 50000, 1000, 'dev-A'); // 50KB code

  // Data is smaller than code — PUSH or NONE
  assert(
    decision.strategy === GravityStrategy.PUSH || decision.strategy === GravityStrategy.NONE,
    `strategy is PUSH or NONE (got ${decision.strategy})`
  );
});

test('18. SCATTER: data distributed across multiple devices', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('distributed', 'dev-B', 400_000, 1_000_000);
  catalog.registerShard('distributed', 'dev-C', 300_000, 1_000_000);
  catalog.registerShard('distributed', 'dev-D', 300_000, 1_000_000);

  const planner = new GravityPlanner(catalog);
  const decision = planner.plan('distributed', 100, 2000, 'dev-A'); // 100B code

  assertEqual(decision.strategy, GravityStrategy.SCATTER, 'SCATTER');
  assert(decision.targetDevices.length >= 2, `multiple targets (got ${decision.targetDevices.length})`);
  assert(decision.savingsRatio > 0, 'some savings');
});

test('19. NONE: data not found in catalog', () => {
  const catalog = new DataCatalog('dev-A');
  const planner = new GravityPlanner(catalog);
  const decision = planner.plan('nonexistent', 50, 1000, 'dev-A');

  assertEqual(decision.strategy, GravityStrategy.NONE, 'NONE');
  assert(decision.reason.includes('not found'), 'reason says not found');
});

test('20. NONE: data already on local device', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('local-data', 'dev-A', 1_000_000, 1_000_000);

  const planner = new GravityPlanner(catalog);
  const decision = planner.plan('local-data', 50, 1000, 'dev-A');

  assertEqual(decision.strategy, GravityStrategy.NONE, 'NONE (local)');
  assert(decision.reason.includes('local'), 'reason says local');
});

test('21. NONE: data too small for gravity', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('small', 'dev-B', 500, 500);

  const planner = new GravityPlanner(catalog, { minDataSizeBytes: 10000 });
  const decision = planner.plan('small', 50, 100, 'dev-A');

  assertEqual(decision.strategy, GravityStrategy.NONE, 'NONE (too small)');
});

test('22. savings calculation: 50B code vs 2GB data', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('huge', 'dev-B', 2_000_000_000, 2_000_000_000);

  const planner = new GravityPlanner(catalog);
  const decision = planner.plan('huge', 50, 4000, 'dev-A');

  assertEqual(decision.networkCostBytes, 4050, 'network=4050B (50 code + 4000 result)');
  assertEqual(decision.naiveCostBytes, 2_000_000_000, 'naive=2GB');
  // Savings should be ~99.9998%
  assert(decision.savingsRatio > 0.999, `savings > 99.9% (got ${(decision.savingsRatio * 100).toFixed(4)}%)`);
});

test('23. wouldBenefit quick check', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('big', 'dev-B', 1_000_000, 1_000_000);
  catalog.registerShard('tiny', 'dev-B', 100, 100);

  const planner = new GravityPlanner(catalog, { minDataSizeBytes: 1000 });

  assert(planner.wouldBenefit('big', 50), 'big data benefits');
  assert(!planner.wouldBenefit('tiny', 50), 'tiny data no benefit');
  assert(!planner.wouldBenefit('missing', 50), 'missing no benefit');
});

test('24. gravity stats track decisions', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('d1', 'dev-B', 2_000_000, 2_000_000);
  catalog.registerShard('d2', 'dev-B', 50, 50);

  const planner = new GravityPlanner(catalog, { minDataSizeBytes: 100 });
  planner.plan('d1', 50, 100, 'dev-A');
  planner.plan('d2', 50, 100, 'dev-A');
  planner.plan('missing', 50, 100, 'dev-A');

  const stats = planner.getStats();
  assertEqual(stats.decisions, 3, 'decisions=3');
  assert(stats.pullCount >= 1, 'at least 1 pull');
  assert(stats.totalSavedBytes > 0, 'saved some bytes');
});

test('25. PULL decision chooses primary device', () => {
  const catalog = new DataCatalog('dev-A');
  // dev-C has 80%, dev-D has 20%
  catalog.registerShard('split', 'dev-C', 800_000, 1_000_000);
  catalog.registerShard('split', 'dev-D', 200_000, 1_000_000);

  const planner = new GravityPlanner(catalog);
  const decision = planner.plan('split', 50, 1000, 'dev-A');

  assertEqual(decision.strategy, GravityStrategy.PULL, 'PULL');
  assertEqual(decision.targetDevices[0], 'dev-C', 'target=dev-C (80%)');
});

test('26. catalog clear wipes all data', () => {
  const catalog = new DataCatalog('dev-A');
  catalog.registerShard('a', 'dev-A', 100, 100);
  catalog.registerShard('b', 'dev-B', 200, 200);
  assertEqual(catalog.size, 2, '2 entries');

  catalog.clear();
  assertEqual(catalog.size, 0, 'cleared');
  assertEqual(catalog.totalBytes, 0, 'zero bytes');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 6: Computation Gravity\x1b[0m`);
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
