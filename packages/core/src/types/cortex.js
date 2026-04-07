"use strict";
/**
 * CMP v3.0 — Mesh Cortex Type Definitions (Layer 14)
 * Distributed neural network inference across mesh devices.
 *
 * A model is split into partitions. Each partition is assigned to a device
 * and backed by a LayerLifeform. Inference flows as a causal chain
 * through synapses connecting sequential layer partitions.
 *
 * Wire protocol message types: 0xF6-0xFB
 *
 * @module types/cortex
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CORTEX_CONFIG = exports.CortexMessageType = void 0;
// ─── Wire Protocol Messages (Layer 14) ───
var CortexMessageType;
(function (CortexMessageType) {
    /** Announce model partition assignment */
    CortexMessageType[CortexMessageType["MODEL_PARTITION"] = 246] = "MODEL_PARTITION";
    /** Forward activation tensor to next layer */
    CortexMessageType[CortexMessageType["LAYER_ACTIVATION"] = 247] = "LAYER_ACTIVATION";
    /** Return processed activation from a layer */
    CortexMessageType[CortexMessageType["LAYER_RESULT"] = 248] = "LAYER_RESULT";
    /** Request model rebalance (device joined/left) */
    CortexMessageType[CortexMessageType["MODEL_REBALANCE"] = 249] = "MODEL_REBALANCE";
    /** Submit inference request to the cortex */
    CortexMessageType[CortexMessageType["INFERENCE_REQUEST"] = 250] = "INFERENCE_REQUEST";
    /** Return inference result */
    CortexMessageType[CortexMessageType["INFERENCE_RESULT"] = 251] = "INFERENCE_RESULT";
})(CortexMessageType || (exports.CortexMessageType = CortexMessageType = {}));
exports.DEFAULT_CORTEX_CONFIG = {
    maxMemoryBytes: 536870912, // 512MB
    inferenceTimeoutMs: 30000,
    replicatePartitions: true,
    maxPartitionsPerDevice: 4,
};
//# sourceMappingURL=cortex.js.map