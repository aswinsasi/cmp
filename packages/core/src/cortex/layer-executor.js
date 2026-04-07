"use strict";
/**
 * CMP v3.0 — Layer Executor
 * Processes forward pass activations for a partition of model layers.
 *
 * Each LayerExecutor handles a contiguous range of layers.
 * It receives an activation tensor, processes it through its layers,
 * and outputs the result for the next partition.
 *
 * For real models: this would run quantized matrix multiplications.
 * For simulation/testing: uses a simplified linear transform.
 *
 * @module cortex/layer-executor
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LayerExecutor = void 0;
exports.defaultLayerFunction = defaultLayerFunction;
/**
 * Default layer function: simplified linear transform + ReLU.
 * For each layer: output[i] = max(0, sum(input * weights_slice) + bias)
 *
 * This is a real computation (not a stub) but simplified from a full
 * transformer layer. Production would use quantized GEMM here.
 */
function defaultLayerFunction(input, layerIndex, weights) {
    const inputSize = input.data.length;
    const outputSize = inputSize; // Same dimension (like residual stream)
    const output = new Float32Array(outputSize);
    // Simple transform: for each output neuron, compute weighted sum + bias
    // Use a deterministic slice of the weights array for this layer
    const weightsPerLayer = Math.max(1, Math.floor(weights.length / Math.max(1, inputSize)));
    const layerOffset = (layerIndex * weightsPerLayer) % Math.max(1, weights.length - inputSize);
    for (let o = 0; o < outputSize; o++) {
        let sum = 0;
        for (let i = 0; i < Math.min(inputSize, weightsPerLayer); i++) {
            const wIdx = (layerOffset + o * Math.min(inputSize, weightsPerLayer) + i) % weights.length;
            sum += input.data[i % inputSize] * (weights[wIdx] || 0.01);
        }
        // ReLU activation
        output[o] = Math.max(0, sum);
    }
    // Normalize to prevent explosion across many layers
    let maxVal = 0;
    for (let i = 0; i < output.length; i++) {
        if (Math.abs(output[i]) > maxVal)
            maxVal = Math.abs(output[i]);
    }
    if (maxVal > 0) {
        for (let i = 0; i < output.length; i++) {
            output[i] /= maxVal;
        }
    }
    return { data: output, shape: input.shape };
}
// ─── Layer Executor ───
class LayerExecutor {
    partitionId;
    modelId;
    layerRange;
    weights;
    layerFn;
    /** Stats */
    executionCount = 0;
    totalComputeMs = 0;
    constructor(partition, layerFn) {
        this.partitionId = partition.partitionId;
        this.modelId = partition.modelId;
        this.layerRange = partition.layerRange;
        this.weights = partition.weights;
        this.layerFn = layerFn ?? defaultLayerFunction;
    }
    /**
     * Process an activation tensor through all layers in this partition.
     * Returns the output activation and compute time.
     */
    execute(input) {
        const start = performance.now();
        let current = input;
        for (let layer = this.layerRange[0]; layer <= this.layerRange[1]; layer++) {
            current = this.layerFn(current, layer, this.weights);
        }
        const computeMs = performance.now() - start;
        this.executionCount++;
        this.totalComputeMs += computeMs;
        return { output: current, computeMs };
    }
    /**
     * Number of layers in this partition.
     */
    get layerCount() {
        return this.layerRange[1] - this.layerRange[0] + 1;
    }
    /**
     * Get execution stats.
     */
    getStats() {
        return {
            executionCount: this.executionCount,
            totalComputeMs: this.totalComputeMs,
            avgComputeMs: this.executionCount > 0 ? this.totalComputeMs / this.executionCount : 0,
        };
    }
}
exports.LayerExecutor = LayerExecutor;
//# sourceMappingURL=layer-executor.js.map