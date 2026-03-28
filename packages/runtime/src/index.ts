/**
 * CMP Runtime - Barrel Export
 * Execution sandbox, resource monitoring, task distribution, and result assembly.
 *
 * @author Agent Viscro
 * @license MIT
 */

export { WASMSandbox, DEFAULT_SANDBOX_CONFIG } from './wasm-sandbox';
export type { SandboxConfig, ExecutionMetrics } from './wasm-sandbox';

export { ResourceMonitor } from './resource-monitor';
export type { ResourceLimits, ResourceSnapshot, ViolationReason, ViolationHandler } from './resource-monitor';

export { CodeCache } from './code-cache';

export { DataSplitter } from './data-splitter';
export type { SplitResult } from './data-splitter';

export { gfAdd, gfSub, gfMul, gfDiv, gfInv, gfPow, gfPolyEval, lagrangeInterpolateAt0 } from './gf256';

export { shamirSplit, shamirReconstruct, shamirVerify, sharesToWire, sharesFromWire } from './shamir';
export type { ShamirShare } from './shamir';

export { TaskDistributor } from './task-distributor';
export type { DecompositionPlan } from './task-distributor';

export { ExecutionEngine } from './execution-engine';
export type { ExecutionConfig } from './execution-engine';

export { ResultAssembler } from './result-assembler';

export {
  executeJavaScript,
  executePython,
  executeSubprocess,
  executeMultiRuntime,
  packCodePayload,
  detectRuntime,
  isRuntimeAvailable,
  listAvailableRuntimes,
  listAllLanguages,
} from './multi-runtime';
export type { RuntimeType, LanguageConfig } from './multi-runtime';
