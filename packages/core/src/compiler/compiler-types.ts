/**
 * CMP v4.0 — Task Compiler Types
 *
 * Type definitions for the Universal Task Compiler.
 * The compiler auto-detects parallelizable patterns in submitted
 * code and generates execution plans.
 *
 * @module compiler/compiler-types
 * @author Agent Viscro
 */

// ─── Parallelization Pattern ───

export enum ParallelPattern {
  SORT         = 'sort',
  MAP          = 'map',
  REDUCE       = 'reduce',
  FILTER       = 'filter',
  SEARCH       = 'search',
  MATRIX       = 'matrix',
  ML_TRAIN     = 'ml_train',
  ML_INFER     = 'ml_infer',
  COMPRESS     = 'compress',
  HASH         = 'hash',
  GENERIC      = 'generic',  // Fallback: replicate and race
}

// ─── Pattern Detection Result ───

export interface PatternMatch {
  pattern: ParallelPattern;
  confidence: number;      // 0.0 - 1.0
  reason: string;
  /** Suggested chunk count (0 = auto) */
  suggestedChunks: number;
  /** Whether data order matters in output */
  orderPreserving: boolean;
}

// ─── Data Chunk ───

export interface DataChunk {
  index: number;
  offset: number;
  length: number;
  data: Uint8Array;
}

// ─── Decomposition Strategy ───

export interface DecompositionResult {
  pattern: ParallelPattern;
  chunks: DataChunk[];
  /** Metadata needed by the merge strategy (e.g., total count for reduce) */
  meta: Record<string, any>;
}

// ─── Merge Strategy ───

export enum MergeType {
  CONCATENATE      = 'concatenate',      // Just join chunks in order
  MERGE_SORT       = 'merge_sort',       // Merge sorted sub-arrays
  TREE_REDUCE      = 'tree_reduce',      // Binary tree reduction (sum, product, etc.)
  FILTER_CONCAT    = 'filter_concat',    // Concatenate non-empty filter results
  FIRST_MATCH      = 'first_match',      // Take first non-null result (search)
  BLOCK_ASSEMBLE   = 'block_assemble',   // Reassemble matrix blocks
  GRADIENT_AVERAGE = 'gradient_average', // Average gradients (ML training)
  RACE_WINNER      = 'race_winner',      // Take fastest result
}

export interface MergeResult {
  data: Uint8Array;
  mergeTimeMs: number;
  chunksProcessed: number;
}

// ─── Compilation Plan ───

export interface CompilationPlan {
  /** Detected pattern */
  pattern: ParallelPattern;
  /** Detection confidence */
  confidence: number;
  /** Number of chunks to split data into */
  chunkCount: number;
  /** How to merge results */
  mergeType: MergeType;
  /** Whether chunk order matters */
  orderPreserving: boolean;
  /** Device assignments (device ID → chunk indices) */
  deviceAssignments: Map<string, number[]>;
  /** The WASM module to distribute to each device */
  wasmModule: Uint8Array;
  /** Chunked input data */
  chunks: DataChunk[];
  /** Metadata for merge phase */
  meta: Record<string, any>;
  /** Fallback plan (if primary fails) */
  fallbackPattern: ParallelPattern;
  /** Human-readable explanation */
  explanation: string;
}

// ─── Pattern Interface ───

/**
 * Every parallelization pattern implements this interface.
 */
export interface IPattern {
  /** Pattern identifier */
  readonly name: ParallelPattern;
  
  /**
   * Detect if this pattern applies to the given task.
   * Returns confidence 0-1 (0 = definitely not, 1 = definitely yes).
   */
  detect(wasmExports: string[], inputData: Uint8Array, meta: TaskMeta): PatternMatch;
  
  /**
   * Decompose input data into chunks for parallel execution.
   */
  decompose(inputData: Uint8Array, chunkCount: number, meta: TaskMeta): DecompositionResult;
  
  /**
   * Merge results from parallel execution back into a single output.
   */
  merge(results: Uint8Array[], meta: Record<string, any>): MergeResult;
  
  /**
   * Which merge type this pattern uses.
   */
  readonly mergeType: MergeType;
}

// ─── Task Metadata ───

export interface TaskMeta {
  /** WASM export function names (from module analysis) */
  wasmExports: string[];
  /** Input data size in bytes */
  inputSizeBytes: number;
  /** Number of available devices */
  availableDevices: number;
  /** Device IDs available for assignment */
  deviceIds: string[];
  /** Optional: user-specified entry point */
  entryPoint: string;
  /** Optional: user hint about element size (bytes per item) */
  elementSizeBytes?: number;
}

// ─── Compiler Config ───

export interface TaskCompilerConfig {
  /** Minimum input size to consider parallelization (bytes) */
  minInputSizeBytes: number;
  /** Maximum chunk count */
  maxChunks: number;
  /** Minimum confidence for pattern match (0-1) */
  minConfidence: number;
  /** Default element size for data splitting (bytes) */
  defaultElementSize: number;
}

export const DEFAULT_COMPILER_CONFIG: TaskCompilerConfig = {
  minInputSizeBytes: 1024,       // 1 KB minimum
  maxChunks: 16,
  minConfidence: 0.3,
  defaultElementSize: 4,         // float32
};
