"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PeerKeyRegistry = exports.MIN_AUTH_FRAME_SIZE = exports.AUTH_TRAILER_SIZE = exports.SIGNATURE_SIZE = exports.PUBKEY_SIZE = void 0;
exports.generateAuthKeypair = generateAuthKeypair;
exports.signFrame = signFrame;
exports.verifyFrame = verifyFrame;
exports.hasAuthTrailer = hasAuthTrailer;
const crypto_1 = require("../crypto");
/** Size of Ed25519 public key in bytes */
exports.PUBKEY_SIZE = 32;
/** Size of Ed25519 detached signature in bytes */
exports.SIGNATURE_SIZE = 64;
/** Total auth trailer size: pubkey + signature */
exports.AUTH_TRAILER_SIZE = exports.PUBKEY_SIZE + exports.SIGNATURE_SIZE;
/** Minimum authenticated frame size: 16B header + 32B pubkey + 64B sig */
exports.MIN_AUTH_FRAME_SIZE = 16 + exports.AUTH_TRAILER_SIZE;
/** CMP Frame magic bytes */
const CMP_MAGIC = [0x43, 0x4D, 0x50]; // "CMP"
/**
 * Generate a new Ed25519 signing keypair for message authentication.
 * Uses native crypto keygen when available.
 */
function generateAuthKeypair() {
    const kp = (0, crypto_1.generateSigningKeyPair)();
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}
/**
 * Sign a CMP frame by appending [pubkey][signature] trailer.
 * Uses native Ed25519 signing (40x faster than tweetnacl).
 */
function signFrame(frame, secretKey, publicKey) {
    // Sign the entire frame (header + payload) — NATIVE ACCELERATED
    const signature = (0, crypto_1.sign)(frame, secretKey);
    // Append: [frame][pubkey:32B][signature:64B]
    const authenticated = new Uint8Array(frame.length + exports.AUTH_TRAILER_SIZE);
    authenticated.set(frame, 0);
    authenticated.set(publicKey, frame.length);
    authenticated.set(signature, frame.length + exports.PUBKEY_SIZE);
    return authenticated;
}
/**
 * Verify and strip the auth trailer from an authenticated frame.
 * Uses native Ed25519 verification (52x faster than tweetnacl).
 */
function verifyFrame(data) {
    if (data.length < exports.MIN_AUTH_FRAME_SIZE) {
        return {
            valid: false,
            frame: data,
            senderKey: new Uint8Array(0),
            reason: `Frame too short for auth: ${data.length} < ${exports.MIN_AUTH_FRAME_SIZE}`,
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
    const frameEnd = data.length - exports.AUTH_TRAILER_SIZE;
    const frame = data.slice(0, frameEnd);
    const senderKey = data.slice(frameEnd, frameEnd + exports.PUBKEY_SIZE);
    const signature = data.slice(frameEnd + exports.PUBKEY_SIZE);
    // NATIVE ACCELERATED Ed25519 verification
    const valid = (0, crypto_1.verify)(frame, signature, senderKey);
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
function hasAuthTrailer(data) {
    if (data.length < exports.MIN_AUTH_FRAME_SIZE)
        return false;
    if (data[0] !== CMP_MAGIC[0] || data[1] !== CMP_MAGIC[1] || data[2] !== CMP_MAGIC[2])
        return false;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const payloadLen = view.getUint32(8, false);
    const expectedTotal = 16 + payloadLen + exports.AUTH_TRAILER_SIZE;
    return expectedTotal === data.length;
}
class PeerKeyRegistry {
    registry = new Map();
    registerKey(address, publicKey) {
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
        if (existing.publicKey.length !== publicKey.length)
            return false;
        for (let i = 0; i < publicKey.length; i++) {
            if (existing.publicKey[i] !== publicKey[i])
                return false;
        }
        existing.lastSeen = Date.now();
        existing.messagesVerified++;
        return true;
    }
    getKey(address) {
        const entry = this.registry.get(address);
        return entry ? entry.publicKey : null;
    }
    getEntry(address) {
        return this.registry.get(address) || null;
    }
    removeKey(address) {
        return this.registry.delete(address);
    }
    rotateKey(address, newPublicKey, oldPublicKey) {
        const existing = this.registry.get(address);
        if (!existing)
            return false;
        for (let i = 0; i < oldPublicKey.length; i++) {
            if (existing.publicKey[i] !== oldPublicKey[i])
                return false;
        }
        existing.publicKey = Uint8Array.from(newPublicKey);
        existing.lastSeen = Date.now();
        return true;
    }
    get size() {
        return this.registry.size;
    }
    clear() {
        this.registry.clear();
    }
    getAddresses() {
        return [...this.registry.keys()];
    }
}
exports.PeerKeyRegistry = PeerKeyRegistry;
//# sourceMappingURL=message-auth.js.map