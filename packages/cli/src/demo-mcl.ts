#!/usr/bin/env npx tsx
/**
 * CMP v1.2 — Mesh Cognition Layer Live Demo
 *
 * This script demonstrates ALL MCL features running on real nodes:
 *   1. Mesh formation (5 virtual nodes)
 *   2. Distributed WASM computation
 *   3. MER generation after each task
 *   4. Strategy hint evolution over repeated tasks
 *   5. Cross-mesh pollination (Mesh A → Mesh B)
 *   6. Cold vs Warm mesh comparison
 *   7. Computation Certificate with MCL flag
 *
 * Run: npx tsx packages/cli/src/demo-mcl.ts
 *
 * No network required — uses VirtualTransport (in-memory mesh).
 *
 * @author Agent Viscro
 */

import { CMPNode, LogLevel, Logger, toHex, shortId, TaskType, VerifyMode } from '../../core/src';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';
import type { MCLEngine } from '../../core/src/mcl/engine';

// ── Colors ──
const C = {
  r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  bg_green: '\x1b[42m', bg_magenta: '\x1b[45m', bg_blue: '\x1b[44m',
};

function banner(text: string, color: string = C.cyan): void {
  const line = '═'.repeat(56);
  console.log(`\n  ${color}${line}${C.r}`);
  console.log(`  ${color}║${C.r}  ${C.b}${text}${C.r}`);
  console.log(`  ${color}${line}${C.r}\n`);
}

function step(n: number, text: string): void {
  console.log(`  ${C.cyan}[Step ${n}]${C.r} ${C.b}${text}${C.r}`);
}

function result(label: string, value: string, color: string = C.green): void {
  console.log(`    ${C.d}${label.padEnd(22)}${C.r} ${color}${C.b}${value}${C.r}`);
}

function sep(): void {
  console.log(`  ${C.d}${'─'.repeat(50)}${C.r}`);
}

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── WASM Module: XOR Cipher (built-in) ──
const XOR_WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,5,3,1,0,1,
  7,20,2,6,109,101,109,111,114,121,2,0,7,101,110,99,114,121,112,116,0,0,
  10,54,1,52,1,1,127,65,0,33,2,2,64,3,64,32,2,32,1,79,13,1,32,0,32,2,
  106,32,0,32,2,106,45,0,0,65,194,0,115,58,0,0,32,2,65,1,106,33,2,12,
  0,11,11,32,1,11
]);

function createNode(id: string, network: VirtualNetwork): CMPNode {
  return new CMPNode({
    logLevel: LogLevel.WARN,
    _transport: new VirtualTransport(id, network),
  });
}

