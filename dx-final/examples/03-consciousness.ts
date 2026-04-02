#!/usr/bin/env npx tsx
/**
 * Example 3: Collective Consciousness
 *
 * Watch the mesh "think" — pheromone trails form, the mesh shifts
 * between behavioral states based on collective activity.
 *
 * This demonstrates Layer 11 (Consciousness) in action:
 *   - Pheromones deposited on computation success/failure
 *   - The mesh detects patterns and shifts behavior
 *   - No voting, no leaders — emergent coordination
 *
 * Usage:
 *   npx tsx examples/03-consciousness.ts
 */

import { CMPNode } from '../packages/core/src/cmp-node';
import { LogLevel } from '../packages/core/src/utils/logger';
import { PheromoneType } from '../packages/core/src/types/consciousness';

async function main() {
  const node = new CMPNode({
    transports: ['lan'],
    acceptingTasks: true,
    logLevel: LogLevel.WARN,
  });

  await node.start();
  const v2 = node.getV2Bridge();
  if (!v2) {
    console.log('  V2 Bridge not available');
    process.exit(1);
  }

  console.log(`\n  ✓ CMP Node started: ${node.meshIdHex().substring(0, 16)}`);
  console.log(`  Layer 11: Collective Consciousness active\n`);

  // ── Phase 1: Normal operation — deposit success pheromones ──
  console.log('  ── Phase 1: Simulating successful computations ──');
  for (let i = 0; i < 5; i++) {
    v2.consciousness.recordSuccess();
    await sleep(200);
    const reading = v2.consciousness.pheromones.read(PheromoneType.COMPUTE_SUCCESS);
    const bar = '█'.repeat(Math.round(reading.totalConcentration * 5));
    console.log(`  Task ${i + 1} succeeded → success pheromone: ${bar} ${reading.totalConcentration.toFixed(2)}`);
  }

  let status = v2.getStatus();
  console.log(`\n  Mesh behavior: ${status.behavior}`);
  console.log(`  Pheromones: ${status.pheromoneCount} active\n`);

  // ── Phase 2: Simulate threat — deposit danger pheromones ──
  console.log('  ── Phase 2: Simulating threat detection ──');
  for (let i = 0; i < 6; i++) {
    v2.consciousness.recordThreat(0.9);
    await sleep(200);
    const reading = v2.consciousness.pheromones.read(PheromoneType.DANGER);
    const bar = '█'.repeat(Math.round(reading.totalConcentration * 3));
    console.log(`  Threat ${i + 1} detected → danger pheromone: ${bar} ${reading.totalConcentration.toFixed(2)}`);
  }

  // Wait for emergence evaluation
  console.log('\n  Waiting for emergence evaluation...');
  await sleep(11000);

  status = v2.getStatus();
  console.log(`\n  Mesh behavior: ${status.behavior.toUpperCase()}`);
  if (status.behavior === 'defensive') {
    console.log('  → The mesh detected widespread danger and shifted to DEFENSIVE mode!');
    console.log('  → No voting happened. No leader decided. This is emergent behavior.');
  }

  // ── Phase 3: Show full pheromone field ──
  console.log('\n  ── Pheromone Field ──');
  const readings = v2.consciousness.pheromones.readAll();
  for (const r of readings) {
    const bar = '█'.repeat(Math.min(30, Math.round(r.totalConcentration * 5)));
    console.log(`  ${r.type.padEnd(20)} ${bar} ${r.totalConcentration.toFixed(2)} (${r.depositCount} deposits)`);
  }

  // ── Phase 4: Swarm decision ──
  console.log('\n  ── Phase 4: Swarm Decision ──');
  console.log('  Initiating mesh-wide decision: "Should we scale up?"');
  const decision = v2.consciousness.swarm.initiate(
    'Should we scale up?',
    ['yes', 'no', 'wait'],
  );
  console.log(`  Decision ID: ${decision.id}`);
  console.log(`  Waiting for sampling window...`);
  await sleep(6000);

  const decided = v2.consciousness.swarm.getDecided();
  if (decided.length > 0) {
    const d = decided[0];
    console.log(`  Result: ${d.result?.winner} (confidence: ${d.result?.confidence.toFixed(2)})`);
  }

  console.log('\n  ══════════════════════════════════════');
  console.log('  The mesh has a mind of its own.');
  console.log('  ══════════════════════════════════════\n');

  await node.stop();
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
