/**
 * CMP Distributed Hash Table (Lightweight)
 * Simple DHT for MER distribution in small meshes (5-50 nodes).
 *
 * NOT a full Kademlia implementation — CMP meshes are small and ephemeral,
 * so we use a simplified approach:
 *   - XOR distance for peer selection (Kademlia-style)
 *   - Replicate to min(3, mesh_size - 1) closest peers
 *   - No routing tables, no iterative lookups
 *
 * The DHT keys are 8-byte hashes derived from (taskType, meshSignature).
 * Each key maps to one or more MERs stored on the closest nodes.
 *
 * @module mcl/dht
 * @author Agent Viscro
 */

import { toHex, Logger } from '../';
import { merDHTKey } from './mer';

const log = new Logger('DHT');

/** Default replication factor — store on this many peers */
export const DHT_REPLICATION = 3;

/**
 * Compute XOR distance between two byte arrays.
 * Returns a Uint8Array of the XOR of each byte pair.
 * Used for Kademlia-style routing: closer nodes have smaller XOR distance.
 */
export function xorDistance(a: Uint8Array, b: Uint8Array): Uint8Array {
  const len = Math.min(a.length, b.length);
  const result = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

/**
 * Compare two XOR distances.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 * Compares byte-by-byte from most significant.
 */
export function compareDistance(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Node identity for DHT operations.
 * Uses the first 8 bytes of meshId as DHT address (matching MER key size).
 */
export interface DHTNode {
  /** Full mesh ID (16 bytes) */
  meshId: Uint8Array;
  /** DHT address: first 8 bytes of meshId (matches MER key size) */
  dhtAddress: Uint8Array;
  /** Transport address for sending messages */
  peerAddress: string;
}

/**
 * Create a DHTNode from a meshId and peer address.
 */
export function createDHTNode(meshId: Uint8Array, peerAddress: string): DHTNode {
  return {
    meshId,
    dhtAddress: meshId.slice(0, 8),
    peerAddress,
  };
}

/**
 * Find the N closest nodes to a given DHT key, sorted by XOR distance.
 *
 * @param key - 8-byte DHT key (from merDHTKey())
 * @param nodes - Available nodes to select from
 * @param n - Number of closest nodes to return
 * @param excludeId - Optional meshId to exclude (e.g., self)
 * @returns Array of up to N closest nodes, sorted closest first
 */
export function closestNodes(
  key: Uint8Array,
  nodes: DHTNode[],
  n: number,
  excludeId?: Uint8Array
): DHTNode[] {
  const excludeHex = excludeId ? toHex(excludeId) : undefined;

  const candidates = nodes
    .filter(node => {
      if (excludeHex && toHex(node.meshId) === excludeHex) return false;
      return true;
    })
    .map(node => ({
      node,
      distance: xorDistance(key, node.dhtAddress),
    }))
    .sort((a, b) => compareDistance(a.distance, b.distance));

  return candidates.slice(0, n).map(c => c.node);
}

/**
 * Determine which nodes should store a MER based on its DHT key.
 * Returns min(replication, available_nodes) closest nodes.
 *
 * @param key - 8-byte DHT key
 * @param nodes - All available mesh nodes
 * @param selfId - This node's meshId (excluded from targets)
 * @param replication - Number of replicas (default: 3)
 */
export function replicationTargets(
  key: Uint8Array,
  nodes: DHTNode[],
  selfId: Uint8Array,
  replication: number = DHT_REPLICATION
): DHTNode[] {
  const targets = closestNodes(key, nodes, replication, selfId);
  log.debug(`Replication targets for key ${toHex(key).substring(0, 8)}: ` +
    `${targets.length} nodes (of ${nodes.length} available)`);
  return targets;
}
