/**
 * CMP Primitive Types
 * Foundation types used across all protocol messages.
 *
 * @module types/primitives
 * @author Agent Viscro
 */

/** 16-byte random session identifier, regenerated per mesh session */
export type MeshId = Uint8Array;

/** 16-byte unique task identifier */
export type TaskId = Uint8Array;

/** 16-byte unique chunk identifier */
export type ChunkId = Uint8Array;

/** 32-byte SHA-256 hash */
export type Hash256 = Uint8Array;

/** 8-byte truncated SHA-256 hash (for beacon capability summary) */
export type Hash64 = Uint8Array;

/** 64-byte Ed25519 signature */
export type Signature = Uint8Array;

/** 32-byte Ed25519 public key */
export type PublicKey = Uint8Array;

/** 32-byte Ed25519 secret key */
export type SecretKey = Uint8Array;

/** 32-byte X25519 shared session key */
export type SessionKey = Uint8Array;

/** Unix timestamp in milliseconds (BigInt for precision) */
export type Timestamp = bigint;

/** Compute Credit Units - the mesh's internal currency */
export type CCU = number;

/** Byte-level sizes */
export const MESH_ID_SIZE = 16;
export const TASK_ID_SIZE = 16;
export const CHUNK_ID_SIZE = 16;
export const HASH_256_SIZE = 32;
export const HASH_64_SIZE = 8;
export const SIGNATURE_SIZE = 64;
export const PUBLIC_KEY_SIZE = 32;
export const SECRET_KEY_SIZE = 32;
export const SESSION_KEY_SIZE = 32;
