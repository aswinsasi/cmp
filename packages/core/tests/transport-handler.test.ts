/**
 * CMP v1.4 — Gap 1 Test Suite: Multi-Device Transport
 * Tests LifeformTransportHandler with mock transport.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/transport-handler.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { LifeformTransportHandler, PeerResolver, FrameTransport } from '../src/lifeform/transport-handler';
import { LifeformManager } from '../src/lifeform/manager';
import {
  encodeLifeformMessage,
  decodeLifeformMessage,
} from '../src/lifeform/wire-protocol';
import { LifeformMessageType, LifeformConfig } from '../src/types/lifeform';
import { Cause, CauseType } from '../src/types/causal';
import { generateId } from '../src/lifeform/crypto';

// ── Helpers ──

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeConfig(name: string, ccu: number = 100): LifeformConfig {
  return {
    name,
    wasmModule: new Uint8Array([0, 0x61, 0x73, 0x6d]),
    initialState: { status: 'active' },
    initialCcu: ccu,
    minReplicas: 1, maxReplicas: 3, autoMigrate: true,
    mutationLibraryHash: null, maxCausesPerSecond: 100, maxStateSizeBytes: 1024 * 1024,
  };
}

function makeCause(): Cause {
  return {
    id: generateId(),
    type: CauseType.MESSAGE,
    chainId: generateId(),
    chainDepth: 0, maxChainDepth: 64, deadlineMs: 0,
    sourceId: generateId(), sourceType: 'device',
    targetId: generateId(),
    payload: new TextEncoder().encode('hello-remote'),
    ccuAttached: 0, expectsResponse: false,
    correlationId: null, emittedAt: Date.now(),
  };
}

// ── Mock Transport Infrastructure ──

/**
 * Simulates two devices connected via in-memory transport.
 * Messages sent by device A arrive at device B and vice versa.
 */
class MockNetwork {
  private handlers = new Map<string, LifeformTransportHandler>();
  /** All frames sent: { from, to, type, payload } */
  public sent: Array<{ from: string; to: string; type: number; payload: Uint8Array }> = [];

  createPeerResolver(deviceId: string, otherDeviceId: string): PeerResolver {
    return {
      getAddressForMeshId: (meshId: string) => {
        // Address is just the meshId in our mock
        if (meshId === otherDeviceId) return `addr:${otherDeviceId}`;
        return null;
      },
      getActivePeerIds: () => [otherDeviceId],
      getLocalMeshId: () => deviceId,
    };
  }

  createFrameTransport(deviceId: string): FrameTransport {
    return {
      sendTo: async (peerAddress: string, data: Uint8Array) => {
        // Extract target device ID from address
        const targetId = peerAddress.replace('addr:', '');
        // Decode the frame to get type
        // CMP Frame: magic(3) + version(1) + type(1) + flags(1) + seq(2) + len(4) + crc(4) + payload
        const type = data[4]; // Message type at offset 4
        const payload = data.slice(16); // Payload after 16-byte header

        this.sent.push({ from: deviceId, to: targetId, type, payload });

        // Deliver to target handler
        const targetHandler = this.handlers.get(targetId);
        if (targetHandler) {
          await targetHandler.handleIncoming(type, payload, `addr:${deviceId}`);
        }
      },
      encodeFrame: (type: number, payload: Uint8Array) => {
        // Simplified CMP Frame: 16-byte header + payload
        const frame = new Uint8Array(16 + payload.length);
        frame[0] = 0x43; // C
        frame[1] = 0x4D; // M
        frame[2] = 0x50; // P
        frame[3] = 0x01; // Version
        frame[4] = type; // Message type
        frame.set(payload, 16);
        return frame;
      },
    };
  }

  registerHandler(deviceId: string, handler: LifeformTransportHandler): void {
    this.handlers.set(deviceId, handler);
  }
}

// ═══════════════════════════════════════
// Transport Handler Unit Tests
// ═══════════════════════════════════════

