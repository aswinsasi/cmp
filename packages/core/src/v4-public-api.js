"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessController = exports.JobState = exports.JobExecutor = exports.JobQueue = exports.getBuiltinStageNames = exports.isBuiltinStage = exports.getBuiltinStage = exports.BackpressureController = exports.PipelineState = exports.PipelineManager = exports.CodeShipper = exports.DataCatalog = exports.GravityStrategy = exports.GravityPlanner = exports.CancelReason = exports.CancelTracker = exports.RaceManager = exports.ExecutionStrategy = exports.ExecutionPlanner = exports.DeviceScorer = exports.LoadMonitor = exports.UnifiedScheduler = exports.MergeType = exports.ParallelPattern = exports.parseWasmExports = exports.PatternDetector = exports.TaskCompiler = exports.buildRLECompressModule = exports.buildMovingAverageModule = exports.buildHistogramModule = exports.buildGrayscaleModule = exports.buildSensorPeaks = exports.buildSensorDelta = exports.buildSensorClamp = exports.buildSensorScale = exports.buildSensorFilter = exports.getBuiltinWasmModuleNames = exports.getBuiltinWasmModule = exports.buildSumReduceModule = exports.buildByteSortModule = exports.buildThresholdFilterModule = exports.buildXorCipherModule = exports.buildDoubleBytesModule = exports.buildIdentityModule = exports.Op = exports.WasmModuleBuilder = exports.WasmSandbox = exports.V4WireHandler = exports.V4Bridge = exports.CMPNode = void 0;
exports.StateMigrator = exports.V3StateStore = exports.PathResolver = exports.MeshFS = exports.V3MessageEncryptor = exports.RateLimiter = exports.ACLMode = void 0;
// ─── Core Node ───
var cmp_node_1 = require("./cmp-node");
Object.defineProperty(exports, "CMPNode", { enumerable: true, get: function () { return cmp_node_1.CMPNode; } });
// ─── V4 Bridge (all-in-one integration) ───
var v4_bridge_1 = require("./v4-bridge");
Object.defineProperty(exports, "V4Bridge", { enumerable: true, get: function () { return v4_bridge_1.V4Bridge; } });
// ─── V4 Wire Handler ───
var v4_wire_handler_1 = require("./v4-wire-handler");
Object.defineProperty(exports, "V4WireHandler", { enumerable: true, get: function () { return v4_wire_handler_1.V4WireHandler; } });
// ─── WASM Sandbox ───
var wasm_sandbox_1 = require("./wasm/wasm-sandbox");
Object.defineProperty(exports, "WasmSandbox", { enumerable: true, get: function () { return wasm_sandbox_1.WasmSandbox; } });
var wasm_module_builder_1 = require("./wasm/wasm-module-builder");
Object.defineProperty(exports, "WasmModuleBuilder", { enumerable: true, get: function () { return wasm_module_builder_1.WasmModuleBuilder; } });
Object.defineProperty(exports, "Op", { enumerable: true, get: function () { return wasm_module_builder_1.Op; } });
// ─── WASM Built-in Modules ───
var builtin_wasm_modules_1 = require("./wasm/builtin-wasm-modules");
Object.defineProperty(exports, "buildIdentityModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildIdentityModule; } });
Object.defineProperty(exports, "buildDoubleBytesModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildDoubleBytesModule; } });
Object.defineProperty(exports, "buildXorCipherModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildXorCipherModule; } });
Object.defineProperty(exports, "buildThresholdFilterModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildThresholdFilterModule; } });
Object.defineProperty(exports, "buildByteSortModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildByteSortModule; } });
Object.defineProperty(exports, "buildSumReduceModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildSumReduceModule; } });
Object.defineProperty(exports, "getBuiltinWasmModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.getBuiltinWasmModule; } });
Object.defineProperty(exports, "getBuiltinWasmModuleNames", { enumerable: true, get: function () { return builtin_wasm_modules_1.getBuiltinWasmModuleNames; } });
// ─── WASM Workload Modules (real computation) ───
var workload_modules_1 = require("./wasm/workload-modules");
Object.defineProperty(exports, "buildSensorFilter", { enumerable: true, get: function () { return workload_modules_1.buildSensorFilter; } });
Object.defineProperty(exports, "buildSensorScale", { enumerable: true, get: function () { return workload_modules_1.buildSensorScale; } });
Object.defineProperty(exports, "buildSensorClamp", { enumerable: true, get: function () { return workload_modules_1.buildSensorClamp; } });
Object.defineProperty(exports, "buildSensorDelta", { enumerable: true, get: function () { return workload_modules_1.buildSensorDelta; } });
Object.defineProperty(exports, "buildSensorPeaks", { enumerable: true, get: function () { return workload_modules_1.buildSensorPeaks; } });
var heavy_workloads_1 = require("./wasm/heavy-workloads");
Object.defineProperty(exports, "buildGrayscaleModule", { enumerable: true, get: function () { return heavy_workloads_1.buildGrayscaleModule; } });
Object.defineProperty(exports, "buildHistogramModule", { enumerable: true, get: function () { return heavy_workloads_1.buildHistogramModule; } });
Object.defineProperty(exports, "buildMovingAverageModule", { enumerable: true, get: function () { return heavy_workloads_1.buildMovingAverageModule; } });
Object.defineProperty(exports, "buildRLECompressModule", { enumerable: true, get: function () { return heavy_workloads_1.buildRLECompressModule; } });
// ─── Task Compiler (auto-parallelization) ───
var task_compiler_1 = require("./compiler/task-compiler");
Object.defineProperty(exports, "TaskCompiler", { enumerable: true, get: function () { return task_compiler_1.TaskCompiler; } });
var pattern_detector_1 = require("./compiler/pattern-detector");
Object.defineProperty(exports, "PatternDetector", { enumerable: true, get: function () { return pattern_detector_1.PatternDetector; } });
Object.defineProperty(exports, "parseWasmExports", { enumerable: true, get: function () { return pattern_detector_1.parseWasmExports; } });
var compiler_types_1 = require("./compiler/compiler-types");
Object.defineProperty(exports, "ParallelPattern", { enumerable: true, get: function () { return compiler_types_1.ParallelPattern; } });
Object.defineProperty(exports, "MergeType", { enumerable: true, get: function () { return compiler_types_1.MergeType; } });
// ─── Scheduler ───
var unified_scheduler_1 = require("./scheduler/unified-scheduler");
Object.defineProperty(exports, "UnifiedScheduler", { enumerable: true, get: function () { return unified_scheduler_1.UnifiedScheduler; } });
var load_monitor_1 = require("./scheduler/load-monitor");
Object.defineProperty(exports, "LoadMonitor", { enumerable: true, get: function () { return load_monitor_1.LoadMonitor; } });
var device_scorer_1 = require("./scheduler/device-scorer");
Object.defineProperty(exports, "DeviceScorer", { enumerable: true, get: function () { return device_scorer_1.DeviceScorer; } });
var execution_planner_1 = require("./scheduler/execution-planner");
Object.defineProperty(exports, "ExecutionPlanner", { enumerable: true, get: function () { return execution_planner_1.ExecutionPlanner; } });
Object.defineProperty(exports, "ExecutionStrategy", { enumerable: true, get: function () { return execution_planner_1.ExecutionStrategy; } });
// ─── Racing ───
var race_manager_1 = require("./scheduler/race-manager");
Object.defineProperty(exports, "RaceManager", { enumerable: true, get: function () { return race_manager_1.RaceManager; } });
var cancel_protocol_1 = require("./scheduler/cancel-protocol");
Object.defineProperty(exports, "CancelTracker", { enumerable: true, get: function () { return cancel_protocol_1.CancelTracker; } });
Object.defineProperty(exports, "CancelReason", { enumerable: true, get: function () { return cancel_protocol_1.CancelReason; } });
// ─── Gravity ───
var gravity_planner_1 = require("./gravity/gravity-planner");
Object.defineProperty(exports, "GravityPlanner", { enumerable: true, get: function () { return gravity_planner_1.GravityPlanner; } });
Object.defineProperty(exports, "GravityStrategy", { enumerable: true, get: function () { return gravity_planner_1.GravityStrategy; } });
var data_catalog_1 = require("./gravity/data-catalog");
Object.defineProperty(exports, "DataCatalog", { enumerable: true, get: function () { return data_catalog_1.DataCatalog; } });
var code_shipper_1 = require("./gravity/code-shipper");
Object.defineProperty(exports, "CodeShipper", { enumerable: true, get: function () { return code_shipper_1.CodeShipper; } });
// ─── Pipes ───
var pipeline_manager_1 = require("./pipes/pipeline-manager");
Object.defineProperty(exports, "PipelineManager", { enumerable: true, get: function () { return pipeline_manager_1.PipelineManager; } });
var pipeline_types_1 = require("./pipes/pipeline-types");
Object.defineProperty(exports, "PipelineState", { enumerable: true, get: function () { return pipeline_types_1.PipelineState; } });
var backpressure_1 = require("./pipes/backpressure");
Object.defineProperty(exports, "BackpressureController", { enumerable: true, get: function () { return backpressure_1.BackpressureController; } });
var builtin_stages_1 = require("./pipes/stages/builtin-stages");
Object.defineProperty(exports, "getBuiltinStage", { enumerable: true, get: function () { return builtin_stages_1.getBuiltinStage; } });
Object.defineProperty(exports, "isBuiltinStage", { enumerable: true, get: function () { return builtin_stages_1.isBuiltinStage; } });
Object.defineProperty(exports, "getBuiltinStageNames", { enumerable: true, get: function () { return builtin_stages_1.getBuiltinStageNames; } });
// ─── Job Queue ───
var job_queue_1 = require("./scheduler/job-queue");
Object.defineProperty(exports, "JobQueue", { enumerable: true, get: function () { return job_queue_1.JobQueue; } });
var job_executor_1 = require("./scheduler/job-executor");
Object.defineProperty(exports, "JobExecutor", { enumerable: true, get: function () { return job_executor_1.JobExecutor; } });
var job_types_1 = require("./scheduler/job-types");
Object.defineProperty(exports, "JobState", { enumerable: true, get: function () { return job_types_1.JobState; } });
// ─── Security ───
var access_control_1 = require("./security/access-control");
Object.defineProperty(exports, "AccessController", { enumerable: true, get: function () { return access_control_1.AccessController; } });
Object.defineProperty(exports, "ACLMode", { enumerable: true, get: function () { return access_control_1.ACLMode; } });
var rate_limiter_1 = require("./security/rate-limiter");
Object.defineProperty(exports, "RateLimiter", { enumerable: true, get: function () { return rate_limiter_1.RateLimiter; } });
var v3_encryption_1 = require("./security/v3-encryption");
Object.defineProperty(exports, "V3MessageEncryptor", { enumerable: true, get: function () { return v3_encryption_1.V3MessageEncryptor; } });
// ─── MeshFS ───
var meshfs_1 = require("./meshfs/meshfs");
Object.defineProperty(exports, "MeshFS", { enumerable: true, get: function () { return meshfs_1.MeshFS; } });
var path_resolver_1 = require("./meshfs/path-resolver");
Object.defineProperty(exports, "PathResolver", { enumerable: true, get: function () { return path_resolver_1.PathResolver; } });
// ─── Persistence ───
var v3_state_store_1 = require("./persistence/v3-state-store");
Object.defineProperty(exports, "V3StateStore", { enumerable: true, get: function () { return v3_state_store_1.V3StateStore; } });
var state_migrator_1 = require("./persistence/state-migrator");
Object.defineProperty(exports, "StateMigrator", { enumerable: true, get: function () { return state_migrator_1.StateMigrator; } });
//# sourceMappingURL=v4-public-api.js.map