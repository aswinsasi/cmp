/**
 * CMP v4.0 — Data-Parallel Patterns
 *
 * Parallelization patterns for data-parallel workloads:
 *   - Sort: merge-sort decomposition
 *   - Map: embarrassingly parallel (chunk + apply independently)
 *   - Reduce: tree reduction (sum, product, min, max, etc.)
 *   - Filter: distribute predicate, concatenate matches
 *   - Search: partition search space, first match wins
 *
 * @module compiler/patterns/data-patterns
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

    chunks.push({
      index: i,
      offset,
      length,
      data: data.slice(offset, offset + length),
    });
  }

  return chunks;
}

// ═══════════════════════════════════════
// Sort Pattern (merge-sort decomposition)
// ═══════════════════════════════════════

export class SortPattern implements IPattern {
  readonly name = ParallelPattern.SORT;
  readonly mergeType = MergeType.MERGE_SORT;

  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch {
    let confidence = 0;
    let reason = '';

    // Check WASM exports for sort-related names
    const sortNames = ['sort', 'qsort', 'mergesort', 'heapsort', 'compare', 'swap'];
    const matches = wasmExports.filter(e => sortNames.some(s => e.toLowerCase().includes(s)));

    if (matches.length > 0) {
      confidence = 0.85;
      reason = `WASM exports contain sort functions: ${matches.join(', ')}`;
    } else if (meta.entryPoint.toLowerCase().includes('sort')) {
      confidence = 0.9;
      reason = `Entry point "${meta.entryPoint}" indicates sorting`;
    }

    return {
      pattern: ParallelPattern.SORT,
      confidence,
      reason: reason || 'No sort indicators detected',
      suggestedChunks: Math.min(meta.availableDevices, 8),
      orderPreserving: true,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    const elementSize = meta.elementSizeBytes ?? 4;
    const chunks = splitEvenly(inputData, chunkCount, elementSize);

    return {
      pattern: ParallelPattern.SORT,
      chunks,
      meta: { elementSize, totalElements: Math.floor(inputData.length / elementSize) },
    };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();
    const elementSize = meta.elementSize ?? 4;

    if (results.length === 0) {
      return { data: new Uint8Array(0), mergeTimeMs: 0, chunksProcessed: 0 };
    }
    if (results.length === 1) {
      return { data: results[0], mergeTimeMs: Date.now() - startMs, chunksProcessed: 1 };
    }

    // K-way merge of sorted subarrays
    // For simplicity and correctness, do pairwise merge bottom-up
    let current = results.map(r => r);

    while (current.length > 1) {
      const next: Uint8Array[] = [];
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          next.push(this.mergeTwoSorted(current[i], current[i + 1], elementSize));
        } else {
          next.push(current[i]);
        }
      }
      current = next;
    }

    return {
      data: current[0],
      mergeTimeMs: Date.now() - startMs,
      chunksProcessed: results.length,
    };
  }

  private mergeTwoSorted(a: Uint8Array, b: Uint8Array, elemSize: number): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    const aCount = Math.floor(a.length / elemSize);
    const bCount = Math.floor(b.length / elemSize);
    let ai = 0, bi = 0, ri = 0;

    while (ai < aCount && bi < bCount) {
      const aVal = this.readElement(a, ai * elemSize, elemSize);
      const bVal = this.readElement(b, bi * elemSize, elemSize);
      if (aVal <= bVal) {
        result.set(a.slice(ai * elemSize, (ai + 1) * elemSize), ri * elemSize);
        ai++;
      } else {
        result.set(b.slice(bi * elemSize, (bi + 1) * elemSize), ri * elemSize);
        bi++;
      }
      ri++;
    }

    while (ai < aCount) {
      result.set(a.slice(ai * elemSize, (ai + 1) * elemSize), ri * elemSize);
      ai++; ri++;
    }
    while (bi < bCount) {
      result.set(b.slice(bi * elemSize, (bi + 1) * elemSize), ri * elemSize);
      bi++; ri++;
    }

    return result.slice(0, ri * elemSize);
  }

  private readElement(data: Uint8Array, offset: number, size: number): number {
    if (size === 4) {
      return (data[offset]) | (data[offset + 1] << 8) |
             (data[offset + 2] << 16) | (data[offset + 3] << 24);
    }
    if (size === 1) return data[offset];
    if (size === 2) return data[offset] | (data[offset + 1] << 8);
    // Default: first byte
    return data[offset];
  }
}

// ═══════════════════════════════════════
// Map Pattern (embarrassingly parallel)
// ═══════════════════════════════════════

export class MapPattern implements IPattern {
  readonly name = ParallelPattern.MAP;
  readonly mergeType = MergeType.CONCATENATE;

  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch {
    let confidence = 0;
    let reason = '';

    const mapNames = ['map', 'transform', 'apply', 'process', 'convert', 'encode', 'decode'];
    const matches = wasmExports.filter(e => mapNames.some(s => e.toLowerCase().includes(s)));

    if (matches.length > 0) {
      confidence = 0.7;
      reason = `WASM exports contain map-like functions: ${matches.join(', ')}`;
    } else if (mapNames.some(n => meta.entryPoint.toLowerCase().includes(n))) {
      confidence = 0.75;
      reason = `Entry point "${meta.entryPoint}" indicates map operation`;
    }

    // Large input with process/transform entry = high map confidence
    if (meta.inputSizeBytes > 10000 && meta.entryPoint === 'process') {
      confidence = Math.max(confidence, 0.6);
      reason = reason || 'Large input with "process" entry point';
    }

    return {
      pattern: ParallelPattern.MAP,
      confidence,
      reason: reason || 'No map indicators detected',
      suggestedChunks: Math.min(meta.availableDevices, 8),
      orderPreserving: true,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    const elementSize = meta.elementSizeBytes ?? 1; // byte-level for map
    const chunks = splitEvenly(inputData, chunkCount, elementSize);

    return {
      pattern: ParallelPattern.MAP,
      chunks,
      meta: { elementSize, preserveOrder: true },
    };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();
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
// Reduce Pattern (tree reduction)
// ═══════════════════════════════════════

export class ReducePattern implements IPattern {
  readonly name = ParallelPattern.REDUCE;
  readonly mergeType = MergeType.TREE_REDUCE;

  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch {
    let confidence = 0;
    let reason = '';

    const reduceNames = ['reduce', 'accumulate', 'aggregate', 'sum', 'count', 'total', 'fold'];
    const matches = wasmExports.filter(e => reduceNames.some(s => e.toLowerCase().includes(s)));

    if (matches.length > 0) {
      confidence = 0.8;
      reason = `WASM exports contain reduce functions: ${matches.join(', ')}`;
    } else if (reduceNames.some(n => meta.entryPoint.toLowerCase().includes(n))) {
      confidence = 0.85;
      reason = `Entry point "${meta.entryPoint}" indicates reduction`;
    }

    return {
      pattern: ParallelPattern.REDUCE,
      confidence,
      reason: reason || 'No reduce indicators detected',
      suggestedChunks: Math.min(meta.availableDevices, 8),
      orderPreserving: false,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    const elementSize = meta.elementSizeBytes ?? 4;
    const chunks = splitEvenly(inputData, chunkCount, elementSize);

    return {
      pattern: ParallelPattern.REDUCE,
      chunks,
      meta: { elementSize, operation: 'user_defined' },
    };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();

    // Tree reduce: each partial result is a single reduced value
    // The final merge just concatenates partial results for a second-level reduce
    // (In a real system, the WASM module would be re-invoked on the partials)
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
// Filter Pattern
// ═══════════════════════════════════════

export class FilterPattern implements IPattern {
  readonly name = ParallelPattern.FILTER;
  readonly mergeType = MergeType.FILTER_CONCAT;

  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch {
    let confidence = 0;
    let reason = '';

    const filterNames = ['filter', 'select', 'where', 'match', 'predicate', 'test', 'grep'];
    const matches = wasmExports.filter(e => filterNames.some(s => e.toLowerCase().includes(s)));

    if (matches.length > 0) {
      confidence = 0.8;
      reason = `WASM exports contain filter functions: ${matches.join(', ')}`;
    } else if (filterNames.some(n => meta.entryPoint.toLowerCase().includes(n))) {
      confidence = 0.85;
      reason = `Entry point "${meta.entryPoint}" indicates filtering`;
    }

    return {
      pattern: ParallelPattern.FILTER,
      confidence,
      reason: reason || 'No filter indicators detected',
      suggestedChunks: Math.min(meta.availableDevices, 8),
      orderPreserving: true,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    const elementSize = meta.elementSizeBytes ?? 1;
    const chunks = splitEvenly(inputData, chunkCount, elementSize);

    return {
      pattern: ParallelPattern.FILTER,
      chunks,
      meta: { elementSize },
    };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();
    // Filter: concatenate all non-empty results (preserving order)
    const nonEmpty = results.filter(r => r.length > 0);
    const totalLen = nonEmpty.reduce((s, r) => s + r.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const r of nonEmpty) {
      merged.set(r, offset);
      offset += r.length;
    }

    return { data: merged, mergeTimeMs: Date.now() - startMs, chunksProcessed: results.length };
  }
}

// ═══════════════════════════════════════
// Search Pattern
// ═══════════════════════════════════════

export class SearchPattern implements IPattern {
  readonly name = ParallelPattern.SEARCH;
  readonly mergeType = MergeType.FIRST_MATCH;

  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch {
    let confidence = 0;
    let reason = '';

    const searchNames = ['search', 'find', 'lookup', 'locate', 'index', 'contains', 'exists'];
    const matches = wasmExports.filter(e => searchNames.some(s => e.toLowerCase().includes(s)));

    if (matches.length > 0) {
      confidence = 0.8;
      reason = `WASM exports contain search functions: ${matches.join(', ')}`;
    } else if (searchNames.some(n => meta.entryPoint.toLowerCase().includes(n))) {
      confidence = 0.85;
      reason = `Entry point "${meta.entryPoint}" indicates search`;
    }

    return {
      pattern: ParallelPattern.SEARCH,
      confidence,
      reason: reason || 'No search indicators detected',
      suggestedChunks: Math.min(meta.availableDevices, 8),
      orderPreserving: false,
    };
  }

  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult {
    // Search: partition the search space
    const chunks = splitEvenly(inputData, chunkCount, 1);

    return {
      pattern: ParallelPattern.SEARCH,
      chunks,
      meta: { searchType: 'linear_partition' },
    };
  }

  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult {
    const startMs = Date.now();
    // First match: take the first non-empty result
    const match = results.find(r => r.length > 0);
    const data = match ?? new Uint8Array(0);

    return { data, mergeTimeMs: Date.now() - startMs, chunksProcessed: results.length };
  }
}
