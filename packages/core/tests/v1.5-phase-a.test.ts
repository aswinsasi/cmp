/**
 * CMP v1.5 — Phase A Test Suite: Authentication & Flow Control
 *
 * Tests:
 *   1. Message Auth — signing, verification, tamper detection, TOFU registry
 *   2. Authenticated Transport — sign/verify through transport wrapper
 *   3. Flow Control — credit-based backpressure, queueing, replenish
 *
 * Run: npx ts-node --transpile-only packages/core/tests/v1.5-phase-a.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateAuthKeypair,
  signFrame,
  verifyFrame,
  hasAuthTrailer,
  PeerKeyRegistry,
  AUTH_TRAILER_SIZE,
  MIN_AUTH_FRAME_SIZE,
} from '../src/auth/message-auth';

import { AuthenticatedTransport } from '../src/auth/authenticated-transport';
import { FlowControlledTransport } from '../src/auth/flow-control';
import { ITransport, TransportEvent, TransportEventHandler } from '../../transport/src/interface';
import { encodeMessage, encodeJSON } from '../src/layers/serializer';
import { MessageType } from '../src/types/beacon';

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Mock transport for unit testing.
 * Records sends and allows manual message injection.
 */
class MockTransport implements ITransport {
  readonly name = 'mock';
  readonly maxPayloadBytes = 1048576;
  readonly estimatedBandwidthMbps = 1000;

  running = false;
  sentMessages: { address: string; data: Uint8Array }[] = [];
  broadcasts: Uint8Array[] = [];
  handlers = new Map<string, Set<TransportEventHandler>>();

  async start() { this.running = true; }
  async stop() { this.running = false; }
  isRunning() { return this.running; }
  async startBeaconing() {}
  async stopBeaconing() {}
  async startScanning() {}
  async stopScanning() {}

  async sendTo(peerAddress: string, data: Uint8Array) {
    this.sentMessages.push({ address: peerAddress, data });
  }

  async broadcast(data: Uint8Array) {
    this.broadcasts.push(data);
  }

  on(event: string, handler: TransportEventHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: TransportEventHandler) {
    const set = this.handlers.get(event);
    if (set) set.delete(handler);
  }

  /** Inject a message as if received from a peer */
  injectMessage(peerAddress: string, data: Uint8Array) {
    const event: TransportEvent = {
      type: 'message',
      peerAddress,
      data,
      transport: 'mock',
      timestamp: Date.now(),
    };
    const set = this.handlers.get('message');
    if (set) for (const h of set) h(event);
  }

  /** Inject a peer discovery */
  injectPeerDiscovered(peerAddress: string) {
    const event: TransportEvent = {
      type: 'peer_discovered',
      peerAddress,
      transport: 'mock',
      timestamp: Date.now(),
    };
    const set = this.handlers.get('peer_discovered');
    if (set) for (const h of set) h(event);
  }
}

// ═══════════════════════════════════════
// Message Auth Tests
// ═══════════════════════════════════════

describe('Message Auth — Keypair Generation', () => {
  it('should generate valid Ed25519 keypair', () => {
    const kp = generateAuthKeypair();
    assert.equal(kp.publicKey.length, 32);
    assert.equal(kp.secretKey.length, 64);
  });

  it('should generate unique keypairs', () => {
    const a = generateAuthKeypair();
    const b = generateAuthKeypair();
    assert.notDeepStrictEqual(a.publicKey, b.publicKey);
    assert.notDeepStrictEqual(a.secretKey, b.secretKey);
  });
});

