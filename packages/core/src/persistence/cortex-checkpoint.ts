/**
 * CMP v4.0 — Cortex Checkpoint
 *
 * Higher-level checkpoint orchestrator for Cortex L14 model partitions.
 * Wraps V3StateStore's cortex checkpoint API with:
 *   - Model partition splitting & reassembly
 *   - Integrity verification (hash before/after)
 *   - Restore validation
 *   - Checkpoint metadata tracking
 *
 * Interface-driven: Cortex L14 implements ICortexCheckpointable
 * and this module handles the persistence mechanics.
 *
 * @module persistence/cortex-checkpoint
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import { V3StateStore, CortexManifest, CortexCheckpoint } from './v3-state-store';

const log = new Logger('CortexCkpt');

// ─── Hex/Hash Helpers ───

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Simple FNV-1a hash for integrity checks.
 * Not cryptographic — just for detecting corruption.
 */
function fnv1a(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ─── Interfaces ───

/**
 * Interface that Cortex L14 model holders must implement
 * to support checkpointing.
 */
export interface ICortexCheckpointable {
  /** Unique model identifier */
  getModelId(): string;
  /** Human-readable model name */
  getModelName(): string;
  /** Total number of layers in the model */
  getTotalLayers(): number;
  /** Total parameter count */
  getTotalParams(): number;
  /** Number of partitions this model is split into */
  getPartitionCount(): number;
  /** Data type of weights */
  getDtype(): string;
  /**
   * Export a single partition's weights as a binary buffer.
   * @param partitionId - 0-indexed partition number
   * @returns [layerRange, weightsBuffer]
   */
  exportPartition(partitionId: number): { layerRange: [number, number]; weights: Uint8Array };
  /**
   * Import a single partition's weights from a binary buffer.
   * @param partitionId - 0-indexed partition number
   * @param weights - raw weight bytes
   * @param manifest - partition metadata
   */
  importPartition(partitionId: number, weights: Uint8Array, manifest: CortexManifest): void;
}

/**
 * Result from a checkpoint operation.
 */
export interface CheckpointResult {
  modelId: string;
  partitionsSaved: number;
  totalBytes: number;
  durationMs: number;
  integrityHashes: string[];
}

/**
 * Result from a restore operation.
 */
export interface RestoreResult {
  modelId: string;
  partitionsRestored: number;
  totalBytes: number;
  durationMs: number;
  integrityValid: boolean;
}

// ─── Cortex Checkpoint Manager ───

export class CortexCheckpointManager {
  private store: V3StateStore;

  constructor(store: V3StateStore) {
    this.store = store;
  }

  /**
   * Checkpoint an entire model — iterates all partitions,
   * exports weights, computes integrity hashes, saves to SQLite.
   */
  checkpoint(model: ICortexCheckpointable): CheckpointResult {
    const startMs = Date.now();
    const modelId = model.getModelId();
    const partitionCount = model.getPartitionCount();
    const hashes: string[] = [];
    let totalBytes = 0;

    log.info(`Checkpointing model ${modelId} (${partitionCount} partitions)...`);

    for (let i = 0; i < partitionCount; i++) {
      const { layerRange, weights } = model.exportPartition(i);
      const hash = fnv1a(weights);
      hashes.push(hash);
      totalBytes += weights.length;

      const manifest: CortexManifest = {
        modelId,
        modelName: model.getModelName(),
        totalLayers: model.getTotalLayers(),
        totalParams: model.getTotalParams(),
        partitionCount,
        layerRange,
        dtype: model.getDtype(),
        checkpointedAt: Date.now(),
      };

      this.store.checkpointModel(modelId, i, manifest, weights);
    }

    // Save integrity hashes as state metadata
    this.store.saveState('cortex', `integrity:${modelId}`, {
      hashes,
      partitionCount,
      totalBytes,
      checkpointedAt: Date.now(),
    });

    const durationMs = Date.now() - startMs;
    log.info(`Checkpointed ${modelId}: ${partitionCount} partitions, ${(totalBytes / 1024).toFixed(1)} KB in ${durationMs}ms`);

    return { modelId, partitionsSaved: partitionCount, totalBytes, durationMs, integrityHashes: hashes };
  }

  /**
   * Restore a model from checkpoint — loads all partitions,
   * verifies integrity, imports weights into the model.
   */
  restore(model: ICortexCheckpointable): RestoreResult {
    const startMs = Date.now();
    const modelId = model.getModelId();

    log.info(`Restoring model ${modelId}...`);

    // Load integrity metadata
    const integrity = this.store.loadState<{
      hashes: string[];
      partitionCount: number;
      totalBytes: number;
    }>('cortex', `integrity:${modelId}`);

    // Load checkpoints
    const checkpoints = this.store.restoreModel(modelId);

    if (checkpoints.length === 0) {
      log.warn(`No checkpoint found for model ${modelId}`);
      return { modelId, partitionsRestored: 0, totalBytes: 0, durationMs: Date.now() - startMs, integrityValid: false };
    }

    let totalBytes = 0;
    let integrityValid = true;

    for (const ckpt of checkpoints) {
      // Verify integrity if we have hashes
      if (integrity && integrity.hashes[ckpt.partitionId]) {
        const expectedHash = integrity.hashes[ckpt.partitionId];
        const actualHash = fnv1a(ckpt.weights);
        if (actualHash !== expectedHash) {
          log.warn(`Integrity check failed for ${modelId} partition ${ckpt.partitionId}: expected ${expectedHash}, got ${actualHash}`);
          integrityValid = false;
        }
      }

      model.importPartition(ckpt.partitionId, ckpt.weights, ckpt.manifest);
      totalBytes += ckpt.weights.length;
    }

    const durationMs = Date.now() - startMs;
    log.info(`Restored ${modelId}: ${checkpoints.length} partitions, ${(totalBytes / 1024).toFixed(1)} KB in ${durationMs}ms (integrity: ${integrityValid ? 'OK' : 'FAILED'})`);

    return { modelId, partitionsRestored: checkpoints.length, totalBytes, durationMs, integrityValid };
  }

  /**
   * Check if a model has a saved checkpoint.
   */
  hasCheckpoint(modelId: string): boolean {
    const checkpoints = this.store.restoreModel(modelId);
    return checkpoints.length > 0;
  }

  /**
   * List all checkpointed models with metadata.
   */
  listCheckpoints(): Array<{
    modelId: string;
    modelName: string;
    partitions: number;
    totalBytes: number;
    checkpointedAt: number;
    integrityHashCount: number;
  }> {
    const models = this.store.listModels();

    return models.map(m => {
      // Get first partition manifest for model name
      const ckpts = this.store.restoreModel(m.modelId);
      const manifest = ckpts.length > 0 ? ckpts[0].manifest : null;
      const integrity = this.store.loadState<{ hashes: string[] }>('cortex', `integrity:${m.modelId}`);

      return {
        modelId: m.modelId,
        modelName: manifest?.modelName ?? 'unknown',
        partitions: m.partitions,
        totalBytes: m.totalBytes,
        checkpointedAt: manifest?.checkpointedAt ?? 0,
        integrityHashCount: integrity?.hashes?.length ?? 0,
      };
    });
  }

  /**
   * Delete a model checkpoint.
   */
  deleteCheckpoint(modelId: string): void {
    this.store.deleteModel(modelId);
    this.store.deleteState('cortex', `integrity:${modelId}`);
    log.info(`Deleted checkpoint for model ${modelId}`);
  }

  /**
   * Verify a checkpoint's integrity without restoring it.
   */
  verifyCheckpoint(modelId: string): { valid: boolean; partitions: number; errors: string[] } {
    const integrity = this.store.loadState<{ hashes: string[]; partitionCount: number }>(
      'cortex', `integrity:${modelId}`,
    );
    const checkpoints = this.store.restoreModel(modelId);
    const errors: string[] = [];

    if (checkpoints.length === 0) {
      return { valid: false, partitions: 0, errors: ['No checkpoint data found'] };
    }

    if (!integrity) {
      return { valid: false, partitions: checkpoints.length, errors: ['No integrity metadata found'] };
    }

    if (checkpoints.length !== integrity.partitionCount) {
      errors.push(`Expected ${integrity.partitionCount} partitions, found ${checkpoints.length}`);
    }

    for (const ckpt of checkpoints) {
      if (integrity.hashes[ckpt.partitionId]) {
        const actual = fnv1a(ckpt.weights);
        if (actual !== integrity.hashes[ckpt.partitionId]) {
          errors.push(`Partition ${ckpt.partitionId}: hash mismatch (expected ${integrity.hashes[ckpt.partitionId]}, got ${actual})`);
        }
      }
    }

    return { valid: errors.length === 0, partitions: checkpoints.length, errors };
  }
}
