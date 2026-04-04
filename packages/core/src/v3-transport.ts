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

// ─── V3 Wire Message Types ───

export const V3MessageType = {
  // Holographic Memory (Layer 15)
  SHARD_WRITE:          0xF2,
  SHARD_READ_REQUEST:   0xF3,
  SHARD_READ_RESPONSE:  0xF4,
  SHARD_REBALANCE:      0xF5,

  // Mesh Cortex (Layer 14)
  LAYER_ACTIVATION:     0xF6,
  LAYER_RESULT:         0xF7,

  // Mesh GPU (Layer 16)
  GPU_TASK_SUBMIT:      0xFA,
  GPU_TASK_RESULT:      0xFB,
  GPU_CAPABILITY_AD:    0xFC,
} as const;

const V3_MSG_MIN = 0xF2;
const V3_MSG_MAX = 0xFC;

export function isV3Message(typeCode: number): boolean {
  return typeCode >= V3_MSG_MIN && typeCode <= V3_MSG_MAX;
}

// ─── Transport Interface (from CMPNode) ───

export interface V3FrameTransport {
  /** Encode a message into CMP Frame (uses existing serializer) */
  encodeFrame(type: number, payload: Uint8Array): Uint8Array;
  /** Send encoded frame to a peer by address */
  sendTo(peerAddress: string, data: Uint8Array): Promise<void>;
}

export interface V3PeerResolver {
  /** Get transport address for a mesh ID hex */
  getAddressForMeshId(meshIdHex: string): string | null;
  /** Get local mesh ID hex */
  getLocalMeshId(): string;
}

// ─── Float32Array serialization ───

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  // Use hex encoding (works everywhere, no btoa dependency issues)
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function base64ToFloat32(hex: string): Float32Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return new Float32Array(bytes.buffer);
}