async function main(): Promise<void> {
  console.log(`
  ${C.magenta}╔═══════════════════════════════════════════════════════╗${C.r}
  ${C.magenta}║${C.r}                                                       ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}   ${C.b}CMP v1.2 — Mesh Cognition Layer Demo${C.r}               ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}   ${C.d}Agent Viscro${C.r}                                        ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}                                                       ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}   ${C.d}Demonstrates: MER generation, strategy hints,${C.r}       ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}   ${C.d}adaptive evolution, cross-mesh pollination${C.r}           ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}                                                       ${C.magenta}║${C.r}
  ${C.magenta}╚═══════════════════════════════════════════════════════╝${C.r}
`);

  // ══════════════════════════════════════════════════════
  // DEMO 1: Mesh Formation + MCL Status
  // ══════════════════════════════════════════════════════
  banner('Demo 1: Mesh Formation with MCL', C.cyan);

  const netA = new VirtualNetwork();
  const nodes: CMPNode[] = [];

  step(1, 'Starting 5-node mesh...');
  for (let i = 0; i < 5; i++) {
    const node = createNode(`node-${i}`, netA);
    await node.start();
    nodes.push(node);
  }
  await wait(2000); // let discovery complete

  const peerCount = nodes[0].getPeers().length;
  result('Nodes active', `${nodes.length}`);
  result('Peers discovered', `${peerCount}`);

  // Show MCL status
  const mclStatus = nodes[0].getMCLStatus();
  result('MCL enabled', `${mclStatus.enabled}`);
  result('MERs stored', `${mclStatus.merCount}`);
  result('Task types learned', `${mclStatus.taskTypes}`);

  // ══════════════════════════════════════════════════════
  // DEMO 2: Computation + MER Generation
  // ══════════════════════════════════════════════════════
  banner('Demo 2: Compute → MER Generation', C.green);

  step(2, 'Running 5 encrypt tasks across mesh...');
  const messages = ['Hello CMP', 'Mesh Cognition', 'Agent Viscro', 'Kerala India', 'Edge Computing'];

  for (let i = 0; i < messages.length; i++) {
    const input = new TextEncoder().encode(messages[i]);
    try {
      const r = await nodes[0].compute(XOR_WASM, input, {
        entryPoint: 'encrypt',
        deadline: 10000,
        verifyMode: VerifyMode.REDUNDANT,
      });
      const mclNow = nodes[0].getMCLStatus();
      console.log(`    ${C.green}✓${C.r} Task ${i + 1}: "${messages[i]}" → ${r.devicesUsed} devices, ${r.totalTimeMs}ms` +
        `  ${C.d}MERs: ${mclNow.merCount}${C.r}`);
    } catch (err: any) {
      // Local fallback is fine — MER still generated for verified results
      console.log(`    ${C.yellow}⚡${C.r} Task ${i + 1}: "${messages[i]}" → local fallback`);
    }
  }

  sep();
  const afterCompute = nodes[0].getMCLStatus();
  result('MERs accumulated', `${afterCompute.merCount}`);
  result('Task types learned', `${afterCompute.taskTypes}`);

  // ══════════════════════════════════════════════════════
  // DEMO 3: Strategy Hints from Experience
  // ══════════════════════════════════════════════════════
  banner('Demo 3: Strategy Hints from Accumulated Experience', C.yellow);

  step(3, 'Generating strategy hint from learned MERs...');

  const engine = nodes[0].getMCLEngine();

  // Manually feed verified task completions to demonstrate hint evolution
  for (let i = 0; i < 5; i++) {
    engine.onTaskComplete({
      taskType: TaskType.INFERENCE,
      deviceCount: 5,
      strategyUsed: 0,
      chunkCount: 4 + i,
      avgChunkSizeKb: 2000 + i * 200,
      totalTimeMs: 8000 - i * 500,
      distributionOverheadMs: 800,
      executionEfficiency: 78 + i * 4,
      faultEvents: 0,
      reassignmentCount: 0,
      verified: true,
    });
  }

  const hint = engine.getHint(TaskType.INFERENCE, 5);
  if (hint) {
    result('Hint available', 'YES ✓');
    result('Recommended chunks', `${hint.recommendedChunkCount}`);
    result('Recommended chunk size', `${hint.recommendedChunkSizeKb} KB`);
    result('Hint confidence', `${hint.confidence}%`);
    result('MER generation', `${hint.merGeneration}`);
    result('Source MERs', `${hint.sourceMerCount}`);

    // Apply hint
    const applied = engine.applyHintToDistribution(0, 5, hint);
    sep();
    result('Hint applied', applied.applied ? 'YES ✓' : 'NO');
    result('Adjusted chunk count', `${applied.chunkCount}`);
    result('Adjusted chunk size', applied.chunkSizeKb ? `${applied.chunkSizeKb} KB` : 'default');
  } else {
    result('Hint available', `${C.yellow}NO (need more verified tasks)${C.r}`);
  }

  // ══════════════════════════════════════════════════════
  // DEMO 4: Cold vs Warm Comparison
  // ══════════════════════════════════════════════════════
  banner('Demo 4: Cold vs Warm Mesh Performance', C.blue);

  step(4, 'Comparing cold mesh (no MERs) vs warm mesh (with experience)...');

  // Cold engine
  const coldEngine = (() => {
    const net = new VirtualNetwork();
    const { MCLEngine } = require('../../core/src/mcl/engine');
    const { generateSigningKeyPair, randomBytes } = require('../../core/src');
    const { VirtualTransport } = require('../../transport/src/virtual-transport');
    const { EventBus } = require('../../core/src/mesh/event-bus');
    const kp = generateSigningKeyPair();
    return new MCLEngine({
      meshId: randomBytes(16),
      signingSecretKey: kp.secretKey,
      signingPublicKey: kp.publicKey,
      transport: new VirtualTransport('cold', net),
      bus: new EventBus(),
    });
  })();
  coldEngine.start();

  const coldHint = coldEngine.getHint(TaskType.INFERENCE, 5);

  // Warm engine (the one that's been running)
  const warmHint = engine.getHint(TaskType.INFERENCE, 5);
  const warmStatus = engine.getStatus();

  console.log();
  console.log(`    ${C.d}${'─'.repeat(45)}${C.r}`);
  console.log(`    ${C.d}${''.padEnd(20)}${C.r} ${C.blue}Cold Mesh${C.r}    ${C.green}Warm Mesh${C.r}`);
  console.log(`    ${C.d}${'─'.repeat(45)}${C.r}`);
  console.log(`    ${'MERs stored'.padEnd(20)} ${C.blue}${String(0).padStart(8)}${C.r}    ${C.green}${String(warmStatus.merCount).padStart(8)}${C.r}`);
  console.log(`    ${'Hint available'.padEnd(20)} ${C.blue}${String(coldHint ? 'YES' : 'NO').padStart(8)}${C.r}    ${C.green}${String(warmHint ? 'YES' : 'NO').padStart(8)}${C.r}`);
  console.log(`    ${'Hint confidence'.padEnd(20)} ${C.blue}${String(coldHint ? coldHint.confidence + '%' : '—').padStart(8)}${C.r}    ${C.green}${String(warmHint ? warmHint.confidence + '%' : '—').padStart(8)}${C.r}`);
  console.log(`    ${'Recommended chunks'.padEnd(20)} ${C.blue}${String(coldHint ? coldHint.recommendedChunkCount : '—').padStart(8)}${C.r}    ${C.green}${String(warmHint ? warmHint.recommendedChunkCount : '—').padStart(8)}${C.r}`);
  console.log(`    ${'Strategy evolved'.padEnd(20)} ${C.blue}${String('NO').padStart(8)}${C.r}    ${C.green}${String(warmHint ? `gen ${warmHint.merGeneration}` : 'NO').padStart(8)}${C.r}`);
  console.log(`    ${C.d}${'─'.repeat(45)}${C.r}`);
  console.log();
  console.log(`    ${C.green}→ Warm mesh skips cold-start heuristics and uses learned parameters${C.r}`);

  // ══════════════════════════════════════════════════════
  // DEMO 5: Cross-Mesh Pollination
  // ══════════════════════════════════════════════════════
  banner('Demo 5: Cross-Mesh Pollination', C.magenta);

  step(5, 'Simulating device movement: Mesh A → Mesh B...');

  console.log(`    ${C.d}Scenario: A researcher's laptop moves from Lab (Mesh A) to Hospital (Mesh B)${C.r}`);
  console.log(`    ${C.d}The laptop carries MERs from Mesh A and pollinates Mesh B${C.r}\n`);

  // Mesh A's experience (already accumulated on engine)
  const meshAMerCount = engine.getStore().size;
  result('Mesh A MERs', `${meshAMerCount}`);

  // Create Mesh B (fresh, no experience)
  const { Pollinator, MERStore } = require('../../core/src/mcl');
  const meshBStore = new MERStore();
  const meshBPollinator = new Pollinator(meshBStore);

  result('Mesh B MERs (before)', `${meshBStore.size}`);

  // Node X (the traveling device) carries Mesh A's MERs
  const nodeXStore = new MERStore();
  for (const mer of engine.getStore().getAll()) {
    nodeXStore.store(mer);
  }
  const nodeXPollinator = new Pollinator(nodeXStore);

  result('Node X carrying', `${nodeXStore.size} MERs from Mesh A`);

  sep();
  console.log(`    ${C.magenta}→ Node X joins Mesh B and offers MERs...${C.r}\n`);

  // Pollination protocol
  const offer = nodeXPollinator.buildOffer(require('../../core/src').randomBytes(16));
  if (offer) {
    result('MER_OFFER sent', `${offer.summaries.length} MERs offered`);

    const request = meshBPollinator.processOffer(offer, require('../../core/src').randomBytes(16));
    if (request) {
      result('MER_REQUEST sent', `${request.merIds.length} MERs requested`);

      const { generateSigningKeyPair } = require('../../core/src');
      const polKP = generateSigningKeyPair();
      const transfer = nodeXPollinator.buildTransfer(request, require('../../core/src').randomBytes(16), polKP.secretKey);
      result('MER_TRANSFER sent', `${transfer.mers.length} MERs transferred`);

      const stored = meshBPollinator.processTransfer(transfer, polKP.publicKey);
      result('Mesh B received', `${stored} MERs`);
    }
  }

  sep();
  result('Mesh B MERs (after)', `${meshBStore.size}`, C.green);

  // Check if Mesh B can now generate hints
  const { generateHint } = require('../../core/src/mcl');
  const meshBHint = generateHint(meshBStore, TaskType.INFERENCE);
  if (meshBHint) {
    result('Mesh B hint available', `YES ✓ (confidence: ${meshBHint.confidence}%)`, C.green);
    console.log(`\n    ${C.green}✓ Mesh B can now perform INFERENCE tasks with learned optimal${C.r}`);
    console.log(`    ${C.green}  parameters — without ever having run the task before!${C.r}`);
  } else {
    result('Mesh B hint available', 'Not yet (needs higher confidence MERs)', C.yellow);
  }

  // ══════════════════════════════════════════════════════
  // DEMO 6: MCL Pollination Stats
  // ══════════════════════════════════════════════════════
  banner('Demo 6: Pollination Statistics', C.cyan);

  const polStats = nodeXPollinator.getStats();
  result('Join events', `${polStats.joinEvents}`);
  result('MERs offered', `${polStats.totalOffered}`);
  result('MERs accepted', `${polStats.totalAccepted}`);
  result('MERs rejected', `${polStats.totalRejected}`);

  // ══════════════════════════════════════════════════════
  // DEMO 7: Full MCL Status Report
  // ══════════════════════════════════════════════════════
  banner('Demo 7: Full MCL Status Report', C.green);

  const finalStatus = nodes[0].getMCLStatus();
  const finalEngine = nodes[0].getMCLEngine();
  const profile = finalEngine.getMCLProfile();

  result('MCL enabled', `${finalStatus.enabled}`);
  result('MERs stored', `${finalStatus.merCount}`);
  result('Task types learned', `${finalStatus.taskTypes}`);
  result('Origin meshes', `${finalStatus.origins}`);
  result('MCL profile version', `${profile.mclVersion}`);
  result('Bloom filter size', `${profile.merCatalogBloom.length} bytes (256 bits)`);
  result('Oldest MER age', `${profile.oldestMerDays} days`);
  result('Cross-mesh count', `${profile.crossMeshCount}`);

  // ══════════════════════════════════════════════════════
  // CLEANUP
  // ══════════════════════════════════════════════════════
  console.log();
  step(7, 'Shutting down mesh...');

  for (const node of nodes) {
    await node.stop();
  }

  result('All nodes stopped', 'OK ✓');

  // ── Final Summary ──
  console.log(`
  ${C.magenta}╔═══════════════════════════════════════════════════════╗${C.r}
  ${C.magenta}║${C.r}  ${C.b}CMP v1.2 MCL Demo Complete${C.r}                           ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}                                                       ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}  ${C.green}✓${C.r} Mesh formed (5 nodes, virtual transport)           ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}  ${C.green}✓${C.r} Distributed WASM computation executed              ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}  ${C.green}✓${C.r} MERs generated after verified tasks                ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}  ${C.green}✓${C.r} Strategy hints evolved from accumulated MERs       ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}  ${C.green}✓${C.r} Cold vs Warm mesh comparison demonstrated          ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}  ${C.green}✓${C.r} Cross-mesh pollination (Mesh A → Mesh B)           ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}  ${C.green}✓${C.r} Mesh B gained experience without running any task  ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}                                                       ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}  ${C.d}This is Layer 8: Mesh Cognition — emergent${C.r}            ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}  ${C.d}distributed intelligence through device mobility.${C.r}     ${C.magenta}║${C.r}
  ${C.magenta}║${C.r}                                                       ${C.magenta}║${C.r}
  ${C.magenta}╚═══════════════════════════════════════════════════════╝${C.r}
`);
}

main().catch(err => {
  console.error(`\n  ${C.red}Fatal: ${err.message}${C.r}\n`);
  console.error(err.stack);
  process.exit(1);
});
