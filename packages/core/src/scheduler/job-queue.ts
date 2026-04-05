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

import { Priority, TaskType } from '../types/task';
import { Logger } from '../utils/logger';
import { V3StateStore } from '../persistence/v3-state-store';
import {
  Job, JobState, JobResult, JobDefinition, JobEvent,
  JobFilter, JobStats, JobQueueConfig, DEFAULT_JOB_QUEUE_CONFIG,
  TERMINAL_STATES, ACTIVE_STATES,
} from './job-types';

const log = new Logger('JobQueue');

// ─── Hex Helpers ───

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
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

export class JobQueue {
  private config: JobQueueConfig;
  private store: V3StateStore | null;
  private jobs = new Map<number, Job>();
  private nextId = 1;
  private eventLog: JobEvent[] = [];
  private listeners = new Set<(event: JobEvent) => void>();

  constructor(store: V3StateStore | null = null, config: Partial<JobQueueConfig> = {}) {
    this.config = { ...DEFAULT_JOB_QUEUE_CONFIG, ...config };
    this.store = store;
  }

  /**
   * Initialize — load persisted jobs from store.
   */
  init(): void {
    if (!this.store) return;

    // Load meta (next ID counter)
    const meta = this.store.loadState<{ nextId: number }>(SUBSYSTEM, META_KEY);
    if (meta) {
      this.nextId = meta.nextId;
    }

    // Load all jobs
    const allEntries = this.store.loadAll<any>(SUBSYSTEM);
    for (const entry of allEntries) {
      if (entry.key === META_KEY || entry.key === EVENT_KEY) continue;

      try {
        const job = this.deserializeJob(entry.data);
        this.jobs.set(job.id, job);
      } catch (err: any) {
        log.warn(`Failed to load job ${entry.key}: ${err.message}`);
      }
    }

    // Load event log
    const events = this.store.loadState<JobEvent[]>(SUBSYSTEM, EVENT_KEY);
    if (events) {
      this.eventLog = events.slice(-200); // Keep last 200
    }

    // Reset any jobs stuck in RUNNING/ASSIGNED (node crashed mid-execution)
    for (const job of this.jobs.values()) {
      if (job.state === JobState.RUNNING || job.state === JobState.ASSIGNED) {
        if (job.retryCount < job.maxRetries) {
          job.state = JobState.RETRY;
          job.retryCount++;
          this.persistJob(job);
          this.emitEvent('retry', job.id, 'Recovered from crash — requeueing');
        } else {
          job.state = JobState.FAILED;
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
  submit(definition: JobDefinition, options: {
    priority?: Priority;
    background?: boolean;
    maxRetries?: number;
    tags?: string[];
  } = {}): Job {
    const job: Job = {
      id: this.nextId++,
      state: JobState.QUEUED,
      priority: options.priority ?? Priority.NORMAL,
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

    log.info(`Job #${job.id} submitted (priority: ${Priority[job.priority]}, bg: ${job.background})`);
    return job;
  }

  // ══════════════════════════════════════
  // Lifecycle Transitions
  // ══════════════════════════════════════

  /**
   * Assign a job to a device.
   */
  assign(jobId: number, deviceId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.state !== JobState.QUEUED && job.state !== JobState.RETRY) return false;

    job.state = JobState.ASSIGNED;
    job.claimedBy = deviceId;
    this.persistJob(job);
    this.emitEvent('assigned', jobId, `Assigned to ${deviceId}`);
    return true;
  }

  /**
   * Mark a job as running.
   */
  start(jobId: number): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.state !== JobState.ASSIGNED && job.state !== JobState.QUEUED && job.state !== JobState.RETRY) return false;

    job.state = JobState.RUNNING;
    job.startedAt = Date.now();
    this.persistJob(job);
    this.emitEvent('started', jobId);
    return true;
  }

  /**
   * Complete a job with a result.
   */
  complete(jobId: number, result: JobResult): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.state !== JobState.RUNNING) return false;

    job.state = JobState.COMPLETED;
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
  fail(jobId: number, error: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (TERMINAL_STATES.has(job.state)) return false;

    if (job.retryCount < job.maxRetries) {
      job.state = JobState.RETRY;
      job.retryCount++;
      job.error = error;
      this.persistJob(job);
      this.emitEvent('retry', jobId, `Retry ${job.retryCount}/${job.maxRetries}: ${error}`);
      log.info(`Job #${jobId} retry ${job.retryCount}/${job.maxRetries}: ${error}`);
      return true;
    }

    job.state = JobState.FAILED;
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
  cancel(jobId: number): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (TERMINAL_STATES.has(job.state)) return false;

    job.state = JobState.CANCELLED;
    job.completedAt = Date.now();
    this.persistJob(job);
    this.emitEvent('cancelled', jobId);
    log.info(`Job #${jobId} cancelled`);
    return true;
  }

  /**
   * Retry a failed job manually.
   */
  retry(jobId: number): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.state !== JobState.FAILED && job.state !== JobState.CANCELLED) return false;

