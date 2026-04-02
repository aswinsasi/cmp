/**
 * CMP v1.5 — Message Authentication (Native Accelerated)
 *
 * Signs outgoing CMP frames with Ed25519. Verifies incoming frames.
 * Now uses the centralized crypto module (which uses native Node.js
 * crypto when available, 40-52x faster than tweetnacl).
 *
 * Authenticated Frame Format:
 *   [CMP Frame: 16B header + NB payload][senderPubKey: 32B][signature: 64B]
 *
 * @module auth/message-auth
 * @author Agent Viscro
 */

import {
  generateSigningKeyPair,
  sign as ed25519Sign,
  verify as ed25519Verify,
} from '../crypto';

/** Size of Ed25519 public key in bytes */
export const PUBKEY_SIZE = 32;

/** Size of Ed25519 detached signature in bytes */
export const SIGNATURE_SIZE = 64;

/** Total auth trailer size: pubkey + signature */
export const AUTH_TRAILER_SIZE = PUBKEY_SIZE + SIGNATURE_SIZE;

/** Minimum authenticated frame size: 16B header + 32B pubkey + 64B sig */
export const MIN_AUTH_FRAME_SIZE = 16 + AUTH_TRAILER_SIZE;

/** CMP Frame magic bytes */
const CMP_MAGIC = [0x43, 0x4D, 0x50]; // "CMP"

// ─── Signing ───

export interface AuthKeypair {
  publicKey: Uint8Array;  // 32 bytes
  secretKey: Uint8Array;  // 64 bytes
}

/**
 * Generate a new Ed25519 signing keypair for message authentication.
 * Uses native crypto keygen when available.
 */
export function generateAuthKeypair(): AuthKeypair {
  const kp = generateSigningKeyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/**
 * Sign a CMP frame by appending [pubkey][signature] trailer.
 * Uses native Ed25519 signing (40x faster than tweetnacl).
 */
export function signFrame(
  frame: Uint8Array,
  secretKey: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  // Sign the entire frame (header + payload) — NATIVE ACCELERATED
  const signature = ed25519Sign(frame, secretKey);

  // Append: [frame][pubkey:32B][signature:64B]
  const authenticated = new Uint8Array(frame.length + AUTH_TRAILER_SIZE);
  authenticated.set(frame, 0);
  authenticated.set(publicKey, frame.length);
  authenticated.set(signature, frame.length + PUBKEY_SIZE);

  return authenticated;
}

/**
 * Result of verifying an authenticated frame.
 */
export interface VerifyResult {
  /** Whether the signature is valid */
  valid: boolean;
  /** The raw CMP frame (header + payload) with auth trailer stripped */
  frame: Uint8Array;
  /** The sender's public key (32 bytes) */
  senderKey: Uint8Array;
  /** Reason for rejection (if valid === false) */
  reason?: string;
}

/**
 * Verify and strip the auth trailer from an authenticated frame.
 * Uses native Ed25519 verification (52x faster than tweetnacl).
 */
export function verifyFrame(data: Uint8Array): VerifyResult {
  if (data.length < MIN_AUTH_FRAME_SIZE) {
    return {
      valid: false,
      frame: data,
      senderKey: new Uint8Array(0),
      reason: `Frame too short for auth: ${data.length} < ${MIN_AUTH_FRAME_SIZE}`,
    };
  }

  if (data[0] !== CMP_MAGIC[0] || data[1] !== CMP_MAGIC[1] || data[2] !== CMP_MAGIC[2]) {
    return {
      valid: false,
      frame: data,
      senderKey: new Uint8Array(0),
      reason: 'Not a CMP frame (bad magic)',
    };
  }

  const frameEnd = data.length - AUTH_TRAILER_SIZE;
  const frame = data.slice(0, frameEnd);
  const senderKey = data.slice(frameEnd, frameEnd + PUBKEY_SIZE);
  const signature = data.slice(frameEnd + PUBKEY_SIZE);

  // NATIVE ACCELERATED Ed25519 verification
  const valid = ed25519Verify(frame, signature, senderKey);

  if (!valid) {
    return {
      valid: false,
      frame,
      senderKey,
      reason: 'Ed25519 signature verification failed',
    };
  }

  return { valid: true, frame, senderKey };
}

/**
 * Check if a frame has an auth trailer (heuristic).
 */
export function hasAuthTrailer(data: Uint8Array): boolean {
  if (data.length < MIN_AUTH_FRAME_SIZE) return false;
  if (data[0] !== CMP_MAGIC[0] || data[1] !== CMP_MAGIC[1] || data[2] !== CMP_MAGIC[2]) return false;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const payloadLen = view.getUint32(8, false);
  const expectedTotal = 16 + payloadLen + AUTH_TRAILER_SIZE;
  return expectedTotal === data.length;
}

// ─── Peer Key Registry (TOFU) ───

export interface PeerKeyEntry {
  publicKey: Uint8Array;
  firstSeen: number;
  lastSeen: number;
  messagesVerified: number;
}

export class PeerKeyRegistry {
  private registry = new Map<string, PeerKeyEntry>();

  registerKey(address: string, publicKey: Uint8Array): boolean {
    const existing = this.registry.get(address);

    if (!existing) {
      this.registry.set(address, {
        publicKey: Uint8Array.from(publicKey),
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        messagesVerified: 1,
      });
      return true;
    }

    if (existing.publicKey.length !== publicKey.length) return false;
    for (let i = 0; i < publicKey.length; i++) {
      if (existing.publicKey[i] !== publicKey[i]) return false;
    }

    existing.lastSeen = Date.now();
    existing.messagesVerified++;
    return true;
  }

  getKey(address: string): Uint8Array | null {
    const entry = this.registry.get(address);
    return entry ? entry.publicKey : null;
  }

  getEntry(address: string): PeerKeyEntry | null {
    return this.registry.get(address) || null;
  }

  removeKey(address: string): boolean {
    return this.registry.delete(address);
  }

  rotateKey(address: string, newPublicKey: Uint8Array, oldPublicKey: Uint8Array): boolean {
    const existing = this.registry.get(address);
    if (!existing) return false;

    for (let i = 0; i < oldPublicKey.length; i++) {
      if (existing.publicKey[i] !== oldPublicKey[i]) return false;
    }

    existing.publicKey = Uint8Array.from(newPublicKey);
    existing.lastSeen = Date.now();
    return true;
  }

  get size(): number {
    return this.registry.size;
  }

  clear(): void {
    this.registry.clear();
  }

  getAddresses(): string[] {
    return [...this.registry.keys()];
  }
}
