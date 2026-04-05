/**
 * CMP v4.0 — Compute-Heavy Patterns
 *
 * Parallelization patterns for compute-intensive workloads:
 *   - Matrix: block decomposition for matrix operations
 *   - ML Train: data-parallel gradient averaging
 *   - Hash: partition input, parallel hashing
 *   - Compress: block-independent compression
 *   - Generic: fallback — replicate and race
 *
 * @module compiler/patterns/compute-patterns
 * @author Agent Viscro
 */

import {
  IPattern, ParallelPattern, PatternMatch, DecompositionResult,
  MergeResult, MergeType, DataChunk, TaskMeta,
} from '../compiler-types';

// ─── Helpers ───

function splitEvenly(data: Uint8Array, chunkCount: number, elementSize: number): DataChunk[] {
  const totalElements = Math.floor(data.length / elementSize);
  const elementsPerChunk = Math.ceil(totalElements / chunkCount);
  const chunks: DataChunk[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const startElem = i * elementsPerChunk;
    const endElem = Math.min(startElem + elementsPerChunk, totalElements);
    const offset = startElem * elementSize;
    const length = (endElem - startElem) * elementSize;

    if (length <= 0) break;

    chunks.push({ index: i, offset, length, data: data.slice(offset, offset + length) });
  }

  return chunks;
}

// ═══════════════════════════════════════
// Matrix Pattern (block decomposition)
// ═══════════════════════════════════════

