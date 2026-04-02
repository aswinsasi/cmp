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

import { Cause, CauseType } from '../types/causal';
import { TaskType } from '../types/task';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// ─── Distribution Request ───

export interface DistributionRequest {
  /** Unique request ID */
  id: Uint8Array;
  /** Requesting Lifeform ID */
  lifeformId: Uint8Array;
  /** Requesting Lifeform name */
  lifeformName: string;
  /** WASM module hash for the distributed task */
  wasmModuleHash: Uint8Array;
  /** Input data for the task */
  inputData: Uint8Array;
  /** Task type (MAP_REDUCE, INFERENCE, etc.) */
  taskType: TaskType;
  /** Deadline for completion (ms from now, 0 = no deadline) */
  deadlineMs: number;
  /** Security level (0=none, 1=encrypted, 2=certified) */
  securityLevel: number;
  /** CCU budget for this distribution */
  ccuBudget: number;
  /** Timestamp */
  submittedAt: number;
  /** Status */
  status: DistributionStatus;
  /** Correlation ID to match result back to the Lifeform cause */
  correlationId: Uint8Array;
}

export enum DistributionStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
}

// ─── Distribution Result ───

export interface DistributionResult {
  /** Request ID this result corresponds to */
  requestId: Uint8Array;
  /** Result data */
  resultData: Uint8Array;
  /** Number of devices that participated */
  devicesUsed: number;
  /** Total execution time across all devices */
  executionTimeMs: number;
  /** CCU actually spent */
  ccuSpent: number;
  /** Success */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ─── Distribution Bridge ───

export class DistributionBridge {
  /** requestId hex → DistributionRequest */
  private pending = new Map<string, DistributionRequest>();
  /** correlationId hex → requestId hex (reverse lookup) */
  private correlations = new Map<string, string>();

  /** Callback: submit task to CMP pipeline (L3-L6) */
  private submitFn: ((req: DistributionRequest) => Promise<void>) | null = null;

  /** Callback: deliver result cause to the Lifeform */
  private deliverResultFn: ((lifeformName: string, cause: Cause) => Promise<void>) | null = null;

  /** Stats */
  private totalSubmitted = 0;
  private totalCompleted = 0;
  private totalFailed = 0;

  /** Set the CMP pipeline submission callback */
  onSubmit(fn: (req: DistributionRequest) => Promise<void>): void {
    this.submitFn = fn;
  }

  /** Set the result delivery callback */
  onDeliverResult(fn: (lifeformName: string, cause: Cause) => Promise<void>): void {
    this.deliverResultFn = fn;
  }

  /**
   * Submit a distributed computation request from a Lifeform.
   * Called by the WASM runtime when lf_distribute() is invoked.
   */
  async submit(
    lifeformId: Uint8Array,
    lifeformName: string,
    wasmModuleHash: Uint8Array,
    inputData: Uint8Array,
    taskType: TaskType,
    deadlineMs: number,
    securityLevel: number,
    ccuBudget: number,
  ): Promise<Uint8Array> {
    const id = randomBytes(16);
    const correlationId = randomBytes(16);

    const request: DistributionRequest = {
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
      } catch (err: any) {
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
  async handleResult(result: DistributionResult): Promise<boolean> {
    const idHex = toHex(result.requestId);
    const request = this.pending.get(idHex);
    if (!request) return false;

    request.status = result.success
      ? DistributionStatus.COMPLETED
      : DistributionStatus.FAILED;

    if (result.success) this.totalCompleted++;
    else this.totalFailed++;

    // Build DISTRIBUTION_RESULT cause
    const cause: Cause = {
      id: randomBytes(16),
      type: CauseType.DISTRIBUTION_RESULT,
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
  checkTimeouts(): number {
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
  getByCorrelation(correlationId: Uint8Array): DistributionRequest | null {
    const corrHex = toHex(correlationId);
    const idHex = this.correlations.get(corrHex);
    if (!idHex) return null;
    return this.pending.get(idHex) ?? null;
  }

  /**
   * Get all pending requests for a Lifeform.
   */
  getPendingFor(lifeformName: string): DistributionRequest[] {
    return [...this.pending.values()].filter(r => r.lifeformName === lifeformName);
  }

  /** Get stats */
  getStats(): {
    totalSubmitted: number;
    totalCompleted: number;
    totalFailed: number;
    pending: number;
  } {
    return {
      totalSubmitted: this.totalSubmitted,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      pending: this.pending.size,
    };
  }

  /** Pending count */
  get pendingCount(): number {
    return this.pending.size;
  }
}