describe('LifeformTransportHandler', () => {
  let network: MockNetwork;
  let mgrA: LifeformManager;
  let mgrB: LifeformManager;
  let handlerA: LifeformTransportHandler;
  let handlerB: LifeformTransportHandler;

  beforeEach(() => {
    network = new MockNetwork();

    // Device A
    mgrA = new LifeformManager({ deviceId: 'device-a', maxHostedLifeforms: 10 });
    mgrA.start();
    handlerA = new LifeformTransportHandler(
      network.createPeerResolver('device-a', 'device-b'),
      network.createFrameTransport('device-a'),
    );
    handlerA.setManager(mgrA);
    network.registerHandler('device-a', handlerA);

    // Device B
    mgrB = new LifeformManager({ deviceId: 'device-b', maxHostedLifeforms: 10 });
    mgrB.start();
    handlerB = new LifeformTransportHandler(
      network.createPeerResolver('device-b', 'device-a'),
      network.createFrameTransport('device-b'),
    );
    handlerB.setManager(mgrB);
    network.registerHandler('device-b', handlerB);

    // Wire managers to use transport for remote delivery
    mgrA.onSendCause(async (targetHost, cause) => {
      await handlerA.sendCause(targetHost, cause);
    });
    mgrB.onSendCause(async (targetHost, cause) => {
      await handlerB.sendCause(targetHost, cause);
    });
  });

  afterEach(() => {
    mgrA.stop();
    mgrB.stop();
  });

  it('should send a cause from device A to device B via transport', async () => {
    // Spawn Lifeform on device B
    const hosted = mgrB.spawn(makeConfig('remote-sensor'))!;
    let causeReceived = false;
    mgrB.setHandler('remote-sensor', async (cause) => {
      causeReceived = true;
      return { stateMutations: 0, outgoingCauses: [] };
    });

    // Send cause from device A's handler to B
    const cause = makeCause();
    const sent = await handlerA.sendCause('device-b', cause);

    assert.equal(sent, true);
    assert.equal(network.sent.length, 1);
    assert.equal(network.sent[0].from, 'device-a');
    assert.equal(network.sent[0].to, 'device-b');
    assert.equal(network.sent[0].type, LifeformMessageType.LIFEFORM_CAUSE);
  });

  it('should fail sending to unknown host', async () => {
    const cause = makeCause();
    const sent = await handlerA.sendCause('device-unknown', cause);
    assert.equal(sent, false);
  });

  it('should broadcast DNS update to all peers', async () => {
    const sent = await handlerA.broadcastDnsUpdate('sensor-1', 'lf-abc', 'device-a', null, 1);
    assert.equal(sent, 1); // One peer (device-b)
    assert.equal(network.sent.length, 1);
    assert.equal(network.sent[0].type, LifeformMessageType.LIFEFORM_DNS_UPDATE);

    // B should have the DNS record now
    const host = mgrB.getDNS().resolveHost('sensor-1');
    assert.equal(host, 'device-a');
  });

  it('should sync DNS with redirect for fusion', async () => {
    // Register all names on B's DNS (as if B discovered them)
    mgrB.getDNS().register('comp-a', 'lf-a', 'device-a');
    mgrB.getDNS().register('comp-b', 'lf-b', 'device-a');
    mgrB.getDNS().register('composite', 'lf-composite', 'device-a');

    // Broadcast fusion redirect: comp-a now points to composite
    await handlerA.broadcastDnsUpdate('comp-a', 'lf-a', 'device-a', 'composite', 2);

    // Resolving comp-a should follow redirect to composite
    const result = mgrB.getDNS().resolve('comp-a');
    assert.ok(result.record);
    assert.equal(result.record.name, 'composite');
    assert.equal(result.redirectCount, 1);
  });

  it('should send state delta to replica host', async () => {
    const delta = {
      changedKeys: ['temp', 'humidity'],
      changes: { temp: { type: 'lww_register', value: 25 }, humidity: { type: 'lww_register', value: 60 } },
      extractedAt: Date.now(),
      sequence: 5,
    };

    const sent = await handlerA.sendStateDelta('device-b', 'lf-123', delta);
    assert.equal(sent, true);
    assert.equal(network.sent.length, 1);
    assert.equal(network.sent[0].type, LifeformMessageType.LIFEFORM_STATE_DELTA);
  });

  it('should send and receive heartbeat', async () => {
    // Setup replication: B is a secondary for lf-123
    mgrA.getReplication().initializeReplica('lf-123', 'device-a');
    mgrA.getReplication().addReplica('lf-123', 'device-b');

    // Also setup on B side so it can process the heartbeat
    mgrB.getReplication().initializeReplica('lf-123', 'device-a');
    mgrB.getReplication().addReplica('lf-123', 'device-b');

    await handlerA.sendHeartbeat('lf-123', 95.5, 42);

    assert.equal(network.sent.length, 1);
    assert.equal(network.sent[0].type, LifeformMessageType.LIFEFORM_HEARTBEAT);
  });

  it('should handle DNS query and response', async () => {
    // Register a name on device A
    mgrA.getDNS().register('my-sensor', 'lf-xyz', 'device-a');

    // Device B sends DNS query to A
    const payload = encodeLifeformMessage(LifeformMessageType.LIFEFORM_DNS_QUERY, {
      pattern: 'my-sensor',
      queryId: 'q-123',
      requesterId: 'device-b',
    });

    await handlerA.handleIncoming(
      LifeformMessageType.LIFEFORM_DNS_QUERY,
      payload,
      'addr:device-b',
    );

    // A should have sent a DNS response back to B
    const response = network.sent.find(s => s.type === LifeformMessageType.LIFEFORM_DNS_RESPONSE);
    assert.ok(response, 'Should have sent DNS response');
  });

  it('should track transport stats', async () => {
    await handlerA.sendCause('device-b', makeCause());
    await handlerA.broadcastDnsUpdate('test', 'lf', 'device-a', null, 1);

    const stats = handlerA.getStats();
    assert.equal(stats.messagesSent, 2);
    assert.ok(stats.causesDelivered >= 1);
  });

  it('should handle HOST_CHANGE and update DNS', async () => {
    // Register name on B
    mgrB.getDNS().register('migrated-lf', 'lf-m', 'device-a');

    // Simulate HOST_CHANGE message arriving at B
    const payload = encodeLifeformMessage(LifeformMessageType.LIFEFORM_HOST_CHANGE, {
      lifeformName: 'migrated-lf',
      oldHostId: 'device-a',
      newHostId: 'device-b',
    });

    await handlerB.handleIncoming(
      LifeformMessageType.LIFEFORM_HOST_CHANGE,
      payload,
      'addr:device-a',
    );

    assert.equal(mgrB.getDNS().resolveHost('migrated-lf'), 'device-b');
  });
});

