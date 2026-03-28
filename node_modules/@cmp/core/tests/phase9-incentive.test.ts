/**
 * CMP Phase 9 Test Suite
 * Tests: Incentive ledger — credits, reputation, decay,
 * and integration with compute flow.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase9-incentive.test.ts
 *
 * @author Agent Viscro
 */

import {
  CMPNode, LogLevel, toHex, shortId, randomBytes,
  TaskType, ChunkStatus, IncentiveLedger,
  REPUTATION_DEFAULT, REPUTATION_MAX, BOOTSTRAP_CREDITS,
} from '../src';
import type { ComputeResult, LedgerAccount } from '../src';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';

const ENCRYPT_WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,5,3,1,0,1,
  7,20,2,6,109,101,109,111,114,121,2,0,7,101,110,99,114,121,112,116,0,0,
  10,54,1,52,1,1,127,65,0,33,2,2,64,3,64,32,2,32,1,79,13,1,32,0,32,2,
  106,32,0,32,2,106,45,0,0,65,194,0,115,58,0,0,32,2,65,1,106,33,2,12,
  0,11,11,32,1,11
]);

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createTestNode(id: string, network: VirtualNetwork, opts: { accepting?: boolean } = {}): CMPNode {
  const transport = new VirtualTransport(id, network);
  return new CMPNode({
    _transport: transport,
    beaconIntervalMs: 150,
    bidWindowMs: 400,
    peerStaleMs: 15000,
    peerDeadMs: 30000,
    acceptingTasks: opts.accepting !== false,
    logLevel: LogLevel.WARN,
  });
}

