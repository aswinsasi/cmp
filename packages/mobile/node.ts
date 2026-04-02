/**
 * CMP Mobile — Real CMPNode on React Native
 *
 * This is NOT a simplified reimplementation. This creates a REAL
 * CMPNode with the full 13-layer protocol stack, running on a phone
 * over BLE transport.
 *
 * Usage in React Native:
 *
 *   import { createMobileNode, MobileNode } from 'cmp/packages/mobile/node';
 *
 *   const { node, v2 } = await createMobileNode();
 *   // node is a real CMPNode — same as the CLI
 *   // v2 is the V2Bridge — consciousness, spacetime, wormholes
 *
 *   const result = await node.compute(wasmModule, inputData);
 *   const status = node.getStatus();
 *   const behavior = v2.getStatus().behavior;
 *
 * What works on mobile:
 *   ✓ All 13 protocol layers
 *   ✓ Ed25519 authentication (tweetnacl fallback)
 *   ✓ BLE discovery and data transfer
 *   ✓ Flow control
 *   ✓ Negotiation, distribution, assembly
 *   ✓ Consciousness (pheromones, quorum, swarm decisions)
 *   ✓ Spacetime (DAG, forking, racing)
 *   ✓ Wormholes (federation, teleportation)
 *   ✓ WASM execution (on JSC engine — iOS and Android with JSC)
 *
 * What doesn't work yet:
 *   ✗ WASM on Hermes engine (Hermes doesn't support WebAssembly)
 *   ✗ SQLite persistence (operates in-memory only)
 *   ✗ Multi-runtime (Python, Shell, etc. — WASM only on mobile)
 *
 * @module mobile/node
 * @author Agent Viscro
 */

import { CMPNode } from '../core/src/cmp-node';
import { V2Bridge } from '../core/src/v2-bridge';
import { BLERNTransport } from '../transport/src/ble-rn-transport';
import { LogLevel } from '../core/src/utils/logger';

export interface MobileNode {
  /** The real CMPNode — full 13-layer stack */
  node: CMPNode;
  /** V2 Bridge — Layers 11-13 */
  v2: V2Bridge;
  /** BLE transport for direct access */
  transport: BLERNTransport;
}

/**
 * Create a real CMPNode running on BLE transport.
 *
 * @param options.logLevel - Log verbosity (default: INFO)
 * @param options.acceptingTasks - Whether to accept tasks from peers (default: true)
 */
export async function createMobileNode(options?: {
  logLevel?: LogLevel;
  acceptingTasks?: boolean;
}): Promise<MobileNode> {
  const transport = new BLERNTransport();

  const node = new CMPNode({
    _transport: transport,
    transports: [],
    acceptingTasks: options?.acceptingTasks ?? true,
    logLevel: options?.logLevel ?? LogLevel.INFO,
    beaconIntervalMs: 3000,
    bidWindowMs: 2000,
    peerStaleMs: 30000,
    peerDeadMs: 60000,
    heartbeatIntervalMs: 5000,
  });

  // V2Bridge is created automatically inside CMPNode (from the patched version)
  const v2 = node.getV2Bridge()!;

  return { node, v2, transport };
}

/**
 * Stop a mobile node cleanly.
 */
export async function stopMobileNode(mobile: MobileNode): Promise<void> {
  await mobile.node.stop();
}

/**
 * Get a comprehensive status object suitable for React Native UI.
 */
export function getMobileStatus(mobile: MobileNode) {
  const nodeStatus = mobile.node.getStatus();
  const v2Status = mobile.v2.getStatus();

  return {
    // Node
    meshId: nodeStatus.meshId,
    running: nodeStatus.running,
    peers: nodeStatus.peers,
    uptime: nodeStatus.uptime,
    credits: nodeStatus.credits,
    reputation: nodeStatus.reputation,

    // Resources
    cores: nodeStatus.resources.totalCores,
    memoryMb: nodeStatus.resources.totalMemoryMb,

    // Consciousness (Layer 11)
    behavior: v2Status.behavior,
    pheromoneCount: v2Status.pheromoneCount,
    dominantPheromone: v2Status.dominantPheromone,
    activeQuorums: v2Status.activeQuorums,
    pendingDecisions: v2Status.pendingDecisions,

    // Spacetime (Layer 12)
    dagNodes: v2Status.dagNodes,
    activeBranches: v2Status.activeBranches,
    activeRaces: v2Status.activeRaces,

    // Wormholes (Layer 13)
    remoteMeshes: v2Status.remoteMeshes,
    activeWormholes: v2Status.activeWormholes,
    crossSynapses: v2Status.crossSynapses,
  };
}
