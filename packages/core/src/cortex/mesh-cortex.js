"use strict";
/**
 * CMP v3.0 — Mesh Cortex Manager (Layer 14)
 * Orchestrates distributed neural network inference across mesh devices.
 *
 * Usage:
 *   const cortex = new MeshCortex(transport, config);
 *   const modelId = cortex.loadModel(manifest, weights);
 *   const result = await cortex.infer(modelId, inputTensor);
 *
 * Architecture:
 *   1. loadModel() → partitions model across available devices
 *   2. Each partition gets a LayerExecutor
 *   3. infer() → chains activations through partitions sequentially
 *   4. If a device fails → replica partition activates (fault tolerance)
 *   5. When devices join/leave → rebalance partitions
 *
 * Each partition CAN be backed by a Lifeform (future integration),
 * giving it migration, replication, DNS, and CCU economy for free.
 *
 * @module cortex/mesh-cortex
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeshCortex = void 0;
const cortex_1 = require("../types/cortex");
const partitioner_1 = require("./partitioner");
const layer_executor_1 = require("./layer-executor");
function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++)
        arr[i] = Math.floor(Math.random() * 256);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ═══════════════════════════════════════
class MeshCortex {
    config;
    transport;
    /** Loaded models: modelId → model data */
    models = new Map();
    /** Stats */
    completedInferences = 0;
    pendingCount = 0;
    /** Custom layer function (for testing) */
    layerFn;
    constructor(transport, config, layerFn) {
        this.config = { ...cortex_1.DEFAULT_CORTEX_CONFIG, ...config };
        this.transport = transport;
        this.layerFn = layerFn;
    }
    // ═══════════════════════════════════════
    // Model Loading
    // ═══════════════════════════════════════
    /**
     * Load a model into the mesh cortex.
     * Partitions it across available devices and creates local executors.
     *
     * @param manifest - Model metadata
     * @param weights - Full model weights (will be sliced per partition)
     * @returns Model ID
     */
    loadModel(manifest, weights) {
        const devices = this.transport.getDevices();
        const localId = this.transport.getLocalDeviceId();
        if (devices.length === 0) {
            // Single device: all partitions local
            devices.push({
                deviceId: localId,
                availableMemoryBytes: this.config.maxMemoryBytes,
                computeSpeed: 1.0,
            });
        }
        // Ensure local device is in the list
        if (!devices.find(d => d.deviceId === localId)) {
            devices.push({
                deviceId: localId,
                availableMemoryBytes: this.config.maxMemoryBytes,
                computeSpeed: 1.0,
            });
        }
        // Partition the model
        const assignments = (0, partitioner_1.partitionModel)(manifest, devices, this.config.maxPartitionsPerDevice);
        // Create local executors for partitions assigned to this device
        const localExecutors = new Map();
        const weightsPerLayer = Math.ceil(weights.length / manifest.totalLayers);
        for (const assignment of assignments) {
            if (assignment.device === localId) {
                // Slice weights for this partition
                const startByte = assignment.layerRange[0] * weightsPerLayer;
                const endByte = Math.min((assignment.layerRange[1] + 1) * weightsPerLayer, weights.length);
                const partitionWeights = weights.slice(startByte, endByte);
                const partition = {
                    partitionId: assignment.partitionId,
                    modelId: manifest.modelId,
                    layerRange: assignment.layerRange,
                    weights: partitionWeights,
                    sizeBytes: assignment.sizeBytes,
                    assignedDevice: assignment.device,
                    nextDevice: null, // Set below
                };
                localExecutors.set(assignment.partitionId, new layer_executor_1.LayerExecutor(partition, this.layerFn));
            }
        }
        // Build inference chain (ordered by layer range)
        const chain = [...assignments].sort((a, b) => a.layerRange[0] - b.layerRange[0]);
        // Set nextDevice pointers
        for (let i = 0; i < chain.length - 1; i++) {
            // Find corresponding local executor and set nextDevice
            const executor = localExecutors.get(chain[i].partitionId);
            if (executor) {
                // nextDevice would be chain[i+1].device
            }
        }
        const model = {
            manifest,
            assignments,
            localExecutors,
            chain,
            ready: true,
        };
        this.models.set(manifest.modelId, model);
        return manifest.modelId;
    }
    // ═══════════════════════════════════════
    // Inference
    // ═══════════════════════════════════════
    /**
     * Run inference on a loaded model.
     * Chains activations through all partitions in order.
     *
     * For local partitions: executes directly.
     * For remote partitions: sends activation via transport, waits for result.
     */
    async infer(modelId, input) {
        const model = this.models.get(modelId);
        if (!model)
            throw new Error(`Model not loaded: ${modelId}`);
        if (!model.ready)
            throw new Error(`Model not ready: ${modelId}`);
        const requestId = randomHex(8);
        const startTime = performance.now();
        const localId = this.transport.getLocalDeviceId();
        this.pendingCount++;
        const partitionTimings = [];
        let usedReplica = false;
        try {
            let current = input;
            // Process through each partition in order
            for (const assignment of model.chain) {
                const partitionStart = performance.now();
                if (assignment.device === localId) {
                    // Local execution
                    const executor = model.localExecutors.get(assignment.partitionId);
                    if (!executor) {
                        throw new Error(`Local executor not found for partition ${assignment.partitionId}`);
                    }
                    const { output } = executor.execute(current);
                    current = output;
                }
                else {
                    // Remote execution via transport
                    try {
                        current = await this.transport.sendActivation(assignment.device, assignment.partitionId, current, requestId);
                    }
                    catch (err) {
                        // Device failed — check if we have a local fallback
                        const localFallback = model.localExecutors.get(assignment.partitionId);
                        if (localFallback) {
                            const { output } = localFallback.execute(current);
                            current = output;
                            usedReplica = true;
                        }
                        else {
                            throw new Error(`Remote device ${assignment.device} failed for partition ` +
                                `${assignment.partitionId} and no local replica available`);
                        }
                    }
                }
                partitionTimings.push({
                    partitionId: assignment.partitionId,
                    device: assignment.device,
                    layerRange: assignment.layerRange,
                    computeMs: performance.now() - partitionStart,
                });
            }
            this.completedInferences++;
            return {
                requestId,
                modelId,
                output: current,
                totalMs: performance.now() - startTime,
                partitionTimings,
                usedReplica,
            };
        }
        finally {
            this.pendingCount--;
        }
    }
    // ═══════════════════════════════════════
    // Remote Execution Handler
    // ═══════════════════════════════════════
    /**
     * Handle an incoming activation from a remote device.
     * Called by the transport handler when a LAYER_ACTIVATION message arrives.
     */
    executePartition(modelId, partitionId, input) {
        const model = this.models.get(modelId);
        if (!model)
            return null;
        const executor = model.localExecutors.get(partitionId);
        if (!executor)
            return null;
        const { output } = executor.execute(input);
        return output;
    }
    /**
     * Execute ALL local partitions for a model.
     * Used by remote activation handler — partition IDs differ between devices,
     * so we run through whatever local executors exist for this model.
     */
    executeAllLocal(modelId, input) {
        const model = this.models.get(modelId);
        if (!model || model.localExecutors.size === 0)
            return null;
        // Sort executors by layer range to ensure correct order
        const sorted = [...model.localExecutors.values()].sort((a, b) => a.layerRange[0] - b.layerRange[0]);
        let current = input;
        for (const executor of sorted) {
            const { output } = executor.execute(current);
            current = output;
        }
        return current;
    }
    // ═══════════════════════════════════════
    // Rebalance
    // ═══════════════════════════════════════
    /**
     * Rebalance model partitions across devices.
     * Called when devices join or leave the mesh.
     */
    rebalance(modelId) {
        const model = this.models.get(modelId);
        if (!model)
            return { migrations: 0 };
        const newDevices = this.transport.getDevices();
        const localId = this.transport.getLocalDeviceId();
        if (!newDevices.find(d => d.deviceId === localId)) {
            newDevices.push({
                deviceId: localId,
                availableMemoryBytes: this.config.maxMemoryBytes,
                computeSpeed: 1.0,
            });
        }
        const { assignments, migrations } = (0, partitioner_1.rebalancePartitions)(model.manifest, model.assignments, newDevices);
        // Update model's assignments and chain
        model.assignments = assignments;
        model.chain = [...assignments].sort((a, b) => a.layerRange[0] - b.layerRange[0]);
        // Recreate local executors (simplified — real impl would transfer weights)
        // For now, only removes executors for partitions no longer local
        for (const [pid, executor] of model.localExecutors) {
            const stillLocal = assignments.find(a => a.partitionId === pid && a.device === localId);
            if (!stillLocal) {
                model.localExecutors.delete(pid);
            }
        }
        return { migrations: migrations.length };
    }
    // ═══════════════════════════════════════
    // Unload
    // ═══════════════════════════════════════
    /**
     * Unload a model from the cortex.
     */
    unloadModel(modelId) {
        return this.models.delete(modelId);
    }
    // ═══════════════════════════════════════
    // Status
    // ═══════════════════════════════════════
    /**
     * Get cortex status.
     */
    getStatus() {
        const models = [];
        let totalMemory = 0;
        for (const [modelId, model] of this.models) {
            const devices = new Set();
            let memUsed = 0;
            for (const a of model.assignments) {
                devices.add(a.device);
                memUsed += a.sizeBytes;
            }
            models.push({
                modelId,
                modelName: model.manifest.modelName,
                totalLayers: model.manifest.totalLayers,
                partitions: model.assignments.length,
                devices: Array.from(devices),
                ready: model.ready,
            });
            totalMemory += memUsed;
        }
        return {
            models,
            totalMemoryUsed: totalMemory,
            pendingInferences: this.pendingCount,
            completedInferences: this.completedInferences,
        };
    }
    /**
     * Get partition assignments for a model.
     */
    getAssignments(modelId) {
        return this.models.get(modelId)?.assignments ?? [];
    }
    /**
     * Check if a model is loaded.
     */
    hasModel(modelId) {
        return this.models.has(modelId);
    }
    /**
     * Get number of loaded models.
     */
    get modelCount() {
        return this.models.size;
    }
}
exports.MeshCortex = MeshCortex;
//# sourceMappingURL=mesh-cortex.js.map