"use strict";
/**
 * CMP v1.4 — Distribution Bridge
 * Connects Lifeform's lf_distribute() to the CMP L3-L6 pipeline.
 * A Lifeform can submit distributed WASM tasks to the mesh from
 * within its onCause handler, making persistent intelligence
 * orchestrate ephemeral compute.
 *
 * Flow:
 *   1. Lifeform calls lf_distribute(wasmHash, input, taskType, deadline)
 *   2. Bridge creates a CMP task request (L3 negotiation)
 *   3. Task is distributed across the mesh (L4-L6 execution)
 *   4. Result arrives as a DISTRIBUTION_RESULT Cause to the Lifeform
 *
 * @module lifeform/distribution-bridge
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DistributionBridge = exports.DistributionStatus = void 0;
const causal_1 = require("../types/causal");
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
var DistributionStatus;
(function (DistributionStatus) {
    DistributionStatus["PENDING"] = "pending";
    DistributionStatus["SUBMITTED"] = "submitted";
    DistributionStatus["EXECUTING"] = "executing";
    DistributionStatus["COMPLETED"] = "completed";
    DistributionStatus["FAILED"] = "failed";
    DistributionStatus["TIMEOUT"] = "timeout";
})(DistributionStatus || (exports.DistributionStatus = DistributionStatus = {}));
// ─── Distribution Bridge ───
class DistributionBridge {
    /** requestId hex → DistributionRequest */
    pending = new Map();
    /** correlationId hex → requestId hex (reverse lookup) */
    correlations = new Map();
    /** Callback: submit task to CMP pipeline (L3-L6) */
    submitFn = null;
    /** Callback: deliver result cause to the Lifeform */
    deliverResultFn = null;
    /** Stats */
    totalSubmitted = 0;
    totalCompleted = 0;
    totalFailed = 0;
    /** Set the CMP pipeline submission callback */
    onSubmit(fn) {
        this.submitFn = fn;
    }
    /** Set the result delivery callback */
    onDeliverResult(fn) {
        this.deliverResultFn = fn;
    }
    /**
     * Submit a distributed computation request from a Lifeform.
     * Called by the WASM runtime when lf_distribute() is invoked.
     */
    async submit(lifeformId, lifeformName, wasmModuleHash, inputData, taskType, deadlineMs, securityLevel, ccuBudget) {
        const id = randomBytes(16);
        const correlationId = randomBytes(16);
        const request = {
            id,
            lifeformId,
            lifeformName,
            wasmModuleHash,
            inputData,
            taskType,
            deadlineMs: deadlineMs > 0 ? Date.now() + deadlineMs : 0,
            securityLevel,
            ccuBudget,
            submittedAt: Date.now(),
            status: DistributionStatus.PENDING,
            correlationId,
        };
        const idHex = toHex(id);
        this.pending.set(idHex, request);
        this.correlations.set(toHex(correlationId), idHex);
        this.totalSubmitted++;
        // Submit to CMP pipeline
        if (this.submitFn) {
            try {
                request.status = DistributionStatus.SUBMITTED;
                await this.submitFn(request);
                request.status = DistributionStatus.EXECUTING;
            }
            catch (err) {
                request.status = DistributionStatus.FAILED;
                this.totalFailed++;
            }
        }
        return correlationId;
    }
    /**
     * Handle a result from the CMP pipeline.
     * Converts it into a DISTRIBUTION_RESULT Cause and delivers
     * it to the requesting Lifeform.
     */
    async handleResult(result) {
        const idHex = toHex(result.requestId);
        const request = this.pending.get(idHex);
        if (!request)
            return false;
        request.status = result.success
            ? DistributionStatus.COMPLETED
            : DistributionStatus.FAILED;
        if (result.success)
            this.totalCompleted++;
        else
            this.totalFailed++;
        // Build DISTRIBUTION_RESULT cause
        const cause = {
            id: randomBytes(16),
            type: causal_1.CauseType.DISTRIBUTION_RESULT,
            chainId: randomBytes(16),
            chainDepth: 0,
            maxChainDepth: 64,
            deadlineMs: 0,
            sourceId: request.id,
            sourceType: 'system',
            targetId: request.lifeformId,
            payload: result.resultData,
            ccuAttached: 0,
            expectsResponse: false,
            correlationId: request.correlationId,
            emittedAt: Date.now(),
        };
        // Deliver to the Lifeform
        if (this.deliverResultFn) {
            await this.deliverResultFn(request.lifeformName, cause);
        }
        // Clean up
        this.pending.delete(idHex);
        this.correlations.delete(toHex(request.correlationId));
        return true;
    }
    /**
     * Check for timed-out requests.
     */
    checkTimeouts() {
        const now = Date.now();
        let timedOut = 0;
        for (const [idHex, request] of this.pending) {
            if (request.deadlineMs > 0 && now > request.deadlineMs) {
                request.status = DistributionStatus.TIMEOUT;
                this.totalFailed++;
                this.pending.delete(idHex);
                this.correlations.delete(toHex(request.correlationId));
                timedOut++;
            }
        }
        return timedOut;
    }
    /**
     * Get a pending request by correlation ID.
     */
    getByCorrelation(correlationId) {
        const corrHex = toHex(correlationId);
        const idHex = this.correlations.get(corrHex);
        if (!idHex)
            return null;
        return this.pending.get(idHex) ?? null;
    }
    /**
     * Get all pending requests for a Lifeform.
     */
    getPendingFor(lifeformName) {
        return [...this.pending.values()].filter(r => r.lifeformName === lifeformName);
    }
    /** Get stats */
    getStats() {
        return {
            totalSubmitted: this.totalSubmitted,
            totalCompleted: this.totalCompleted,
            totalFailed: this.totalFailed,
            pending: this.pending.size,
        };
    }
    /** Pending count */
    get pendingCount() {
        return this.pending.size;
    }
}
exports.DistributionBridge = DistributionBridge;
//# sourceMappingURL=distribution-bridge.js.map