// ═══════════════════════════════════════
// Two-Node Integration
// ═══════════════════════════════════════

describe('Multi-Device Integration', () => {
  it('should spawn on A, deliver cause from B, verify state on A', async () => {
    const network = new MockNetwork();

    const mgrA = new LifeformManager({ deviceId: 'node-1', maxHostedLifeforms: 10 });
    mgrA.start();
    const handlerA = new LifeformTransportHandler(
      network.createPeerResolver('node-1', 'node-2'),
      network.createFrameTransport('node-1'),
    );
    handlerA.setManager(mgrA);
    network.registerHandler('node-1', handlerA);

    const mgrB = new LifeformManager({ deviceId: 'node-2', maxHostedLifeforms: 10 });
    mgrB.start();
    const handlerB = new LifeformTransportHandler(
      network.createPeerResolver('node-2', 'node-1'),
      network.createFrameTransport('node-2'),
    );
    handlerB.setManager(mgrB);
    network.registerHandler('node-2', handlerB);

    // 1. Spawn Lifeform on node-1
    const hosted = mgrA.spawn(makeConfig('echo-remote', 100))!;
    assert.ok(hosted);

    let receivedPayload = '';
    mgrA.setHandler('echo-remote', async (cause) => {
      receivedPayload = new TextDecoder().decode(cause.payload);
      hosted.state.set('last_msg', receivedPayload);
      return { stateMutations: 1, outgoingCauses: [] };
    });

    // 2. Broadcast DNS so node-2 knows where echo-remote lives
    await handlerA.broadcastDnsUpdate('echo-remote', toHex(hosted.lifecycle.id), 'node-1', null, 1);

    // 3. Send cause from node-2's handler to node-1
    const cause = makeCause();
    cause.payload = new TextEncoder().encode('from-node-2');
    await handlerB.sendCause('node-1', cause);

    // 4. Verify the cause was received and processed
    assert.equal(receivedPayload, 'from-node-2');
    assert.equal(hosted.state.get('last_msg'), 'from-node-2');
    assert.equal(hosted.lifecycle.causesProcessed, 1);

    mgrA.stop();
    mgrB.stop();
  });
});