describe('Message Auth — Frame Signing', () => {
  it('should sign a CMP frame and append auth trailer', () => {
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ test: true }));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);

    assert.equal(signed.length, frame.length + AUTH_TRAILER_SIZE);
    // Original frame is preserved at the start
    for (let i = 0; i < frame.length; i++) {
      assert.equal(signed[i], frame[i]);
    }
  });

  it('should verify a correctly signed frame', () => {
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ foo: 'bar' }));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);

    const result = verifyFrame(signed);
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.frame, frame);
    assert.deepStrictEqual(result.senderKey, kp.publicKey);
    assert.equal(result.reason, undefined);
  });

  it('should reject a tampered frame', () => {
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ test: true }));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);

    // Tamper with a payload byte (byte 20 is inside the payload)
    signed[20] ^= 0xFF;

    const result = verifyFrame(signed);
    // Tampered data should fail either CRC (in decodeMessage) or signature verification
    assert.equal(result.valid, false);
  });

  it('should reject a frame signed with wrong key', () => {
    const kp1 = generateAuthKeypair();
    const kp2 = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ test: true }));

    // Sign with kp1 secret but claim kp2 public key
    const signed = signFrame(frame, kp1.secretKey, kp2.publicKey);

    const result = verifyFrame(signed);
    assert.equal(result.valid, false);
  });

  it('should reject frames that are too short', () => {
    const result = verifyFrame(new Uint8Array(10));
    assert.equal(result.valid, false);
    assert.ok(result.reason!.includes('too short'));
  });

  it('should reject non-CMP frames', () => {
    const fakeFrame = new Uint8Array(MIN_AUTH_FRAME_SIZE);
    fakeFrame[0] = 0x00;
    const result = verifyFrame(fakeFrame);
    assert.equal(result.valid, false);
    assert.ok(result.reason!.includes('bad magic'));
  });

  it('should handle empty payload frames', () => {
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, new Uint8Array(0));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);
    const result = verifyFrame(signed);
    assert.equal(result.valid, true);
  });

  it('should handle large payload frames', () => {
    const kp = generateAuthKeypair();
    const bigPayload = new Uint8Array(65536);
    for (let i = 0; i < bigPayload.length; i++) bigPayload[i] = i & 0xFF;
    const frame = encodeMessage(MessageType.CHUNK_DATA, bigPayload);
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);
    const result = verifyFrame(signed);
    assert.equal(result.valid, true);
    assert.equal(result.frame.length, frame.length);
  });
});

describe('Message Auth — hasAuthTrailer', () => {
  it('should detect auth trailer on signed frame', () => {
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ x: 1 }));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);
    assert.equal(hasAuthTrailer(signed), true);
  });

  it('should not detect auth trailer on unsigned frame', () => {
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ x: 1 }));
    assert.equal(hasAuthTrailer(frame), false);
  });

  it('should not detect auth trailer on short data', () => {
    assert.equal(hasAuthTrailer(new Uint8Array(5)), false);
  });
});

describe('Message Auth — PeerKeyRegistry (TOFU)', () => {
  let registry: PeerKeyRegistry;

  beforeEach(() => {
    registry = new PeerKeyRegistry();
  });

  it('should accept first-time key registration', () => {
    const kp = generateAuthKeypair();
    assert.equal(registry.registerKey('10.0.0.1:8080', kp.publicKey), true);
    assert.equal(registry.size, 1);
  });

  it('should accept same key from same address', () => {
    const kp = generateAuthKeypair();
    assert.equal(registry.registerKey('10.0.0.1:8080', kp.publicKey), true);
    assert.equal(registry.registerKey('10.0.0.1:8080', kp.publicKey), true);

    const entry = registry.getEntry('10.0.0.1:8080');
    assert.ok(entry);
    assert.equal(entry.messagesVerified, 2);
  });

  it('should REJECT different key from same address (MITM)', () => {
    const kp1 = generateAuthKeypair();
    const kp2 = generateAuthKeypair();
    assert.equal(registry.registerKey('10.0.0.1:8080', kp1.publicKey), true);
    assert.equal(registry.registerKey('10.0.0.1:8080', kp2.publicKey), false);
  });

  it('should allow different keys from different addresses', () => {
    const kp1 = generateAuthKeypair();
    const kp2 = generateAuthKeypair();
    assert.equal(registry.registerKey('10.0.0.1:8080', kp1.publicKey), true);
    assert.equal(registry.registerKey('10.0.0.2:8080', kp2.publicKey), true);
    assert.equal(registry.size, 2);
  });

  it('should support key rotation with old key verification', () => {
    const kp1 = generateAuthKeypair();
    const kp2 = generateAuthKeypair();

    registry.registerKey('10.0.0.1:8080', kp1.publicKey);
    assert.equal(registry.rotateKey('10.0.0.1:8080', kp2.publicKey, kp1.publicKey), true);
    assert.equal(registry.registerKey('10.0.0.1:8080', kp2.publicKey), true);
    assert.equal(registry.registerKey('10.0.0.1:8080', kp1.publicKey), false);
  });

  it('should reject rotation with wrong old key', () => {
    const kp1 = generateAuthKeypair();
    const kp2 = generateAuthKeypair();
    const kp3 = generateAuthKeypair();
    registry.registerKey('10.0.0.1:8080', kp1.publicKey);
    assert.equal(registry.rotateKey('10.0.0.1:8080', kp2.publicKey, kp3.publicKey), false);
  });

  it('should remove peer keys', () => {
    const kp = generateAuthKeypair();
    registry.registerKey('10.0.0.1:8080', kp.publicKey);
    assert.equal(registry.removeKey('10.0.0.1:8080'), true);
    assert.equal(registry.size, 0);
    assert.equal(registry.getKey('10.0.0.1:8080'), null);
  });

  it('should list all registered addresses', () => {
    const kp1 = generateAuthKeypair();
    const kp2 = generateAuthKeypair();
    registry.registerKey('10.0.0.1:8080', kp1.publicKey);
    registry.registerKey('10.0.0.2:9090', kp2.publicKey);
    const addrs = registry.getAddresses();
    assert.equal(addrs.length, 2);
    assert.ok(addrs.includes('10.0.0.1:8080'));
    assert.ok(addrs.includes('10.0.0.2:9090'));
  });

  it('should clear all entries', () => {
    const kp = generateAuthKeypair();
    registry.registerKey('10.0.0.1:8080', kp.publicKey);
    registry.registerKey('10.0.0.2:8080', kp.publicKey);
    registry.clear();
    assert.equal(registry.size, 0);
  });
});

