/**
 * CMP v4.0 — Phase 5: Speculative Racing Tests
 *
 * 24 tests covering:
 *   - Racing decision logic (when to race / not race)
 *   - Race execution (first success wins, losers cancelled)
 *   - CCU economics (winner/loser payments)
 *   - Cancel protocol (send/ack tracking)
 *   - Edge cases (all fail, single racer, device failure)
 *
 * Run: npx tsx packages/core/tests/v4-race-manager.test.ts
 *
 * @author Agent Viscro
 */

import {
  RaceManager, RaceConfig, RacingMeshState, Racer, RacerResult,
} from '../src/scheduler/race-manager';
import {
  CancelTracker, CancelReason, TASK_CANCEL_MSG,
} from '../src/scheduler/cancel-protocol';

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

// ─── Helpers ───

function makeRacer(deviceId: string, delayMs: number, success: boolean = true, data: Uint8Array = new Uint8Array([0xAA])): Racer {
  const taskId = `task-${deviceId}`;
  return {
    deviceId,
    taskId,
    startedAt: Date.now(),
    promise: new Promise<RacerResult>((resolve) => {
      setTimeout(() => {
        resolve({
          deviceId,
          taskId,
          success,
          data: success ? data : null,
          totalTimeMs: delayMs,
          error: success ? null : `${deviceId} failed`,
        });
      }, delayMs);
    }),
  };
}

function makeFailRacer(deviceId: string, delayMs: number): Racer {
  return makeRacer(deviceId, delayMs, false);
}

// ─── Main ───

