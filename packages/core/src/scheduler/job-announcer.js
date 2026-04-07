"use strict";
/**
 * CMP v4.0 — Job Announcer
 *
 * Broadcasts available jobs to mesh peers so remote devices
 * can claim and execute them. Uses the v4 wire protocol:
 *
 *   JOB_ANNOUNCE (0xD1): submitter → broadcast
 *     "I have a job available, here are the requirements"
 *
 *   JOB_CLAIM (0xD2): executor → submitter
 *     "I can handle this job, here's my estimate"
 *
 *   JOB_RESULT (0xD3): executor → submitter
 *     "Here's the result of the job"
 *
 * The announcer periodically scans the queue for pending jobs
 * and broadcasts them. Remote peers that claim a job get assigned.
 *
 * @module scheduler/job-announcer
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobAnnouncer = void 0;
const logger_1 = require("../utils/logger");
const job_types_1 = require("./job-types");
const log = new logger_1.Logger('JobAnnounce');
// ─── Hex Helpers ───
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}
const DEFAULT_ANNOUNCER_CONFIG = {
    announceIntervalMs: 5000,
    deviceId: 'local',
    claimTimeoutMs: 10000,
};
// ─── Job Announcer ───
class JobAnnouncer {
    queue;
    config;
    broadcastFn = null;
    sendToFn = null;
    announceTimer = null;
    running = false;
    /** Jobs we've announced but not yet claimed (with announce timestamp) */
    announced = new Map();
    /** Pending claims for jobs we own (jobId → best claimer) */
    pendingClaims = new Map();
    constructor(queue, config = {}) {
        this.queue = queue;
        this.config = { ...DEFAULT_ANNOUNCER_CONFIG, ...config };
    }
    /**
     * Set transport functions for sending messages.
     */
    setTransport(broadcast, sendTo) {
        this.broadcastFn = broadcast;
        this.sendToFn = sendTo;
    }
    /**
     * Start announcing jobs.
     */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.announceTimer = setInterval(() => {
            this.announcePendingJobs();
        }, this.config.announceIntervalMs);
        log.info(`Job announcer started (interval: ${this.config.announceIntervalMs}ms)`);
    }
    /**
     * Stop announcing.
     */
    stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.announceTimer) {
            clearInterval(this.announceTimer);
            this.announceTimer = null;
        }
        log.info('Job announcer stopped');
    }
    /**
     * Handle an incoming job-related message from a peer.
     */
    handleMessage(msgType, payload) {
        switch (msgType) {
            case job_types_1.JobMessageType.JOB_ANNOUNCE:
                this.handleAnnounce(payload);
                break;
            case job_types_1.JobMessageType.JOB_CLAIM:
                this.handleClaim(payload);
                break;
            case job_types_1.JobMessageType.JOB_RESULT:
                this.handleResult(payload);
                break;
        }
    }
    // ══════════════════════════════════════
    // Announce (this device → mesh)
    // ══════════════════════════════════════
    /**
     * Broadcast all pending jobs to the mesh.
     */
    announcePendingJobs() {
        if (!this.broadcastFn)
            return;
        const pending = this.queue.list({ state: [job_types_1.JobState.QUEUED, job_types_1.JobState.RETRY] });
        for (const job of pending) {
            // Skip if recently announced (within claim timeout window)
            const lastAnnounce = this.announced.get(job.id);
            if (lastAnnounce && Date.now() - lastAnnounce < this.config.claimTimeoutMs) {
                continue;
            }
            const wire = {
                jobId: job.id,
                priority: job.priority,
                taskType: job.definition.taskType,
                payloadSizeKb: Math.ceil(job.definition.inputData.length / 1024),
                deadlineMs: job.definition.deadlineMs,
                announcerId: this.config.deviceId,
            };
            this.broadcastFn(job_types_1.JobMessageType.JOB_ANNOUNCE, wire);
            this.announced.set(job.id, Date.now());
        }
        // Clean up expired announcements
        const now = Date.now();
        for (const [jobId, ts] of this.announced) {
            if (now - ts > this.config.claimTimeoutMs * 2) {
                this.announced.delete(jobId);
            }
        }
    }
    // ══════════════════════════════════════
    // Handle Incoming Messages
    // ══════════════════════════════════════
    /**
     * Handle a JOB_ANNOUNCE from another device.
     * This device could claim the job if it has capacity.
     */
    handleAnnounce(wire) {
        // Don't claim our own announcements
        if (wire.announcerId === this.config.deviceId)
            return;
        // For now, we don't auto-claim remote jobs —
        // this will be wired when the Unified Scheduler (Phase 3) is built.
        // The announcer just records that a remote job exists.
        log.debug(`Job announce from ${wire.announcerId}: job #${wire.jobId} (${wire.payloadSizeKb}KB, deadline ${wire.deadlineMs}ms)`);
    }
    /**
     * Handle a JOB_CLAIM from a remote device wanting to execute our job.
     */
    handleClaim(wire) {
        const job = this.queue.get(wire.jobId);
        if (!job)
            return;
        // Only accept claims for our jobs that are still pending
        if (job.state !== job_types_1.JobState.QUEUED && job.state !== job_types_1.JobState.RETRY)
            return;
        // Keep the best claim (lowest estimated time)
        const existing = this.pendingClaims.get(wire.jobId);
        if (!existing || wire.estimatedTimeMs < existing.estimatedTimeMs) {
            this.pendingClaims.set(wire.jobId, wire);
            log.info(`Job #${wire.jobId} claimed by ${wire.claimerId} (est: ${wire.estimatedTimeMs}ms)`);
            // Assign immediately (first come first served for now)
            this.queue.assign(wire.jobId, wire.claimerId);
            this.pendingClaims.delete(wire.jobId);
            this.announced.delete(wire.jobId);
        }
    }
    /**
     * Handle a JOB_RESULT from a remote device that executed our job.
     */
    handleResult(wire) {
        const job = this.queue.get(wire.jobId);
        if (!job)
            return;
        if (wire.success && wire.resultHex) {
            const result = {
                data: fromHex(wire.resultHex),
                totalTimeMs: wire.totalTimeMs,
                chunksExecuted: wire.chunksExecuted,
                devicesUsed: wire.devicesUsed,
                verified: true,
                localFallback: false,
            };
            this.queue.complete(wire.jobId, result);
        }
        else {
            this.queue.fail(wire.jobId, wire.error || 'Remote execution failed');
        }
    }
    // ══════════════════════════════════════
    // Status
    // ══════════════════════════════════════
    getStatus() {
        return {
            running: this.running,
            announcedJobs: this.announced.size,
            pendingClaims: this.pendingClaims.size,
        };
    }
}
exports.JobAnnouncer = JobAnnouncer;
//# sourceMappingURL=job-announcer.js.map