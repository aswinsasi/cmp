/**
 * CMP v5.0 — Clean Public API
 *
 * Zero-config, zero-blockchain peer-to-peer WASM mesh computer.
 *
 * This is the public API surface. It exposes ONLY the practical
 * distributed computing primitives. Internal subsystems (swarm logic,
 * adaptive routing, speculative execution) are implementation details.
 *
 * @example Quick Start
 * ```typescript
 * import { CMPNode, buildSensorFilter } from '@agent-viscro/cmp';
 *
 * const node = new CMPNode({ transports: ['lan'] });
 * await node.start();
 *
 * // Distribute a WASM workload across all idle devices on your LAN
 * const wasm = buildSensorFilter(100);
 * const result = await node.compute(wasm, sensorData, {
 *   entryPoint: 'process',
 *   chunkHint: 4,
 * });
 *
 * console.log(`Processed by ${result.devicesUsed} devices in ${result.totalTimeMs}ms`);
 * await node.stop();
 * ```
 *
 * @example Streaming Pipeline
 * ```typescript
 * import { CMPNode, PipelineManager } from '@agent-viscro/cmp';
 *
 * const node = new CMPNode({ transports: ['lan'] });
 * await node.start();
 *
 * const pipes = new PipelineManager(node.shortMeshId());
 * pipes.define('etl', ['filter:predicate=gt:100', 'map:transform=double', 'collect']);
 * pipes.start('etl');
 * pipes.push('etl', rawData);
 * const output = pipes.stop('etl');
 * ```
 *
 * @example Build Custom WASM Module
 * ```typescript
 * import { WasmModuleBuilder, Op } from '@agent-viscro/cmp';
 *
 * const builder = new WasmModuleBuilder();
 * builder.addFunction('process', [Op.LocalGet, 0, Op.I32Const, 2, Op.I32Mul]);
 * const wasmBytes = builder.build();
 * ```
 *
 * @packageDocumentation
 * @module @agent-viscro/cmp
 * @author Agent Viscro
 * @license MIT
 */

// ═══════════════════════════════════════════
// CORE: Mesh Node
// ═══════════════════════════════════════════

export { CMPNode } from './cmp-node';
export type {
  ComputeOptions,
  ComputeResult,
  MeshStatus,
  PeerInfo,
  CMPNodeConfig,
} from './cmp-node';

// ═══════════════════════════════════════════
// COMPUTE: WASM Sandbox & Module Builder
// ═══════════════════════════════════════════

export { WasmSandbox } from './wasm/wasm-sandbox';
export type { WasmExecResult, SandboxConfig } from './wasm/wasm-sandbox';
export { WasmModuleBuilder, Op } from './wasm/wasm-module-builder';

// ═══════════════════════════════════════════
// COMPUTE: Built-in WASM Modules
// ═══════════════════════════════════════════

export {
  buildIdentityModule, buildDoubleBytesModule, buildXorCipherModule,
  buildThresholdFilterModule, buildByteSortModule, buildSumReduceModule,
  getBuiltinWasmModule, getBuiltinWasmModuleNames,
} from './wasm/builtin-wasm-modules';

// Real workloads
export {
  buildSensorFilter, buildSensorScale, buildSensorClamp,
  buildSensorDelta, buildSensorPeaks,
} from './wasm/workload-modules';

// Heavy workloads (image processing, signal processing)
export {
  buildGrayscaleModule, buildHistogramModule,
  buildMovingAverageModule, buildRLECompressModule,
} from './wasm/heavy-workloads';

// ═══════════════════════════════════════════
// SCHEDULING: Auto-Parallelization
// ═══════════════════════════════════════════

export { TaskCompiler } from './compiler/task-compiler';
export type { CompileResult } from './compiler/task-compiler';
export { PatternDetector, parseWasmExports } from './compiler/pattern-detector';
export { ParallelPattern, MergeType } from './compiler/compiler-types';
export type { CompilationPlan, TaskMeta, PatternMatch } from './compiler/compiler-types';

