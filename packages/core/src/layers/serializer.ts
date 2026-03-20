/**
 * CMP Message Serializer
 * Binary serialization for all protocol messages beyond beacons.
 * Uses a simple TLV (Type-Length-Value) format:
 *   [type: 1B][length: 4B][payload: NB]
 *
 * @module layers/serializer
 * @author Agent Viscro
 */

import { MessageType } from '../types/beacon';
import { CMPCapability, Architecture, GPUType, PowerSource, ThermalState, Runtime, GPUFeature } from '../types/capability';
import { concatBytes } from '../utils/helpers';

/** Message envelope: type + length + payload */
export interface CMPMessage {
  type: MessageType;
  payload: Uint8Array;
}

/**
 * Encode a message into wire format.
 */
export function encodeMessage(type: MessageType, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(5);
  const view = new DataView(header.buffer);
  header[0] = type;
  view.setUint32(1, payload.length, false);
  return concatBytes(header, payload);
}

/**
 * Decode a message from wire format.
 * Returns null if data is too short or malformed.
 */
export function decodeMessage(data: Uint8Array): CMPMessage | null {
  if (data.length < 5) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = data[0] as MessageType;
  const length = view.getUint32(1, false);
  if (data.length < 5 + length) return null;
  const payload = data.slice(5, 5 + length);
  return { type, payload };
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
