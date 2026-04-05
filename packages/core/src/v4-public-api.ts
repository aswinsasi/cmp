/**
 * CMP — Compute Mesh Protocol
 *
 * Turn any devices on the same network into a distributed supercomputer.
 *
 * @example
 * ```typescript
 * import { CMPNode, buildSensorFilter, PipelineManager } from '@agent-viscro/cmp';
 *
 * const node = new CMPNode({ transports: ['lan'] });
 * await node.start();
 *
 * // Distribute a real WASM workload across the mesh
 * const filterWasm = buildSensorFilter(100);
 * const result = await node.compute(filterWasm, sensorData, {
 *   entryPoint: 'process',
 *   deadline: 5000,
 *   chunkHint: 4,   // Split across 4 devices
 * });
 *
 * // Streaming pipeline
 * const pipes = new PipelineManager(node.shortMeshId());
 * pipes.define('etl', ['filter:predicate=gt:100', 'map:transform=double', 'collect']);
 * pipes.start('etl');
 * pipes.push('etl', data);
 * const output = pipes.stop('etl');
 *
 * await node.stop();
 * ```
 *
 * @packageDocumentation
 * @module @agent-viscro/cmp
 * @author Agent Viscro
 * @license MIT
 */

// ─── Core Node ───
export { CMPNode } from './cmp-node';

// ─── V4 Bridge (all-in-one integration) ───
export { V4Bridge } from './v4-bridge';
export type { V4ComputeResult, V4ComputeOptions, V4BridgeConfig } from './v4-bridge';

// ─── V4 Wire Handler ───
export { V4WireHandler } from './v4-wire-handler';
export type { V4TransportSend, V4PeerResolver } from './v4-wire-handler';

// ─── WASM Sandbox ───
export { WasmSandbox } from './wasm/wasm-sandbox';
export type { WasmExecResult, SandboxConfig } from './wasm/wasm-sandbox';
export { WasmModuleBuilder, Op } from './wasm/wasm-module-builder';

// ─── WASM Built-in Modules ───
export {
  buildIdentityModule, buildDoubleBytesModule, buildXorCipherModule,
  buildThresholdFilterModule, buildByteSortModule, buildSumReduceModule,
  getBuiltinWasmModule, getBuiltinWasmModuleNames,
} from './wasm/builtin-wasm-modules';

// ─── WASM Workload Modules (real computation) ───
export {
  buildSensorFilter, buildSensorScale, buildSensorClamp,
  buildSensorDelta, buildSensorPeaks,
} from './wasm/workload-modules';
export {
  buildGrayscaleModule, buildHistogramModule,
  buildMovingAverageModule, buildRLECompressModule,
} from './wasm/heavy-workloads';

// ─── Task Compiler (auto-parallelization) ───
export { TaskCompiler } from './compiler/task-compiler';
export type { CompileResult } from './compiler/task-compiler';
export { PatternDetector, parseWasmExports } from './compiler/pattern-detector';
export { ParallelPattern, MergeType } from './compiler/compiler-types';
export type { CompilationPlan, TaskMeta, PatternMatch } from './compiler/compiler-types';

// ─── Scheduler ───
export { UnifiedScheduler } from './scheduler/unified-scheduler';
export type { PeerProvider, SchedulerResult } from './scheduler/unified-scheduler';
export { LoadMonitor } from './scheduler/load-monitor';
export { DeviceScorer } from './scheduler/device-scorer';
export { ExecutionPlanner, ExecutionStrategy } from './scheduler/execution-planner';

// ─── Racing ───
export { RaceManager } from './scheduler/race-manager';
export type { RaceDecision, RacingMeshState, RaceConfig } from './scheduler/race-manager';
export { CancelTracker, CancelReason } from './scheduler/cancel-protocol';

// ─── Gravity ───
export { GravityPlanner, GravityStrategy } from './gravity/gravity-planner';
export type { GravityDecision } from './gravity/gravity-planner';
export { DataCatalog } from './gravity/data-catalog';
export type { DataLocation } from './gravity/data-catalog';
export { CodeShipper } from './gravity/code-shipper';

// ─── Pipes ───
export { PipelineManager } from './pipes/pipeline-manager';
export { PipelineState } from './pipes/pipeline-types';
export type { PipelineMetrics, PipelineInstance, StageMetrics } from './pipes/pipeline-types';
export { BackpressureController } from './pipes/backpressure';
export { getBuiltinStage, isBuiltinStage, getBuiltinStageNames } from './pipes/stages/builtin-stages';

// ─── Job Queue ───
export { JobQueue } from './scheduler/job-queue';
export { JobExecutor } from './scheduler/job-executor';
export { JobState } from './scheduler/job-types';
export type { Job, JobDefinition, JobResult } from './scheduler/job-types';

// ─── Security ───
export { AccessController, ACLMode } from './security/access-control';
export { RateLimiter } from './security/rate-limiter';
export { V3MessageEncryptor } from './security/v3-encryption';

// ─── MeshFS ───
export { MeshFS } from './meshfs/meshfs';
export { PathResolver } from './meshfs/path-resolver';
export type { MeshFileEntry, MeshFileInfo, WriteOptions } from './meshfs/meshfs-types';

// ─── Persistence ───
export { V3StateStore } from './persistence/v3-state-store';
export { StateMigrator } from './persistence/state-migrator';