async function main() {

// ════════════════════════════════════════════
// STANDALONE LEDGER TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Standalone Ledger: Credits ──\x1b[0m');

test('New account gets bootstrap credits', () => {
  const ledger = new IncentiveLedger();
  const account = ledger.getAccount('aabbccdd');
  assertEqual(account.credits, BOOTSTRAP_CREDITS, 'bootstrap credits');
  assertEqual(account.reputation, REPUTATION_DEFAULT, 'default reputation');
});

test('getBalance returns correct balance', () => {
  const ledger = new IncentiveLedger();
  assertEqual(ledger.getBalance('aabb'), BOOTSTRAP_CREDITS, 'initial balance');
});

test('spendCredits deducts and returns true', () => {
  const ledger = new IncentiveLedger();
  ledger.getAccount('spender');
  const ok = ledger.spendCredits('spender', 10, 'task1');
  assertEqual(ok, true, 'should succeed');
  assertEqual(ledger.getBalance('spender'), 90, 'remaining balance');
});

test('spendCredits returns false when insufficient', () => {
  const ledger = new IncentiveLedger();
  ledger.getAccount('broke');
  ledger.spendCredits('broke', 100, 'task1'); // spend all 100
  const ok = ledger.spendCredits('broke', 1, 'task2');
  assertEqual(ok, false, 'should fail');
  assertEqual(ledger.getBalance('broke'), 0, 'still zero');
});

test('earnCredits adds to balance', () => {
  const ledger = new IncentiveLedger();
  ledger.getAccount('executor');
  ledger.earnCredits('executor', 'requester', 15, 'task1', 'chunk1');
  assertEqual(ledger.getBalance('executor'), 115, 'earned balance');
});

test('spend + earn flow: requester pays, executor earns', () => {
  const ledger = new IncentiveLedger();
  ledger.getAccount('req');
  ledger.getAccount('exec');

  ledger.spendCredits('req', 5, 'task1');
  ledger.earnCredits('exec', 'req', 5, 'task1', 'chunk1');

  assertEqual(ledger.getBalance('req'), 95, 'requester spent');
  assertEqual(ledger.getBalance('exec'), 105, 'executor earned');
});

test('getTransactions records credit transfers', () => {
  const ledger = new IncentiveLedger();
  ledger.getAccount('a');
  ledger.getAccount('b');
  ledger.earnCredits('b', 'a', 10, 'task1', 'chunk1');
  ledger.earnCredits('b', 'a', 5, 'task2', 'chunk2');

  const txs = ledger.getTransactions();
  assertEqual(txs.length, 2, 'transaction count');
  assertEqual(txs[0].amount, 10, 'first tx amount');
  assertEqual(txs[1].amount, 5, 'second tx amount');
});

console.log('\n\x1b[1m── Standalone Ledger: Reputation ──\x1b[0m');

test('recordCompletion increases reputation factors', () => {
  const ledger = new IncentiveLedger();
  ledger.getAccount('good');

  for (let i = 0; i < 10; i++) {
    ledger.recordCompletion('good', true);
  }

  const factors = ledger.getFactors('good');
  assert(factors.completionRate > 0.9, `completionRate: ${factors.completionRate}`);
  assert(factors.accuracyRate > 0.9, `accuracyRate: ${factors.accuracyRate}`);

  const rep = ledger.getReputation('good');
  assert(rep >= REPUTATION_DEFAULT, `reputation should stay high: ${rep}`);
});

test('recordFailure decreases completion rate and reputation', () => {
  const ledger = new IncentiveLedger();
  ledger.getAccount('bad');

  for (let i = 0; i < 10; i++) {
    ledger.recordFailure('bad');
  }

  const rep = ledger.getReputation('bad');
  const factors = ledger.getFactors('bad');
  // Failures only affect completionRate (35% weight)
  // Other factors stay at 1.0, so floor is ~6500
  assert(factors.completionRate < 0.5, `completionRate should drop: ${factors.completionRate}`);
  assert(rep < REPUTATION_MAX, `reputation below max: ${rep}`);
  console.log(`    → 10 failures: reputation=${rep}, completion=${factors.completionRate.toFixed(2)}`);
});

test('Mixed completions and failures produce intermediate reputation', () => {
  const ledger = new IncentiveLedger();
  ledger.getAccount('mixed');

  // 7 successes, 3 failures
  for (let i = 0; i < 7; i++) ledger.recordCompletion('mixed', true);
  for (let i = 0; i < 3; i++) ledger.recordFailure('mixed');

  const rep = ledger.getReputation('mixed');
  const factors = ledger.getFactors('mixed');
  assert(rep > 0, `reputation positive: ${rep}`);
  assert(factors.completionRate < 1.0, `completion rate < 1: ${factors.completionRate}`);
  assert(factors.completionRate > 0.5, `completion rate > 0.5: ${factors.completionRate}`);

  console.log(`    → 7/10 success: reputation=${rep}, completion=${factors.completionRate.toFixed(2)}`);
});

test('canParticipate returns false when all factors are bad', () => {
  const ledger = new IncentiveLedger({ minReputation: 2000 });
  ledger.getAccount('terrible');

  // Tank all four reputation factors with many observations
  for (let i = 0; i < 50; i++) {
    ledger.recordFailure('terrible');
    ledger.recordCompletion('terrible', false); // inaccurate
    ledger.recordAvailability('terrible', false);
    ledger.recordResourceHonesty('terrible', false);
  }

  const rep = ledger.getReputation('terrible');
  const canJoin = ledger.canParticipate('terrible');

  console.log(`    → All factors bad (50x): reputation=${rep}, canParticipate=${canJoin}`);
  assert(rep < 2000, `reputation should be low: ${rep}`);
  assertEqual(canJoin, false, 'should be excluded');
});

test('applyDecay reduces reputation for inactive accounts', () => {
  const ledger = new IncentiveLedger();
  const account = ledger.getAccount('idle');
  const originalRep = account.reputation;

  // Simulate 4 weeks of inactivity
  account.lastActiveMs = Date.now() - (4 * 7 * 24 * 60 * 60 * 1000);

  ledger.applyDecay();

  const newRep = ledger.getReputation('idle');
  assert(newRep < originalRep, `reputation should decay: ${originalRep} → ${newRep}`);
  console.log(`    → 4 weeks idle: ${originalRep} → ${newRep}`);
});

test('applyDecay does not affect active accounts', () => {
  const ledger = new IncentiveLedger();
  const account = ledger.getAccount('active');
  const originalRep = account.reputation;

  // Just created — lastActiveMs is now
  ledger.applyDecay();

  assertEqual(ledger.getReputation('active'), originalRep, 'reputation unchanged');
});

console.log('\n\x1b[1m── Standalone Ledger: Persistence ──\x1b[0m');

test('exportJSON and importJSON round-trip', () => {
  const ledger1 = new IncentiveLedger();
  ledger1.getAccount('node1');
  ledger1.spendCredits('node1', 20, 'task1');
  ledger1.earnCredits('node1', 'node2', 5, 'task2', 'chunk1');
  ledger1.recordCompletion('node1', true);

  const json = ledger1.exportJSON();

  const ledger2 = new IncentiveLedger();
  ledger2.importJSON(json);

  assertEqual(ledger2.getBalance('node1'), 85, 'imported balance');
  assert(ledger2.getTransactions().length >= 1, 'imported transactions');
});

test('getSummary returns correct statistics', () => {
  const ledger = new IncentiveLedger();
  ledger.getAccount('a');
  ledger.getAccount('b');
  ledger.earnCredits('a', 'b', 10, 'task1', 'chunk1');

  const summary = ledger.getSummary();
  assertEqual(summary.totalAccounts, 2, 'account count');
  assert(summary.totalCreditsInCirculation >= 200, `credits: ${summary.totalCreditsInCirculation}`);
  assertEqual(summary.totalTransactions, 1, 'transaction count');
});

// ════════════════════════════════════════════
// INTEGRATION WITH COMPUTE FLOW
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Integration: Credits flow during compute ──\x1b[0m');

await testAsync('Requester spends credits, executor earns credits after compute', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const executor = createTestNode('exec', network);

  await requester.start();
  await executor.start();
  await sleep(2000);

  const reqLedger = requester.getLedger();
  const reqHex = requester.meshIdHex();
  const beforeBalance = reqLedger.getBalance(reqHex);

  const input = new TextEncoder().encode('credit test');
  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  assertEqual(result.localFallback, false, 'should be remote');

  const afterBalance = reqLedger.getBalance(reqHex);
  assert(afterBalance < beforeBalance, `requester should spend: ${beforeBalance} → ${afterBalance}`);

  // Executor should have earned credits (tracked in requester's ledger)
  const execHex = executor.meshIdHex();
  const execBalance = reqLedger.getBalance(execHex);
  assert(execBalance > BOOTSTRAP_CREDITS, `executor earned in requester ledger: ${execBalance}`);

  console.log(`    → Requester: ${beforeBalance} → ${afterBalance} CCU (spent ${beforeBalance - afterBalance})`);
  console.log(`    → Executor: ${BOOTSTRAP_CREDITS} → ${execBalance} CCU (earned ${execBalance - BOOTSTRAP_CREDITS})`);

  await requester.stop();
  await executor.stop();
});

await testAsync('getStatus shows real credit balance', async () => {
  const network = new VirtualNetwork();
  const node = createTestNode('solo', network);
  await node.start();

  const status1 = node.getStatus();
  assertEqual(status1.credits, BOOTSTRAP_CREDITS, 'initial credits');
  assertEqual(status1.reputation, REPUTATION_DEFAULT, 'initial reputation');

  await node.stop();
});

await testAsync('Multi-chunk compute: requester pays for each chunk', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const exec1 = createTestNode('e1', network);
  const exec2 = createTestNode('e2', network);

  await requester.start();
  await exec1.start();
  await exec2.start();
  await sleep(2500);

  const reqHex = requester.meshIdHex();
  const before = requester.getLedger().getBalance(reqHex);

  const input = new Uint8Array(100);
  for (let i = 0; i < 100; i++) input[i] = i;

  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    chunkHint: 2,
  });

  const after = requester.getLedger().getBalance(reqHex);
  const spent = before - after;

  assert(spent >= 2, `should spend >= 2 CCU for 2 chunks: spent ${spent}`);
  assert(result.chunksExecuted >= 2, `chunks: ${result.chunksExecuted}`);

  console.log(`    → 2 chunks: spent ${spent} CCU, earned back ${result.chunksExecuted} CCU by executors`);

  await requester.stop();
  await exec1.stop();
  await exec2.stop();
});

