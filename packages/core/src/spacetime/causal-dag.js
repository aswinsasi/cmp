"use strict";
/**
 * CMP v2.0 — Causal Merkle DAG
 *
 * Every cause execution becomes a node in a content-addressed DAG.
 * Any historical state can be reconstructed from the DAG root.
 *
 * Properties:
 *   - Immutable: nodes are never modified after creation
 *   - Content-addressed: hash = f(parentHash, causeId, stateHash, resultHash)
 *   - Branching: multiple heads (like git branches)
 *   - Verifiable: anyone with the DAG can verify computation history
 *   - Prunable: old nodes can be evicted while preserving recent history
 *
 * @module spacetime/causal-dag
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CausalMerkleDAG = void 0;
const spacetime_1 = require("../types/spacetime");
// ─── Helpers ───
function randomId() {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < 8; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
/**
 * Simple SHA-256-like hash for content addressing.
 * Uses FNV-1a for speed in non-crypto context. In production,
 * swap with native SHA-256 from crypto module.
 */
function contentHash(...parts) {
    const input = parts.join(':');
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    // Convert to hex and pad to look like a hash
    const h1 = (hash >>> 0).toString(16).padStart(8, '0');
    // Second pass for more bits
    let hash2 = 0xcbf29ce484222325n;
    for (let i = 0; i < input.length; i++) {
        hash2 ^= BigInt(input.charCodeAt(i));
        hash2 = (hash2 * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    const h2 = hash2.toString(16).padStart(16, '0');
    return h1 + h2;
}
// ─── Causal Merkle DAG ───
class CausalMerkleDAG {
    /** All nodes: hash → DAGNode */
    nodes = new Map();
    /** Branch heads: branchId → latest node hash */
    heads = new Map();
    /** Branch sequences: branchId → next sequence number */
    sequences = new Map();
    /** Genesis node hash */
    genesisHash = '';
    config;
    constructor(config) {
        this.config = { ...spacetime_1.DEFAULT_SPACETIME_CONFIG, ...config };
    }
    // ── Append ──
    /**
     * Append a new node to the DAG on a specific branch.
     * Returns the content hash of the new node.
     */
    append(branchId, causeId, stateHash, resultHash, executionTimeMs, ccuCost, stateSnapshot) {
        const parentHash = this.heads.get(branchId) || '';
        const sequence = this.sequences.get(branchId) || 0;
        const hash = contentHash(parentHash, causeId, stateHash, resultHash, String(sequence));
        const node = {
            hash,
            parentHash,
            causeId,
            stateHash,
            resultHash,
            branchId,
            sequence,
            timestamp: Date.now(),
            executionTimeMs,
            ccuCost,
            stateSnapshot: (sequence % this.config.snapshotEveryN === 0) ? stateSnapshot : undefined,
        };
        this.nodes.set(hash, node);
        this.heads.set(branchId, hash);
        this.sequences.set(branchId, sequence + 1);
        if (this.genesisHash === '' && parentHash === '') {
            this.genesisHash = hash;
        }
        // Prune if over limit
        if (this.nodes.size > this.config.maxDAGNodes) {
            this.prune();
        }
        return node;
    }
    // ── Query ──
    /** Get a node by hash */
    getNode(hash) {
        return this.nodes.get(hash) || null;
    }
    /** Get the head node of a branch */
    getHead(branchId) {
        const hash = this.heads.get(branchId);
        return hash ? (this.nodes.get(hash) || null) : null;
    }
    /** Get all nodes in a branch (in order) */
    getBranchHistory(branchId) {
        const history = [];
        let currentHash = this.heads.get(branchId);
        while (currentHash) {
            const node = this.nodes.get(currentHash);
            if (!node)
                break;
            history.unshift(node); // prepend to get chronological order
            currentHash = node.parentHash || undefined;
        }
        return history;
    }
    /** Get the most recent N nodes on a branch */
    getRecentNodes(branchId, n) {
        const nodes = [];
        let currentHash = this.heads.get(branchId);
        while (currentHash && nodes.length < n) {
            const node = this.nodes.get(currentHash);
            if (!node)
                break;
            nodes.push(node);
            currentHash = node.parentHash || undefined;
        }
        return nodes; // most recent first
    }
    /** Find a node with a state snapshot at or before a given sequence */
    findNearestSnapshot(branchId, beforeSequence) {
        // Walk backward from the head to find a node with a snapshot
        let currentHash = this.heads.get(branchId);
        while (currentHash) {
            const node = this.nodes.get(currentHash);
            if (!node || node.sequence > beforeSequence) {
                if (node)
                    currentHash = node.parentHash || undefined;
                else
                    break;
                continue;
            }
            if (node.stateSnapshot !== undefined)
                return node;
            currentHash = node.parentHash || undefined;
        }
        return null;
    }
    /** Verify a node's content hash is correct */
    verifyNode(node) {
        const expected = contentHash(node.parentHash, node.causeId, node.stateHash, node.resultHash, String(node.sequence));
        return expected === node.hash;
    }
    /** Verify an entire branch's chain integrity */
    verifyBranch(branchId) {
        const history = this.getBranchHistory(branchId);
        for (let i = 0; i < history.length; i++) {
            if (!this.verifyNode(history[i])) {
                return { valid: false, invalidAt: history[i].hash };
            }
            // Check parent linkage
            if (i > 0 && history[i].parentHash !== history[i - 1].hash) {
                return { valid: false, invalidAt: history[i].hash };
            }
        }
        return { valid: true };
    }
    // ── Branch Management ──
    /** Create a new branch forking from a specific node */
    createBranch(branchId, forkFromHash) {
        if (this.heads.has(branchId))
            return false; // Branch already exists
        const forkNode = this.nodes.get(forkFromHash);
        if (!forkNode)
            return false;
        this.heads.set(branchId, forkFromHash);
        this.sequences.set(branchId, forkNode.sequence + 1);
        return true;
    }
    /** Get all branch IDs */
    getBranchIds() {
        return [...this.heads.keys()];
    }
    /** Get branch length (nodes since genesis or fork) */
    getBranchLength(branchId) {
        return this.sequences.get(branchId) || 0;
    }
    /** Remove a branch (keeps shared nodes, removes branch-exclusive nodes) */
    removeBranch(branchId) {
        const branchNodes = [...this.nodes.values()].filter(n => n.branchId === branchId);
        let removed = 0;
        for (const node of branchNodes) {
            this.nodes.delete(node.hash);
            removed++;
        }
        this.heads.delete(branchId);
        this.sequences.delete(branchId);
        return removed;
    }
    // ── DAG Info ──
    /** Get DAG metadata */
    getInfo() {
        let totalComputeMs = 0;
        let totalCcu = 0;
        for (const [, node] of this.nodes) {
            totalComputeMs += node.executionTimeMs;
            totalCcu += node.ccuCost;
        }
        return {
            totalNodes: this.nodes.size,
            branchCount: this.heads.size,
            heads: new Map(this.heads),
            genesisHash: this.genesisHash,
            totalComputeMs,
            totalCcu,
        };
    }
    /** Total number of nodes in the DAG */
    get size() {
        return this.nodes.size;
    }
    /** Clear the entire DAG */
    clear() {
        this.nodes.clear();
        this.heads.clear();
        this.sequences.clear();
        this.genesisHash = '';
    }
    // ── Internal ──
    /** Prune oldest nodes to stay within limits */
    prune() {
        // Sort all nodes by timestamp, remove the oldest 10%
        const allNodes = [...this.nodes.values()].sort((a, b) => a.timestamp - b.timestamp);
        const pruneCount = Math.ceil(allNodes.length * 0.1);
        for (let i = 0; i < pruneCount; i++) {
            this.nodes.delete(allNodes[i].hash);
            // Update genesis if we pruned it
            if (allNodes[i].hash === this.genesisHash && allNodes.length > pruneCount) {
                this.genesisHash = allNodes[pruneCount].hash;
            }
        }
    }
}
exports.CausalMerkleDAG = CausalMerkleDAG;
//# sourceMappingURL=causal-dag.js.map