"use strict";
/**
 * CMP v4.0 — Execution Planner
 *
 * Decides HOW to execute a task based on its type and mesh state.
 *
 * Decision tree:
 *   Input arrives →
 *     Is it a WASM module?        → WASM sandbox distribution (Layers 3-6)
 *     Is it a tensor computation? → Cortex layer splitting (L14)
 *     Is it a matrix/vector op?   → GPU compute (L16)
 *     Is it a sort/filter/map?    → Auto-decomposition (Phase 4, future)
 *     Cannot determine?           → Replicate and race (Phase 5, future)
 *
 * The planner produces an ExecutionPlan that the UnifiedScheduler
 * uses to dispatch the task to the right subsystem.
 *
 * @module scheduler/execution-planner
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionPlanner = exports.TaskCategory = exports.ExecutionStrategy = void 0;
const logger_1 = require("../utils/logger");
const task_1 = require("../types/task");
const log = new logger_1.Logger('ExecPlan');
// ─── Execution Strategy ───
var ExecutionStrategy;
(function (ExecutionStrategy) {
    /** Distribute WASM module across mesh (existing L3-L6 path) */
    ExecutionStrategy["WASM_DISTRIBUTE"] = "wasm_distribute";
    /** Split neural model across devices (Cortex L14) */
    ExecutionStrategy["CORTEX_SPLIT"] = "cortex_split";
    /** Offload to GPU device (GPU L16) */
    ExecutionStrategy["GPU_COMPUTE"] = "gpu_compute";
    /** Auto-decompose using pattern library (Phase 4, future) */
    ExecutionStrategy["AUTO_DECOMPOSE"] = "auto_decompose";
    /** Replicate and race on multiple devices (Phase 5, future) */
    ExecutionStrategy["SPECULATIVE_RACE"] = "speculative_race";
    /** Execute locally only (no peers or too small) */
    ExecutionStrategy["LOCAL_ONLY"] = "local_only";
    /** Hybrid: split across multiple strategies */
    ExecutionStrategy["HYBRID"] = "hybrid";
})(ExecutionStrategy || (exports.ExecutionStrategy = ExecutionStrategy = {}));
var TaskCategory;
(function (TaskCategory) {
    TaskCategory["WASM_MODULE"] = "wasm_module";
    TaskCategory["TENSOR_COMPUTATION"] = "tensor_computation";
    TaskCategory["MATRIX_OPERATION"] = "matrix_operation";
    TaskCategory["DATA_PARALLEL"] = "data_parallel";
    TaskCategory["STREAMING"] = "streaming";
    TaskCategory["UNKNOWN"] = "unknown";
})(TaskCategory || (exports.TaskCategory = TaskCategory = {}));
// ─── Execution Planner ───
class ExecutionPlanner {
    /**
     * Analyze a task to determine its category.
     */
    analyzeTask(wasmModule, inputData, taskType) {
        const isWasm = wasmModule.length >= 4 &&
            wasmModule[0] === 0x00 &&
            wasmModule[1] === 0x61 &&
            wasmModule[2] === 0x73 &&
            wasmModule[3] === 0x6D;
        const payloadSizeKb = Math.ceil(inputData.length / 1024);
        // Heuristic: detect tensor-like tasks
        const isTensorLike = taskType === task_1.TaskType.INFERENCE ||
            (payloadSizeKb > 100 && this.looksLikeTensor(inputData));
        // Heuristic: detect data-parallel tasks
        const isDataParallel = taskType === task_1.TaskType.MAP_REDUCE ||
            taskType === task_1.TaskType.SCATTER_GATHER;
        // Compute intensity heuristic (ratio of code size to data size)
        const codeToData = wasmModule.length / Math.max(1, inputData.length);
        const computeIntensity = Math.min(1.0, codeToData * 2);
        let category;
        if (isTensorLike) {
            category = TaskCategory.TENSOR_COMPUTATION;
        }
        else if (isDataParallel) {
            category = TaskCategory.DATA_PARALLEL;
        }
        else if (isWasm) {
            category = TaskCategory.WASM_MODULE;
        }
        else {
            category = TaskCategory.UNKNOWN;
        }
        return {
            category,
            isWasm,
            payloadSizeKb,
            computeIntensity,
            isTensorLike,
            isDataParallel,
        };
    }
    /**
     * Create an execution plan for a task.
     */
    plan(analysis, meshState, taskType) {
        // ── Decision Tree ──
        // No peers → local only
        if (meshState.peerCount === 0) {
            return {
                strategy: ExecutionStrategy.LOCAL_ONLY,
                reason: 'No peers available — executing locally',
                deviceCount: 1,
                shouldChunk: false,
                chunkCount: 0,
                requiresGPU: false,
                estimatedTimeMs: -1,
                confidence: 1.0,
                fallback: ExecutionStrategy.LOCAL_ONLY,
            };
        }
        // Tiny payload → not worth distributing
        if (analysis.payloadSizeKb < 1 && !analysis.isTensorLike) {
            return {
                strategy: ExecutionStrategy.LOCAL_ONLY,
                reason: 'Payload too small for distribution overhead',
                deviceCount: 1,
                shouldChunk: false,
                chunkCount: 0,
                requiresGPU: false,
                estimatedTimeMs: -1,
                confidence: 0.9,
                fallback: ExecutionStrategy.LOCAL_ONLY,
            };
        }
        // Tensor computation → Cortex (if available)
        if (analysis.isTensorLike && meshState.hasCortex) {
            const deviceCount = Math.min(meshState.peerCount + 1, 4);
            return {
                strategy: ExecutionStrategy.CORTEX_SPLIT,
                reason: 'Tensor computation detected — using Cortex L14 model splitting',
                deviceCount,
                shouldChunk: false,
                chunkCount: 0,
                requiresGPU: meshState.hasGPUPeers,
                estimatedTimeMs: -1,
                confidence: 0.85,
                fallback: ExecutionStrategy.WASM_DISTRIBUTE,
            };
        }
        // GPU matrix operation → GPU compute
        if (analysis.isTensorLike && meshState.hasGPUPeers) {
            return {
                strategy: ExecutionStrategy.GPU_COMPUTE,
                reason: 'Matrix/tensor operation — routing to GPU device',
                deviceCount: 1,
                shouldChunk: false,
                chunkCount: 0,
                requiresGPU: true,
                estimatedTimeMs: -1,
                confidence: 0.8,
                fallback: ExecutionStrategy.WASM_DISTRIBUTE,
            };
        }
        // WASM module with data-parallel task → distribute
        if (analysis.isWasm && analysis.isDataParallel) {
            const chunkCount = Math.min(meshState.peerCount + 1, 8);
            return {
                strategy: ExecutionStrategy.WASM_DISTRIBUTE,
                reason: 'WASM data-parallel task — distributing across mesh',
                deviceCount: chunkCount,
                shouldChunk: true,
                chunkCount,
                requiresGPU: false,
                estimatedTimeMs: -1,
                confidence: 0.9,
                fallback: ExecutionStrategy.LOCAL_ONLY,
            };
        }
        // WASM module (general) → distribute
        if (analysis.isWasm) {
            const deviceCount = Math.min(meshState.peerCount + 1, 4);
            return {
                strategy: ExecutionStrategy.WASM_DISTRIBUTE,
                reason: 'WASM module — distributing via L3-L6 pipeline',
                deviceCount,
                shouldChunk: analysis.payloadSizeKb > 10,
                chunkCount: analysis.payloadSizeKb > 10 ? deviceCount : 0,
                requiresGPU: false,
                estimatedTimeMs: -1,
                confidence: 0.85,
                fallback: ExecutionStrategy.LOCAL_ONLY,
            };
        }
        // Unknown task type → speculative race (future Phase 5)
        // For now, fall back to local
        return {
            strategy: ExecutionStrategy.SPECULATIVE_RACE,
            reason: 'Cannot determine task type — will race on multiple devices',
            deviceCount: Math.min(3, meshState.peerCount + 1),
            shouldChunk: false,
            chunkCount: 0,
            requiresGPU: false,
            estimatedTimeMs: -1,
            confidence: 0.5,
            fallback: ExecutionStrategy.LOCAL_ONLY,
        };
    }
    /**
     * Quick plan from raw inputs (convenience method).
     */
    planTask(wasmModule, inputData, taskType, meshState) {
        const analysis = this.analyzeTask(wasmModule, inputData, taskType);
        return this.plan(analysis, meshState, taskType);
    }
    // ══════════════════════════════════════
    // Heuristics
    // ══════════════════════════════════════
    /**
     * Quick heuristic: does this input look like tensor data?
     * Checks for float32 alignment and density.
     */
    looksLikeTensor(data) {
        if (data.length < 16)
            return false;
        // Check if length is a multiple of 4 (float32 aligned)
        if (data.length % 4 !== 0)
            return false;
        // Sample bytes — tensor data tends to have high byte entropy
        // but not random (zeros in upper bytes of floats are common)
        let zeroCount = 0;
        const sampleSize = Math.min(data.length, 256);
        for (let i = 0; i < sampleSize; i++) {
            if (data[i] === 0)
                zeroCount++;
        }
        // Tensors: ~20-40% zeros (float exponent bits)
        const zeroRatio = zeroCount / sampleSize;
        return zeroRatio > 0.15 && zeroRatio < 0.50;
    }
}
exports.ExecutionPlanner = ExecutionPlanner;
//# sourceMappingURL=execution-planner.js.map