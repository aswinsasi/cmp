/**
 * CMP Beacon Types
 * Layer 1: Discovery beacon frame format.
 * Designed to fit within a single BLE 5.0 advertisement packet (38 bytes).
 *
 * @module types/beacon
 * @author Agent Viscro
 */

import { MeshId, Hash64, Timestamp } from './primitives';

/** CMP magic bytes: ASCII "CMP" = 0x434D50 */
export const BEACON_MAGIC = 0x434D50;

/** Total serialized beacon size in bytes */
export const BEACON_SIZE = 38;

/** Default beacon broadcast interval (ms) */
export const BEACON_INTERVAL_MS = 5000;

/** Mark peer as stale after this many ms without beacon */
export const PEER_STALE_MS = 30000;

/** Remove peer from table after this many ms without beacon */
export const PEER_DEAD_MS = 60000;

/** Current protocol version */
export const PROTOCOL_VERSION = 1;

/** Default hop count for relay */
export const DEFAULT_TTL = 3;

/** Beacon flag bits */
export interface BeaconFlags {
  /** Bit 0: Device is willing to execute tasks from others */
  acceptingTasks: boolean;
  /** Bit 1: Device has pending tasks waiting for mesh resources */
  hasPendingTasks: boolean;
  /** Bit 2: Device can relay beacons to extend mesh range */
  relayCapable: boolean;
}

/**
 * CMP Beacon Frame
 *
 * Broadcast at regular intervals to announce presence in the mesh.
 * Contains minimal information for discovery; full capability
 * exchange happens after handshake.
 */
export interface CMPBeacon {
  /** Magic bytes: 0x434D50 ("CMP") - 3 bytes */
  magic: number;
  /** Protocol version - 1 byte */
  version: number;
  /** Random session identifier - 16 bytes */
  meshId: MeshId;
  /** Truncated SHA-256 of capability set - 8 bytes */
  capabilityHash: Hash64;
  /** Unix timestamp in milliseconds - 8 bytes */
  timestamp: Timestamp;
  /** Hop count for relay, default 3 - 1 byte */
  ttl: number;
  /** Beacon flags - 1 byte */
  flags: BeaconFlags;
}

/**
 * CMP Message Types
 * Used as the first byte after magic for non-beacon messages.
 */
export enum MessageType {
  BEACON = 0x01,
  HANDSHAKE_INIT = 0x02,
  HANDSHAKE_RESPONSE = 0x03,
  CAPABILITY_EXCHANGE = 0x04,
  TASK_REQUEST = 0x10,
  BID = 0x11,
  ASSIGNMENT = 0x12,
  ASSIGNMENT_ACK = 0x13,
  CHUNK_DATA = 0x20,
  CHUNK_RESULT = 0x21,
  HEARTBEAT = 0x30,
  DEPARTURE_NOTICE = 0x31,
  CHECKPOINT_STORE = 0x40,
  CHECKPOINT_REQUEST = 0x41,
  CHECKPOINT_RESPONSE = 0x42,
  CODE_REQUEST = 0x50,
  CODE_RESPONSE = 0x51,
  CREDIT_RECEIPT = 0x60,
}
