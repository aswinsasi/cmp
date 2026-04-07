"use strict";
/**
 * CMP v3.0 — V3 Transport Handler
 * Real wire protocol for distributing computation across physical devices.
 *
 * Handles request-response patterns for:
 *   - Cortex: send activation tensor → remote device computes → returns result
 *   - GPU: send compute task → remote device executes → returns output
 *   - Memory: send shard → remote device stores; request shard → returns data
 *
 * Message types 0xF2-0xFC (after v2's 0xE1-0xF1 range).
 *
 * Uses the same frame format as existing LifeformTransportHandler:
 *   encodeMessage(type, jsonPayload) → CMP Frame → transport.sendTo()
 *
 * @module v3-transport
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.V3TransportHandler = exports.V3MessageType = void 0;
exports.isV3Message = isV3Message;
// ─── V3 Wire Message Types ───
exports.V3MessageType = {
    // Holographic Memory (Layer 15)
    SHARD_WRITE: 0xF2,
    SHARD_READ_REQUEST: 0xF3,
    SHARD_READ_RESPONSE: 0xF4,
    SHARD_REBALANCE: 0xF5,
    // Mesh Cortex (Layer 14)
    LAYER_ACTIVATION: 0xF6,
    LAYER_RESULT: 0xF7,
    // Mesh GPU (Layer 16)
    GPU_TASK_SUBMIT: 0xFA,
    GPU_TASK_RESULT: 0xFB,
    GPU_CAPABILITY_AD: 0xFC,
};
const V3_MSG_MIN = 0xF2;
const V3_MSG_MAX = 0xFC;
function isV3Message(typeCode) {
    return typeCode >= V3_MSG_MIN && typeCode <= V3_MSG_MAX;
}
// ─── Float32Array serialization ───
function float32ToBase64(arr) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    // Use hex encoding (works everywhere, no btoa dependency issues)
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}
function base64ToFloat32(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return new Float32Array(bytes.buffer);
}
function uint8ToHex(arr) {
    let hex = '';
    for (let i = 0; i < arr.length; i++) {
        hex += arr[i].toString(16).padStart(2, '0');
    }
    return hex;
}
function hexToUint8(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
// ═══════════════════════════════════════
class V3TransportHandler {
    transport;
    resolver;
    /** Pending request callbacks: requestId → { resolve, reject, timer } */
    pending = new Map();
    /** Default timeout for request-response (ms) */
    timeoutMs = 15000;
    /** Handlers for incoming requests (set by V3Bridge) */
    cortexHandler = null;
    gpuHandler = null;
    shardStoreHandler = null;
    shardReadHandler = null;
    constructor(transport, resolver) {
        this.transport = transport;
        this.resolver = resolver;
    }
    // ═══════════════════════════════════════
    // Handler Registration
    // ═══════════════════════════════════════
    /** Register handler for incoming Cortex activations */
    onCortexActivation(handler) {
        this.cortexHandler = handler;
    }
    /** Register handler for incoming GPU tasks */
    onGPUTask(handler) {
        this.gpuHandler = handler;
    }
    /** Register handler for incoming shard writes */
    onShardStore(handler) {
        this.shardStoreHandler = handler;
    }
    /** Register handler for incoming shard reads */
    onShardRead(handler) {
        this.shardReadHandler = handler;
    }
    // ═══════════════════════════════════════
    // Incoming Message Router
    // ═══════════════════════════════════════
    /**
     * Handle an incoming V3 message from the wire.
     * Called by CMPNode when message type is 0xF2-0xFC.
     */
    async handleIncoming(type, payload, senderAddress) {
        let data;
        try {
            data = JSON.parse(decoder.decode(payload));
        }
        catch {
            return; // Malformed
        }
        switch (type) {
            // ── Cortex ──
            case exports.V3MessageType.LAYER_ACTIVATION:
                await this.handleCortexActivation(data, senderAddress);
                break;
            case exports.V3MessageType.LAYER_RESULT:
                this.handleResponse(data);
                break;
            // ── GPU ──
            case exports.V3MessageType.GPU_TASK_SUBMIT:
                await this.handleGPUTaskSubmit(data, senderAddress);
                break;
            case exports.V3MessageType.GPU_TASK_RESULT:
                this.handleResponse(data);
                break;
            // ── Memory ──
            case exports.V3MessageType.SHARD_WRITE:
                this.handleShardWrite(data, senderAddress);
                break;
            case exports.V3MessageType.SHARD_READ_REQUEST:
                await this.handleShardReadRequest(data, senderAddress);
                break;
            case exports.V3MessageType.SHARD_READ_RESPONSE:
                this.handleResponse(data);
                break;
        }
    }
    // ═══════════════════════════════════════
    // CORTEX: Send activation, receive result
    // ═══════════════════════════════════════
    /**
     * Send an activation tensor to a remote device for processing.
     * Waits for the result and returns it.
     */
    async sendActivation(deviceId, partitionId, activationData, shape, requestId, modelId) {
        const address = this.resolver.getAddressForMeshId(deviceId);
        if (!address)
            throw new Error(`No address for device: ${deviceId}`);
        const msg = {
            requestId,
            partitionId,
            modelId: modelId || '',
            dataHex: float32ToBase64(activationData),
            shape,
            senderId: this.resolver.getLocalMeshId(),
        };
        const payload = encoder.encode(JSON.stringify(msg));
        const frame = this.transport.encodeFrame(exports.V3MessageType.LAYER_ACTIVATION, payload);
        await this.transport.sendTo(address, frame);
        // Wait for response
        const response = await this.waitForResponse(requestId);
        return {
            data: base64ToFloat32(response.dataHex),
            shape: response.shape,
        };
    }
    /** Handle incoming activation request → compute → send result back */
    async handleCortexActivation(data, senderAddress) {
        if (!this.cortexHandler)
            return;
        const result = await this.cortexHandler(data.modelId || '', data.dataHex, data.shape, data.requestId);
        if (!result)
            return;
        const response = {
            requestId: data.requestId,
            dataHex: result.dataHex,
            shape: result.shape,
        };
        const payload = encoder.encode(JSON.stringify(response));
        const frame = this.transport.encodeFrame(exports.V3MessageType.LAYER_RESULT, payload);
        await this.transport.sendTo(senderAddress, frame);
    }
    // ═══════════════════════════════════════
    // GPU: Send task, receive result
    // ═══════════════════════════════════════
    /**
     * Send a GPU compute task to a remote device.
     * Serializes buffers and waits for result.
     */
    async sendGPUTask(deviceId, task) {
        const address = this.resolver.getAddressForMeshId(deviceId);
        if (!address)
            throw new Error(`No address for device: ${deviceId}`);
        const msg = {
            requestId: task.taskId,
            taskId: task.taskId,
            shaderCode: task.shaderCode,
            buffers: task.buffers.map(b => ({
                label: b.label,
                dataHex: float32ToBase64(b.data),
                usage: b.usage,
            })),
            workgroups: task.workgroups,
            outputBufferIndices: task.outputBufferIndices,
            priority: task.priority,
            senderId: this.resolver.getLocalMeshId(),
        };
        const payload = encoder.encode(JSON.stringify(msg));
        const frame = this.transport.encodeFrame(exports.V3MessageType.GPU_TASK_SUBMIT, payload);
        await this.transport.sendTo(address, frame);
        const response = await this.waitForResponse(task.taskId);
        return {
            taskId: response.taskId,
            success: response.success,
            outputBuffers: (response.outputBuffersHex || []).map((h) => base64ToFloat32(h)),
            computeMs: response.computeMs,
            executorDevice: response.executorDevice,
            error: response.error,
        };
    }
    /** Handle incoming GPU task → execute → send result back */
    async handleGPUTaskSubmit(data, senderAddress) {
        if (!this.gpuHandler)
            return;
        // Reconstruct task with deserialized buffers
        const task = {
            taskId: data.taskId,
            shaderCode: data.shaderCode,
            buffers: data.buffers.map((b) => ({
                label: b.label,
                data: base64ToFloat32(b.dataHex),
                usage: b.usage,
            })),
            workgroups: data.workgroups,
            outputBufferIndices: data.outputBufferIndices,
            priority: data.priority,
            deadline: 0,
            submitterDevice: data.senderId,
        };
        const result = await this.gpuHandler(task);
        const response = {
            requestId: data.requestId || data.taskId,
            taskId: result.taskId,
            success: result.success,
            outputBuffersHex: (result.outputBuffers || []).map((b) => float32ToBase64(b)),
            computeMs: result.computeMs,
            executorDevice: this.resolver.getLocalMeshId(),
            error: result.error,
        };
        const payload = encoder.encode(JSON.stringify(response));
        const frame = this.transport.encodeFrame(exports.V3MessageType.GPU_TASK_RESULT, payload);
        await this.transport.sendTo(senderAddress, frame);
    }
    // ═══════════════════════════════════════
    // MEMORY: Send/request shards
    // ═══════════════════════════════════════
    /**
     * Send a shard to a remote device for storage.
     */
    async sendShard(deviceId, shard) {
        const address = this.resolver.getAddressForMeshId(deviceId);
        if (!address)
            return false;
        const msg = {
            key: shard.key,
            shardIndex: shard.shardIndex,
            totalShards: shard.totalShards,
            requiredShards: shard.requiredShards,
            dataHex: uint8ToHex(shard.data),
            checksumHex: uint8ToHex(shard.checksum),
            originalSize: shard.originalSize,
            writtenAt: shard.writtenAt,
            ttlMs: shard.ttlMs,
            senderId: this.resolver.getLocalMeshId(),
        };
        const payload = encoder.encode(JSON.stringify(msg));
        const frame = this.transport.encodeFrame(exports.V3MessageType.SHARD_WRITE, payload);
        await this.transport.sendTo(address, frame);
        return true;
    }
    /**
     * Request a shard from a remote device.
     */
    async requestShard(deviceId, key, shardIndex) {
        const address = this.resolver.getAddressForMeshId(deviceId);
        if (!address)
            return null;
        const requestId = `shard-${key}-${shardIndex}-${Date.now()}`;
        const msg = {
            requestId,
            key,
            shardIndex,
            senderId: this.resolver.getLocalMeshId(),
        };
        const payload = encoder.encode(JSON.stringify(msg));
        const frame = this.transport.encodeFrame(exports.V3MessageType.SHARD_READ_REQUEST, payload);
        await this.transport.sendTo(address, frame);
        try {
            const response = await this.waitForResponse(requestId);
            if (!response.found)
                return null;
            return {
                data: hexToUint8(response.dataHex),
                checksum: hexToUint8(response.checksumHex),
            };
        }
        catch {
            return null; // Timeout
        }
    }
    /** Handle incoming shard write */
    handleShardWrite(data, senderAddress) {
        if (!this.shardStoreHandler)
            return;
        this.shardStoreHandler({
            key: data.key,
            shardIndex: data.shardIndex,
            totalShards: data.totalShards,
            requiredShards: data.requiredShards,
            data: hexToUint8(data.dataHex),
            checksum: hexToUint8(data.checksumHex),
            originalSize: data.originalSize,
            writtenAt: data.writtenAt,
            ttlMs: data.ttlMs,
        });
    }
    /** Handle incoming shard read request → lookup → send response */
    async handleShardReadRequest(data, senderAddress) {
        if (!this.shardReadHandler)
            return;
        const shard = this.shardReadHandler(data.key, data.shardIndex);
        const response = {
            requestId: data.requestId,
            key: data.key,
            shardIndex: data.shardIndex,
            found: !!shard,
        };
        if (shard) {
            response.dataHex = uint8ToHex(shard.descriptor.data);
            response.checksumHex = uint8ToHex(shard.descriptor.checksum);
        }
        const payload = encoder.encode(JSON.stringify(response));
        const frame = this.transport.encodeFrame(exports.V3MessageType.SHARD_READ_RESPONSE, payload);
        await this.transport.sendTo(senderAddress, frame);
    }
    // ═══════════════════════════════════════
    // Request-Response Infrastructure
    // ═══════════════════════════════════════
    /** Wait for a response matching a requestId */
    waitForResponse(requestId) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`V3 request timeout: ${requestId}`));
            }, this.timeoutMs);
            this.pending.set(requestId, { resolve, reject, timer });
        });
    }
    /** Handle an incoming response (matches to pending request) */
    handleResponse(data) {
        const requestId = data.requestId;
        if (!requestId)
            return;
        const pending = this.pending.get(requestId);
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.resolve(data);
    }
    /** Get count of pending requests */
    get pendingCount() {
        return this.pending.size;
    }
    /** Clean up all pending requests */
    destroy() {
        for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error('V3TransportHandler destroyed'));
        }
        this.pending.clear();
    }
}
exports.V3TransportHandler = V3TransportHandler;
//# sourceMappingURL=v3-transport.js.map