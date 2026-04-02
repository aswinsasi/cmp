/**
 * CMP v1.5 — Phase B Test Suite: Immune Bridge & Secure Node Factory
 *
 * Tests:
 *   1. AuthImmuneBridge — violation routing, quarantine escalation
 *   2. Secure Node Factory — creates wired CMPNode with auth stack
 *
 * Run: npx ts-node --transpile-only packages/core/tests/v1.5-phase-b.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// Force exit after all tests — CMPNode creates timers (peer table cleanup,
// beacon intervals) that keep the process alive even after stop().
after(() => setTimeout(() => process.exit(0), 200));

import { AuthImmuneBridge } from '../src/auth/auth-immune-bridge';
import { AuthenticatedTransport, AuthViolationEvent } from '../src/auth/authenticated-transport';
import { generateAuthKeypair, signFrame } from '../src/auth/message-auth';
import { ThreatDetector } from '../src/immune/threat-detector';
import { QuarantineManager } from '../src/immune/quarantine-manager';
import { AntibodyGenerator } from '../src/immune/antibody-generator';
import { ThreatType, ThreatSeverity, QuarantineLevel, ThreatEvent } from '../src/types/immune';
import { createSecureNode, stopSecureNode, SecureNodeResult } from '../src/auth/secure-node-factory';
import { ITransport, TransportEvent, TransportEventHandler } from '../../transport/src/interface';
import { encodeMessage, encodeJSON } from '../src/layers/serializer';
import { MessageType } from '../src/types/beacon';

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

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
  async sendTo(addr: string, data: Uint8Array) { this.sentMessages.push({ address: addr, data }); }
  async broadcast(data: Uint8Array) { this.broadcasts.push(data); }

  on(event: string, handler: TransportEventHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: TransportEventHandler) {
    const set = this.handlers.get(event);
    if (set) set.delete(handler);
  }

  injectMessage(addr: string, data: Uint8Array) {
    const evt: TransportEvent = { type: 'message', peerAddress: addr, data, transport: 'mock', timestamp: Date.now() };
    const set = this.handlers.get('message');
    if (set) for (const h of set) h(evt);
  }
}

// ═══════════════════════════════════════
// Auth-Immune Bridge Tests
// ═══════════════════════════════════════

describe('AuthImmuneBridge — Bad Signature Handling', () => {
  let detector: ThreatDetector;
  let quarantine: QuarantineManager;
  let generator: AntibodyGenerator;
  let bridge: AuthImmuneBridge;
  let mock: MockTransport;
  let auth: AuthenticatedTransport;

  beforeEach(() => {
    detector = new ThreatDetector();
    quarantine = new QuarantineManager();
    generator = new AntibodyGenerator('test-node');
    bridge = new AuthImmuneBridge(detector, quarantine, generator, {
      badSigWatchThreshold: 2,
      badSigRestrictThreshold: 4,
      keyMismatchRestrictThreshold: 1,
      keyMismatchExpelThreshold: 2,
    });

    mock = new MockTransport();
    auth = new AuthenticatedTransport(mock);
    bridge.connect(auth);
  });

  it('should create threat events from bad signatures', async () => {
    await auth.start();

    const threats: ThreatEvent[] = [];
    bridge.onThreat((e) => threats.push(e));

    // Inject tampered signed message
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({}));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);
    signed[signed.length - 5] ^= 0xFF; // Tamper with signature

    mock.injectMessage('10.0.0.99:8080', signed);

    assert.equal(threats.length, 1);
    assert.equal(threats[0].type, ThreatType.PROTOCOL_ABUSE);
    assert.equal(threats[0].severity, ThreatSeverity.MEDIUM);

    const stats = bridge.getStats();
    assert.equal(stats.totalViolations, 1);
  });

  it('should escalate to WATCH quarantine after threshold', async () => {
    await auth.start();

    const kp = generateAuthKeypair();

    // Send multiple bad sigs
    for (let i = 0; i < 2; i++) {
      const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ i }));
      const signed = signFrame(frame, kp.secretKey, kp.publicKey);
      signed[signed.length - 5] ^= 0xFF;
      mock.injectMessage('10.0.0.99:8080', signed);
    }

    const stats = bridge.getStats();
    assert.equal(stats.totalViolations, 2);
    assert.ok(stats.quarantineActions >= 1, 'Should quarantine after threshold');
  });

  it('should escalate to RESTRICTED after higher threshold', async () => {
    await auth.start();

    const threats: ThreatEvent[] = [];
    bridge.onThreat((e) => threats.push(e));

    // Send 4 bad sigs
    for (let i = 0; i < 4; i++) {
      const kp = generateAuthKeypair();
      const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ i }));
      const signed = signFrame(frame, kp.secretKey, kp.publicKey);
      signed[signed.length - 5] ^= 0xFF;
      mock.injectMessage('10.0.0.99:8080', signed);
    }

    assert.equal(threats.length, 4);
    // Last threat should be HIGH severity
    assert.equal(threats[3].severity, ThreatSeverity.HIGH);

    const stats = bridge.getStats();
    assert.ok(stats.quarantineActions >= 2, 'Should have multiple quarantine actions');
  });
});

describe('AuthImmuneBridge — Key Mismatch (MITM)', () => {
  let bridge: AuthImmuneBridge;
  let quarantine: QuarantineManager;
  let mock: MockTransport;
  let auth: AuthenticatedTransport;

  beforeEach(() => {
    const detector = new ThreatDetector();
    quarantine = new QuarantineManager();
    const generator = new AntibodyGenerator('test-node');
    bridge = new AuthImmuneBridge(detector, quarantine, generator, {
      badSigWatchThreshold: 3,
      badSigRestrictThreshold: 5,
      keyMismatchRestrictThreshold: 1,
      keyMismatchExpelThreshold: 2,
    });

    mock = new MockTransport();
    auth = new AuthenticatedTransport(mock);
    bridge.connect(auth);
  });

  it('should create CRITICAL threat on key mismatch', async () => {
    await auth.start();

    const threats: ThreatEvent[] = [];
    bridge.onThreat((e) => threats.push(e));

    // First message establishes TOFU key
    const kp1 = generateAuthKeypair();
    const frame1 = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ msg: 1 }));
    mock.injectMessage('10.0.0.50:8080', signFrame(frame1, kp1.secretKey, kp1.publicKey));

    // Second message with DIFFERENT key — MITM!
    const kp2 = generateAuthKeypair();
    const frame2 = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ msg: 2 }));
    mock.injectMessage('10.0.0.50:8080', signFrame(frame2, kp2.secretKey, kp2.publicKey));

    assert.equal(threats.length, 1);
    assert.equal(threats[0].type, ThreatType.SYBIL_ATTACK);
    assert.equal(threats[0].severity, ThreatSeverity.CRITICAL);

    const stats = bridge.getStats();
    assert.equal(stats.quarantineActions, 1);
  });

  it('should immediately quarantine on first key mismatch', async () => {
    await auth.start();

    // Establish key
    const kp1 = generateAuthKeypair();
    mock.injectMessage('10.0.0.50:8080', signFrame(
      encodeMessage(MessageType.HEARTBEAT, encodeJSON({})),
      kp1.secretKey, kp1.publicKey,
    ));

    // Mismatch
    const kp2 = generateAuthKeypair();
    mock.injectMessage('10.0.0.50:8080', signFrame(
      encodeMessage(MessageType.HEARTBEAT, encodeJSON({})),
      kp2.secretKey, kp2.publicKey,
    ));

    const stats = bridge.getStats();
    assert.equal(stats.quarantineActions, 1);
    assert.equal(stats.totalViolations, 1);
  });
});

describe('AuthImmuneBridge — Stats', () => {
  it('should track per-address violations', async () => {
    const detector = new ThreatDetector();
    const quarantine = new QuarantineManager();
    const bridge = new AuthImmuneBridge(detector, quarantine);

    const mock = new MockTransport();
    const auth = new AuthenticatedTransport(mock);
    bridge.connect(auth);
    await auth.start();

    const kp = generateAuthKeypair();

    // Bad sig from address A
    const frame1 = encodeMessage(MessageType.HEARTBEAT, encodeJSON({}));
    const signed1 = signFrame(frame1, kp.secretKey, kp.publicKey);
    signed1[signed1.length - 5] ^= 0xFF;
    mock.injectMessage('10.0.0.1:8080', signed1);

    // Bad sig from address B
    const frame2 = encodeMessage(MessageType.HEARTBEAT, encodeJSON({}));
    const signed2 = signFrame(frame2, kp.secretKey, kp.publicKey);
    signed2[signed2.length - 5] ^= 0xFF;
    mock.injectMessage('10.0.0.2:8080', signed2);

    const stats = bridge.getStats();
    assert.equal(stats.totalViolations, 2);
    assert.equal(stats.violationsPerAddress.size, 2);
    assert.equal(stats.violationsPerAddress.get('10.0.0.1:8080')?.badSig, 1);
    assert.equal(stats.violationsPerAddress.get('10.0.0.2:8080')?.badSig, 1);
  });
});

// ═══════════════════════════════════════
// Secure Node Factory Tests
// ═══════════════════════════════════════

describe('Secure Node Factory — Creation', () => {
  it('should create a CMPNode with auth stack using mock transport', () => {
    const mock = new MockTransport();
    const result = createSecureNode({
      _rawTransport: mock,
      transports: [],
    });

    assert.ok(result.node, 'Should create CMPNode');
    assert.ok(result.auth, 'Should create AuthenticatedTransport');
    assert.ok(result.flowControl, 'Should create FlowControlledTransport');
    assert.ok(result.bridge, 'Should create AuthImmuneBridge');
    assert.ok(result.immune.threatDetector, 'Should create ThreatDetector');
    assert.ok(result.immune.quarantineManager, 'Should create QuarantineManager');
    assert.ok(result.authKeypair, 'Should have auth keypair');
    assert.equal(result.authKeypair.publicKey.length, 32);

    // Cleanup
    result.immune.quarantineManager.stop();
  });

  it('should create node without auth when disabled', () => {
    const mock = new MockTransport();
    const result = createSecureNode({
      _rawTransport: mock,
      transports: [],
      disableAuth: true,
    });

    assert.ok(result.node);
    assert.equal(result.auth, null);
    assert.ok(result.flowControl); // FC still enabled
    result.immune.quarantineManager.stop();
  });

  it('should create node without flow control when disabled', () => {
    const mock = new MockTransport();
    const result = createSecureNode({
      _rawTransport: mock,
      transports: [],
      disableFlowControl: true,
    });

    assert.ok(result.node);
    assert.ok(result.auth); // Auth still enabled
    assert.equal(result.flowControl, null);
    result.immune.quarantineManager.stop();
  });

  it('should accept custom auth keypair', () => {
    const kp = generateAuthKeypair();
    const mock = new MockTransport();
    const result = createSecureNode({
      _rawTransport: mock,
      transports: [],
      authKeypair: kp,
    });

    assert.deepStrictEqual(result.authKeypair.publicKey, kp.publicKey);
    result.immune.quarantineManager.stop();
  });

  it('should wire auth violations to immune bridge', async () => {
    const mock = new MockTransport();
    const result = createSecureNode({
      _rawTransport: mock,
      transports: [],
    });

    await result.node.start();

    const threats: ThreatEvent[] = [];
    result.bridge.onThreat((e) => threats.push(e));

    // Inject a tampered message
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({}));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);
    signed[signed.length - 5] ^= 0xFF;

    mock.injectMessage('10.0.0.99:8080', signed);

    assert.equal(threats.length, 1, 'Bridge should receive threat from auth violation');
    assert.equal(threats[0].type, ThreatType.PROTOCOL_ABUSE);

    await stopSecureNode(result);
  });
});

describe('Secure Node Factory — Start/Stop', () => {
  it('should start and stop cleanly with mock transport', async () => {
    const mock = new MockTransport();
    const result = createSecureNode({
      _rawTransport: mock,
      transports: [],
    });

    await result.node.start();
    assert.equal(result.node.isRunning(), true);

    const status = result.node.getStatus();
    assert.ok(status.meshId);
    assert.equal(status.running, true);

    await stopSecureNode(result);
    assert.equal(result.node.isRunning(), false);
  });

  it('should create node with LAN transport when no raw transport given', async () => {
    const result = createSecureNode({
      transports: ['lan'],
    });

    assert.ok(result.node);
    assert.ok(result.rawLanTransport, 'Should expose raw LAN transport');
    assert.ok(result.auth);
    assert.ok(result.flowControl);
    result.immune.quarantineManager.stop();
    // Stop the LAN transport to release TCP/UDP sockets so process can exit
    if (result.rawLanTransport) await result.rawLanTransport.stop();
  });
});

// ═══════════════════════════════════════
// Summary
// ═══════════════════════════════════════

console.log('\n══════════════════════════════════════════════');
console.log(' CMP v1.5 Phase B — Immune Bridge & Factory');
console.log('══════════════════════════════════════════════\n');
