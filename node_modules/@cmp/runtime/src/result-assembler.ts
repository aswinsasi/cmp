/**
 * CMP Result Assembler
 * Layer 6: Collects chunk results, verifies correctness,
 * and reassembles the final task output.
 *
 * @module runtime/result-assembler
 * @author Agent Viscro
 */

import {
  CMPResult,
  ChunkStatus,
  TaskCompletion,
  VerifyResult,
  VerifyMode,
  TaskType,
  SessionKey,
  decrypt,
  hash256,
  toHex,
  shortId,
  bytesEqual,
  Logger,
} from '../../core/src';
import type { DecompositionPlan } from './task-distributor';
import { DataSplitter } from './data-splitter';

const log = new Logger('Assembler');

export class ResultAssembler {
  /** chunkId hex → results (may have multiple for redundant execution) */
  private results = new Map<string, CMPResult[]>();
  private plan: DecompositionPlan;
  private sessionKey: SessionKey;
  private startTime: number;
  private splitter = new DataSplitter();

  constructor(plan: DecompositionPlan, sessionKey: SessionKey) {
    this.plan = plan;
    this.sessionKey = sessionKey;
    this.startTime = Date.now();
  }

  /**
   * Submit a chunk result. Returns TaskCompletion if all chunks are done.
   */
  collectResult(result: CMPResult): TaskCompletion | null {
    const chunkHex = toHex(result.chunkId);

    if (!this.results.has(chunkHex)) {
      this.results.set(chunkHex, []);
    }
    this.results.get(chunkHex)!.push(result);

    log.debug(`Result collected for chunk ${shortId(result.chunkId)}: ${ChunkStatus[result.status]}`, {
      executorId: shortId(result.executorId),
      timeMs: result.executionTimeMs,
    });

    if (this.isComplete()) {
      return this.assemble();
    }
    return null;
  }

  /**
   * Check if all chunks have at least one successful result.
   */
  isComplete(): boolean {
    for (const chunk of this.plan.chunks) {
      const chunkHex = toHex(chunk.chunkId);
      const results = this.results.get(chunkHex) || [];
      const hasSuccess = results.some((r) => r.status === ChunkStatus.SUCCESS);
      if (!hasSuccess) return false;
    }
    return true;
  }

  /**
   * Get count of collected results.
   */
  getCollectedCount(): number {
    let count = 0;
    for (const results of this.results.values()) {
      count += results.length;
    }
    return count;
  }

  /**
   * Get count of chunks still pending.
   */
  getPendingCount(): number {
    let pending = 0;
    for (const chunk of this.plan.chunks) {
      const chunkHex = toHex(chunk.chunkId);
      const results = this.results.get(chunkHex) || [];
      const hasSuccess = results.some((r) => r.status === ChunkStatus.SUCCESS);
      if (!hasSuccess) pending++;
    }
    return pending;
  }

  /**
   * Get list of failed chunk IDs.
   */
  getFailedChunks(): Uint8Array[] {
    const failed: Uint8Array[] = [];
    for (const chunk of this.plan.chunks) {
      const chunkHex = toHex(chunk.chunkId);
      const results = this.results.get(chunkHex) || [];
      const allFailed = results.length > 0 && results.every((r) => r.status !== ChunkStatus.SUCCESS);
      if (allFailed) failed.push(chunk.chunkId);
    }
    return failed;
  }

  /**
   * Assemble all results into final task output.
   */
  private assemble(): TaskCompletion {
    // Sort chunks by sequence
    const ordered = [...this.plan.chunks].sort((a, b) => a.sequence - b.sequence);

    // Select best result for each chunk (with verification)
    const selectedResults: CMPResult[] = [];
    let verifyResult: VerifyResult = { valid: true, confidence: 1.0 };

    for (const chunk of ordered) {
      const chunkHex = toHex(chunk.chunkId);
      const chunkResults = this.results.get(chunkHex) || [];
      const successResults = chunkResults.filter((r) => r.status === ChunkStatus.SUCCESS);

      if (successResults.length === 0) {
        // Should not happen if isComplete() was true, but handle gracefully
        verifyResult = { valid: false, confidence: 0, reason: `No success result for chunk ${shortId(chunk.chunkId)}` };
        continue;
      }

      // If redundant execution, verify consistency
      if (successResults.length >= 2) {
        const vr = this.verifyRedundant(successResults);
        if (!vr.valid) {
          verifyResult = vr;
        }
      }

      selectedResults.push(successResults[0]);
    }

    // Decrypt all results
    const decryptedChunks: Uint8Array[] = [];
    for (const result of selectedResults) {
      try {
        const decrypted = decrypt(result.payload, this.sessionKey);
        decryptedChunks.push(decrypted);
      } catch {
        // Try raw (unencrypted) payload
        decryptedChunks.push(result.payload);
      }
    }

    // Merge based on strategy
    const assembled = this.mergeByStrategy(decryptedChunks);

    const totalTimeMs = Date.now() - this.startTime;
    const devicesUsed = new Set(selectedResults.map((r) => toHex(r.executorId))).size;

    log.info(`Task assembled: ${decryptedChunks.length} chunks, ${devicesUsed} devices, ${totalTimeMs}ms`);

    return {
      taskId: this.plan.chunks[0]?.taskId || new Uint8Array(16),
      result: assembled,
      totalTimeMs,
      chunksExecuted: selectedResults.length,
      devicesUsed,
      verificationType: this.plan.redundancy > 1 ? 'REDUNDANT' : 'NONE',
      verificationResult: verifyResult,
    };
  }

  /**
   * Verify redundant execution results via majority voting.
   */
  private verifyRedundant(results: CMPResult[]): VerifyResult {
    // Hash each result's payload
    const hashCounts = new Map<string, number>();
    for (const result of results) {
      const h = toHex(hash256(result.payload));
      hashCounts.set(h, (hashCounts.get(h) || 0) + 1);
    }

    // Find majority
    let maxCount = 0;
    let majorityHash = '';
    for (const [h, count] of hashCounts) {
      if (count > maxCount) {
        maxCount = count;
        majorityHash = h;
      }
    }

    const confidence = maxCount / results.length;
    const valid = confidence > 0.5;

    if (!valid) {
      log.warn('Redundant verification failed: no majority consensus', {
        results: results.length,
        uniqueHashes: hashCounts.size,
      });
    }

    return { valid, confidence, majorityHash };
  }

  /**
   * Merge chunks based on the decomposition strategy.
   */
  private mergeByStrategy(chunks: Uint8Array[]): Uint8Array {
    if (chunks.length === 0) return new Uint8Array(0);

    switch (this.plan.strategy) {
      case TaskType.MAP_REDUCE:
      case TaskType.CUSTOM:
      case TaskType.INFERENCE:
        // Concatenate in order
        return this.splitter.reassembleParallel(chunks);

      case TaskType.PIPELINE:
        // Pipeline: final stage output is the result
        return chunks[chunks.length - 1];

      case TaskType.SCATTER_GATHER:
        // Scatter-gather: return all results concatenated
        // (application layer decides how to use multiple results)
        return this.splitter.reassembleParallel(chunks);

      default:
        return this.splitter.reassembleParallel(chunks);
    }
  }

  /**
   * Reset the assembler for reuse.
   */
  reset(): void {
    this.results.clear();
    this.startTime = Date.now();
  }
}
