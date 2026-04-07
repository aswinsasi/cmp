"use strict";
/**
 * CMP v3.0 — Mesh GPU Type Definitions (Layer 16)
 * Share GPU compute across the mesh. A device without a GPU can
 * submit compute shaders that execute on a remote device's GPU.
 *
 * Wire protocol message types: 0xFC-0xFE
 *
 * @module types/gpu
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MESH_GPU_CONFIG = exports.NO_GPU = exports.GPUMessageType = void 0;
// ─── Wire Protocol Messages (Layer 16) ───
var GPUMessageType;
(function (GPUMessageType) {
    /** Submit a GPU compute task */
    GPUMessageType[GPUMessageType["GPU_TASK_SUBMIT"] = 252] = "GPU_TASK_SUBMIT";
    /** Return GPU compute result */
    GPUMessageType[GPUMessageType["GPU_TASK_RESULT"] = 253] = "GPU_TASK_RESULT";
    /** GPU capability advertisement */
    GPUMessageType[GPUMessageType["GPU_CAPABILITY_AD"] = 254] = "GPU_CAPABILITY_AD";
})(GPUMessageType || (exports.GPUMessageType = GPUMessageType = {}));
exports.NO_GPU = {
    available: false,
    adapterName: 'none',
    maxBufferSize: 0,
    maxComputeWorkgroups: [0, 0, 0],
    maxComputeInvocations: 0,
    vramBytes: 0,
    vramUtilization: 0,
    computeUtilization: 0,
};
exports.DEFAULT_MESH_GPU_CONFIG = {
    maxConcurrentTasks: 4,
    taskTimeoutMs: 30000,
    minVramForAcceptance: 67108864, // 64MB
    maxUtilizationForAcceptance: 0.9,
};
//# sourceMappingURL=gpu.js.map