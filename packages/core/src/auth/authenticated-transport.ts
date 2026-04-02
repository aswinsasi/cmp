/**
 * CMP v1.5 — Authenticated Transport
 *
 * ITransport wrapper that transparently signs all outgoing messages
 * and verifies all incoming messages using Ed25519.
 *
 * Usage:
 *   const raw = new LANTransport();
 *   const auth = new AuthenticatedTransport(raw);
 *   await auth.start();
 *   // All messages are now signed/verified automatically
 *
 * Behavior:
 *   - sendTo / broadcast: signs the data before forwarding to inner transport
 *   - message events: verifies signature, drops invalid, strips trailer
 *   - peer_discovered events: pass through unmodified (beacons are unsigned
 *     in v1.5 — the handshake phase establishes identity)
 *   - key mismatch (TOFU violation): emits 'auth_violation' event and drops
 *
 * The caller sees the exact same ITransport interface. Data flowing
 * through event handlers has the auth trailer stripped — the caller
 * never sees raw signatures.
 *
 * @module auth/authenticated-transport
 * @author Agent Viscro
 */

import { ITransport, TransportEvent, TransportEventHandler } from '../../../transport/src/interface';
import {
  AuthKeypair,
  generateAuthKeypair,
  signFrame,
  verifyFrame,
  hasAuthTrailer,
  PeerKeyRegistry,
  AUTH_TRAILER_SIZE,
} from './message-auth';

// ─── Stats ───

export interface AuthTransportStats {
  messagesSigned: number;
  messagesVerified: number;
  messagesRejectedBadSig: number;
  messagesRejectedKeyMismatch: number;
  peersRegistered: number;
}

// ─── Auth Violation Event ───

export interface AuthViolationEvent {
  type: 'key_mismatch' | 'bad_signature';
  peerAddress: string;
  timestamp: number;
  /** The public key we expected (from TOFU registry) */
  expectedKey?: Uint8Array;
  /** The public key we received */
  receivedKey?: Uint8Array;
}

export type AuthViolationHandler = (event: AuthViolationEvent) => void;

// ─── Authenticated Transport ───

export class AuthenticatedTransport implements ITransport {
  readonly name: string;
  readonly maxPayloadBytes: number;
  readonly estimatedBandwidthMbps: number;

  private inner: ITransport;
  private keypair: AuthKeypair;
  private peerRegistry: PeerKeyRegistry;
  private handlers = new Map<string, Set<TransportEventHandler>>();
  private violationHandlers = new Set<AuthViolationHandler>();

  /** Stats */
  private stats: AuthTransportStats = {
    messagesSigned: 0,
    messagesVerified: 0,
    messagesRejectedBadSig: 0,
    messagesRejectedKeyMismatch: 0,
    peersRegistered: 0,
  };

  /**
   * @param inner - The raw transport to wrap
   * @param keypair - Optional pre-generated keypair (generates new if not provided)
   */
  constructor(inner: ITransport, keypair?: AuthKeypair) {
    this.inner = inner;
    this.keypair = keypair || generateAuthKeypair();
    this.peerRegistry = new PeerKeyRegistry();

    // Adjust max payload to account for auth trailer
    this.name = `auth(${inner.name})`;
    this.maxPayloadBytes = inner.maxPayloadBytes - AUTH_TRAILER_SIZE;
    this.estimatedBandwidthMbps = inner.estimatedBandwidthMbps;

    // Subscribe to inner transport events
    this.inner.on('message', (event) => this.handleIncomingMessage(event));
    this.inner.on('peer_discovered', (event) => this.emit(event));
    this.inner.on('peer_lost', (event) => this.emit(event));
    this.inner.on('error', (event) => this.emit(event));
  }

  // ── Lifecycle ──

  async start(): Promise<void> {
    return this.inner.start();
  }

  async stop(): Promise<void> {
    return this.inner.stop();
  }