// ═══════════════════════════════════════════
// SCHEDULING: Bytecode Analysis (World's First)
// ═══════════════════════════════════════════

export { analyzeWasmBytecode, StructuralPattern, OutputRatio, MemoryPattern } from './compiler/bytecode-analyzer';
export type { BytecodeAnalysis, FunctionAnalysis } from './compiler/bytecode-analyzer';
export { analyzeInputStructure, splitAtBoundaries, InputFormat } from './compiler/input-analyzer';
export type { InputStructure } from './compiler/input-analyzer';
export { verifyMergeCorrectness } from './compiler/merge-verifier';
export type { VerificationResult } from './compiler/merge-verifier';

// ═══════════════════════════════════════════
// SCHEDULING: Self-Learning (World's First)
// ═══════════════════════════════════════════

export { LearningBridge, createFingerprint } from './compiler/learning-bridge';
export type { ComputationFingerprint, LearningRecommendation } from './compiler/learning-bridge';

// ═══════════════════════════════════════════
// SCHEDULING: Computational Phylogenetics (World's First)
// ═══════════════════════════════════════════

export { PhylogeneticsEngine, encodeGenome, PhylogeneticIndex, StrategyInheritor } from './compiler/phylogenetics';
export type { ComputationGenome, AncestorMatch, InheritedStrategy, LearnedStrategy } from './compiler/phylogenetics';

// ═══════════════════════════════════════════
// SCHEDULING: Unified Scheduler
// ═══════════════════════════════════════════

export { UnifiedScheduler } from './scheduler/unified-scheduler';
export type { PeerProvider, SchedulerResult } from './scheduler/unified-scheduler';
export { LoadMonitor } from './scheduler/load-monitor';

// ═══════════════════════════════════════════
// SCHEDULING: Job Queue (Background Tasks)
// ═══════════════════════════════════════════

export { JobQueue } from './scheduler/job-queue';
export type { JobDefinition, JobResult, JobState } from './scheduler/job-types';

// ═══════════════════════════════════════════
// DATA: Computation Gravity
// ═══════════════════════════════════════════

export { DataCatalog } from './gravity/data-catalog';
export type { DataEntry, DataLocation } from './gravity/data-catalog';
export { GravityPlanner, GravityStrategy } from './gravity/gravity-planner';
export type { GravityDecision } from './gravity/gravity-planner';
export { CodeShipper } from './gravity/code-shipper';

// ═══════════════════════════════════════════
// DATA: Streaming Pipelines
// ═══════════════════════════════════════════

export { PipelineManager } from './pipes/pipeline-manager';
export type {
  PipelineDefinition, PipelineStage, PipelineStatus,
} from './pipes/pipeline-types';

// ═══════════════════════════════════════════
// DATA: Distributed Filesystem
// ═══════════════════════════════════════════

export { MeshFS } from './meshfs/meshfs';

// ═══════════════════════════════════════════
// SECURITY
// ═══════════════════════════════════════════

export { AccessController } from './security/access-control';
export { RateLimiter } from './security/rate-limiter';

// ═══════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════

export { V3StateStore } from './persistence/v3-state-store';

// ═══════════════════════════════════════════
// TRANSPORT (for custom transports)
// ═══════════════════════════════════════════

export type { ITransport, TransportEvent } from '../../transport/src/interface';
export { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';

// ═══════════════════════════════════════════
// INTEGRATION: V4 Bridge (all pillars wired)
// ═══════════════════════════════════════════

export { V4Bridge } from './v4-bridge';
export type { V4ComputeResult, V4ComputeOptions, V4BridgeConfig } from './v4-bridge';

// ═══════════════════════════════════════════
// WIRE PROTOCOL
// ═══════════════════════════════════════════

export { V4WireHandler } from './v4-wire-handler';

// ═══════════════════════════════════════════
// PRIMITIVES & TYPES
// ═══════════════════════════════════════════

export type { MeshId, TaskId } from './types/primitives';
export { TaskType, Priority } from './types/task';
export type { CMPCapability } from './types/capability';
