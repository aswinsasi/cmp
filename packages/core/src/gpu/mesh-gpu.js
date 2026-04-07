"use strict";
/**
 * CMP v3.0 — Mesh GPU Manager (Layer 16)
 * Orchestrates GPU compute across mesh devices.
 *
 * A device without a GPU can submit a compute shader that executes
 * on a remote device's GPU. The mesh presents a unified GPU surface.
 *
 * Features:
 *   - Automatic GPU peer discovery via capability exchange
 *   - Task routing to best available GPU (by VRAM, latency, utilization)
 *   - Distributed compute: split large tasks across multiple GPUs
 *   - CPU fallback when no GPU peers available
 *   - Task queuing with priority and deadlines
 *
 * @module gpu/mesh-gpu
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeshGPU = void 0;
const gpu_1 = require("../types/gpu");
const executor_1 = require("./executor");
function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++)
        arr[i] = Math.floor(Math.random() * 256);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ═══════════════════════════════════════
class MeshGPU {
    config;
    transport;
    localExecutor;
    /** Stats */
    completedTasks = 0;
    failedTasks = 0;
    pendingCount = 0;
    constructor(transport, config, localCapability) {
        this.config = { ...gpu_1.DEFAULT_MESH_GPU_CONFIG, ...config };
        this.transport = transport;
        this.localExecutor = new executor_1.GPUExecutor(localCapability);
    }
    // ═══════════════════════════════════════
    // Single Task Execution
    // ═══════════════════════════════════════
    /**
     * Execute a GPU compute task on the mesh.
     * Automatically selects the best available GPU (local or remote).
     *
     * @param shaderCode - WGSL compute shader source
     * @param buffers - Input data buffers
     * @param workgroups - Dispatch dimensions [x, y, z]
     * @param options - Priority, deadline, output buffer indices
     */
    async compute(shaderCode, buffers, workgroups, options) {
        const task = {
            taskId: randomHex(8),
            shaderCode,
            buffers,
            workgroups,
            outputBufferIndices: options?.outputBufferIndices ?? [0],
            priority: options?.priority ?? 'normal',
            deadline: options?.deadline ?? 0,
            submitterDevice: this.transport.getLocalDeviceId(),
        };
        this.pendingCount++;
        try {
            // Select best GPU
            const target = this.selectBestGPU(task);
            let result;
            if (target === 'local') {
                result = await this.localExecutor.execute(task);
            }
            else {
                try {
                    result = await this.transport.sendGPUTask(target, task);
                }
                catch (err) {
                    // Remote failed — fallback to local
                    result = await this.localExecutor.execute(task);
                    result.executorDevice = 'local (fallback)';
                }
            }
            if (result.success) {
                this.completedTasks++;
            }
            else {
                this.failedTasks++;
            }
            return result;
        }
        finally {
            this.pendingCount--;
        }
    }
    // ═══════════════════════════════════════
    // Distributed Compute
    // ═══════════════════════════════════════
    /**
     * Split a large computation across multiple GPUs.
     * Distributes data across available GPU peers, executes in parallel,
     * and assembles the result.
     *
     * @param shaderCode - WGSL compute shader (same for all chunks)
     * @param data - Input data to split
     * @param shape - Data shape [rows, cols]
     * @param splitStrategy - How to split: 'row', 'column', or 'block'
     */
    async distributeCompute(shaderCode, data, shape, splitStrategy = 'row') {
        const startTime = performance.now();
        // Get available GPUs (including local)
        const gpus = this.getAvailableGPUs();
        const deviceCount = Math.max(1, gpus.length);
        // Split data
        const chunks = this.splitData(data, shape, splitStrategy, deviceCount);
        // Execute in parallel
        const promises = [];
        for (let i = 0; i < chunks.length; i++) {
            const targetDevice = i < gpus.length ? gpus[i].deviceId : 'local';
            const buffers = [{
                    label: `chunk-${i}`,
                    data: chunks[i],
                    usage: 'storage',
                }];
            const chunkRows = splitStrategy === 'row'
                ? Math.ceil(shape[0] / deviceCount)
                : shape[0];
            const chunkCols = splitStrategy === 'column'
                ? Math.ceil(shape[1] / deviceCount)
                : shape[1];
            const task = {
                taskId: randomHex(8),
                shaderCode,
                buffers,
                workgroups: [Math.ceil(chunkRows / 8), Math.ceil(chunkCols / 8), 1],
                outputBufferIndices: [0],
                priority: 'high',
                deadline: 0,
                submitterDevice: this.transport.getLocalDeviceId(),
            };
            if (targetDevice === 'local') {
                promises.push(this.localExecutor.execute(task));
            }
            else {
                promises.push(this.transport.sendGPUTask(targetDevice, task).catch(() => this.localExecutor.execute(task) // Fallback
                ));
            }
        }
        const results = await Promise.all(promises);
        // Assemble results
        const assembled = this.assembleResults(results, shape, splitStrategy);
        const devicesUsed = new Set(results.map(r => r.executorDevice)).size;
        return {
            result: assembled,
            devicesUsed,
            totalMs: performance.now() - startTime,
        };
    }
    // ═══════════════════════════════════════
    // Remote Execution Handler
    // ═══════════════════════════════════════
    /**
     * Handle an incoming GPU task from a remote device.
     * Called by the transport handler when a GPU_TASK_SUBMIT message arrives.
     */
    async handleRemoteTask(task) {
        if (!this.localExecutor.canAccept(task, {
            maxConcurrentTasks: this.config.maxConcurrentTasks,
            maxUtilization: this.config.maxUtilizationForAcceptance,
        })) {
            return {
                taskId: task.taskId,
                success: false,
                outputBuffers: [],
                computeMs: 0,
                executorDevice: this.transport.getLocalDeviceId(),
                error: 'GPU executor at capacity',
            };
        }
        return this.localExecutor.execute(task);
    }
    // ═══════════════════════════════════════
    // GPU Selection
    // ═══════════════════════════════════════
    /**
     * Select the best GPU for a task.
     * Scoring: VRAM available × (1 - utilization) / latency
     */
    selectBestGPU(task) {
        const peers = this.transport.getGPUPeers().filter(p => p.capability.available &&
            p.capability.computeUtilization < this.config.maxUtilizationForAcceptance);
        if (peers.length === 0)
            return 'local';
        // Score each peer
        let bestScore = -1;
        let bestDevice = 'local';
        // Score local
        const localCap = this.localExecutor.getCapability();
        if (localCap.available) {
            const localScore = (localCap.vramBytes * (1 - localCap.vramUtilization)) / 1;
            bestScore = localScore;
            bestDevice = 'local';
        }
        for (const peer of peers) {
            const vramAvail = peer.capability.vramBytes * (1 - peer.capability.vramUtilization);
            const score = vramAvail * (1 - peer.capability.computeUtilization) / Math.max(1, peer.latencyMs);
            if (score > bestScore) {
                bestScore = score;
                bestDevice = peer.deviceId;
            }
        }
        return bestDevice;
    }
    /**
     * Get all available GPUs (local + remote), sorted by capability.
     */
    getAvailableGPUs() {
        const localId = this.transport.getLocalDeviceId();
        const localCap = this.localExecutor.getCapability();
        const all = [];
        if (localCap.available) {
            all.push({
                deviceId: localId,
                capability: localCap,
                latencyMs: 0,
            });
        }
        const remotes = this.transport.getGPUPeers().filter(p => p.capability.available &&
            p.capability.computeUtilization < this.config.maxUtilizationForAcceptance);
        all.push(...remotes);
        // Sort by VRAM descending
        all.sort((a, b) => b.capability.vramBytes - a.capability.vramBytes);
        return all;
    }
    // ═══════════════════════════════════════
    // Data Splitting & Assembly
    // ═══════════════════════════════════════
    splitData(data, shape, strategy, chunks) {
        const [rows, cols] = shape;
        if (strategy === 'row') {
            const rowsPerChunk = Math.ceil(rows / chunks);
            const result = [];
            for (let c = 0; c < chunks; c++) {
                const startRow = c * rowsPerChunk;
                const endRow = Math.min(startRow + rowsPerChunk, rows);
                if (startRow >= rows)
                    break;
                const chunkData = new Float32Array((endRow - startRow) * cols);
                for (let r = startRow; r < endRow; r++) {
                    for (let j = 0; j < cols; j++) {
                        chunkData[(r - startRow) * cols + j] = data[r * cols + j];
                    }
                }
                result.push(chunkData);
            }
            return result;
        }
        if (strategy === 'column') {
            const colsPerChunk = Math.ceil(cols / chunks);
            const result = [];
            for (let c = 0; c < chunks; c++) {
                const startCol = c * colsPerChunk;
                const endCol = Math.min(startCol + colsPerChunk, cols);
                if (startCol >= cols)
                    break;
                const chunkData = new Float32Array(rows * (endCol - startCol));
                for (let r = 0; r < rows; r++) {
                    for (let j = startCol; j < endCol; j++) {
                        chunkData[r * (endCol - startCol) + (j - startCol)] = data[r * cols + j];
                    }
                }
                result.push(chunkData);
            }
            return result;
        }
        // Block strategy: split into rectangular blocks
        // Simplified: just use row splitting
        return this.splitData(data, shape, 'row', chunks);
    }
    assembleResults(results, originalShape, strategy) {
        // Concatenate output buffers in order
        let totalLength = 0;
        for (const r of results) {
            if (r.success && r.outputBuffers.length > 0) {
                totalLength += r.outputBuffers[0].length;
            }
        }
        const assembled = new Float32Array(totalLength);
        let offset = 0;
        for (const r of results) {
            if (r.success && r.outputBuffers.length > 0) {
                assembled.set(r.outputBuffers[0], offset);
                offset += r.outputBuffers[0].length;
            }
        }
        return assembled;
    }
    // ═══════════════════════════════════════
    // Capability
    // ═══════════════════════════════════════
    /**
     * Get local GPU capability.
     */
    getLocalCapability() {
        return this.localExecutor.getCapability();
    }
    /**
     * Get all GPU capabilities across the mesh.
     */
    getMeshCapabilities() {
        return this.getAvailableGPUs();
    }
    /**
     * Register a custom CPU kernel on the local executor.
     */
    registerKernel(name, kernel) {
        this.localExecutor.registerKernel(name, kernel);
    }
    // ═══════════════════════════════════════
    // Status
    // ═══════════════════════════════════════
    getStatus() {
        const localCap = this.localExecutor.getCapability();
        const remoteGPUs = this.transport.getGPUPeers();
        // Estimate mesh compute (very rough)
        let totalVRAM = localCap.vramBytes;
        for (const p of remoteGPUs)
            totalVRAM += p.capability.vramBytes;
        const meshEstimate = totalVRAM / 1e9; // Rough TFLOPS estimate
        return {
            localGPU: localCap,
            remoteGPUs,
            meshComputeEstimate: meshEstimate,
            pendingTasks: this.pendingCount,
            completedTasks: this.completedTasks,
            failedTasks: this.failedTasks,
        };
    }
}
exports.MeshGPU = MeshGPU;
//# sourceMappingURL=mesh-gpu.js.map