async function main() {

// ════════════════════════════════════════════
// Racing Decision Logic
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Racing Decision Logic ──\x1b[0m');

const mgr = new RaceManager();

test('1. skip race for fast tasks (< 100ms)', () => {
  const decision = mgr.shouldRace({
    availableDevices: 4,
    avgUtilization: 0.5,
    loadVariance: 5,
    estimatedDurationMs: 50,
  });
  assert(!decision.shouldRace, 'should not race');
  assert(decision.reason.includes('too fast'), 'reason mentions fast');
});

test('2. always race for slow tasks (≥ 5s)', () => {
  const decision = mgr.shouldRace({
    availableDevices: 4,
    avgUtilization: 0.5,
    loadVariance: 5,
    estimatedDurationMs: 6000,
  });
  assert(decision.shouldRace, 'should race');
  assertEqual(decision.racerCount, 3, 'default 3 racers');
  assert(decision.reason.includes('Slow task'), 'reason mentions slow');
});

test('3. race when high load variance', () => {
  const decision = mgr.shouldRace({
    availableDevices: 4,
    avgUtilization: 0.6,
    loadVariance: 30, // High variance
    estimatedDurationMs: 2000,
  });
  assert(decision.shouldRace, 'should race');
  assert(decision.reason.includes('variance'), 'reason mentions variance');
});

test('4. race when mesh is idle', () => {
  const decision = mgr.shouldRace({
    availableDevices: 4,
    avgUtilization: 0.1, // 10% utilization — very idle
    loadVariance: 5,
    estimatedDurationMs: 2000,
  });
  assert(decision.shouldRace, 'should race');
  assert(decision.reason.includes('idle'), 'reason mentions idle');
});

test('5. skip race when not enough devices', () => {
  const decision = mgr.shouldRace({
    availableDevices: 1,
    avgUtilization: 0.5,
    loadVariance: 5,
    estimatedDurationMs: 10000,
  });
  assert(!decision.shouldRace, 'cannot race with 1 device');
});

test('6. racerCount capped by available devices', () => {
  const decision = mgr.shouldRace({
    availableDevices: 2,
    avgUtilization: 0.1,
    loadVariance: 5,
    estimatedDurationMs: 10000,
  });
  assert(decision.shouldRace, 'should race');
  assertEqual(decision.racerCount, 2, 'capped at 2');
});

test('7. racerCount capped by maxRacers config', () => {
  const smallMgr = new RaceManager({ maxRacers: 2 });
  const decision = smallMgr.shouldRace({
    availableDevices: 10,
    avgUtilization: 0.1,
    loadVariance: 5,
    estimatedDurationMs: 10000,
  });
  assertEqual(decision.racerCount, 2, 'capped at maxRacers=2');
});

test('8. no race when no criteria met', () => {
  const decision = mgr.shouldRace({
    availableDevices: 4,
    avgUtilization: 0.6,  // Not idle
    loadVariance: 5,       // Low variance
    estimatedDurationMs: 500, // Medium duration
  });
  assert(!decision.shouldRace, 'no criteria met');
});

test('9. race with unknown duration + available capacity', () => {
  const decision = mgr.shouldRace({
    availableDevices: 4,
    avgUtilization: 0.3, // Under 50%
    loadVariance: 5,
    estimatedDurationMs: -1, // Unknown
  });
  assert(decision.shouldRace, 'race with unknown duration');
  assert(decision.reason.includes('Unknown'), 'reason mentions unknown');
});

// ════════════════════════════════════════════
// CCU Economics
// ════════════════════════════════════════════
console.log('\n\x1b[1m── CCU Economics ──\x1b[0m');

test('10. CCU calculation for 3 racers (default shares)', () => {
  const ccu = mgr.calculateCCU(10, 3);
  assertEqual(ccu.basePrice, 10, 'base=10');
  assertEqual(ccu.racerCount, 3, 'racers=3');
  assertEqual(ccu.winnerPayment, 10, 'winner=10');
  assertEqual(ccu.loserPayment, 2, 'loser=2');
  assertEqual(ccu.totalCost, 14, 'total=14 (10 + 2×2)');
});

test('11. CCU calculation for 1 racer (no losers)', () => {
  const ccu = mgr.calculateCCU(10, 1);
  assertEqual(ccu.totalCost, 10, 'single racer = base price');
});

test('12. CCU calculation for 5 racers', () => {
  const ccu = mgr.calculateCCU(100, 5);
  assertEqual(ccu.winnerPayment, 100, 'winner=100');
  assertEqual(ccu.loserPayment, 20, 'loser=20');
  assertEqual(ccu.totalCost, 180, 'total=180 (100 + 4×20)');
});

test('13. custom CCU shares', () => {
  const custom = new RaceManager({ winnerShare: 0.8, loserShare: 0.1 });
  const ccu = custom.calculateCCU(100, 3);
  assertEqual(ccu.winnerPayment, 80, 'winner=80');
  assertEqual(ccu.loserPayment, 10, 'loser=10');
  assertEqual(ccu.totalCost, 100, 'total=100 (80 + 2×10)');
});

// ════════════════════════════════════════════
// Race Execution
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Race Execution ──\x1b[0m');

await testAsync('14. fastest device wins the race', async () => {
  const mgr = new RaceManager();
  const racers = [
    makeRacer('slow', 200),
    makeRacer('fast', 20),
    makeRacer('medium', 100),
  ];

  const { winner } = await mgr.race(racers);
  assertEqual(winner.deviceId, 'fast', 'fast wins');
  assert(winner.success, 'winner succeeded');
  assert(winner.data !== null, 'winner has data');
});

await testAsync('15. race records CCU cost', async () => {
  const mgr = new RaceManager();
  const racers = [makeRacer('a', 10), makeRacer('b', 50), makeRacer('c', 100)];

  const { record } = await mgr.race(racers, 10);
  assert(record.ccuCost !== null, 'has CCU cost');
  assertEqual(record.ccuCost!.totalCost, 14, 'CCU=14');
  assertEqual(record.state, 'completed', 'state=completed');
});

await testAsync('16. race sends cancel to losers', async () => {
  const mgr = new RaceManager();
  const cancels: Array<{ deviceId: string; taskId: string }> = [];
  mgr.setTransport((deviceId, msgType, payload) => {
    if (msgType === TASK_CANCEL_MSG) {
      cancels.push({ deviceId, taskId: payload.taskId });
    }
  });

  const racers = [makeRacer('a', 10), makeRacer('b', 200), makeRacer('c', 200)];
  const { winner } = await mgr.race(racers);

  // Wait a tick for cancels to be sent
  await new Promise(r => setTimeout(r, 50));

  assertEqual(winner.deviceId, 'a', 'a wins');
  assertEqual(cancels.length, 2, '2 cancels sent');
  assert(cancels.every(c => c.deviceId !== 'a'), 'winner not cancelled');
});

await testAsync('17. race survives partial failures (2/3 fail, 1 succeeds)', async () => {
  const mgr = new RaceManager();
  const racers = [
    makeFailRacer('fail1', 10),
    makeFailRacer('fail2', 20),
    makeRacer('survivor', 50),
  ];

  const { winner } = await mgr.race(racers);
  assertEqual(winner.deviceId, 'survivor', 'survivor wins');
  assert(winner.success, 'survivor succeeded');
});

await testAsync('18. race fails when all racers fail', async () => {
  const mgr = new RaceManager();
  const racers = [
    makeFailRacer('f1', 10),
    makeFailRacer('f2', 20),
    makeFailRacer('f3', 30),
  ];

  try {
    await mgr.race(racers);
    assert(false, 'should have thrown');
  } catch (err: any) {
    assert(err.message.includes('failed'), 'error mentions failure');
  }
});

await testAsync('19. race with single racer (no competition)', async () => {
  const mgr = new RaceManager();
  const racers = [makeRacer('solo', 10)];

  const { winner, record } = await mgr.race(racers, 10);
  assertEqual(winner.deviceId, 'solo', 'solo wins');
  assertEqual(record.ccuCost!.totalCost, 10, 'no loser cost');
});

await testAsync('20. race stats are tracked', async () => {
  const mgr = new RaceManager();
  await mgr.race([makeRacer('a', 10), makeRacer('b', 50)]);
  await mgr.race([makeRacer('c', 10), makeRacer('d', 50)]);

  const stats = mgr.getStats();
  assertEqual(stats.totalRaces, 2, 'totalRaces=2');
  assertEqual(stats.totalWins, 2, 'totalWins=2');
  assert(stats.totalCancelled >= 2, 'at least 2 cancelled');
});

// ════════════════════════════════════════════
// Cancel Protocol
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Cancel Protocol ──\x1b[0m');

test('21. cancel sends TASK_CANCEL message', () => {
  const tracker = new CancelTracker();
  const sent: any[] = [];
  tracker.setTransport((deviceId, msgType, payload) => {
    sent.push({ deviceId, msgType, payload });
  });

  tracker.cancel('dev-B', 'task-1', 'race-1', CancelReason.RACE_LOST);

  assertEqual(sent.length, 1, '1 message sent');
  assertEqual(sent[0].deviceId, 'dev-B', 'to dev-B');
  assertEqual(sent[0].msgType, TASK_CANCEL_MSG, 'TASK_CANCEL');
  assertEqual(sent[0].payload.reason, 'race_lost', 'reason=race_lost');
});

test('22. cancelLosers cancels all except winner', () => {
  const tracker = new CancelTracker();
  const cancelled: string[] = [];
  tracker.setTransport((deviceId) => { cancelled.push(deviceId); });

  const count = tracker.cancelLosers('race-1', 'winner', [
    { deviceId: 'winner', taskId: 't1' },
    { deviceId: 'loser1', taskId: 't2' },
    { deviceId: 'loser2', taskId: 't3' },
  ]);

  assertEqual(count, 2, '2 cancelled');
  assert(!cancelled.includes('winner'), 'winner not cancelled');
  assert(cancelled.includes('loser1'), 'loser1 cancelled');
  assert(cancelled.includes('loser2'), 'loser2 cancelled');
});

test('23. handleAck processes cancel acknowledgement', () => {
  const tracker = new CancelTracker();
  tracker.setTransport(() => {});

  tracker.cancel('dev-B', 'task-1', 'race-1', CancelReason.RACE_LOST);
  assertEqual(tracker.pendingCount, 1, '1 pending');

  tracker.handleAck({
    taskId: 'task-1',
    raceId: 'race-1',
    deviceId: 'dev-B',
    stopped: true,
    partialBytes: 128,
    computeMs: 45,
  });

  assertEqual(tracker.pendingCount, 0, '0 pending after ack');
});

test('24. allAcked checks race completion', () => {
  const tracker = new CancelTracker();
  tracker.setTransport(() => {});

  tracker.cancel('dev-A', 't1', 'race-X', CancelReason.RACE_LOST);
  tracker.cancel('dev-B', 't2', 'race-X', CancelReason.RACE_LOST);

  assert(!tracker.allAcked('race-X'), 'not all acked');

  tracker.handleAck({ taskId: 't1', raceId: 'race-X', deviceId: 'dev-A', stopped: true, partialBytes: 0, computeMs: 10 });
  assert(!tracker.allAcked('race-X'), 'still 1 pending');

  tracker.handleAck({ taskId: 't2', raceId: 'race-X', deviceId: 'dev-B', stopped: true, partialBytes: 0, computeMs: 20 });
  assert(tracker.allAcked('race-X'), 'all acked');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 5: Speculative Racing\x1b[0m`);
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
