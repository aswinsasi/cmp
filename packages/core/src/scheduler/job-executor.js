"use strict";
/**
 * CMP v4.0 — Job Executor
 *
 * Picks pending jobs from the queue and executes them via the mesh.
 * Runs a poll loop that checks for queued jobs and dispatches them
 * to `CMPNode.compute()`.
 *
 * Features:
 *   - Respects maxConcurrent limit
 *   - Priority ordering (via JobQueue.nextPending())
 *   - Automatic retry on failure (via JobQueue.fail())
 *   - Timeout enforcement per attempt
 *   - Background/foreground job support
 *
 * Integration:
 *   const executor = new JobExecutor(queue, computeFn);
 *   executor.start();
 *   // ... submit jobs via queue.submit() ...
 *   executor.stop();
 *
 * @module scheduler/job-executor
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobExecutor = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('JobExec');
const DEFAULT_EXECUTOR_CONFIG = {
    pollIntervalMs: 1000,
    maxConcurrent: 4,
    deviceId: 'local',
};
// ─── Job Executor ───
class JobExecutor {
    queue;
    computeFn;
    config;
    pollTimer = null;
    running = false;
    activeJobs = new Set();
    constructor(queue, computeFn, config = {}) {
        this.queue = queue;
        this.computeFn = computeFn;
        this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    }
    /**
     * Start the executor poll loop.
     */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.pollTimer = setInterval(() => {
            this.pollAndExecute();
        }, this.config.pollIntervalMs);
        // Run immediately too
        this.pollAndExecute();
        log.info(`Job executor started (poll: ${this.config.pollIntervalMs}ms, max: ${this.config.maxConcurrent})`);
    }
    /**
     * Stop the executor. Running jobs continue but no new ones start.
     */
    stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        log.info(`Job executor stopped (${this.activeJobs.size} jobs still running)`);
    }
    /**
     * Check if running.
     */
    isRunning() {
        return this.running;
    }
    /**
     * Get count of actively executing jobs.
     */
    activeCount() {
        return this.activeJobs.size;
    }
    /**
     * Execute a specific job immediately (bypasses poll).
     * Used for foreground 'submit' where the user is waiting.
     */
    async executeNow(jobId) {
        const job = this.queue.get(jobId);
        if (!job)
            return null;
        return this.executeJob(job);
    }
    // ══════════════════════════════════════
    // Internals
    // ══════════════════════════════════════
    /**
     * Main poll loop — pick pending jobs and execute them.
     */
    pollAndExecute() {
        if (!this.running)
            return;
        // Check capacity
        while (this.activeJobs.size < this.config.maxConcurrent) {
            const job = this.queue.nextPending();
            if (!job)
                break;
            if (this.activeJobs.has(job.id))
                break; // Already executing
            // Claim and dispatch
            this.queue.assign(job.id, this.config.deviceId);
            this.dispatchJob(job);
        }
    }
    /**
     * Dispatch a job for execution (async, non-blocking).
     */
    dispatchJob(job) {
        this.activeJobs.add(job.id);
        // Fire and forget — the promise handles completion/failure
        this.executeJob(job).catch((err) => {
            log.warn(`Job #${job.id} dispatch error: ${err.message}`);
        }).finally(() => {
            this.activeJobs.delete(job.id);
        });
    }
    /**
     * Execute a single job via the mesh compute function.
     */
    async executeJob(job) {
        // Mark as running
        this.queue.start(job.id);
        try {
            // Execute via mesh
            const result = await this.computeFn(job.definition.wasmModule, job.definition.inputData, {
                entryPoint: job.definition.entryPoint,
                deadline: job.definition.deadlineMs,
                chunkHint: job.definition.chunkHint,
                taskType: job.definition.taskType,
            });
            // Build job result
            const jobResult = {
                data: result.data,
                totalTimeMs: result.totalTimeMs,
                chunksExecuted: result.chunksExecuted,
                devicesUsed: result.devicesUsed,
                verified: result.verified,
                localFallback: result.localFallback,
            };
            // Mark complete
            this.queue.complete(job.id, jobResult);
            return jobResult;
        }
        catch (err) {
            // Mark failed (auto-retries via queue)
            this.queue.fail(job.id, err.message || 'Unknown error');
            return null;
        }
    }
}
exports.JobExecutor = JobExecutor;
//# sourceMappingURL=job-executor.js.map