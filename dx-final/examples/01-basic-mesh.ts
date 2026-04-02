#!/usr/bin/env npx tsx
/**
 * Example 1: Basic Mesh
 *
 * Start a CMP node, discover nearby devices, show status.
 * Run this on two computers on the same WiFi to see them find each other.
 *
 * Usage:
 *   npx tsx examples/01-basic-mesh.ts
 *
 * On a second computer (same WiFi):
 *   npx tsx examples/01-basic-mesh.ts
 *
 * You'll see "Peers: 1" appear on both.
 */

import { CMPNode } from '../packages/core/src/cmp-node';
import { LogLevel } from '../packages/core/src/utils/logger';

async function main() {
  // Create a mesh node
  const node = new CMPNode({
    transports: ['lan'],
    acceptingTasks: true,
    logLevel: LogLevel.WARN,
  });

  // Start — this begins broadcasting and scanning for peers
  await node.start();
  const meshId = node.meshIdHex().substring(0, 16);

  console.log(`\n  ✓ CMP Node started: ${meshId}`);
  console.log(`  Scanning for nearby devices...\n`);

  // Check for peers every 2 seconds
  let lastPeerCount = 0;
  const interval = setInterval(() => {
    const status = node.getStatus();
    if (status.peers !== lastPeerCount) {
      lastPeerCount = status.peers;
      console.log(`  → Found ${status.peers} peer(s)!`);
    }
  }, 2000);

  // Show status after 10 seconds
  await sleep(10000);
  clearInterval(interval);

  const status = node.getStatus();
  console.log(`\n  ── Mesh Status ──`);
  console.log(`  Node:       ${meshId}`);
  console.log(`  Peers:      ${status.peers}`);
  console.log(`  Credits:    ${status.credits} CCU`);
  console.log(`  Reputation: ${status.reputation}/10000`);
  console.log(`  Uptime:     ${Math.floor(status.uptime / 1000)}s`);

  // V2 status
  const v2 = node.getV2Bridge();
  if (v2) {
    const v2s = v2.getStatus();
    console.log(`  Behavior:   ${v2s.behavior}`);
    console.log(`  Pheromones: ${v2s.pheromoneCount}`);
  }

  console.log(`\n  Stopping...\n`);
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
