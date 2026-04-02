#!/usr/bin/env npx tsx
/**
 * Example 4: Two-Node Distributed Compute
 *
 * This is the REAL thing — two CMPNodes on the same machine form a mesh,
 * one submits a WASM task, the other executes it remotely, result returns.
 *
 * This proves CMP's entire reason for existing:
 *   Device A submits → Device B executes → Result comes back
 *
 * Usage:
 *   npx tsx examples/04-two-node-compute.ts
 *
 * What happens:
 *   1. Node A and Node B start on different LAN ports
 *   2. They discover each other via UDP multicast
 *   3. Node A submits a WASM computation
 *   4. The WASM module travels to Node B over TCP
 *   5. Node B loads it into a WASM sandbox, executes it
 *   6. Encrypted result comes back to Node A
 *   7. Node A decrypts and assembles the final result
 *
 * All over real UDP/TCP with Ed25519 authentication.
 */

import { CMPNode } from '../packages/core/src/cmp-node';
import { LogLevel } from '../packages/core/src/utils/logger';

// ── Minimal WASM module: process(ptr, len) → len ──
// Identity transform — proves the full pipeline without computation complexity
const PROCESS_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x14, 0x02,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
  0x07, 0x70, 0x72, 0x6f, 0x63, 0x65, 0x73, 0x73, 0x00, 0x00,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x20, 0x01, 0x0b,
]);

async function main() {
  console.log('\n  ════════════════════════════════════════════════');
  console.log('  CMP — Two-Node Distributed Computation Demo');
  console.log('  ════════════════════════════════════════════════\n');

  // ── Step 1: Create two nodes ──
  console.log('  [1] Creating two CMPNodes...');
  const nodeA = new CMPNode({
    transports: ['lan'],
    acceptingTasks: true,
    logLevel: LogLevel.WARN,
    beaconIntervalMs: 500,
    bidWindowMs: 2000,
  });

  const nodeB = new CMPNode({
    transports: ['lan'],
    acceptingTasks: true,
    logLevel: LogLevel.WARN,
    beaconIntervalMs: 500,
    bidWindowMs: 2000,
  });

  await nodeA.start();
  await nodeB.start();

  const idA = nodeA.meshIdHex().substring(0, 8);
  const idB = nodeB.meshIdHex().substring(0, 8);
  console.log(`      Node A: ${idA}`);
  console.log(`      Node B: ${idB}`);

  // ── Step 2: Wait for discovery ──
  console.log('\n  [2] Waiting for peer discovery...');
  await waitUntil(() => nodeA.getStatus().peers > 0 && nodeB.getStatus().peers > 0, 15000);
  console.log(`      Node A sees ${nodeA.getStatus().peers} peer(s)`);
  console.log(`      Node B sees ${nodeB.getStatus().peers} peer(s)`);

  // ── Step 3: Wait for capability exchange ──
  console.log('\n  [3] Exchanging capabilities...');
  await sleep(3000);

  // ── Step 4: Submit computation ──
  console.log('\n  [4] Node A submitting WASM computation to mesh...');
  const inputData = new Uint8Array(64);
  for (let i = 0; i < 64; i++) inputData[i] = i;
  console.log(`      WASM module: ${PROCESS_WASM.length} bytes`);
  console.log(`      Input data:  ${inputData.length} bytes [0,1,2,...,63]`);

  const startTime = Date.now();
  const result = await nodeA.compute(PROCESS_WASM, inputData, {
    entryPoint: 'process',
    deadline: 15000,
    chunkHint: 1,
  });
  const elapsed = Date.now() - startTime;

  // ── Step 5: Show results ──
  console.log(`\n  [5] RESULT:`);
  console.log(`      Status:      ${result.verified ? 'SUCCESS' : 'FAILED'}`);
  console.log(`      Time:        ${elapsed}ms`);
  console.log(`      Chunks:      ${result.chunksExecuted}`);
  console.log(`      Devices:     ${result.devicesUsed}`);
  console.log(`      Output:      ${result.data.length} bytes`);
  console.log(`      Distributed: ${!result.localFallback}`);

  if (!result.localFallback) {
    console.log('\n  ════════════════════════════════════════════════');
    console.log('  ║  DISTRIBUTED COMPUTATION SUCCESSFUL!         ║');
    console.log('  ║                                              ║');
    console.log('  ║  Node A submitted → Node B executed → Result ║');
    console.log('  ║  All over real LAN with Ed25519 auth.        ║');
    console.log('  ════════════════════════════════════════════════');
  } else {
    console.log('\n  [!] Fell back to local execution.');
    console.log('      The API works, but bid timing may need adjustment.');
  }

  // ── Step 6: Check consciousness ──
  const v2a = nodeA.getV2Bridge();
  const v2b = nodeB.getV2Bridge();
  if (v2a && v2b) {
    console.log(`\n  [6] Consciousness after computation:`);
    console.log(`      Node A behavior: ${v2a.getStatus().behavior}`);
    console.log(`      Node B behavior: ${v2b.getStatus().behavior}`);
    console.log(`      Node A pheromones: ${v2a.getStatus().pheromoneCount}`);
    console.log(`      Node B pheromones: ${v2b.getStatus().pheromoneCount}`);
  }

  console.log('\n  [7] Stopping nodes...');
  await nodeA.stop();
  await nodeB.stop();
  console.log('      Done.\n');

  setTimeout(() => process.exit(0), 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function waitUntil(fn: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Discovery timeout'));
      setTimeout(check, 300);
    };
    check();
  });
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
