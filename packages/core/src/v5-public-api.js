"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Priority = exports.TaskType = exports.V4WireHandler = exports.V4Bridge = exports.VirtualTransport = exports.VirtualNetwork = exports.V3StateStore = exports.RateLimiter = exports.AccessController = exports.MeshFS = exports.PipelineManager = exports.CodeShipper = exports.GravityStrategy = exports.GravityPlanner = exports.DataCatalog = exports.JobQueue = exports.LoadMonitor = exports.UnifiedScheduler = exports.MergeType = exports.ParallelPattern = exports.parseWasmExports = exports.PatternDetector = exports.TaskCompiler = exports.buildRLECompressModule = exports.buildMovingAverageModule = exports.buildHistogramModule = exports.buildGrayscaleModule = exports.buildSensorPeaks = exports.buildSensorDelta = exports.buildSensorClamp = exports.buildSensorScale = exports.buildSensorFilter = exports.getBuiltinWasmModuleNames = exports.getBuiltinWasmModule = exports.buildSumReduceModule = exports.buildByteSortModule = exports.buildThresholdFilterModule = exports.buildXorCipherModule = exports.buildDoubleBytesModule = exports.buildIdentityModule = exports.Op = exports.WasmModuleBuilder = exports.WasmSandbox = exports.CMPNode = void 0;
// ═══════════════════════════════════════════
// CORE: Mesh Node
// ═══════════════════════════════════════════
var cmp_node_1 = require("./cmp-node");
Object.defineProperty(exports, "CMPNode", { enumerable: true, get: function () { return cmp_node_1.CMPNode; } });
// ═══════════════════════════════════════════
// COMPUTE: WASM Sandbox & Module Builder
// ═══════════════════════════════════════════
var wasm_sandbox_1 = require("./wasm/wasm-sandbox");
Object.defineProperty(exports, "WasmSandbox", { enumerable: true, get: function () { return wasm_sandbox_1.WasmSandbox; } });
var wasm_module_builder_1 = require("./wasm/wasm-module-builder");
Object.defineProperty(exports, "WasmModuleBuilder", { enumerable: true, get: function () { return wasm_module_builder_1.WasmModuleBuilder; } });
Object.defineProperty(exports, "Op", { enumerable: true, get: function () { return wasm_module_builder_1.Op; } });
// ═══════════════════════════════════════════
// COMPUTE: Built-in WASM Modules
// ═══════════════════════════════════════════
var builtin_wasm_modules_1 = require("./wasm/builtin-wasm-modules");
Object.defineProperty(exports, "buildIdentityModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildIdentityModule; } });
Object.defineProperty(exports, "buildDoubleBytesModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildDoubleBytesModule; } });
Object.defineProperty(exports, "buildXorCipherModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildXorCipherModule; } });
Object.defineProperty(exports, "buildThresholdFilterModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildThresholdFilterModule; } });
Object.defineProperty(exports, "buildByteSortModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildByteSortModule; } });
Object.defineProperty(exports, "buildSumReduceModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.buildSumReduceModule; } });
Object.defineProperty(exports, "getBuiltinWasmModule", { enumerable: true, get: function () { return builtin_wasm_modules_1.getBuiltinWasmModule; } });
Object.defineProperty(exports, "getBuiltinWasmModuleNames", { enumerable: true, get: function () { return builtin_wasm_modules_1.getBuiltinWasmModuleNames; } });
// Real workloads
var workload_modules_1 = require("./wasm/workload-modules");
Object.defineProperty(exports, "buildSensorFilter", { enumerable: true, get: function () { return workload_modules_1.buildSensorFilter; } });
Object.defineProperty(exports, "buildSensorScale", { enumerable: true, get: function () { return workload_modules_1.buildSensorScale; } });
Object.defineProperty(exports, "buildSensorClamp", { enumerable: true, get: function () { return workload_modules_1.buildSensorClamp; } });
Object.defineProperty(exports, "buildSensorDelta", { enumerable: true, get: function () { return workload_modules_1.buildSensorDelta; } });
Object.defineProperty(exports, "buildSensorPeaks", { enumerable: true, get: function () { return workload_modules_1.buildSensorPeaks; } });
// Heavy workloads (image processing, signal processing)
var heavy_workloads_1 = require("./wasm/heavy-workloads");
Object.defineProperty(exports, "buildGrayscaleModule", { enumerable: true, get: function () { return heavy_workloads_1.buildGrayscaleModule; } });
Object.defineProperty(exports, "buildHistogramModule", { enumerable: true, get: function () { return heavy_workloads_1.buildHistogramModule; } });
Object.defineProperty(exports, "buildMovingAverageModule", { enumerable: true, get: function () { return heavy_workloads_1.buildMovingAverageModule; } });
Object.defineProperty(exports, "buildRLECompressModule", { enumerable: true, get: function () { return heavy_workloads_1.buildRLECompressModule; } });
// ═══════════════════════════════════════════
// SCHEDULING: Auto-Parallelization
// ═══════════════════════════════════════════
var task_compiler_1 = require("./compiler/task-compiler");
Object.defineProperty(exports, "TaskCompiler", { enumerable: true, get: function () { return task_compiler_1.TaskCompiler; } });
var pattern_detector_1 = require("./compiler/pattern-detector");
Object.defineProperty(exports, "PatternDetector", { enumerable: true, get: function () { return pattern_detector_1.PatternDetector; } });
Object.defineProperty(exports, "parseWasmExports", { enumerable: true, get: function () { return pattern_detector_1.parseWasmExports; } });
var compiler_types_1 = require("./compiler/compiler-types");
Object.defineProperty(exports, "ParallelPattern", { enumerable: true, get: function () { return compiler_types_1.ParallelPattern; } });
Object.defineProperty(exports, "MergeType", { enumerable: true, get: function () { return compiler_types_1.MergeType; } });
// ═══════════════════════════════════════════
// SCHEDULING: Unified Scheduler
// ═══════════════════════════════════════════
var unified_scheduler_1 = require("./scheduler/unified-scheduler");
Object.defineProperty(exports, "UnifiedScheduler", { enumerable: true, get: function () { return unified_scheduler_1.UnifiedScheduler; } });
var load_monitor_1 = require("./scheduler/load-monitor");
Object.defineProperty(exports, "LoadMonitor", { enumerable: true, get: function () { return load_monitor_1.LoadMonitor; } });
// ═══════════════════════════════════════════
// SCHEDULING: Job Queue (Background Tasks)
// ═══════════════════════════════════════════
var job_queue_1 = require("./scheduler/job-queue");
Object.defineProperty(exports, "JobQueue", { enumerable: true, get: function () { return job_queue_1.JobQueue; } });
// ═══════════════════════════════════════════
// DATA: Computation Gravity
// ═══════════════════════════════════════════
var data_catalog_1 = require("./gravity/data-catalog");
Object.defineProperty(exports, "DataCatalog", { enumerable: true, get: function () { return data_catalog_1.DataCatalog; } });
var gravity_planner_1 = require("./gravity/gravity-planner");
Object.defineProperty(exports, "GravityPlanner", { enumerable: true, get: function () { return gravity_planner_1.GravityPlanner; } });
Object.defineProperty(exports, "GravityStrategy", { enumerable: true, get: function () { return gravity_planner_1.GravityStrategy; } });
var code_shipper_1 = require("./gravity/code-shipper");
Object.defineProperty(exports, "CodeShipper", { enumerable: true, get: function () { return code_shipper_1.CodeShipper; } });
// ═══════════════════════════════════════════
// DATA: Streaming Pipelines
// ═══════════════════════════════════════════
var pipeline_manager_1 = require("./pipes/pipeline-manager");
Object.defineProperty(exports, "PipelineManager", { enumerable: true, get: function () { return pipeline_manager_1.PipelineManager; } });
// ═══════════════════════════════════════════
// DATA: Distributed Filesystem
// ═══════════════════════════════════════════
var meshfs_1 = require("./meshfs/meshfs");
Object.defineProperty(exports, "MeshFS", { enumerable: true, get: function () { return meshfs_1.MeshFS; } });
// ═══════════════════════════════════════════
// SECURITY
// ═══════════════════════════════════════════
var access_control_1 = require("./security/access-control");
Object.defineProperty(exports, "AccessController", { enumerable: true, get: function () { return access_control_1.AccessController; } });
var rate_limiter_1 = require("./security/rate-limiter");
Object.defineProperty(exports, "RateLimiter", { enumerable: true, get: function () { return rate_limiter_1.RateLimiter; } });
// ═══════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════
var v3_state_store_1 = require("./persistence/v3-state-store");
Object.defineProperty(exports, "V3StateStore", { enumerable: true, get: function () { return v3_state_store_1.V3StateStore; } });
var virtual_transport_1 = require("../../transport/src/virtual-transport");
Object.defineProperty(exports, "VirtualNetwork", { enumerable: true, get: function () { return virtual_transport_1.VirtualNetwork; } });
Object.defineProperty(exports, "VirtualTransport", { enumerable: true, get: function () { return virtual_transport_1.VirtualTransport; } });
// ═══════════════════════════════════════════
// INTEGRATION: V4 Bridge (all pillars wired)
// ═══════════════════════════════════════════
var v4_bridge_1 = require("./v4-bridge");
Object.defineProperty(exports, "V4Bridge", { enumerable: true, get: function () { return v4_bridge_1.V4Bridge; } });
// ═══════════════════════════════════════════
// WIRE PROTOCOL
// ═══════════════════════════════════════════
var v4_wire_handler_1 = require("./v4-wire-handler");
Object.defineProperty(exports, "V4WireHandler", { enumerable: true, get: function () { return v4_wire_handler_1.V4WireHandler; } });
var task_1 = require("./types/task");
Object.defineProperty(exports, "TaskType", { enumerable: true, get: function () { return task_1.TaskType; } });
Object.defineProperty(exports, "Priority", { enumerable: true, get: function () { return task_1.Priority; } });
//# sourceMappingURL=v5-public-api.js.map