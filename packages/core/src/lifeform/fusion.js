"use strict";
/**
 * CMP v1.4 — Fusion/Fission Engine
 * Completely unprecedented: two independent Lifeforms MERGE into a
 * single composite entity (Fusion) and later SPLIT back (Fission).
 *
 * Fusion Protocol:
 *   T0  A proposes fusion with B
 *   T1  B accepts or rejects
 *   T2  State merge (CRDT merge — conflict-free)
 *   T3  Genome composition (both WASM modules loaded)
 *   T4  CCU pooling (contribution ratio + escrow)
 *   T5  Synapse transfer (all connections redirect to composite)
 *   T6  Composite spawns, components enter FUSED state
 *   T7  DNS redirects: old names → composite name
 *
 * Fission Protocol:
 *   T0  Trigger (manual, timer, low CCU, intent satisfied)
 *   T1  State partition by namespace prefix
 *   T2  CCU division (escrow returned + earned split by ratio)
 *   T3  Synapse partition
 *   T4  Components respawn independently
 *   T5  DNS redirects cleared
 *
 * @module lifeform/fusion
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FusionEngine = exports.FusionStatus = void 0;
const fusion_1 = require("../types/fusion");
const crdt_state_1 = require("./crdt/crdt-state");
const crypto_1 = require("./crypto");
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomBytes(n) {
    const bytes = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < n; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}
var FusionStatus;
(function (FusionStatus) {
    FusionStatus["PROPOSED"] = "proposed";
    FusionStatus["ACCEPTED"] = "accepted";
    FusionStatus["EXECUTING"] = "executing";
    FusionStatus["ACTIVE"] = "active";
    FusionStatus["FISSIONING"] = "fissioning";
    FusionStatus["COMPLETED"] = "completed";
    FusionStatus["REJECTED"] = "rejected";
    FusionStatus["EXPIRED"] = "expired";
})(FusionStatus || (exports.FusionStatus = FusionStatus = {}));
// ─── Fusion Engine ───
class FusionEngine {
    /** proposalId hex → FusionRecord */
    proposals = new Map();
    /** compositeId hex → FusionRecord (for active fusions) */
    activeFusions = new Map();
    /** componentId hex → compositeId hex (reverse lookup) */
    componentToComposite = new Map();
    /** Stats */
    totalProposals = 0;
    totalFusions = 0;
    totalFissions = 0;
    totalRejections = 0;
    // ═══════════════════════════════════════
    // Propose
    // ═══════════════════════════════════════
    /**
     * Create a fusion proposal.
     */
    propose(proposerSoul, targetId, config, expiresInMs = 60000) {
        const proposal = {
            id: (0, crypto_1.generateId)(),
            proposerId: proposerSoul.id,
            targetId,
            fusionConfig: config,
            proposerSignature: (0, crypto_1.signObject)({ proposerId: proposerSoul.id, targetId, config }, proposerSoul.secretKey),
            proposedAt: Date.now(),
            expiresAt: Date.now() + expiresInMs,
        };
        const record = {
            proposal,
            status: FusionStatus.PROPOSED,
            soulA: proposerSoul,
            soulB: null,
            compositeSoul: null,
            compositeGenome: null,
            mergedState: null,
            pooledCcu: 0,
            escrowA: 0,
            escrowB: 0,
            ccuEarnedWhileFused: 0,
            fusedAt: null,
            fissionTriggers: config.fissionTriggers,
        };
        this.proposals.set(toHex(proposal.id), record);
        this.totalProposals++;
        return proposal;
    }
    // ═══════════════════════════════════════
    // Accept / Reject
    // ═══════════════════════════════════════
    /**
     * Accept a fusion proposal.
     */
    accept(proposalId, targetSoul) {
        const hex = toHex(proposalId);
        const record = this.proposals.get(hex);
        if (!record)
            return false;
        if (record.status !== FusionStatus.PROPOSED)
            return false;
        // Check expiry
        if (Date.now() > record.proposal.expiresAt) {
            record.status = FusionStatus.EXPIRED;
            return false;
        }
        record.soulB = targetSoul;
        record.status = FusionStatus.ACCEPTED;
        return true;
    }
    /**
     * Reject a fusion proposal.
     */
    reject(proposalId) {
        const hex = toHex(proposalId);
        const record = this.proposals.get(hex);
        if (!record)
            return false;
        if (record.status !== FusionStatus.PROPOSED)
            return false;
        record.status = FusionStatus.REJECTED;
        this.totalRejections++;
        return true;
    }
    // ═══════════════════════════════════════
    // Execute Fusion
    // ═══════════════════════════════════════
    /**
     * Execute the fusion — merge state, create composite identity,
     * compose genomes, pool CCU.
     *
     * @param proposalId - the accepted proposal
     * @param stateA - component A's CRDT state
     * @param stateB - component B's CRDT state
     * @param ccuA - component A's CCU balance
     * @param ccuB - component B's CCU balance
     * @param genomeHashA - component A's WASM hash
     * @param genomeHashB - component B's WASM hash
     */
    execute(proposalId, stateA, stateB, ccuA, ccuB, genomeHashA, genomeHashB) {
        const hex = toHex(proposalId);
        const record = this.proposals.get(hex);
        if (!record)
            return null;
        if (record.status !== FusionStatus.ACCEPTED)
            return null;
        if (!record.soulB)
            return null;
        record.status = FusionStatus.EXECUTING;
        const config = record.proposal.fusionConfig;
        // Step 1: Create composite identity with real crypto
        const compositeIdBytes = (0, crypto_1.deriveCompositeId)(record.soulA.id, record.soulB.id);
        const compositeKeypair = (0, crypto_1.generateKeypair)();
        const compositeSoul = {
            compositeId: compositeIdBytes,
            components: [record.soulA, record.soulB],
            compositePublicKey: compositeKeypair.publicKey,
            compositeSecretKey: compositeKeypair.secretKey,
            componentSignatures: [
                (0, crypto_1.signObject)({ compositeId: compositeIdBytes, role: 'a' }, record.soulA.secretKey),
                (0, crypto_1.signObject)({ compositeId: compositeIdBytes, role: 'b' }, record.soulB.secretKey),
            ],
            fusedAt: Date.now(),
            fusionConfig: config,
        };
        // Step 2: Merge state
        const mergedState = new crdt_state_1.CRDTState(toHex(compositeIdBytes));
        switch (config.stateConflictStrategy) {
            case fusion_1.StateConflictStrategy.NAMESPACE_PREFIX: {
                // Prefix A's keys with component A name, B's with component B name
                const nsA = record.soulA.name;
                const nsB = record.soulB.name;
                for (const key of stateA.keys()) {
                    const crdt = stateA.getCRDT(key);
                    if (crdt)
                        mergedState.setCRDT(`${nsA}.${key}`, crdt.clone());
                }
                for (const key of stateB.keys()) {
                    const crdt = stateB.getCRDT(key);
                    if (crdt)
                        mergedState.setCRDT(`${nsB}.${key}`, crdt.clone());
                }
                break;
            }
            case fusion_1.StateConflictStrategy.CRDT_MERGE: {
                // Merge directly — CRDTs handle conflicts
                mergedState.merge(stateA);
                mergedState.merge(stateB);
                break;
            }
            case fusion_1.StateConflictStrategy.TIMESTAMP_WINS:
            default: {
                // Merge A first, then B (B's LWW timestamps will win if newer)
                mergedState.merge(stateA);
                mergedState.merge(stateB);
                break;
            }
        }
        // Step 3: Compose genomes
        const compositeGenome = {
            moduleHashes: [genomeHashA, genomeHashB],
            executionOrder: config.primaryGenome === 'proposer' ? 'a_first' : 'b_first',
            stateNamespaces: {
                componentA: record.soulA.name,
                componentB: record.soulB.name,
                shared: 'shared',
            },
        };
        // Step 4: Pool CCU
        const ratio = config.ccuContributionRatio;
        const contributionA = ccuA * ratio;
        const contributionB = ccuB * (1 - ratio);
        const escrowA = ccuA - contributionA;
        const escrowB = ccuB - contributionB;
        record.compositeSoul = compositeSoul;
        record.compositeGenome = compositeGenome;
        record.mergedState = mergedState;
        record.pooledCcu = contributionA + contributionB;
        record.escrowA = escrowA;
        record.escrowB = escrowB;
        record.fusedAt = Date.now();
        record.status = FusionStatus.ACTIVE;
        // Index
        const compositeHex = toHex(compositeIdBytes);
        this.activeFusions.set(compositeHex, record);
        this.componentToComposite.set(toHex(record.soulA.id), compositeHex);
        this.componentToComposite.set(toHex(record.soulB.id), compositeHex);
        this.totalFusions++;
        return record;
    }
    // ═══════════════════════════════════════
    // Fission
    // ═══════════════════════════════════════
    /**
     * Execute fission — split composite back into components.
     *
     * @param compositeId - the composite Lifeform ID
     * @param compositeState - current merged state
     * @param compositeCcuBalance - current CCU balance
     * @param trigger - what caused the fission
     */
    fission(compositeId, compositeState, compositeCcuBalance, trigger = 'manual') {
        const hex = toHex(compositeId);
        const record = this.activeFusions.get(hex);
        if (!record)
            return null;
        if (record.status !== FusionStatus.ACTIVE)
            return null;
        if (!record.compositeSoul || !record.soulB)
            return null;
        record.status = FusionStatus.FISSIONING;
        const config = record.proposal.fusionConfig;
        const nsA = record.soulA.name;
        const nsB = record.soulB.name;
        // Step 1: Partition state
        const stateKeysA = [];
        const stateKeysB = [];
        for (const key of compositeState.keys()) {
            if (key.startsWith(`${nsA}.`)) {
                stateKeysA.push(key);
            }
            else if (key.startsWith(`${nsB}.`)) {
                stateKeysB.push(key);
            }
            else if (key.startsWith('shared.')) {
                // Shared keys go to both
                stateKeysA.push(key);
                stateKeysB.push(key);
            }
            else {
                // Unnamespaced keys — split by hash of key name
                const hash = key.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
                if (hash % 2 === 0)
                    stateKeysA.push(key);
                else
                    stateKeysB.push(key);
            }
        }
        // Step 2: CCU division
        const ratio = config.ccuContributionRatio;
        const earnedSplit = compositeCcuBalance - record.escrowA - record.escrowB;
        const earnedA = Math.max(0, earnedSplit * ratio);
        const earnedB = Math.max(0, earnedSplit * (1 - ratio));
        const ccuA = record.escrowA + earnedA;
        const ccuB = record.escrowB + earnedB;
        const result = {
            compositeId,
            componentA: {
                id: record.soulA.id,
                ccuBalance: ccuA,
                stateKeys: stateKeysA,
            },
            componentB: {
                id: record.soulB.id,
                ccuBalance: ccuB,
                stateKeys: stateKeysB,
            },
            fissionedAt: Date.now(),
            trigger,
        };
        // Clean up
        record.status = FusionStatus.COMPLETED;
        this.activeFusions.delete(hex);
        this.componentToComposite.delete(toHex(record.soulA.id));
        this.componentToComposite.delete(toHex(record.soulB.id));
        this.totalFissions++;
        return result;
    }
    // ═══════════════════════════════════════
    // Queries
    // ═══════════════════════════════════════
    /** Get proposal by ID */
    getProposal(proposalId) {
        return this.proposals.get(toHex(proposalId)) ?? null;
    }
    /** Get active fusion by composite ID */
    getActiveFusion(compositeId) {
        return this.activeFusions.get(toHex(compositeId)) ?? null;
    }
    /** Check if a component is currently fused */
    isFused(componentId) {
        return this.componentToComposite.has(toHex(componentId));
    }
    /** Get composite ID for a fused component */
    getCompositeId(componentId) {
        return this.componentToComposite.get(toHex(componentId)) ?? null;
    }
    /** Check if a fission trigger should fire */
    checkFissionTriggers(compositeId, ccuBalance, fusedDurationMs) {
        const record = this.activeFusions.get(toHex(compositeId));
        if (!record)
            return null;
        const config = record.proposal.fusionConfig;
        for (const trigger of record.fissionTriggers) {
            switch (trigger) {
                case fusion_1.FissionTrigger.LOW_CCU:
                    if (ccuBalance < 1)
                        return fusion_1.FissionTrigger.LOW_CCU;
                    break;
                case fusion_1.FissionTrigger.DURATION_EXPIRED:
                    if (config.maxFusionDurationMs > 0 && fusedDurationMs >= config.maxFusionDurationMs) {
                        return fusion_1.FissionTrigger.DURATION_EXPIRED;
                    }
                    break;
                // LOW_LOAD and INTENT_SATISFIED need external checks
            }
        }
        return null;
    }
    /** Get all active fusions */
    getActiveFusions() {
        return [...this.activeFusions.values()];
    }
    /** Get all proposals (including expired/rejected) */
    getAllProposals() {
        return [...this.proposals.values()];
    }
    /** Get stats */
    getStats() {
        let pending = 0;
        for (const r of this.proposals.values()) {
            if (r.status === FusionStatus.PROPOSED)
                pending++;
        }
        return {
            totalProposals: this.totalProposals,
            totalFusions: this.totalFusions,
            totalFissions: this.totalFissions,
            totalRejections: this.totalRejections,
            activeFusions: this.activeFusions.size,
            pendingProposals: pending,
        };
    }
}
exports.FusionEngine = FusionEngine;
//# sourceMappingURL=fusion.js.map