export class MatrixPattern implements IPattern {
  readonly name = ParallelPattern.MATRIX;
  readonly mergeType = MergeType.BLOCK_ASSEMBLE;

  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch {
    let confidence = 0;
    let reason = '';

    const matNames = ['matmul', 'matrix', 'gemm', 'dot', 'multiply', 'transpose', 'conv', 'linear'];
    const matches = wasmExports.filter(e => matNames.some(s => e.toLowerCase().includes(s)));

    if (matches.length > 0) {
      confidence = 0.85;
      reason = `WASM exports contain matrix functions: ${matches.join(', ')}`;
    } else if (matNames.some(n => meta.entryPoint.toLowerCase().includes(n))) {
      confidence = 0.9;
      reason = `Entry point "${meta.entryPoint}" indicates matrix operation`;
    }

    // Float32-aligned large data = likely matrix
    if (confidence === 0 && inputData.length > 4096 && inputData.length % 4 === 0) {
      // Check if length is a perfect square * 4 (square matrix of float32)
      const floatCount = inputData.length / 4;
      const side = Math.sqrt(floatCount);
      if (Math.abs(side - Math.round(side)) < 0.01) {
        confidence = 0.5;
        reason = 'Data size suggests square matrix of float32 values';
      }
    }

    return {
      pattern: ParallelPattern.MATRIX,
      confidence,
      reason: reason || 'No matrix indicators detected',
      suggestedChunks: Math.min(meta.availableDevices, 4), // Matrix blocks: typically 2x2 or 4
      orderPreserving: true,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    // Block decomposition: split into row-blocks
    const elementSize = meta.elementSizeBytes ?? 4;
    const chunks = splitEvenly(inputData, chunkCount, elementSize);

    return {
      pattern: ParallelPattern.MATRIX,
      chunks,
      meta: { elementSize, blockCount: chunkCount },
    };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();
    // Reassemble row-blocks in order
    const totalLen = results.reduce((s, r) => s + r.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const r of results) {
      merged.set(r, offset);
      offset += r.length;
    }

    return { data: merged, mergeTimeMs: Date.now() - startMs, chunksProcessed: results.length };
  }
}

// ═══════════════════════════════════════
// ML Training Pattern (gradient averaging)
// ═══════════════════════════════════════

export class MLTrainPattern implements IPattern {
  readonly name = ParallelPattern.ML_TRAIN;
  readonly mergeType = MergeType.GRADIENT_AVERAGE;

  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch {
    let confidence = 0;
    let reason = '';

    const mlNames = ['train', 'gradient', 'backward', 'loss', 'sgd', 'adam', 'optimizer', 'epoch'];
    const matches = wasmExports.filter(e => mlNames.some(s => e.toLowerCase().includes(s)));

    if (matches.length > 0) {
      confidence = 0.85;
      reason = `WASM exports contain ML training functions: ${matches.join(', ')}`;
    } else if (mlNames.some(n => meta.entryPoint.toLowerCase().includes(n))) {
      confidence = 0.9;
      reason = `Entry point "${meta.entryPoint}" indicates ML training`;
    }

    return {
      pattern: ParallelPattern.ML_TRAIN,
      confidence,
      reason: reason || 'No ML training indicators detected',
      suggestedChunks: Math.min(meta.availableDevices, 4),
      orderPreserving: false,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    // Data-parallel: each device gets a shard of training data
    const chunks = splitEvenly(inputData, chunkCount, meta.elementSizeBytes ?? 4);

    return {
      pattern: ParallelPattern.ML_TRAIN,
      chunks,
      meta: { chunkCount, elementSize: meta.elementSizeBytes ?? 4 },
    };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();

    if (results.length === 0) {
      return { data: new Uint8Array(0), mergeTimeMs: 0, chunksProcessed: 0 };
    }

    // Gradient averaging: element-wise average of float32 arrays
    const elementSize = 4; // float32
    const elementCount = Math.floor(results[0].length / elementSize);
    const averaged = new Float32Array(elementCount);

    // Sum all gradients
    for (const result of results) {
      const view = new Float32Array(result.buffer, result.byteOffset, Math.floor(result.length / elementSize));
      for (let i = 0; i < Math.min(elementCount, view.length); i++) {
        averaged[i] += view[i];
      }
    }

    // Average
    for (let i = 0; i < elementCount; i++) {
      averaged[i] /= results.length;
    }

    return {
      data: new Uint8Array(averaged.buffer),
      mergeTimeMs: Date.now() - startMs,
      chunksProcessed: results.length,
    };
  }
}

// ═══════════════════════════════════════
// Hash Pattern
// ═══════════════════════════════════════

export class HashPattern implements IPattern {
  readonly name = ParallelPattern.HASH;
  readonly mergeType = MergeType.CONCATENATE;

  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch {
    let confidence = 0;
    let reason = '';

    const hashNames = ['hash', 'sha', 'md5', 'blake', 'keccak', 'digest', 'checksum', 'crc'];
    const matches = wasmExports.filter(e => hashNames.some(s => e.toLowerCase().includes(s)));

    if (matches.length > 0) {
      confidence = 0.85;
      reason = `WASM exports contain hash functions: ${matches.join(', ')}`;
    } else if (hashNames.some(n => meta.entryPoint.toLowerCase().includes(n))) {
      confidence = 0.9;
      reason = `Entry point "${meta.entryPoint}" indicates hashing`;
    }

    return {
      pattern: ParallelPattern.HASH,
      confidence,
      reason: reason || 'No hash indicators detected',
      suggestedChunks: Math.min(meta.availableDevices, 8),
      orderPreserving: true,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    const chunks = splitEvenly(inputData, chunkCount, 1);
    return { pattern: ParallelPattern.HASH, chunks, meta: {} };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();
    // Concatenate hash outputs in order
    const totalLen = results.reduce((s, r) => s + r.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const r of results) { merged.set(r, offset); offset += r.length; }
    return { data: merged, mergeTimeMs: Date.now() - startMs, chunksProcessed: results.length };
  }
}

// ═══════════════════════════════════════
// Compress Pattern
// ═══════════════════════════════════════

export class CompressPattern implements IPattern {
  readonly name = ParallelPattern.COMPRESS;
  readonly mergeType = MergeType.CONCATENATE;

  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch {
    let confidence = 0;
    let reason = '';

    const compNames = ['compress', 'deflate', 'gzip', 'lz', 'zstd', 'brotli', 'snappy', 'decompress', 'inflate'];
    const matches = wasmExports.filter(e => compNames.some(s => e.toLowerCase().includes(s)));

    if (matches.length > 0) {
      confidence = 0.85;
      reason = `WASM exports contain compression functions: ${matches.join(', ')}`;
    } else if (compNames.some(n => meta.entryPoint.toLowerCase().includes(n))) {
      confidence = 0.9;
      reason = `Entry point "${meta.entryPoint}" indicates compression`;
    }

    return {
      pattern: ParallelPattern.COMPRESS,
      confidence,
      reason: reason || 'No compression indicators detected',
      suggestedChunks: Math.min(meta.availableDevices, 8),
      orderPreserving: true,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    // Block-independent compression: each chunk compressed separately
    const chunks = splitEvenly(inputData, chunkCount, 1);
    return { pattern: ParallelPattern.COMPRESS, chunks, meta: {} };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();
    const totalLen = results.reduce((s, r) => s + r.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const r of results) { merged.set(r, offset); offset += r.length; }
    return { data: merged, mergeTimeMs: Date.now() - startMs, chunksProcessed: results.length };
  }
}

// ═══════════════════════════════════════
// Generic Pattern (replicate and race)
// ═══════════════════════════════════════

export class GenericPattern implements IPattern {
  readonly name = ParallelPattern.GENERIC;
  readonly mergeType = MergeType.RACE_WINNER;

  detect(_wasmExports: string[], _inputData: Uint8Array, _meta: TaskMeta): PatternMatch {
    // Generic always matches as a fallback with low confidence
    return {
      pattern: ParallelPattern.GENERIC,
      confidence: 0.2,
      reason: 'Fallback: no specific pattern detected — will replicate and race',
      suggestedChunks: 1, // Don't chunk — send full data to each racer
      orderPreserving: true,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    // Generic: don't split data — replicate to all devices
    const chunks: DataChunk[] = [];
    const racerCount = Math.min(chunkCount, 3); // Max 3 racers

    for (let i = 0; i < racerCount; i++) {
      chunks.push({
        index: i,
        offset: 0,
        length: inputData.length,
        data: inputData, // Same data to each racer
      });
    }

    return {
      pattern: ParallelPattern.GENERIC,
      chunks,
      meta: { racerCount, replicated: true },
    };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();
    // Race winner: take first non-empty result
    const winner = results.find(r => r.length > 0) ?? new Uint8Array(0);
    return { data: winner, mergeTimeMs: Date.now() - startMs, chunksProcessed: results.length };
  }
}