// ═══════════════════════════════════════
// Authenticated Transport Tests
// ═══════════════════════════════════════

describe('AuthenticatedTransport — Outgoing Messages', () => {
  it('should sign outgoing sendTo messages', async () => {
    const mock = new MockTransport();
    const auth = new AuthenticatedTransport(mock);
    await auth.start();

    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ test: true }));
    await auth.sendTo('10.0.0.1:8080', frame);

    assert.equal(mock.sentMessages.length, 1);
    const sent = mock.sentMessages[0];
    assert.equal(sent.address, '10.0.0.1:8080');
    assert.equal(sent.data.length, frame.length + AUTH_TRAILER_SIZE);
    assert.equal(hasAuthTrailer(sent.data), true);

    const verified = verifyFrame(sent.data);
    assert.equal(verified.valid, true);
    assert.deepStrictEqual(verified.frame, frame);
  });

  it('should sign outgoing broadcast messages', async () => {
    const mock = new MockTransport();
    const auth = new AuthenticatedTransport(mock);
    await auth.start();

    const frame = encodeMessage(MessageType.DEPARTURE_NOTICE, encodeJSON({ leaving: true }));
    await auth.broadcast(frame);

    assert.equal(mock.broadcasts.length, 1);
    assert.equal(hasAuthTrailer(mock.broadcasts[0]), true);
  });

  it('should track signing stats', async () => {
    const mock = new MockTransport();
    const auth = new AuthenticatedTransport(mock);
    await auth.start();

    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({}));
    await auth.sendTo('10.0.0.1:8080', frame);
    await auth.sendTo('10.0.0.2:8080', frame);
    await auth.broadcast(frame);

    assert.equal(auth.getStats().messagesSigned, 3);
  });
});

