/**
 * CMP Beacon Codec
 * Binary serialization/deserialization for 38-byte beacon frames.
 * Designed to fit within a single BLE 5.0 advertisement packet.
 *
 * Wire format:
 *   [magic: 3B][version: 1B][meshId: 16B][capHash: 8B][timestamp: 8B][ttl: 1B][flags: 1B]
 *   Total: 38 bytes
 *
 * @module layers/discovery
 * @author Agent Viscro
 */

import { CMPBeacon, BeaconFlags, BEACON_MAGIC, BEACON_SIZE, PROTOCOL_VERSION, DEFAULT_TTL } from '../types/beacon';
import { MeshId, Hash64 } from '../types/primitives';
import { hash64 } from '../crypto';
import { now } from '../utils/helpers';

/**
 * Encode a CMPBeacon into a 38-byte binary frame.
 */
export function encodeBeacon(beacon: CMPBeacon): Uint8Array {
  const buf = new ArrayBuffer(BEACON_SIZE);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  // Magic (3 bytes, big-endian)
  view.setUint8(offset++, (beacon.magic >> 16) & 0xff);
  view.setUint8(offset++, (beacon.magic >> 8) & 0xff);
  view.setUint8(offset++, beacon.magic & 0xff);

  // Version (1 byte)
  view.setUint8(offset++, beacon.version);

  // MeshId (16 bytes)
  bytes.set(beacon.meshId.slice(0, 16), offset);
  offset += 16;

  // Capability hash (8 bytes)
  bytes.set(beacon.capabilityHash.slice(0, 8), offset);
  offset += 8;

  // Timestamp (8 bytes, big-endian BigUint64)
  view.setBigUint64(offset, beacon.timestamp, false);
  offset += 8;

  // TTL (1 byte)
  view.setUint8(offset++, beacon.ttl);

  // Flags (1 byte)
  let flags = 0;
  if (beacon.flags.acceptingTasks) flags |= 0x01;
  if (beacon.flags.hasPendingTasks) flags |= 0x02;
  if (beacon.flags.relayCapable) flags |= 0x04;
  view.setUint8(offset++, flags);

  return bytes;
}

/**
 * Decode a 38-byte binary frame into a CMPBeacon.
 * Returns null if frame is invalid.
 */
export function decodeBeacon(data: Uint8Array): CMPBeacon | null {
  if (data.length < BEACON_SIZE) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  // Magic (3 bytes)
  const magic =
    (view.getUint8(offset) << 16) |
    (view.getUint8(offset + 1) << 8) |
    view.getUint8(offset + 2);
  offset += 3;

  if (magic !== BEACON_MAGIC) return null;

  // Version (1 byte)
  const version = view.getUint8(offset++);

  // MeshId (16 bytes)
  const meshId = new Uint8Array(16);
  meshId.set(data.slice(offset, offset + 16));
  offset += 16;

  // Capability hash (8 bytes)
  const capabilityHash = new Uint8Array(8);
  capabilityHash.set(data.slice(offset, offset + 8));
  offset += 8;

  // Timestamp (8 bytes)
  const timestamp = view.getBigUint64(offset, false);
  offset += 8;

  // TTL (1 byte)
  const ttl = view.getUint8(offset++);

  // Flags (1 byte)
  const flagsByte = view.getUint8(offset++);
  const flags: BeaconFlags = {
    acceptingTasks: (flagsByte & 0x01) !== 0,
    hasPendingTasks: (flagsByte & 0x02) !== 0,
    relayCapable: (flagsByte & 0x04) !== 0,
  };

  return { magic, version, meshId, capabilityHash, timestamp, ttl, flags };
}

/**
 * Create a fresh beacon for this node.
 */
export function createBeacon(
  meshId: MeshId,
  capabilityHash: Hash64,
  flags: Partial<BeaconFlags> = {}
): CMPBeacon {
  return {
    magic: BEACON_MAGIC,
    version: PROTOCOL_VERSION,
    meshId,
    capabilityHash,
    timestamp: now(),
    ttl: DEFAULT_TTL,
    flags: {
      acceptingTasks: true,
      hasPendingTasks: false,
      relayCapable: true,
      ...flags,
    },
  };
}

/**
 * Validate a decoded beacon.
 */
export function isValidBeacon(beacon: CMPBeacon): boolean {
  if (beacon.magic !== BEACON_MAGIC) return false;
  if (beacon.version < 1) return false;
  if (beacon.meshId.length !== 16) return false;
  if (beacon.capabilityHash.length !== 8) return false;
  if (beacon.ttl < 0 || beacon.ttl > 255) return false;
  return true;
}
