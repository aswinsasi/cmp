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
  /** Bit 3: Device supports Mesh Cognition Layer (v1.2) */
  mclCapable: boolean;
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

  // Layer 8: Mesh Cognition (v1.2)
  MER_OFFER = 0x70,
  MER_REQUEST = 0x71,
  MER_TRANSFER = 0x72,
  MER_STORE = 0x73,
  MER_QUERY = 0x74,

  // Layer 9: Precognition (v1.3)
  SPECULATIVE_OFFER = 0x80,
  SPECULATIVE_ACK = 0x81,
  SPECULATIVE_RESULT = 0x82,
  SPECULATIVE_ABORT = 0x83,
  PHANTOM_HIT = 0x84,

  // Immune System (v1.3)
  ANTIBODY_OFFER = 0x90,
  ANTIBODY_REQUEST = 0x91,
  ANTIBODY_TRANSFER = 0x92,
  QUARANTINE_NOTIFY = 0x93,

  // Temporal Compute Futures (v1.3)
  FUTURE_LIST = 0xA0,
  FUTURE_BUY = 0xA1,
  FUTURE_CONFIRM = 0xA2,
  FUTURE_CANCEL = 0xA3,
  FUTURE_SETTLE = 0xA4,
  FUTURE_QUERY = 0xA5,

  // Morphogenesis (v1.3)
  MORPHOGEN_SIGNAL = 0xB0,
  ORGAN_ANNOUNCE = 0xB1,
  ORGAN_JOIN = 0xB2,
  ORGAN_ACK = 0xB3,
  ORGAN_ROUTE = 0xB4,

  // V4 Supercomputer (v4.0) — range 0xF2-0xFD
  V4_LOAD_REPORT     = 0xF2,
  V4_JOB_ANNOUNCE    = 0xF3,
  V4_JOB_RESULT      = 0xF4,
  V4_PIPE_DATA       = 0xF5,
  V4_PIPE_BACKPRESSURE = 0xF6,
  V4_CATALOG_GOSSIP  = 0xF7,
  V4_CODE_SHIP       = 0xF8,
  V4_CODE_RESULT     = 0xF9,
  V4_TASK_CANCEL     = 0xFA,
  V4_TASK_CANCEL_ACK = 0xFB,
}