await testAsync('Executor reputation tracked after successful completion', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const executor = createTestNode('exec', network);

  await requester.start();
  await executor.start();
  await sleep(2000);

  const input = new TextEncoder().encode('reputation test');
  await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  const execHex = executor.meshIdHex();
  const rep = requester.getLedger().getReputation(execHex);
  assert(rep >= REPUTATION_DEFAULT, `executor reputation should stay high: ${rep}`);

  const account = requester.getLedger().getAccount(execHex);
  assert(account.tasksCompleted >= 1, `tasksCompleted: ${account.tasksCompleted}`);

  console.log(`    → Executor: reputation=${rep}, completed=${account.tasksCompleted}`);

  await requester.stop();
  await executor.stop();
});

await testAsync('Executor own ledger increases when executing chunks for others', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const executor = createTestNode('exec', network);

  await requester.start();
  await executor.start();
  await sleep(2000);

  const execHex = executor.meshIdHex();
  const beforeBalance = executor.getLedger().getBalance(execHex);

  // Requester sends task → executor runs it
  const input = new TextEncoder().encode('executor earns');
  await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  // Give a tick for chunk:executed event to fire
  await sleep(100);

  const afterBalance = executor.getLedger().getBalance(execHex);
  assert(afterBalance > beforeBalance, `executor balance should increase: ${beforeBalance} → ${afterBalance}`);

  console.log(`    → Executor own ledger: ${beforeBalance} → ${afterBalance} CCU`);

  await requester.stop();
  await executor.stop();
});

// ════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (failed > 0) {
  console.log(`  \x1b[1m\x1b[31mResults: ${passed} passed, ${failed} failed\x1b[0m`);
  for (const err of errors) console.log(err);
} else {
  console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
}
console.log('══════════════════════════════════════════════════\n');

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
