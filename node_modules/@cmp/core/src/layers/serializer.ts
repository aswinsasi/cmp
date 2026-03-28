/**
 * CMP Message Serializer
 * Binary serialization for all protocol messages.
 *
 * v1.2 Wire Format (CMP Frame):
 *   [magic: 3B "CMP"][version: 1B][type: 1B][flags: 1B][seq: 2B][len: 4B][crc: 4B][payload: NB]
 *   Total header: 16 bytes
 *
 * Backward compatible: decodeMessage auto-detects v1.0 TLV format
 * (first byte != 0x43) and handles both formats transparently.
 *
 * @module layers/serializer
 * @author Agent Viscro
 */

import { MessageType, BEACON_MAGIC } from '../types/beacon';
import { CMPCapability, Architecture, GPUType, PowerSource, ThermalState, Runtime, GPUFeature } from '../types/capability';
import { concatBytes } from '../utils/helpers';
import { crc32c } from '../utils/crc32c';

/** CMP Frame header size in bytes */
export const FRAME_HEADER_SIZE = 16;

/** Maximum payload size (16 MB) */
export const FRAME_MAX_PAYLOAD = 16 * 1024 * 1024;

/** CMP Frame flags */
export interface FrameFlags {
  /** Bit 0: payload is LZ4-compressed */
  compressed: boolean;
  /** Bit 1: payload is encrypted */
  encrypted: boolean;
  /** Bit 2: payload is fragmented */
  fragmented: boolean;
}

/** Message envelope: type + payload + optional frame metadata */
export interface CMPMessage {
  type: MessageType;
  payload: Uint8Array;
  /** Frame sequence number (v1.2, 0 for v1.0 messages) */
  sequence?: number;
  /** Frame flags (v1.2) */
  flags?: FrameFlags;
}

/** Sequence counter per-session (monotonic) */
let frameSequence = 0;

/**
 * Encode a message into CMP Frame wire format (v1.2).
 *
 * Frame layout (16-byte header + payload):
 *   Offset  Size  Field
 *   0x00    3     magic       0x43 0x4D 0x50 ("CMP")
 *   0x03    1     version     0x01
 *   0x04    1     msg_type    MessageType enum
 *   0x05    1     flags       bitfield (compress|encrypt|fragment)
 *   0x06    2     sequence    uint16 big-endian (monotonic)
 *   0x08    4     payload_len uint32 big-endian
 *   0x0C    4     checksum    CRC-32C of payload
 *   0x10    var   payload     msg_type-specific content
 *
 * Signature is unchanged — existing callers work without modification.
 */
export function encodeMessage(type: MessageType, payload: Uint8Array): Uint8Array {
  if (payload.length > FRAME_MAX_PAYLOAD) {
    throw new Error(`Payload exceeds max size: ${payload.length} > ${FRAME_MAX_PAYLOAD}`);
  }

  const header = new Uint8Array(FRAME_HEADER_SIZE);
  const view = new DataView(header.buffer);

  // Magic: "CMP" (3 bytes)
  header[0] = 0x43; // 'C'
  header[1] = 0x4D; // 'M'
  header[2] = 0x50; // 'P'

  // Version (1 byte)
  header[3] = 0x01;

  // Message type (1 byte)
  header[4] = type;

  // Flags (1 byte) — no compression/encryption at frame level for now
  header[5] = 0x00;

  // Sequence (2 bytes, big-endian, monotonic)
  const seq = (frameSequence++) & 0xFFFF;
  view.setUint16(6, seq, false);

  // Payload length (4 bytes, big-endian)
  view.setUint32(8, payload.length, false);

  // CRC-32C of payload (4 bytes, big-endian)
  const checksum = crc32c(payload);
  view.setUint32(12, checksum, false);

  return concatBytes(header, payload);
}

/**
 * Decode a message from wire format.
 * Auto-detects v1.2 CMP Frame (magic 0x434D50) vs v1.0 TLV format.
 * Returns null if data is too short, malformed, or CRC fails.
 */
export function decodeMessage(data: Uint8Array): CMPMessage | null {
  if (data.length < 5) return null;

  // Auto-detect format: CMP Frame starts with 0x43 0x4D 0x50 ("CMP")
  if (data[0] === 0x43 && data[1] === 0x4D && data[2] === 0x50) {
    return decodeCMPFrame(data);
  }

  // Fallback: v1.0 TLV format [type:1B][length:4B][payload]
  return decodeTLV(data);
}

/**
 * Decode a v1.2 CMP Frame.
 */
function decodeCMPFrame(data: Uint8Array): CMPMessage | null {
  if (data.length < FRAME_HEADER_SIZE) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Version check
  const version = data[3];
  if (version < 1) return null;

  // Message type
  const type = data[4] as MessageType;

  // Flags
  const flagsByte = data[5];
  const flags: FrameFlags = {
    compressed: (flagsByte & 0x01) !== 0,
    encrypted: (flagsByte & 0x02) !== 0,
    fragmented: (flagsByte & 0x04) !== 0,
  };

  // Sequence
  const sequence = view.getUint16(6, false);

  // Payload length
  const payloadLen = view.getUint32(8, false);
  if (payloadLen > FRAME_MAX_PAYLOAD) return null;
  if (data.length < FRAME_HEADER_SIZE + payloadLen) return null;

  // CRC-32C
  const expectedCRC = view.getUint32(12, false);
  const payload = data.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + payloadLen);

  // Verify CRC
  const actualCRC = crc32c(payload);
  if (actualCRC !== expectedCRC) return null;

  return { type, payload, sequence, flags };
}

