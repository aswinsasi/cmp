"use strict";
/**
 * CMP Task Distributor
 * Layer 4: Decomposes tasks into distributable chunks based on
 * the task type, available mesh resources, and security requirements.
 *
 * @module runtime/task-distributor
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskDistributor = void 0;
const src_1 = require("../../core/src");
const src_2 = require("../../core/src");
const data_splitter_1 = require("./data-splitter");
class TaskDistributor {
    splitter = new data_splitter_1.DataSplitter();
    /**
     * Plan the decomposition of a task across assigned mesh devices.
     *
     * @param request - The original task request
     * @param assignments - Winners from negotiation
     * @param inputData - Raw input data to distribute
     * @param codeRef - Reference to the WASM/ONNX module
     * @returns Decomposition plan with chunks and split input data
     */
    plan(request, assignments, inputData, codeRef) {
        const numDevices = assignments.length;
        if (numDevices === 0) {
            return { strategy: request.taskType, chunks: [], inputChunks: [], estimatedTotalMs: 0, redundancy: 1 };
        }
        const redundancy = request.security.verifyMode === src_1.VerifyMode.REDUNDANT ? 2 : 1;
        const isConfidential = request.security.dataSensitivity === src_1.SecurityLevel.CONFIDENTIAL;
        switch (request.taskType) {
            case src_1.TaskType.MAP_REDUCE:
            case src_1.TaskType.CUSTOM:
                return this.planDataParallel(request, assignments, inputData, codeRef, redundancy, isConfidential);
            case src_1.TaskType.PIPELINE:
                return this.planPipeline(request, assignments, inputData, codeRef, redundancy);
            case src_1.TaskType.SCATTER_GATHER:
                return this.planScatterGather(request, assignments, inputData, codeRef, redundancy);
            case src_1.TaskType.INFERENCE:
                return this.planInference(request, assignments, inputData, codeRef, redundancy, isConfidential);
            default:
                return this.planDataParallel(request, assignments, inputData, codeRef, redundancy, isConfidential);
        }
    }
    /**
     * Data Parallel: split input into N chunks, same code on each.
     */
    planDataParallel(request, assignments, inputData, codeRef, redundancy, isConfidential) {
        const numChunks = request.chunkHint > 0 ? request.chunkHint : assignments.length;
        // Split input data
        let inputChunks;
        if (isConfidential) {
            // Secret sharing — each chunk is a random share
            inputChunks = this.splitter.split(inputData, numChunks);
        }
        else {
            // Standard parallel split
            inputChunks = this.splitter.splitParallel(inputData, numChunks);
        }
        const chunks = [];
        for (let i = 0; i < numChunks; i++) {
            const assignee = assignments[i % assignments.length];
            const chunk = this.createChunk(request, i, numChunks, assignee.assignment.bidderId, inputChunks[i] || new Uint8Array(0), codeRef, [], redundancy, request.computeBudget.deadlineMs);
            chunks.push(chunk);
        }
        return {
            strategy: src_1.TaskType.MAP_REDUCE,
            chunks,
            inputChunks,
            estimatedTotalMs: request.computeBudget.deadlineMs,
            redundancy,
        };
    }
    /**
     * Pipeline: sequential stages, each on a different device.
     * Chunk N depends on chunk N-1.
     */
    planPipeline(request, assignments, inputData, codeRef, redundancy) {
        const numStages = assignments.length;
        const chunks = [];
        const inputChunks = [inputData]; // Only first stage gets full input
        const perStageTimeout = Math.ceil(request.computeBudget.deadlineMs / numStages) * 2;
        for (let i = 0; i < numStages; i++) {
            const dependencies = i > 0 ? [chunks[i - 1].chunkId] : [];
            const chunkInput = i === 0 ? inputData : new Uint8Array(0); // Later stages get output from previous
            const chunk = this.createChunk(request, i, numStages, assignments[i].assignment.bidderId, chunkInput, codeRef, dependencies, 1, // Pipeline doesn't benefit from redundancy per stage
            perStageTimeout);
            chunks.push(chunk);
            if (i > 0)
                inputChunks.push(new Uint8Array(0));
        }
        return {
            strategy: src_1.TaskType.PIPELINE,
            chunks,
            inputChunks,
            estimatedTotalMs: request.computeBudget.deadlineMs,
            redundancy: 1,
        };
    }
    /**
     * Scatter-Gather: broadcast same data to all, collect diverse results.
     * Used for ensemble inference, consensus algorithms.
     */
    planScatterGather(request, assignments, inputData, codeRef, redundancy) {
        const chunks = [];
        const inputChunks = [];
        for (let i = 0; i < assignments.length; i++) {
            // Every device gets the full input
            inputChunks.push(new Uint8Array(inputData));
            const chunk = this.createChunk(request, i, assignments.length, assignments[i].assignment.bidderId, inputData, codeRef, [], 1, // Scatter-gather has inherent redundancy
            request.computeBudget.deadlineMs);
            chunks.push(chunk);
        }
        return {
            strategy: src_1.TaskType.SCATTER_GATHER,
            chunks,
            inputChunks,
            estimatedTotalMs: request.computeBudget.deadlineMs,
            redundancy: 1,
        };
    }
    /**
     * Inference: model-parallel or data-parallel depending on model size.
     */
    planInference(request, assignments, inputData, codeRef, redundancy, isConfidential) {
        // For inference, prefer data-parallel if input is batch data
        // Model-parallel would require model splitting logic
        return this.planDataParallel(request, assignments, inputData, codeRef, redundancy, isConfidential);
    }
    /**
     * Create a single chunk descriptor.
     */
    createChunk(request, sequence, totalChunks, assigneeId, payload, codeRef, dependencies, redundancy, timeoutMs) {
        return {
            chunkId: (0, src_2.randomBytes)(16),
            taskId: request.taskId,
            sequence,
            totalChunks,
            assigneeId,
            payload,
            codeRef,
            dependencies,
            expectedOutput: {
                format: src_1.OutputFormat.RAW_BYTES,
                maxSizeKb: Math.ceil(request.payloadSizeKb / totalChunks) * 2, // 2x for safety
            },
            redundancy,
            timeoutMs,
        };
    }
}
exports.TaskDistributor = TaskDistributor;
//# sourceMappingURL=task-distributor.js.map