describe('AuthenticatedTransport — Incoming Messages', () => {
  it('should verify and strip valid signed messages', async () => {
    const mock = new MockTransport();
    const kpSender = generateAuthKeypair();
    const auth = new AuthenticatedTransport(mock);
    await auth.start();

    const received: TransportEvent[] = [];
    auth.on('message', (e) => received.push(e));

    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ hello: 'world' }));
    const signed = signFrame(frame, kpSender.secretKey, kpSender.publicKey);
    mock.injectMessage('10.0.0.5:9090', signed);

    assert.equal(received.length, 1);
    assert.deepStrictEqual(received[0].data, frame);
    assert.equal(received[0].peerAddress, '10.0.0.5:9090');
  });

  it('should DROP messages with invalid signatures', async () => {
    const mock = new MockTransport();
    const kp = generateAuthKeypair();
    const auth = new AuthenticatedTransport(mock);
    await auth.start();

    const received: TransportEvent[] = [];
    auth.on('message', (e) => received.push(e));

    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ test: true }));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);
    // Tamper with the signature itself (last 64 bytes)
    signed[signed.length - 10] ^= 0xFF;

    mock.injectMessage('10.0.0.5:9090', signed);

    assert.equal(received.length, 0);
    assert.equal(auth.getStats().messagesRejectedBadSig, 1);
  });

  it('should fire auth violation on bad signature', async () => {
    const mock = new MockTransport();
    const kp = generateAuthKeypair();
    const auth = new AuthenticatedTransport(mock);
    await auth.start();

    const violations: any[] = [];
    auth.onAuthViolation((e) => violations.push(e));

    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({}));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);
    signed[signed.length - 5] ^= 0xFF;

    mock.injectMessage('10.0.0.5:9090', signed);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].type, 'bad_signature');
    assert.equal(violations[0].peerAddress, '10.0.0.5:9090');
  });

  it('should REJECT key changes from same address (TOFU)', async () => {
    const mock = new MockTransport();
    const kp1 = generateAuthKeypair();
    const kp2 = generateAuthKeypair();
    const auth = new AuthenticatedTransport(mock);
    await auth.start();

    const received: TransportEvent[] = [];
    const violations: any[] = [];
    auth.on('message', (e) => received.push(e));
    auth.onAuthViolation((e) => violations.push(e));

    // First message from kp1 — accepted (TOFU)
    const frame1 = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ msg: 1 }));
    mock.injectMessage('10.0.0.5:9090', signFrame(frame1, kp1.secretKey, kp1.publicKey));
    assert.equal(received.length, 1);

    // Second message from DIFFERENT key at same address — REJECTED
    const frame2 = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ msg: 2 }));
    mock.injectMessage('10.0.0.5:9090', signFrame(frame2, kp2.secretKey, kp2.publicKey));
    assert.equal(received.length, 1); // Still 1

    assert.equal(violations.length, 1);
    assert.equal(violations[0].type, 'key_mismatch');
    assert.equal(auth.getStats().messagesRejectedKeyMismatch, 1);
  });

  it('should pass through unsigned messages (backward compat)', async () => {
    const mock = new MockTransport();
    const auth = new AuthenticatedTransport(mock);
    await auth.start();

    const received: TransportEvent[] = [];
    auth.on('message', (e) => received.push(e));

    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ old: true }));
    mock.injectMessage('10.0.0.5:9090', frame);

    assert.equal(received.length, 1);
    assert.deepStrictEqual(received[0].data, frame);
  });

  it('should pass through peer_discovered events', async () => {
    const mock = new MockTransport();
    const auth = new AuthenticatedTransport(mock);
    await auth.start();

    const discovered: TransportEvent[] = [];
    auth.on('peer_discovered', (e) => discovered.push(e));

    mock.injectPeerDiscovered('10.0.0.5:9090');
    assert.equal(discovered.length, 1);
  });
});

describe('AuthenticatedTransport — Two-way Communication', () => {
  it('should allow two AuthenticatedTransports to communicate', async () => {
    const mockA = new MockTransport();
    const mockB = new MockTransport();
    const authA = new AuthenticatedTransport(mockA);
    const authB = new AuthenticatedTransport(mockB);
    await authA.start();
    await authB.start();

    const receivedByB: TransportEvent[] = [];
    authB.on('message', (e) => receivedByB.push(e));

    // A sends to B
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ from: 'A' }));
    await authA.sendTo('10.0.0.2:8080', frame);

    // Simulate B receiving A's signed message
    mockB.injectMessage('10.0.0.1:8080', mockA.sentMessages[0].data);

    assert.equal(receivedByB.length, 1);
    assert.deepStrictEqual(receivedByB[0].data, frame);
    assert.equal(authB.getStats().messagesVerified, 1);
    assert.equal(authB.getStats().peersRegistered, 1);
  });

  it('should allow bidirectional auth communication', async () => {
    const mockA = new MockTransport();
    const mockB = new MockTransport();
    const authA = new AuthenticatedTransport(mockA);
    const authB = new AuthenticatedTransport(mockB);
    await authA.start();
    await authB.start();

    const receivedByA: TransportEvent[] = [];
    const receivedByB: TransportEvent[] = [];
    authA.on('message', (e) => receivedByA.push(e));
    authB.on('message', (e) => receivedByB.push(e));

    // A → B
    const frameAB = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ dir: 'A→B' }));
    await authA.sendTo('B', frameAB);
    mockB.injectMessage('A', mockA.sentMessages[0].data);

    // B → A
    const frameBA = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ dir: 'B→A' }));
    await authB.sendTo('A', frameBA);
    mockA.injectMessage('B', mockB.sentMessages[0].data);

    assert.equal(receivedByA.length, 1);
    assert.equal(receivedByB.length, 1);
    assert.deepStrictEqual(receivedByA[0].data, frameBA);
    assert.deepStrictEqual(receivedByB[0].data, frameAB);
  });
});