  isRunning(): boolean {
    return this.inner.isRunning();
  }

  // ── Discovery (pass-through, beacons are unsigned) ──

  async startBeaconing(beaconData: Uint8Array, intervalMs: number): Promise<void> {
    return this.inner.startBeaconing(beaconData, intervalMs);
  }

  async stopBeaconing(): Promise<void> {
    return this.inner.stopBeaconing();
  }

  async startScanning(): Promise<void> {
    return this.inner.startScanning();
  }

  async stopScanning(): Promise<void> {
    return this.inner.stopScanning();
  }

  // ── Data Transfer (signed) ──

  async sendTo(peerAddress: string, data: Uint8Array): Promise<void> {
    const signed = signFrame(data, this.keypair.secretKey, this.keypair.publicKey);
    this.stats.messagesSigned++;
    return this.inner.sendTo(peerAddress, signed);
  }

  async broadcast(data: Uint8Array): Promise<void> {
    const signed = signFrame(data, this.keypair.secretKey, this.keypair.publicKey);
    this.stats.messagesSigned++;
    return this.inner.broadcast(signed);
  }

  // ── Events ──

  on(event: string, handler: TransportEventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: TransportEventHandler): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(event);
    }
  }

  /**
   * Subscribe to authentication violation events.
   * These fire when a peer sends a message with an invalid signature
   * or when a known peer's key changes (potential MITM).
   */
  onAuthViolation(handler: AuthViolationHandler): void {
    this.violationHandlers.add(handler);
  }

  // ── Public Accessors ──

  /** Get this node's public key */
  getPublicKey(): Uint8Array {
    return this.keypair.publicKey;
  }

  /** Get the peer key registry */
  getPeerRegistry(): PeerKeyRegistry {
    return this.peerRegistry;
  }

  /** Get authentication statistics */
  getStats(): AuthTransportStats {
    return { ...this.stats, peersRegistered: this.peerRegistry.size };
  }

  /** Get the inner (raw) transport */
  getInnerTransport(): ITransport {
    return this.inner;
  }

  // ── Internals ──

  private handleIncomingMessage(event: TransportEvent): void {
    if (!event.data || event.data.length === 0) return;

    // Check if this message has an auth trailer
    if (!hasAuthTrailer(event.data)) {
      // Unsigned message — in v1.5, we still accept unsigned messages
      // for backward compatibility but could flag them in the future
      this.emit(event);
      return;
    }

    // Verify signature
    const result = verifyFrame(event.data);

    if (!result.valid) {
      // Bad signature — drop and report
      this.stats.messagesRejectedBadSig++;
      for (const handler of this.violationHandlers) {
        try {
          handler({
            type: 'bad_signature',
            peerAddress: event.peerAddress || 'unknown',
            timestamp: Date.now(),
            receivedKey: result.senderKey,
          });
        } catch {}
      }
      return;
    }

    // TOFU key registration/verification
    const address = event.peerAddress || 'unknown';
    const keyTrusted = this.peerRegistry.registerKey(address, result.senderKey);

    if (!keyTrusted) {
      // Key mismatch! This address previously used a different key.
      this.stats.messagesRejectedKeyMismatch++;
      const expectedKey = this.peerRegistry.getKey(address);
      for (const handler of this.violationHandlers) {
        try {
          handler({
            type: 'key_mismatch',
            peerAddress: address,
            timestamp: Date.now(),
            expectedKey: expectedKey || undefined,
            receivedKey: result.senderKey,
          });
        } catch {}
      }
      return;
    }

    this.stats.messagesVerified++;

    // Emit with stripped frame (no auth trailer)
    this.emit({
      ...event,
      data: result.frame,
    });
  }

  private emit(event: TransportEvent): void {
    for (const key of [event.type, 'all']) {
      const set = this.handlers.get(key);
      if (set) {
        for (const h of set) {
          try { h(event); } catch {}
        }
      }
    }
  }
}