function uint8ToHex(arr: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ═══════════════════════════════════════

export class V3TransportHandler {
  private transport: V3FrameTransport;
  private resolver: V3PeerResolver;

  /** Pending request callbacks: requestId → { resolve, reject, timer } */
  private pending = new Map<string, {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  /** Default timeout for request-response (ms) */
  private timeoutMs = 15000;

  /** Handlers for incoming requests (set by V3Bridge) */
  private cortexHandler: ((modelId: string, dataHex: string, shape: number[], requestId: string) => Promise<{ dataHex: string; shape: number[] } | null>) | null = null;
  private gpuHandler: ((task: any) => Promise<any>) | null = null;
  private shardStoreHandler: ((shard: any) => boolean) | null = null;
  private shardReadHandler: ((key: string, shardIndex: number) => any | null) | null = null;

  constructor(transport: V3FrameTransport, resolver: V3PeerResolver) {
    this.transport = transport;
    this.resolver = resolver;
  }

  // ═══════════════════════════════════════
  // Handler Registration
  // ═══════════════════════════════════════

  /** Register handler for incoming Cortex activations */
  onCortexActivation(handler: typeof this.cortexHandler): void {
    this.cortexHandler = handler;
  }

  /** Register handler for incoming GPU tasks */
  onGPUTask(handler: typeof this.gpuHandler): void {
    this.gpuHandler = handler;
  }

  /** Register handler for incoming shard writes */
  onShardStore(handler: typeof this.shardStoreHandler): void {
    this.shardStoreHandler = handler;
  }

  /** Register handler for incoming shard reads */
  onShardRead(handler: typeof this.shardReadHandler): void {
    this.shardReadHandler = handler;
  }

  // ═══════════════════════════════════════
  // Incoming Message Router
  // ═══════════════════════════════════════

  /**
   * Handle an incoming V3 message from the wire.
   * Called by CMPNode when message type is 0xF2-0xFC.
   */
  async handleIncoming(type: number, payload: Uint8Array, senderAddress: string): Promise<void> {
    let data: any;
    try {
      data = JSON.parse(decoder.decode(payload));
    } catch {
      return; // Malformed
    }

    switch (type) {
      // ── Cortex ──
      case V3MessageType.LAYER_ACTIVATION:
        await this.handleCortexActivation(data, senderAddress);
        break;

      case V3MessageType.LAYER_RESULT:
        this.handleResponse(data);
        break;

      // ── GPU ──
      case V3MessageType.GPU_TASK_SUBMIT:
        await this.handleGPUTaskSubmit(data, senderAddress);
        break;

      case V3MessageType.GPU_TASK_RESULT:
        this.handleResponse(data);
        break;

      // ── Memory ──
      case V3MessageType.SHARD_WRITE:
        this.handleShardWrite(data, senderAddress);
        break;

      case V3MessageType.SHARD_READ_REQUEST:
        await this.handleShardReadRequest(data, senderAddress);
        break;

      case V3MessageType.SHARD_READ_RESPONSE:
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
  async sendActivation(
    deviceId: string,
    partitionId: string,
    activationData: Float32Array,
    shape: number[],
    requestId: string,
    modelId?: string,
  ): Promise<{ data: Float32Array; shape: number[] }> {
    const address = this.resolver.getAddressForMeshId(deviceId);
    if (!address) throw new Error(`No address for device: ${deviceId}`);

    const msg = {
      requestId,
      partitionId,
      modelId: modelId || '',
      dataHex: float32ToBase64(activationData),
      shape,
      senderId: this.resolver.getLocalMeshId(),
    };

    const payload = encoder.encode(JSON.stringify(msg));
    const frame = this.transport.encodeFrame(V3MessageType.LAYER_ACTIVATION, payload);
    await this.transport.sendTo(address, frame);

    // Wait for response
    const response = await this.waitForResponse(requestId);
    return {
      data: base64ToFloat32(response.dataHex),
      shape: response.shape,
    };
  }

  /** Handle incoming activation request → compute → send result back */
  private async handleCortexActivation(data: any, senderAddress: string): Promise<void> {
    if (!this.cortexHandler) return;

    const result = await this.cortexHandler(
      data.modelId || '',
      data.dataHex,
      data.shape,
      data.requestId,
    );

    if (!result) return;

    const response = {
      requestId: data.requestId,
      dataHex: result.dataHex,
      shape: result.shape,
    };

    const payload = encoder.encode(JSON.stringify(response));
    const frame = this.transport.encodeFrame(V3MessageType.LAYER_RESULT, payload);
    await this.transport.sendTo(senderAddress, frame);
  }

  // ═══════════════════════════════════════
  // GPU: Send task, receive result
  // ═══════════════════════════════════════

  /**
   * Send a GPU compute task to a remote device.
   * Serializes buffers and waits for result.
   */
  async sendGPUTask(
    deviceId: string,
    task: {
      taskId: string;
      shaderCode: string;
      buffers: Array<{ label: string; data: Float32Array; usage: string }>;
      workgroups: [number, number, number];
      outputBufferIndices: number[];
      priority: string;
    },
  ): Promise<{
    taskId: string;
    success: boolean;
    outputBuffers: Float32Array[];
    computeMs: number;
    executorDevice: string;
    error?: string;
  }> {
    const address = this.resolver.getAddressForMeshId(deviceId);
    if (!address) throw new Error(`No address for device: ${deviceId}`);

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
    const frame = this.transport.encodeFrame(V3MessageType.GPU_TASK_SUBMIT, payload);
    await this.transport.sendTo(address, frame);

    const response = await this.waitForResponse(task.taskId);
    return {
      taskId: response.taskId,
      success: response.success,
      outputBuffers: (response.outputBuffersHex || []).map((h: string) => base64ToFloat32(h)),
      computeMs: response.computeMs,
      executorDevice: response.executorDevice,
      error: response.error,
    };
  }

  /** Handle incoming GPU task → execute → send result back */
  private async handleGPUTaskSubmit(data: any, senderAddress: string): Promise<void> {
    if (!this.gpuHandler) return;

    // Reconstruct task with deserialized buffers
    const task = {
      taskId: data.taskId,
      shaderCode: data.shaderCode,
      buffers: data.buffers.map((b: any) => ({
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
      outputBuffersHex: (result.outputBuffers || []).map((b: Float32Array) => float32ToBase64(b)),
      computeMs: result.computeMs,
      executorDevice: this.resolver.getLocalMeshId(),
      error: result.error,
    };

    const payload = encoder.encode(JSON.stringify(response));
    const frame = this.transport.encodeFrame(V3MessageType.GPU_TASK_RESULT, payload);
    await this.transport.sendTo(senderAddress, frame);
  }

  // ═══════════════════════════════════════
  // MEMORY: Send/request shards
  // ═══════════════════════════════════════

  /**
   * Send a shard to a remote device for storage.
   */
  async sendShard(
    deviceId: string,
    shard: {
      key: string;
      shardIndex: number;
      totalShards: number;
      requiredShards: number;
      data: Uint8Array;
      checksum: Uint8Array;
      originalSize: number;
      writtenAt: number;
      ttlMs: number;
    },
  ): Promise<boolean> {
    const address = this.resolver.getAddressForMeshId(deviceId);
    if (!address) return false;

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
    const frame = this.transport.encodeFrame(V3MessageType.SHARD_WRITE, payload);
    await this.transport.sendTo(address, frame);
    return true;
  }

  /**
   * Request a shard from a remote device.
   */
  async requestShard(
    deviceId: string,
    key: string,
    shardIndex: number,
  ): Promise<{ data: Uint8Array; checksum: Uint8Array } | null> {
    const address = this.resolver.getAddressForMeshId(deviceId);
    if (!address) return null;

    const requestId = `shard-${key}-${shardIndex}-${Date.now()}`;
    const msg = {
      requestId,
      key,
      shardIndex,
      senderId: this.resolver.getLocalMeshId(),
    };

    const payload = encoder.encode(JSON.stringify(msg));
    const frame = this.transport.encodeFrame(V3MessageType.SHARD_READ_REQUEST, payload);
    await this.transport.sendTo(address, frame);

    try {
      const response = await this.waitForResponse(requestId);
      if (!response.found) return null;
      return {
        data: hexToUint8(response.dataHex),
        checksum: hexToUint8(response.checksumHex),
      };
    } catch {
      return null; // Timeout
    }
  }

  /** Handle incoming shard write */
  private handleShardWrite(data: any, senderAddress: string): void {
    if (!this.shardStoreHandler) return;

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
  private async handleShardReadRequest(data: any, senderAddress: string): Promise<void> {
    if (!this.shardReadHandler) return;

    const shard = this.shardReadHandler(data.key, data.shardIndex);

    const response: any = {
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
    const frame = this.transport.encodeFrame(V3MessageType.SHARD_READ_RESPONSE, payload);
    await this.transport.sendTo(senderAddress, frame);
  }

  // ═══════════════════════════════════════
  // Request-Response Infrastructure
  // ═══════════════════════════════════════

  /** Wait for a response matching a requestId */
  private waitForResponse(requestId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`V3 request timeout: ${requestId}`));
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  /** Handle an incoming response (matches to pending request) */
  private handleResponse(data: any): void {
    const requestId = data.requestId;
    if (!requestId) return;

    const pending = this.pending.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(data);
  }

  /** Get count of pending requests */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Clean up all pending requests */
  destroy(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('V3TransportHandler destroyed'));
    }
    this.pending.clear();
  }
}