/**
 * Decode a v1.0 TLV format message (backward compatibility).
 */
function decodeTLV(data: Uint8Array): CMPMessage | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = data[0] as MessageType;
  const length = view.getUint32(1, false);
  if (data.length < 5 + length) return null;
  const payload = data.slice(5, 5 + length);
  return { type, payload };
}

/**
 * Reset the frame sequence counter (for testing).
 */
export function resetFrameSequence(): void {
  frameSequence = 0;
}

/**
 * Get the current frame sequence counter value.
 */
export function getFrameSequence(): number {
  return frameSequence;
}

/**
 * Encode a capability profile into binary.
 * Uses JSON for simplicity in v1.0; will migrate to protobuf in v1.1.
 */
export function encodeCapability(cap: CMPCapability): Uint8Array {
  const serializable = {
    meshId: Array.from(cap.meshId),
    cpu: cap.cpu,
    memory: cap.memory,
    gpu: {
      type: cap.gpu.type,
      computeUnits: cap.gpu.computeUnits,
      vramMb: cap.gpu.vramMb,
      supports: Array.from(cap.gpu.supports),
    },
    storage: cap.storage,
    network: cap.network,
    power: cap.power,
    runtimes: cap.runtimes,
    reputationScore: cap.reputationScore,
    availabilitySec: cap.availabilitySec,
  };
  const json = JSON.stringify(serializable);
  return new TextEncoder().encode(json);
}

/**
 * Decode a capability profile from binary.
 */
export function decodeCapability(data: Uint8Array): CMPCapability | null {
  try {
    const json = new TextDecoder().decode(data);
    const obj = JSON.parse(json);
    return {
      meshId: new Uint8Array(obj.meshId),
      cpu: obj.cpu,
      memory: obj.memory,
      gpu: {
        type: obj.gpu.type as GPUType,
        computeUnits: obj.gpu.computeUnits,
        vramMb: obj.gpu.vramMb,
        supports: new Set(obj.gpu.supports as GPUFeature[]),
      },
      storage: obj.storage,
      network: obj.network,
      power: obj.power,
      runtimes: obj.runtimes as Runtime[],
      reputationScore: obj.reputationScore,
      availabilitySec: obj.availabilitySec,
    };
  } catch {
    return null;
  }
}

/**
 * Encode a JSON-serializable object as a message payload.
 */
export function encodeJSON(obj: any): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

/**
 * Decode a JSON payload.
 */
export function decodeJSON<T = any>(data: Uint8Array): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
}

/**
 * Handshake init payload: sender's exchange public key.
 */
export interface HandshakeInit {
  meshId: number[];
  exchangePublicKey: number[];
  signingPublicKey: number[];
}

/**
 * Handshake response payload.
 */
export interface HandshakeResponse {
  meshId: number[];
  exchangePublicKey: number[];
  signingPublicKey: number[];
}

// ── Remote Execution Wire Formats ──

/**
 * CHUNK_DATA message: sent from requester to executor.
 * Contains everything the executor needs to run a chunk.
 */
export interface ChunkDataWire {
  taskId: number[];
  chunkId: number[];
  sequence: number;
  totalChunks: number;
  /** Raw WASM module bytes */
  wasmModule: number[];
  entryPoint: string;
  moduleHash: number[];
  /** Session key for payload decrypt/result encrypt */
  sessionKey: number[];
  /** Encrypted input data */
  encryptedPayload: number[];
  timeoutMs: number;
  expectedOutput: { format: number; maxSizeKb: number };
  /** Encrypted checkpoint from previous executor (for resuming after failure) */
  checkpoint?: number[];
  /** Number of steps already completed (for checkpoint resume) */
  checkpointSteps?: number;
}

/**
 * CHUNK_RESULT message: sent from executor back to requester.
 */
export interface ChunkResultWire {
  taskId: number[];
  chunkId: number[];
  executorId: number[];
  status: number;
  /** Encrypted output data */
  encryptedPayload: number[];
  executionTimeMs: number;
  resourceUsed: { cpuMs: number; memoryPeakMb: number; gpuMs: number };
  proof: number[];
}

/**
 * HEARTBEAT message: sent from executor to requester during execution.
 * Proves the executor is alive and still working on the chunk.
 */
export interface HeartbeatWire {
  taskId: number[];
  chunkId: number[];
  executorId: number[];
  timestamp: number;
}

/**
 * DEPARTURE_NOTICE message: broadcast when a node is shutting down gracefully.
 * Gives peers time to reassign any chunks this node was executing.
 */
export interface DepartureNoticeWire {
  meshId: number[];
  /** Chunks this node was executing (may be empty) */
  activeChunks: { taskId: number[]; chunkId: number[] }[];
  timestamp: number;
}

/**
 * CHECKPOINT_STORE message: sent from executor to requester during long-running tasks.
 * Contains a snapshot of the WASM linear memory so execution can resume on another device.
 */
export interface CheckpointStoreWire {
  taskId: number[];
  chunkId: number[];
  executorId: number[];
  /** Encrypted WASM memory snapshot */
  encryptedCheckpoint: number[];
  /** How many steps have been completed */
  stepsCompleted: number;
  timestamp: number;
}