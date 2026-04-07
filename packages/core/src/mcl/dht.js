"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DHT_REPLICATION = void 0;
exports.xorDistance = xorDistance;
exports.compareDistance = compareDistance;
exports.createDHTNode = createDHTNode;
exports.closestNodes = closestNodes;
exports.replicationTargets = replicationTargets;
const __1 = require("../");
const log = new __1.Logger('DHT');
/** Default replication factor — store on this many peers */
exports.DHT_REPLICATION = 3;
/**
 * Compute XOR distance between two byte arrays.
 * Returns a Uint8Array of the XOR of each byte pair.
 * Used for Kademlia-style routing: closer nodes have smaller XOR distance.
 */
function xorDistance(a, b) {
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
function compareDistance(a, b) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i])
            return a[i] - b[i];
    }
    return a.length - b.length;
}
/**
 * Create a DHTNode from a meshId and peer address.
 */
function createDHTNode(meshId, peerAddress) {
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
function closestNodes(key, nodes, n, excludeId) {
    const excludeHex = excludeId ? (0, __1.toHex)(excludeId) : undefined;
    const candidates = nodes
        .filter(node => {
        if (excludeHex && (0, __1.toHex)(node.meshId) === excludeHex)
            return false;
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
function replicationTargets(key, nodes, selfId, replication = exports.DHT_REPLICATION) {
    const targets = closestNodes(key, nodes, replication, selfId);
    log.debug(`Replication targets for key ${(0, __1.toHex)(key).substring(0, 8)}: ` +
        `${targets.length} nodes (of ${nodes.length} available)`);
    return targets;
}
//# sourceMappingURL=dht.js.map