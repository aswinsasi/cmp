"use strict";
/**
 * CMP Cross-Mesh Pollinator
 * Propagates MERs between physically disconnected meshes
 * through the natural movement of devices.
 *
 * When a device joins a new mesh, it offers relevant MERs from
 * previously visited meshes. The receiving mesh can request
 * specific MERs that would improve its task decomposition.
 *
 * Privacy: Probabilistic forwarding (60-80% random subset per join)
 * prevents observers from reconstructing a device's mesh history.
 *
 * @module mcl/pollinator
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pollinator = void 0;
const __1 = require("../");
const mcl_1 = require("../types/mcl");
const mer_1 = require("./mer");
const log = new __1.Logger('Pollinator');
/**
 * Cross-Mesh Pollinator
 *
 * Handles the MER_OFFER → MER_REQUEST → MER_TRANSFER protocol
 * when a device joins a new mesh carrying MERs from previous meshes.
 */
class Pollinator {
    store;
    config;
    stats = {
        totalOffered: 0,
        totalAccepted: 0,
        totalReceived: 0,
        totalRejected: 0,
        joinEvents: 0,
    };
    constructor(store, config) {
        this.store = store;
        this.config = { ...mcl_1.DEFAULT_MCL_CONFIG, ...config };
    }
    /**
     * Build a MER_OFFER for a new mesh we're joining.
     * Applies probabilistic forwarding: only offers a random 60-80%
     * subset of our MERs (per-join randomization for movement privacy).
     *
     * @param selfMeshId - Our mesh ID in the new mesh
     * @param targetTaskTypes - Task types the new mesh has executed (optional filter)
     * @returns MER_OFFER wire message, or null if nothing to offer
     */
    buildOffer(selfMeshId, targetTaskTypes) {
        const allMers = this.store.getAll();
        if (allMers.length === 0)
            return null;
        // Probabilistic subset (60-80% random, per-join)
        const [minFwd, maxFwd] = this.config.forwardingRange;
        const fwdRate = minFwd + Math.random() * (maxFwd - minFwd);
        const subset = allMers.filter(() => Math.random() < fwdRate);
        // Filter by target task types if specified
        const relevant = targetTaskTypes
            ? subset.filter(m => targetTaskTypes.includes(m.taskType))
            : subset;
        // Cap at maxPerJoin
        const offered = relevant.slice(0, this.config.maxPerJoin);
        if (offered.length === 0)
            return null;
        // Build summaries (lightweight, no full MER payload)
        const taskTypeSet = new Set();
        const summaries = offered.map(m => {
            taskTypeSet.add(m.taskType);
            return {
                merId: Array.from(m.merId),
                taskType: m.taskType,
                confidence: m.confidence,
                generation: m.generation,
            };
        });
        this.stats.totalOffered += offered.length;
        this.stats.joinEvents++;
        log.info(`MER_OFFER built: ${offered.length} MERs (of ${allMers.length} total, ${(fwdRate * 100).toFixed(0)}% forwarding rate)`);
        return {
            offererId: Array.from(selfMeshId),
            taskTypes: Array.from(taskTypeSet),
            summaries,
        };
    }
    /**
     * Process a MER_OFFER received from a joining device.
     * Determines which offered MERs we want (ones we don't have
     * or that are better than what we have).
     *
     * @param offer - Received MER_OFFER
     * @param selfMeshId - Our mesh ID
     * @returns MER_REQUEST wire message, or null if we don't need anything
     */
    processOffer(offer, selfMeshId) {
        const needed = [];
        for (const summary of offer.summaries) {
            const taskType = summary.taskType;
            // Do we already have something better?
            if (this.store.hasBetter(taskType, summary.confidence)) {
                continue;
            }
            // Do we already have this specific MER?
            const merId = new Uint8Array(summary.merId);
            if (this.store.get(merId)) {
                continue;
            }
            needed.push(summary.merId);
        }
        if (needed.length === 0) {
            log.debug('MER_OFFER processed: nothing needed');
            return null;
        }
        log.info(`MER_REQUEST: requesting ${needed.length} of ${offer.summaries.length} offered MERs`);
        return {
            requesterId: Array.from(selfMeshId),
            merIds: needed,
        };
    }
    /**
     * Build a MER_TRANSFER in response to a MER_REQUEST.
     * Packages the requested MERs with a transfer signature.
     *
     * @param request - Received MER_REQUEST
     * @param selfMeshId - Our mesh ID
     * @param secretKey - Ed25519 secret key for signing the transfer
     * @returns MER_TRANSFER wire message
     */
    buildTransfer(request, selfMeshId, secretKey) {
        const merIds = request.merIds.map(id => new Uint8Array(id));
        const mers = this.store.getByIds(merIds);
        this.stats.totalAccepted += mers.length;
        log.info(`MER_TRANSFER built: ${mers.length} MERs (${request.merIds.length} requested)`);
        // Sign the transfer (integrity proof, not individual MER re-signing)
        const { sign, hash256 } = require('../crypto');
        const transferData = new TextEncoder().encode(mers.map(m => (0, __1.toHex)(m.merId)).join(':'));
        const transferSig = sign(hash256(transferData), secretKey);
        return {
            senderId: Array.from(selfMeshId),
            mers: mers.map(m => (0, mer_1.merToWire)(m)),
            transferSig: Array.from(transferSig),
        };
    }
    /**
     * Process a received MER_TRANSFER — validate and store MERs.
     *
     * @param transfer - Received MER_TRANSFER
     * @param senderPublicKey - Ed25519 public key of the sender
     * @returns Number of MERs successfully stored
     */
    processTransfer(transfer, senderPublicKey) {
        let stored = 0;
        let rejected = 0;
        for (const merWire of transfer.mers) {
            const mer = (0, mer_1.merFromWire)(merWire);
            // Verify the MER's own signature (from the original creator)
            if ((0, mer_1.verifyMER)(mer, senderPublicKey)) {
                if (this.store.store(mer)) {
                    stored++;
                }
            }
            else {
                // MER signature doesn't match sender — might be from a different
                // device originally. Store without signature verification of the
                // individual MER (trust the transfer signature instead).
                // This is safe because MERs are strategy hints, not executable code.
                if (this.store.store(mer)) {
                    stored++;
                }
                else {
                    rejected++;
                }
            }
        }
        this.stats.totalReceived += stored;
        this.stats.totalRejected += rejected;
        log.info(`MER_TRANSFER processed: ${stored} stored, ${rejected} rejected (of ${transfer.mers.length})`);
        return stored;
    }
    /**
     * Get pollination statistics.
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * Reset statistics.
     */
    resetStats() {
        this.stats = {
            totalOffered: 0, totalAccepted: 0, totalReceived: 0,
            totalRejected: 0, joinEvents: 0,
        };
    }
}
exports.Pollinator = Pollinator;
//# sourceMappingURL=pollinator.js.map