// ═══════════════════════════════════════
// Flow Control Tests
// ═══════════════════════════════════════

describe('Flow Control — Credit Management', () => {
  it('should grant initial credits to new peers', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 10, replenishAmount: 5, replenishThreshold: 5, maxQueuePerPeer: 100,
    });
    await fc.start();
    // Trigger peer state creation via sendTo
    await fc.sendTo('10.0.0.1:8080', new Uint8Array([1]));
    assert.equal(fc.getPeerCredits('10.0.0.1:8080'), 9); // 10 - 1
  });

  it('should deduct credits on send', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 5, replenishAmount: 3, replenishThreshold: 3, maxQueuePerPeer: 100,
    });
    await fc.start();

    await fc.sendTo('10.0.0.1:8080', new Uint8Array([1]));
    await fc.sendTo('10.0.0.1:8080', new Uint8Array([2]));
    assert.equal(fc.getPeerCredits('10.0.0.1:8080'), 3);
    assert.equal(mock.sentMessages.length, 2);
  });

  it('should queue messages when credits are exhausted', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 2, replenishAmount: 2, replenishThreshold: 2, maxQueuePerPeer: 100,
    });
    await fc.start();

    await fc.sendTo('10.0.0.1:8080', new Uint8Array([1]));
    await fc.sendTo('10.0.0.1:8080', new Uint8Array([2]));
    assert.equal(fc.getPeerCredits('10.0.0.1:8080'), 0);
    assert.equal(mock.sentMessages.length, 2);

    await fc.sendTo('10.0.0.1:8080', new Uint8Array([3]));
    assert.equal(mock.sentMessages.length, 2); // Not sent
    assert.equal(fc.getPeerQueueSize('10.0.0.1:8080'), 1);
  });

  it('should flush queue when credits are granted', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 1, replenishAmount: 2, replenishThreshold: 2, maxQueuePerPeer: 100,
    });
    await fc.start();

    await fc.sendTo('10.0.0.1:8080', new Uint8Array([1]));
    await fc.sendTo('10.0.0.1:8080', new Uint8Array([2])); // Queued
    await fc.sendTo('10.0.0.1:8080', new Uint8Array([3])); // Queued
    assert.equal(mock.sentMessages.length, 1);
    assert.equal(fc.getPeerQueueSize('10.0.0.1:8080'), 2);

    fc.grantCredits('10.0.0.1:8080', 5);
    await sleep(10);

    assert.equal(mock.sentMessages.length, 3);
    assert.equal(fc.getPeerQueueSize('10.0.0.1:8080'), 0);
  });

  it('should drop oldest when queue overflows', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 0, replenishAmount: 1, replenishThreshold: 1, maxQueuePerPeer: 2,
    });
    await fc.start();

    await fc.sendTo('10.0.0.1:8080', new Uint8Array([1]));
    await fc.sendTo('10.0.0.1:8080', new Uint8Array([2]));
    await fc.sendTo('10.0.0.1:8080', new Uint8Array([3])); // Drops [1]

    assert.equal(fc.getPeerQueueSize('10.0.0.1:8080'), 2);
    assert.equal(fc.getStats().totalDropped, 1);
  });
});

