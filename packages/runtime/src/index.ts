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

export { TaskDistributor } from './task-distributor';
export type { DecompositionPlan } from './task-distributor';

export { ExecutionEngine } from './execution-engine';
export type { ExecutionConfig } from './execution-engine';

export { ResultAssembler } from './result-assembler';