    job.state = JobState.QUEUED;
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
  get(jobId: number): Job | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * List jobs matching a filter.
   */
  list(filter: JobFilter = {}): Job[] {
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
      result = result.filter(j => filter.tags!.some(t => j.tags.includes(t)));
    }

    // Sort by priority (highest first), then by submission time (oldest first)
    result.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
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
  nextPending(): Job | null {
    const pending = this.list({ state: [JobState.QUEUED, JobState.RETRY] });
    return pending.length > 0 ? pending[0] : null;
  }

  /**
   * Count currently running jobs.
   */
  runningCount(): number {
    return this.list({ state: [JobState.RUNNING, JobState.ASSIGNED] }).length;
  }

  /**
   * Check if there's capacity to run more jobs.
   */
  hasCapacity(): boolean {
    return this.runningCount() < this.config.maxConcurrent;
  }

  /**
   * Get job statistics.
   */
  getStats(): JobStats {
    const jobs = Array.from(this.jobs.values());
    const byState: Record<string, number> = {};

    for (const state of Object.values(JobState)) {
      byState[state] = 0;
    }
    for (const job of jobs) {
      byState[job.state] = (byState[job.state] || 0) + 1;
    }

    const completedJobs = jobs.filter(j => j.state === JobState.COMPLETED && j.result);
    const avgTime = completedJobs.length > 0
      ? completedJobs.reduce((sum, j) => sum + (j.result?.totalTimeMs ?? 0), 0) / completedJobs.length
      : 0;

    return {
      total: jobs.length,
      byState,
      completed: byState[JobState.COMPLETED] || 0,
      failed: byState[JobState.FAILED] || 0,
      cancelled: byState[JobState.CANCELLED] || 0,
      running: (byState[JobState.RUNNING] || 0) + (byState[JobState.ASSIGNED] || 0),
      queued: (byState[JobState.QUEUED] || 0) + (byState[JobState.RETRY] || 0),
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
  clearCompleted(): number {
    let count = 0;
    for (const [id, job] of this.jobs) {
      if (TERMINAL_STATES.has(job.state)) {
        this.jobs.delete(id);
        if (this.store) {
          this.store.deleteState(SUBSYSTEM, `job:${id}`);
        }
        count++;
      }
    }
    if (count > 0) log.info(`Cleared ${count} completed jobs`);
    return count;
  }

  /**
   * Clear ALL jobs (for testing / reset).
   */
  clearAll(): void {
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
  onEvent(listener: (event: JobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get recent events.
   */
  getEvents(limit: number = 20): JobEvent[] {
    return this.eventLog.slice(-limit);
  }

  // ══════════════════════════════════════
  // Internals
  // ══════════════════════════════════════

  private emitEvent(type: JobEvent['type'], jobId: number, details?: string): void {
    const event: JobEvent = { type, jobId, timestamp: Date.now(), details };
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
      try { listener(event); } catch {}
    }
  }

  private persistJob(job: Job): void {
    if (!this.store) return;
    this.store.saveState(SUBSYSTEM, `job:${job.id}`, this.serializeJob(job));
  }

  private persistMeta(): void {
    if (!this.store) return;
    this.store.saveState(SUBSYSTEM, META_KEY, { nextId: this.nextId });
  }

  private serializeJob(job: Job): any {
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

  private deserializeJob(data: any): Job {
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
  private pruneHistory(): void {
    const completed = Array.from(this.jobs.values())
      .filter(j => TERMINAL_STATES.has(j.state))
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