describe('Flow Control — Replenish Protocol', () => {
  it('should auto-send REPLENISH after receiving threshold messages', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 100, replenishAmount: 5, replenishThreshold: 3, maxQueuePerPeer: 100,
    });
    await fc.start();

    const received: TransportEvent[] = [];
    fc.on('message', (e) => received.push(e));

    mock.injectMessage('10.0.0.5:9090', new Uint8Array([10]));
    mock.injectMessage('10.0.0.5:9090', new Uint8Array([20]));
    mock.injectMessage('10.0.0.5:9090', new Uint8Array([30]));

    assert.equal(received.length, 3);
    assert.ok(mock.sentMessages.length >= 1, 'Should have sent REPLENISH');

    const replenish = mock.sentMessages[0];
    assert.equal(replenish.address, '10.0.0.5:9090');
    assert.equal(replenish.data[0], 0xFF);
    assert.equal(replenish.data.length, 5);
  });

  it('should handle incoming REPLENISH messages', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 1, replenishAmount: 10, replenishThreshold: 10, maxQueuePerPeer: 100,
    });
    await fc.start();

    await fc.sendTo('10.0.0.5:9090', new Uint8Array([1]));
    await fc.sendTo('10.0.0.5:9090', new Uint8Array([2])); // Queued
    assert.equal(mock.sentMessages.length, 1);

    // Inject REPLENISH
    const replenish = new Uint8Array(5);
    replenish[0] = 0xFF;
    new DataView(replenish.buffer).setUint32(1, 10, false);
    mock.injectMessage('10.0.0.5:9090', replenish);

    await sleep(10);
    assert.equal(mock.sentMessages.length, 2);
    assert.equal(fc.getPeerCredits('10.0.0.5:9090'), 9);
    assert.equal(fc.getStats().replenishReceived, 1);
  });

  it('should NOT forward REPLENISH as regular messages', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 100, replenishAmount: 5, replenishThreshold: 100, maxQueuePerPeer: 100,
    });
    await fc.start();

    const received: TransportEvent[] = [];
    fc.on('message', (e) => received.push(e));

    const replenish = new Uint8Array(5);
    replenish[0] = 0xFF;
    new DataView(replenish.buffer).setUint32(1, 5, false);
    mock.injectMessage('10.0.0.5:9090', replenish);

    assert.equal(received.length, 0);
  });
});

describe('Flow Control — Broadcast Bypass', () => {
  it('should send broadcasts without flow control', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 0, replenishAmount: 1, replenishThreshold: 1, maxQueuePerPeer: 100,
    });
    await fc.start();

    await fc.broadcast(new Uint8Array([1, 2, 3]));
    assert.equal(mock.broadcasts.length, 1);
  });
});

describe('Flow Control — Peer Cleanup', () => {
  it('should remove peer state on peer_lost', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 10, replenishAmount: 5, replenishThreshold: 5, maxQueuePerPeer: 100,
    });
    await fc.start();

    // Create peer state
    await fc.sendTo('10.0.0.1:8080', new Uint8Array([1]));
    assert.equal(fc.getStats().trackedPeers, 1);

    // Simulate peer lost
    const set = mock.handlers.get('peer_lost');
    if (set) for (const h of set) h({
      type: 'peer_lost', peerAddress: '10.0.0.1:8080', transport: 'mock', timestamp: Date.now(),
    });

    assert.equal(fc.getStats().trackedPeers, 0);
  });
});

// ═══════════════════════════════════════
// Combined: Auth + Flow Control
// ═══════════════════════════════════════

describe('Auth + Flow Control — Layered Stack', () => {
  it('should work with Auth wrapping FlowControl wrapping Mock', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 100, replenishAmount: 50, replenishThreshold: 50, maxQueuePerPeer: 1000,
    });
    const auth = new AuthenticatedTransport(fc);
    await auth.start();

    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ layered: true }));
    await auth.sendTo('10.0.0.1:8080', frame);

    assert.equal(mock.sentMessages.length, 1);
    const sent = mock.sentMessages[0].data;
    assert.equal(hasAuthTrailer(sent), true);

    const result = verifyFrame(sent);
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.frame, frame);
    assert.equal(fc.getPeerCredits('10.0.0.1:8080'), 99);
  });

  it('should flow-control authenticated messages', async () => {
    const mock = new MockTransport();
    const fc = new FlowControlledTransport(mock, {
      initialCredits: 2, replenishAmount: 2, replenishThreshold: 2, maxQueuePerPeer: 100,
    });
    const auth = new AuthenticatedTransport(fc);
    await auth.start();

    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({}));
    await auth.sendTo('peer', frame);
    await auth.sendTo('peer', frame);
    await auth.sendTo('peer', frame); // Should be queued in FC layer

    assert.equal(mock.sentMessages.length, 2);
    assert.equal(fc.getPeerQueueSize('peer'), 1);
    assert.equal(auth.getStats().messagesSigned, 3); // All 3 were signed
  });
});

// ═══════════════════════════════════════
// Summary
// ═══════════════════════════════════════

console.log('\n══════════════════════════════════════════════');
console.log(' CMP v1.5 Phase A — Auth & Flow Control Tests');
console.log('══════════════════════════════════════════════\n');
