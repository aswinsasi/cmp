"use strict";
/**
 * CMP v4.0 — Job Queue
 *
 * SQLite-backed persistent job queue. Jobs survive node restarts.
 * Uses V3StateStore for persistence — all job state is stored as
 * JSON in the v3_state table under the 'jobs' subsystem.
 *
 * Features:
 *   - Priority ordering (CRITICAL > HIGH > NORMAL > LOW)
 *   - Automatic retry on failure (configurable maxRetries)
 *   - Background jobs survive node restarts
 *   - Job result persistence
 *   - History cleanup (keeps last N completed jobs)
 *   - Event emission for state transitions
 *
 * @module scheduler/job-queue
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobQueue = void 0;
const task_1 = require("../types/task");
const logger_1 = require("../utils/logger");
const job_types_1 = require("./job-types");
const log = new logger_1.Logger('JobQueue');
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
// ─── Subsystem Key ───
const SUBSYSTEM = 'jobs';
const META_KEY = '_meta';
const EVENT_KEY = '_events';
// ─── Job Queue ───
class JobQueue {
    config;
    store;
    jobs = new Map();
    nextId = 1;
    eventLog = [];
    listeners = new Set();
    constructor(store = null, config = {}) {
        this.config = { ...job_types_1.DEFAULT_JOB_QUEUE_CONFIG, ...config };
        this.store = store;
    }
    /**
     * Initialize — load persisted jobs from store.
     */
    init() {
        if (!this.store)
            return;
        // Load meta (next ID counter)
        const meta = this.store.loadState(SUBSYSTEM, META_KEY);
        if (meta) {
            this.nextId = meta.nextId;
        }
        // Load all jobs
        const allEntries = this.store.loadAll(SUBSYSTEM);
        for (const entry of allEntries) {
            if (entry.key === META_KEY || entry.key === EVENT_KEY)
                continue;
            try {
                const job = this.deserializeJob(entry.data);
                this.jobs.set(job.id, job);
            }
            catch (err) {
                log.warn(`Failed to load job ${entry.key}: ${err.message}`);
            }
        }
        // Load event log
        const events = this.store.loadState(SUBSYSTEM, EVENT_KEY);
        if (events) {
            this.eventLog = events.slice(-200); // Keep last 200
        }
        // Reset any jobs stuck in RUNNING/ASSIGNED (node crashed mid-execution)
        for (const job of this.jobs.values()) {
            if (job.state === job_types_1.JobState.RUNNING || job.state === job_types_1.JobState.ASSIGNED) {
                if (job.retryCount < job.maxRetries) {
                    job.state = job_types_1.JobState.RETRY;
                    job.retryCount++;
                    this.persistJob(job);
                    this.emitEvent('retry', job.id, 'Recovered from crash — requeueing');
                }
                else {
                    job.state = job_types_1.JobState.FAILED;
                    job.error = 'Node crashed during execution (max retries exceeded)';
                    job.completedAt = Date.now();
                    this.persistJob(job);
                    this.emitEvent('failed', job.id, job.error);
                }
            }
        }
        log.info(`Job queue initialized: ${this.jobs.size} jobs loaded, next ID: ${this.nextId}`);
    }
    // ══════════════════════════════════════
    // Submit
    // ══════════════════════════════════════
    /**
     * Submit a new job to the queue.
     */
    submit(definition, options = {}) {
        const job = {
            id: this.nextId++,
            state: job_types_1.JobState.QUEUED,
            priority: options.priority ?? task_1.Priority.NORMAL,
            background: options.background ?? false,
            definition,
            maxRetries: options.maxRetries ?? this.config.defaultMaxRetries,
            retryCount: 0,
            error: null,
            result: null,
            claimedBy: null,
            submittedAt: Date.now(),
            startedAt: null,
            completedAt: null,
            tags: options.tags ?? [],
        };
        this.jobs.set(job.id, job);
        this.persistJob(job);
        this.persistMeta();
        this.emitEvent('queued', job.id);
        log.info(`Job #${job.id} submitted (priority: ${task_1.Priority[job.priority]}, bg: ${job.background})`);
        return job;
    }
    // ══════════════════════════════════════
    // Lifecycle Transitions
    // ══════════════════════════════════════
    /**
     * Assign a job to a device.
     */
    assign(jobId, deviceId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return false;
        if (job.state !== job_types_1.JobState.QUEUED && job.state !== job_types_1.JobState.RETRY)
            return false;
        job.state = job_types_1.JobState.ASSIGNED;
        job.claimedBy = deviceId;
        this.persistJob(job);
        this.emitEvent('assigned', jobId, `Assigned to ${deviceId}`);
        return true;
    }
    /**
     * Mark a job as running.
     */
    start(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return false;
        if (job.state !== job_types_1.JobState.ASSIGNED && job.state !== job_types_1.JobState.QUEUED && job.state !== job_types_1.JobState.RETRY)
            return false;
        job.state = job_types_1.JobState.RUNNING;
        job.startedAt = Date.now();
        this.persistJob(job);
        this.emitEvent('started', jobId);
        return true;
    }
    /**
     * Complete a job with a result.
     */
    complete(jobId, result) {
        const job = this.jobs.get(jobId);
        if (!job)
            return false;
        if (job.state !== job_types_1.JobState.RUNNING)
            return false;
        job.state = job_types_1.JobState.COMPLETED;
        job.result = result;
        job.completedAt = Date.now();
        this.persistJob(job);
        this.emitEvent('completed', jobId, `${result.totalTimeMs}ms, ${result.devicesUsed} devices`);
        log.info(`Job #${jobId} completed: ${result.totalTimeMs}ms, ${result.chunksExecuted} chunks`);
        this.pruneHistory();
        return true;
    }
    /**
     * Mark a job as failed. Auto-retries if retries remain.
     */
    fail(jobId, error) {
        const job = this.jobs.get(jobId);
        if (!job)
            return false;
        if (job_types_1.TERMINAL_STATES.has(job.state))
            return false;
        if (job.retryCount < job.maxRetries) {
            job.state = job_types_1.JobState.RETRY;
            job.retryCount++;
            job.error = error;
            this.persistJob(job);
            this.emitEvent('retry', jobId, `Retry ${job.retryCount}/${job.maxRetries}: ${error}`);
            log.info(`Job #${jobId} retry ${job.retryCount}/${job.maxRetries}: ${error}`);
            return true;
        }
        job.state = job_types_1.JobState.FAILED;
        job.error = error;
        job.completedAt = Date.now();
        this.persistJob(job);
        this.emitEvent('failed', jobId, error);
        log.warn(`Job #${jobId} failed: ${error}`);
        return true;
    }
    /**
     * Cancel a job.
     */
    cancel(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return false;
        if (job_types_1.TERMINAL_STATES.has(job.state))
            return false;
        job.state = job_types_1.JobState.CANCELLED;
        job.completedAt = Date.now();
        this.persistJob(job);
        this.emitEvent('cancelled', jobId);
        log.info(`Job #${jobId} cancelled`);
        return true;
    }
    /**
     * Retry a failed job manually.
     */
    retry(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return false;
        if (job.state !== job_types_1.JobState.FAILED && job.state !== job_types_1.JobState.CANCELLED)
            return false;
        job.state = job_types_1.JobState.QUEUED;
        job.error = null;
        job.result = null;
        job.claimedBy = null;
        job.startedAt = null;
        job.completedAt = null;
        // Don't reset retryCount — keeps accumulating
        this.persistJob(job);
        this.emitEvent('queued', jobId, 'Manual retry');
        log.info(`Job #${jobId} requeued for retry`);
        return true;
    }
    // ══════════════════════════════════════
    // Query
    // ══════════════════════════════════════
    /**
     * Get a job by ID.
     */
    get(jobId) {
        return this.jobs.get(jobId) ?? null;
    }
    /**
     * List jobs matching a filter.
     */
    list(filter = {}) {
        let result = Array.from(this.jobs.values());
        if (filter.state) {
            const states = Array.isArray(filter.state) ? filter.state : [filter.state];
            result = result.filter(j => states.includes(j.state));
        }
        if (filter.priority !== undefined) {
            result = result.filter(j => j.priority === filter.priority);
        }
        if (filter.background !== undefined) {
            result = result.filter(j => j.background === filter.background);
        }
        if (filter.tags && filter.tags.length > 0) {
            result = result.filter(j => filter.tags.some(t => j.tags.includes(t)));
        }
        // Sort by priority (highest first), then by submission time (oldest first)
        result.sort((a, b) => {
            if (b.priority !== a.priority)
                return b.priority - a.priority;
            return a.submittedAt - b.submittedAt;
        });
        if (filter.limit) {
            result = result.slice(0, filter.limit);
        }
        return result;
    }
    /**
     * Get the next job that should be executed.
     * Returns the highest-priority QUEUED or RETRY job.
     */
    nextPending() {
        const pending = this.list({ state: [job_types_1.JobState.QUEUED, job_types_1.JobState.RETRY] });
        return pending.length > 0 ? pending[0] : null;
    }
    /**
     * Count currently running jobs.
     */
    runningCount() {
        return this.list({ state: [job_types_1.JobState.RUNNING, job_types_1.JobState.ASSIGNED] }).length;
    }
    /**
     * Check if there's capacity to run more jobs.
     */
    hasCapacity() {
        return this.runningCount() < this.config.maxConcurrent;
    }
    /**
     * Get job statistics.
     */
    getStats() {
        const jobs = Array.from(this.jobs.values());
        const byState = {};
        for (const state of Object.values(job_types_1.JobState)) {
            byState[state] = 0;
        }
        for (const job of jobs) {
            byState[job.state] = (byState[job.state] || 0) + 1;
        }
        const completedJobs = jobs.filter(j => j.state === job_types_1.JobState.COMPLETED && j.result);
        const avgTime = completedJobs.length > 0
            ? completedJobs.reduce((sum, j) => sum + (j.result?.totalTimeMs ?? 0), 0) / completedJobs.length
            : 0;
        return {
            total: jobs.length,
            byState,
            completed: byState[job_types_1.JobState.COMPLETED] || 0,
            failed: byState[job_types_1.JobState.FAILED] || 0,
            cancelled: byState[job_types_1.JobState.CANCELLED] || 0,
            running: (byState[job_types_1.JobState.RUNNING] || 0) + (byState[job_types_1.JobState.ASSIGNED] || 0),
            queued: (byState[job_types_1.JobState.QUEUED] || 0) + (byState[job_types_1.JobState.RETRY] || 0),
            avgCompletionTimeMs: Math.round(avgTime),
            totalRetries: jobs.reduce((sum, j) => sum + j.retryCount, 0),
        };
    }
    // ══════════════════════════════════════
    // Cleanup
    // ══════════════════════════════════════
    /**
     * Clear completed/failed/cancelled jobs from history.
     */
    clearCompleted() {
        let count = 0;
        for (const [id, job] of this.jobs) {
            if (job_types_1.TERMINAL_STATES.has(job.state)) {
                this.jobs.delete(id);
                if (this.store) {
                    this.store.deleteState(SUBSYSTEM, `job:${id}`);
                }
                count++;
            }
        }
        if (count > 0)
            log.info(`Cleared ${count} completed jobs`);
        return count;
    }
    /**
     * Clear ALL jobs (for testing / reset).
     */
    clearAll() {
        this.jobs.clear();
        this.eventLog = [];
        this.nextId = 1;
        if (this.store) {
            this.store.clearSubsystem(SUBSYSTEM);
        }
    }
    // ══════════════════════════════════════
    // Events
    // ══════════════════════════════════════
    /**
     * Subscribe to job events.
     */
    onEvent(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /**
     * Get recent events.
     */
    getEvents(limit = 20) {
        return this.eventLog.slice(-limit);
    }
    // ══════════════════════════════════════
    // Internals
    // ══════════════════════════════════════
    emitEvent(type, jobId, details) {
        const event = { type, jobId, timestamp: Date.now(), details };
        this.eventLog.push(event);
        // Trim event log
        if (this.eventLog.length > 500) {
            this.eventLog = this.eventLog.slice(-200);
        }
        // Persist events
        if (this.store) {
            this.store.saveState(SUBSYSTEM, EVENT_KEY, this.eventLog.slice(-200));
        }
        // Notify listeners
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch { }
        }
    }
    persistJob(job) {
        if (!this.store)
            return;
        this.store.saveState(SUBSYSTEM, `job:${job.id}`, this.serializeJob(job));
    }
    persistMeta() {
        if (!this.store)
            return;
        this.store.saveState(SUBSYSTEM, META_KEY, { nextId: this.nextId });
    }
    serializeJob(job) {
        return {
            ...job,
            definition: {
                ...job.definition,
                wasmModule: toHex(job.definition.wasmModule),
                inputData: toHex(job.definition.inputData),
            },
            result: job.result ? {
                ...job.result,
                data: toHex(job.result.data),
            } : null,
        };
    }
    deserializeJob(data) {
        return {
            ...data,
            definition: {
                ...data.definition,
                wasmModule: fromHex(data.definition.wasmModule),
                inputData: fromHex(data.definition.inputData),
            },
            result: data.result ? {
                ...data.result,
                data: fromHex(data.result.data),
            } : null,
        };
    }
    /**
     * Prune old completed jobs if history exceeds max.
     */
    pruneHistory() {
        const completed = Array.from(this.jobs.values())
            .filter(j => job_types_1.TERMINAL_STATES.has(j.state))
            .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
        const excess = completed.length - this.config.maxHistorySize;
        if (excess > 0) {
            for (let i = 0; i < excess; i++) {
                const job = completed[i];
                this.jobs.delete(job.id);
                if (this.store) {
                    this.store.deleteState(SUBSYSTEM, `job:${job.id}`);
                }
            }
        }
    }
}
exports.JobQueue = JobQueue;
//# sourceMappingURL=job-queue.js.map