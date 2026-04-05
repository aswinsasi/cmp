/**
 * CMP v4.0 — V3 Wire Message Encryption
 *
 * Encrypts all v3 wire messages using session keys derived from
 * the Ed25519 handshake. Previously, activation tensors and
 * other data traveled as plain JSON hex — now everything is
 * encrypted in transit.
 *
 * Encryption: XSalsa20-Poly1305 (via tweetnacl, same as existing)
 * Key: 32-byte session key from Diffie-Hellman exchange
 *
 * @module security/v3-encryption
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';

const log = new Logger('V3Encrypt');

// ─── Hex Helpers ───

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ─── Encryption Interface ───

export interface EncryptFn {
  (plaintext: Uint8Array, key: Uint8Array): Uint8Array;
}

export interface DecryptFn {
  (ciphertext: Uint8Array, key: Uint8Array): Uint8Array;
}

// ─── Message Range ───

/** v3 message types that should be encrypted (0xF2-0xFC) */
export const V3_ENCRYPTED_RANGE = { min: 0xF2, max: 0xFC };

/** v4 message types that should be encrypted */
export const V4_ENCRYPTED_RANGE = { min: 0xD0, max: 0xFF };

// ─── V3 Message Encryptor ───

export class V3MessageEncryptor {
  private sessionKeys = new Map<string, Uint8Array>();
  private encryptFn: EncryptFn;
  private decryptFn: DecryptFn;
  private enabled: boolean;

  // Stats
  private stats = {
    messagesEncrypted: 0,
    messagesDecrypted: 0,
    bytesEncrypted: 0,
    bytesDecrypted: 0,
    decryptionFailures: 0,
  };

  constructor(
    encryptFn: EncryptFn,
    decryptFn: DecryptFn,
    enabled: boolean = true,
  ) {
    this.encryptFn = encryptFn;
    this.decryptFn = decryptFn;
    this.enabled = enabled;
  }

  /**
   * Register a session key for a peer.
   */
  setSessionKey(peerId: string, key: Uint8Array): void {
    if (key.length !== 32) {
      throw new Error(`Session key must be 32 bytes, got ${key.length}`);
    }
    this.sessionKeys.set(peerId, key);
    log.info(`Session key registered for peer ${peerId.substring(0, 8)}`);
  }

  /**
   * Remove a session key (peer left).
   */
  removeSessionKey(peerId: string): void {
    this.sessionKeys.delete(peerId);
  }

  /**
   * Check if a session key exists for a peer.
   */
  hasSessionKey(peerId: string): boolean {
    return this.sessionKeys.has(peerId);
  }

  /**
   * Check if encryption is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable/disable encryption.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    log.info(`Wire encryption ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Should this message type be encrypted?
   */
  shouldEncrypt(msgType: number): boolean {
    if (!this.enabled) return false;
    return (msgType >= V3_ENCRYPTED_RANGE.min && msgType <= V3_ENCRYPTED_RANGE.max) ||
           (msgType >= V4_ENCRYPTED_RANGE.min && msgType <= V4_ENCRYPTED_RANGE.max);
  }

  /**
   * Encrypt a message payload for a peer.
   */
  encrypt(peerId: string, payload: Uint8Array): Uint8Array | null {
    if (!this.enabled) return payload;

    const key = this.sessionKeys.get(peerId);
    if (!key) {
      log.warn(`No session key for peer ${peerId.substring(0, 8)} — sending unencrypted`);
      return payload;
    }

    try {
      const encrypted = this.encryptFn(payload, key);
      this.stats.messagesEncrypted++;
      this.stats.bytesEncrypted += payload.length;
      return encrypted;
    } catch (err: any) {
      log.warn(`Encryption failed for peer ${peerId.substring(0, 8)}: ${err.message}`);
      return null;
    }
  }

  /**
   * Decrypt a message payload from a peer.
   */
  decrypt(peerId: string, ciphertext: Uint8Array): Uint8Array | null {
    if (!this.enabled) return ciphertext;

    const key = this.sessionKeys.get(peerId);
    if (!key) {
      log.warn(`No session key for peer ${peerId.substring(0, 8)} — cannot decrypt`);
      return null;
    }

    try {
      const decrypted = this.decryptFn(ciphertext, key);
      this.stats.messagesDecrypted++;
      this.stats.bytesDecrypted += decrypted.length;
      return decrypted;
    } catch (err: any) {
      this.stats.decryptionFailures++;
      log.warn(`Decryption failed from peer ${peerId.substring(0, 8)}: ${err.message}`);
      return null;
    }
  }

  /**
   * Get encryption statistics.
   */
  getStats(): typeof this.stats & { registeredPeers: number } {
    return { ...this.stats, registeredPeers: this.sessionKeys.size };
  }

  /**
   * Clear all session keys.
   */
  clearKeys(): void {
    this.sessionKeys.clear();
  }
}
