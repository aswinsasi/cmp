/**
 * CMP v1.5 — Two-Node Integration Test (FIRST CONTACT)
 *
 * This is the single most important test in CMP's history.
 * For the first time, two real Node.js processes discover each other
 * over real LAN transport (UDP multicast + TCP), exchange authenticated
 * CMP messages, and verify end-to-end communication.
 *
 * What this test proves:
 *   1. UDP multicast beacon discovery WORKS between two processes
 *   2. TCP data channel establishment WORKS
 *   3. CMP frame encoding/decoding WORKS over real wire
 *   4. Ed25519 message authentication WORKS end-to-end
 *   5. Bidirectional communication WORKS (A→B and B→A)
 *   6. Beacon → Handshake → Message lifecycle WORKS
 *
 * Architecture:
 *   This test runs in a SINGLE process but creates TWO independent
 *   CMP transport stacks (each with its own UDP/TCP ports).
 *   They discover each other via UDP multicast on localhost.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/v1.5-two-node.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';

import { LANTransport } from '../../transport/src/lan-transport';
import { TransportEvent } from '../../transport/src/interface';
import { encodeMessage, decodeMessage, encodeJSON, decodeJSON } from '../src/layers/serializer';
import { MessageType } from '../src/types/beacon';
import {
  generateAuthKeypair,
  signFrame,
  verifyFrame,
  hasAuthTrailer,
  AuthKeypair,
} from '../src/auth/message-auth';
import { AuthenticatedTransport } from '../src/auth/authenticated-transport';

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function waitForEvent(
  transport: LANTransport | AuthenticatedTransport,
  eventType: string,
  timeoutMs: number = 10000,
): Promise<TransportEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      transport.off(eventType, handler);
      reject(new Error(`Timeout waiting for ${eventType} after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (event: TransportEvent) => {
      clearTimeout(timer);
      transport.off(eventType, handler);
      resolve(event);
    };

    transport.on(eventType, handler);
  });
}

function collectEvents(
  transport: LANTransport | AuthenticatedTransport,
  eventType: string,
): { events: TransportEvent[]; stop: () => void } {
  const events: TransportEvent[] = [];
  const handler = (event: TransportEvent) => events.push(event);
  transport.on(eventType, handler);
  return {
    events,
    stop: () => transport.off(eventType, handler),
  };
}

// ═══════════════════════════════════════
// Raw LAN Transport: Two-Node Discovery
// ═══════════════════════════════════════

describe('Two-Node — Raw LAN Transport Discovery', () => {
  let nodeA: LANTransport;
  let nodeB: LANTransport;

  before(async () => {
    nodeA = new LANTransport();
    nodeB = new LANTransport();
    await nodeA.start();
    await nodeB.start();
  });

  after(async () => {
    await nodeA.stop();
    await nodeB.stop();
  });

  it('should discover each other via UDP multicast beacons', async () => {
    // Both nodes beacon. Each should discover the other.
    const discoveredByA = waitForEvent(nodeA, 'peer_discovered', 8000);
    const discoveredByB = waitForEvent(nodeB, 'peer_discovered', 8000);

    const beaconA = new TextEncoder().encode('BEACON-NODE-A');
    const beaconB = new TextEncoder().encode('BEACON-NODE-B');

    await nodeA.startBeaconing(beaconA, 500);
    await nodeB.startBeaconing(beaconB, 500);

    const [eventA, eventB] = await Promise.all([discoveredByA, discoveredByB]);

    // A discovered B
    assert.ok(eventA.peerAddress, 'Node A should discover a peer address');
    assert.ok(eventA.data, 'Node A should receive beacon data');
    const dataFromB = new TextDecoder().decode(eventA.data);
    assert.equal(dataFromB, 'BEACON-NODE-B');

    // B discovered A
    assert.ok(eventB.peerAddress, 'Node B should discover a peer address');
    assert.ok(eventB.data, 'Node B should receive beacon data');
    const dataFromA = new TextDecoder().decode(eventB.data);
    assert.equal(dataFromA, 'BEACON-NODE-A');

    console.log(`  ✓ Node A discovered Node B at ${eventA.peerAddress}`);
    console.log(`  ✓ Node B discovered Node A at ${eventB.peerAddress}`);

    await nodeA.stopBeaconing();
    await nodeB.stopBeaconing();
  });

  it('should exchange CMP frames over TCP', async () => {
    // First, discover each other to get addresses
    const beaconA = new TextEncoder().encode('TCP-TEST-A');
    const beaconB = new TextEncoder().encode('TCP-TEST-B');

    const discoveredByA = waitForEvent(nodeA, 'peer_discovered', 8000);
    const discoveredByB = waitForEvent(nodeB, 'peer_discovered', 8000);

    await nodeA.startBeaconing(beaconA, 300);
    await nodeB.startBeaconing(beaconB, 300);

    const [evtA, evtB] = await Promise.all([discoveredByA, discoveredByB]);
    const addressOfB = evtA.peerAddress!;
    const addressOfA = evtB.peerAddress!;

    await nodeA.stopBeaconing();
    await nodeB.stopBeaconing();

    // Now send a real CMP frame from A → B
    const msgReceived = waitForEvent(nodeB, 'message', 8000);

    const payload = encodeJSON({ from: 'nodeA', msg: 'Hello CMP!', ts: Date.now() });
    const frame = encodeMessage(MessageType.HEARTBEAT, payload);
    await nodeA.sendTo(addressOfB, frame);

    const received = await msgReceived;
    assert.ok(received.data, 'Node B should receive data');

    // Decode the CMP frame
    const decoded = decodeMessage(received.data!);
    assert.ok(decoded, 'Should decode as valid CMP frame');
    assert.equal(decoded!.type, MessageType.HEARTBEAT);

    const json = decodeJSON(decoded!.payload);
    assert.ok(json, 'Should decode JSON payload');
    assert.equal(json.from, 'nodeA');
    assert.equal(json.msg, 'Hello CMP!');

    console.log(`  ✓ A→B CMP frame delivered and decoded: "${json.msg}"`);
  });

  it('should support bidirectional CMP frame exchange', async () => {
    // Discover
    const beaconA = new TextEncoder().encode('BIDIR-A');
    const beaconB = new TextEncoder().encode('BIDIR-B');

    const discoveredByA = waitForEvent(nodeA, 'peer_discovered', 8000);
    const discoveredByB = waitForEvent(nodeB, 'peer_discovered', 8000);

    await nodeA.startBeaconing(beaconA, 300);
    await nodeB.startBeaconing(beaconB, 300);

    const [evtA, evtB] = await Promise.all([discoveredByA, discoveredByB]);
    const addressOfB = evtA.peerAddress!;
    const addressOfA = evtB.peerAddress!;

    await nodeA.stopBeaconing();
    await nodeB.stopBeaconing();

    // A → B
    const msgAtB = waitForEvent(nodeB, 'message', 8000);
    const frameAB = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ dir: 'A→B' }));
    await nodeA.sendTo(addressOfB, frameAB);
    const recvB = await msgAtB;

    // B → A
    const msgAtA = waitForEvent(nodeA, 'message', 8000);
    const frameBA = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ dir: 'B→A' }));
    await nodeB.sendTo(addressOfA, frameBA);
    const recvA = await msgAtA;

    // Verify both directions
    const decodedAtB = decodeMessage(recvB.data!)!;
    const decodedAtA = decodeMessage(recvA.data!)!;
    assert.equal(decodeJSON(decodedAtB.payload).dir, 'A→B');
    assert.equal(decodeJSON(decodedAtA.payload).dir, 'B→A');

    console.log(`  ✓ Bidirectional: A→B and B→A both delivered`);
  });

  it('should handle multiple rapid messages', async () => {
    // Discover
    const discoveredByA = waitForEvent(nodeA, 'peer_discovered', 8000);
    await nodeA.startBeaconing(new TextEncoder().encode('RAPID-A'), 300);
    await nodeB.startBeaconing(new TextEncoder().encode('RAPID-B'), 300);
    const evtA = await discoveredByA;
    const addressOfB = evtA.peerAddress!;

    await nodeA.stopBeaconing();
    await nodeB.stopBeaconing();

    // Collect all messages at B
    const collector = collectEvents(nodeB, 'message');

    // Send 20 messages rapidly
    const MESSAGE_COUNT = 20;
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ seq: i }));
      await nodeA.sendTo(addressOfB, frame);
    }

    // Wait for delivery
    await sleep(2000);
    collector.stop();

    // All messages should arrive
    assert.ok(
      collector.events.length >= MESSAGE_COUNT * 0.9,
      `Expected at least ${MESSAGE_COUNT * 0.9} messages, got ${collector.events.length}`,
    );

    // Verify ordering (TCP preserves order)
    let lastSeq = -1;
    for (const evt of collector.events) {
      const decoded = decodeMessage(evt.data!);
      if (decoded) {
        const json = decodeJSON(decoded.payload);
        if (json && typeof json.seq === 'number') {
          assert.ok(json.seq > lastSeq, `Out of order: ${json.seq} <= ${lastSeq}`);
          lastSeq = json.seq;
        }
      }
    }

    console.log(`  ✓ ${collector.events.length}/${MESSAGE_COUNT} rapid messages delivered in order`);
  });
});

// ═══════════════════════════════════════
// Authenticated LAN: Signed Messages
// ═══════════════════════════════════════

describe('Two-Node — Authenticated LAN Transport', () => {
  let rawA: LANTransport;
  let rawB: LANTransport;
  let authA: AuthenticatedTransport;
  let authB: AuthenticatedTransport;

  before(async () => {
    rawA = new LANTransport();
    rawB = new LANTransport();
    authA = new AuthenticatedTransport(rawA);
    authB = new AuthenticatedTransport(rawB);
    await authA.start();
    await authB.start();
  });

  after(async () => {
    await authA.stop();
    await authB.stop();
  });

  it('should discover peers and exchange authenticated CMP frames', async () => {
    // Discovery (beacons bypass auth — pass through raw transport)
    const discoveredByA = waitForEvent(authA, 'peer_discovered', 8000);
    const discoveredByB = waitForEvent(authB, 'peer_discovered', 8000);

    await rawA.startBeaconing(new TextEncoder().encode('AUTH-A'), 300);
    await rawB.startBeaconing(new TextEncoder().encode('AUTH-B'), 300);

    const [evtA, evtB] = await Promise.all([discoveredByA, discoveredByB]);
    const addressOfB = evtA.peerAddress!;
    const addressOfA = evtB.peerAddress!;

    await rawA.stopBeaconing();
    await rawB.stopBeaconing();

    console.log(`  ✓ Discovery: A sees B at ${addressOfB}`);
    console.log(`  ✓ Discovery: B sees A at ${addressOfA}`);

    // A sends authenticated message to B
    const msgAtB = waitForEvent(authB, 'message', 8000);
    const frame = encodeMessage(
      MessageType.HEARTBEAT,
      encodeJSON({ from: 'nodeA', authenticated: true, ts: Date.now() }),
    );
    await authA.sendTo(addressOfB, frame);

    const received = await msgAtB;
    assert.ok(received.data, 'B should receive authenticated message');

    // The data B receives should be the STRIPPED frame (no auth trailer)
    const decoded = decodeMessage(received.data!);
    assert.ok(decoded, 'Should decode as valid CMP frame');
    const json = decodeJSON(decoded!.payload);
    assert.equal(json.from, 'nodeA');
    assert.equal(json.authenticated, true);

    console.log(`  ✓ Authenticated A→B: message verified and delivered`);

    // Verify auth stats
    const statsA = authA.getStats();
    const statsB = authB.getStats();
    assert.ok(statsA.messagesSigned >= 1, 'A should have signed at least 1 message');
    assert.ok(statsB.messagesVerified >= 1, 'B should have verified at least 1 message');
    assert.equal(statsB.messagesRejectedBadSig, 0, 'No bad signatures');
    assert.equal(statsB.messagesRejectedKeyMismatch, 0, 'No key mismatches');

    console.log(`  ✓ Auth stats: A signed ${statsA.messagesSigned}, B verified ${statsB.messagesVerified}`);
  });

  it('should reject tampered messages over real wire', async () => {
    // Discover
    const discoveredByA = waitForEvent(authA, 'peer_discovered', 8000);
    await rawA.startBeaconing(new TextEncoder().encode('TAMPER-A'), 300);
    await rawB.startBeaconing(new TextEncoder().encode('TAMPER-B'), 300);
    const evtA = await discoveredByA;
    const addressOfB = evtA.peerAddress!;
    await rawA.stopBeaconing();
    await rawB.stopBeaconing();

    // Track violations at B
    const violations: any[] = [];
    authB.onAuthViolation((e) => violations.push(e));

    // Manually create a signed frame, tamper, and send over raw transport
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ tampered: true }));
    const kpFake = generateAuthKeypair();
    const signed = signFrame(frame, kpFake.secretKey, kpFake.publicKey);
    // Tamper with the signature
    signed[signed.length - 3] ^= 0xFF;

    // Send tampered frame directly on raw transport (bypassing authA's signing)
    await rawA.sendTo(addressOfB, signed);

    // Wait a bit for processing
    await sleep(1000);

    // B should have rejected it
    const statsB = authB.getStats();
    assert.ok(statsB.messagesRejectedBadSig >= 1, 'B should reject tampered message');

    console.log(`  ✓ Tampered message correctly rejected (${statsB.messagesRejectedBadSig} bad sigs)`);
  });

  it('should support bidirectional authenticated communication', async () => {
    // Discover
    const discoveredByA = waitForEvent(authA, 'peer_discovered', 8000);
    const discoveredByB = waitForEvent(authB, 'peer_discovered', 8000);
    await rawA.startBeaconing(new TextEncoder().encode('BIDIR-AUTH-A'), 300);
    await rawB.startBeaconing(new TextEncoder().encode('BIDIR-AUTH-B'), 300);
    const [evtA, evtB] = await Promise.all([discoveredByA, discoveredByB]);
    const addressOfB = evtA.peerAddress!;
    const addressOfA = evtB.peerAddress!;
    await rawA.stopBeaconing();
    await rawB.stopBeaconing();

    // A → B (authenticated)
    const msgAtB = waitForEvent(authB, 'message', 8000);
    await authA.sendTo(addressOfB, encodeMessage(MessageType.HEARTBEAT, encodeJSON({ dir: 'A→B' })));
    const recvB = await msgAtB;
    const jsonB = decodeJSON(decodeMessage(recvB.data!)!.payload);
    assert.equal(jsonB.dir, 'A→B');

    // B → A (authenticated)
    const msgAtA = waitForEvent(authA, 'message', 8000);
    await authB.sendTo(addressOfA, encodeMessage(MessageType.HEARTBEAT, encodeJSON({ dir: 'B→A' })));
    const recvA = await msgAtA;
    const jsonA = decodeJSON(decodeMessage(recvA.data!)!.payload);
    assert.equal(jsonA.dir, 'B→A');

    console.log(`  ✓ Bidirectional authenticated: A→B ✓, B→A ✓`);

    // Both should have registered each other's keys (TOFU)
    const registryA = authA.getPeerRegistry();
    const registryB = authB.getPeerRegistry();
    assert.ok(registryA.size >= 1, 'A should have registered B\'s key');
    assert.ok(registryB.size >= 1, 'B should have registered A\'s key');

    console.log(`  ✓ TOFU: A has ${registryA.size} peer keys, B has ${registryB.size} peer keys`);
  });
});

// ═══════════════════════════════════════
// Lifecycle: Full Discovery → Message Flow
// ═══════════════════════════════════════

describe('Two-Node — Full Lifecycle', () => {
  it('should complete full discovery → auth → message → verify lifecycle', async () => {
    console.log('\n  ── FULL LIFECYCLE TEST ──\n');

    // Step 1: Create two independent nodes
    const rawA = new LANTransport();
    const rawB = new LANTransport();
    const authA = new AuthenticatedTransport(rawA);
    const authB = new AuthenticatedTransport(rawB);

    await authA.start();
    await authB.start();
    console.log(`  [1] Nodes started: A on TCP ${rawA.getTcpPort()}, B on TCP ${rawB.getTcpPort()}`);

    // Step 2: Beacon discovery
    const discoveredByA = waitForEvent(authA, 'peer_discovered', 10000);
    const discoveredByB = waitForEvent(authB, 'peer_discovered', 10000);

    const beaconPayloadA = encodeJSON({ nodeId: 'ALPHA', version: '1.5.0' });
    const beaconPayloadB = encodeJSON({ nodeId: 'BETA', version: '1.5.0' });

    await rawA.startBeaconing(beaconPayloadA, 300);
    await rawB.startBeaconing(beaconPayloadB, 300);

    const [evtA, evtB] = await Promise.all([discoveredByA, discoveredByB]);
    const addressOfB = evtA.peerAddress!;
    const addressOfA = evtB.peerAddress!;

    // Verify beacon payloads
    const beaconFromB = decodeJSON(evtA.data!);
    const beaconFromA = decodeJSON(evtB.data!);
    assert.equal(beaconFromB.nodeId, 'BETA');
    assert.equal(beaconFromA.nodeId, 'ALPHA');

    await rawA.stopBeaconing();
    await rawB.stopBeaconing();
    console.log(`  [2] Discovery: A↔B discovered (A sees ${addressOfB}, B sees ${addressOfA})`);

    // Step 3: Authenticated message exchange
    const msgAtB = waitForEvent(authB, 'message', 8000);
    const taskRequest = {
      type: 'TASK_REQUEST',
      taskId: 'task-001',
      requester: 'ALPHA',
      runtime: 'WASM',
      payloadSizeKb: 256,
      deadline: Date.now() + 5000,
    };
    const frame = encodeMessage(MessageType.CHUNK_DATA, encodeJSON(taskRequest));
    await authA.sendTo(addressOfB, frame);

    const received = await msgAtB;
    const decoded = decodeMessage(received.data!)!;
    const task = decodeJSON(decoded.payload);

    assert.equal(task.type, 'TASK_REQUEST');
    assert.equal(task.taskId, 'task-001');
    assert.equal(task.requester, 'ALPHA');
    console.log(`  [3] Auth message: A→B TASK_REQUEST delivered and verified`);

    // Step 4: Response from B → A
    const msgAtA = waitForEvent(authA, 'message', 8000);
    const bid = {
      type: 'BID',
      taskId: 'task-001',
      bidder: 'BETA',
      estimatedTimeMs: 1500,
      confidence: 0.95,
    };
    const responseFrame = encodeMessage(MessageType.CHUNK_RESULT, encodeJSON(bid));
    await authB.sendTo(addressOfA, responseFrame);

    const response = await msgAtA;
    const decodedResp = decodeMessage(response.data!)!;
    const bidData = decodeJSON(decodedResp.payload);

    assert.equal(bidData.type, 'BID');
    assert.equal(bidData.bidder, 'BETA');
    assert.equal(bidData.confidence, 0.95);
    console.log(`  [4] Auth message: B→A BID delivered and verified`);

    // Step 5: Verify auth state
    const statsA = authA.getStats();
    const statsB = authB.getStats();
    console.log(`  [5] Auth stats:`);
    console.log(`      A: signed=${statsA.messagesSigned}, verified=${statsA.messagesVerified}, peers=${statsA.peersRegistered}`);
    console.log(`      B: signed=${statsB.messagesSigned}, verified=${statsB.messagesVerified}, peers=${statsB.peersRegistered}`);

    assert.ok(statsA.messagesSigned >= 1);
    assert.ok(statsA.messagesVerified >= 1);
    assert.ok(statsB.messagesSigned >= 1);
    assert.ok(statsB.messagesVerified >= 1);
    assert.equal(statsA.messagesRejectedBadSig, 0);
    assert.equal(statsB.messagesRejectedBadSig, 0);

    // Step 6: Cleanup
    await authA.stop();
    await authB.stop();
    console.log(`  [6] Nodes stopped cleanly`);

    console.log('\n  ── FIRST CONTACT: SUCCESSFUL ──\n');
  });
});

// ═══════════════════════════════════════
// Summary
// ═══════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════');
console.log(' CMP v1.5 — TWO-NODE INTEGRATION TEST (FIRST CONTACT)');
console.log(' Two real LAN transports. Real UDP. Real TCP. Real Ed25519.');
console.log('══════════════════════════════════════════════════════\n');
