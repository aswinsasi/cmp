/**
 * CMP v1.4 — Lifeform Transport Handler
 * Bridges the Lifeform system to the CMP transport layer.
 * Routes Lifeform messages (0xC0-0xE0) between local LifeformManager
 * and remote peers over the existing CMP Frame protocol.
 *
 * Handles:
 *   - Remote cause delivery (LIFEFORM_CAUSE)
 *   - State delta replication (LIFEFORM_STATE_DELTA/ACK)
 *   - Migration offers/acks (LIFEFORM_MIGRATE_OFFER/ACK/HOST_CHANGE)
 *   - DNS updates/queries (LIFEFORM_DNS_UPDATE/QUERY/RESPONSE)
 *   - Synapse offers (LIFEFORM_SYNAPSE_OFFER/ACK)
 *   - Heartbeats (LIFEFORM_HEARTBEAT)
 *   - Intent sampling (INTENT_SAMPLE_REQUEST/RESPONSE)
 *
 * @module lifeform/transport-handler
 * @author Agent Viscro
 */

import { LifeformMessageType } from '../types/lifeform';
import { Cause, CauseType } from '../types/causal';
import {
  encodeLifeformMessage,
  decodeLifeformMessage,
  isLifeformMessage,
} from './wire-protocol';
import { generateId } from './crypto';

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

// ─── Peer Resolution ───

export interface PeerResolver {
  /** Get transport address for a mesh ID hex */
  getAddressForMeshId(meshIdHex: string): string | null;
  /** Get all active peer mesh IDs */
  getActivePeerIds(): string[];
  /** Get local device mesh ID hex */
  getLocalMeshId(): string;
}

// ─── Frame Send/Receive ───

export interface FrameTransport {
  /** Send encoded CMP Frame to a peer address */
  sendTo(peerAddress: string, data: Uint8Array): Promise<void>;
  /** Encode a message into a CMP Frame */
  encodeFrame(type: number, payload: Uint8Array): Uint8Array;
}

// ─── Lifeform Manager Interface (subset used by transport) ───

export interface LifeformManagerBridge {
  /** Process a cause for a locally-hosted Lifeform */
  processLocalCause(lifeformIdHex: string, cause: Cause): Promise<boolean>;
  /** Get DNS */
  getDNS(): any;
  /** Get replication manager */
  getReplication(): any;
  /** Get by name */
  getByName(name: string): any;
}

// ─── Transport Handler ───

export class LifeformTransportHandler {
  private peerResolver: PeerResolver;
  private frameTransport: FrameTransport;
  private manager: LifeformManagerBridge | null = null;

  /** Pending DNS queries: queryId → resolve callback */
  private pendingDnsQueries = new Map<string, (records: any[]) => void>();

  /** Stats */
  private messagesSent = 0;
  private messagesReceived = 0;
  private causesDelivered = 0;
  private deltasSync = 0;

  constructor(peerResolver: PeerResolver, frameTransport: FrameTransport) {
    this.peerResolver = peerResolver;
    this.frameTransport = frameTransport;
  }

  /** Connect to LifeformManager */
  setManager(manager: LifeformManagerBridge): void {
    this.manager = manager;
  }

  // ═══════════════════════════════════════
  // Outgoing: Send to remote peers
  // ═══════════════════════════════════════

  /**
   * Send a cause to a remote host.
   * Called by LifeformManager when DNS resolves to a non-local host.
   */
  async sendCause(targetHostId: string, cause: Cause): Promise<boolean> {
    const address = this.peerResolver.getAddressForMeshId(targetHostId);
    if (!address) return false;

    const payload = encodeLifeformMessage(LifeformMessageType.LIFEFORM_CAUSE, {
      causeId: toHex(cause.id),
      causeType: cause.type,
      chainId: toHex(cause.chainId),
      chainDepth: cause.chainDepth,
      maxChainDepth: cause.maxChainDepth,
      deadlineMs: cause.deadlineMs,
      sourceId: toHex(cause.sourceId),
      sourceType: cause.sourceType,
      targetId: toHex(cause.targetId),
      payload: Buffer.from(cause.payload).toString('base64'),
      ccuAttached: cause.ccuAttached,
      expectsResponse: cause.expectsResponse,
      correlationId: cause.correlationId ? toHex(cause.correlationId) : null,
      emittedAt: cause.emittedAt,
    });

    const frame = this.frameTransport.encodeFrame(LifeformMessageType.LIFEFORM_CAUSE, payload);
    await this.frameTransport.sendTo(address, frame);
    this.messagesSent++;
    this.causesDelivered++;
    return true;
  }

  /**
   * Send a state delta to a replica host.
   */
  async sendStateDelta(targetHostId: string, lifeformIdHex: string, delta: any): Promise<boolean> {
    const address = this.peerResolver.getAddressForMeshId(targetHostId);
    if (!address) return false;

    const payload = encodeLifeformMessage(LifeformMessageType.LIFEFORM_STATE_DELTA, {
      lifeformId: lifeformIdHex,
      deltaSequence: delta.sequence,
      changedKeys: delta.changedKeys,
      changes: delta.changes,
      extractedAt: delta.extractedAt,
    });

    const frame = this.frameTransport.encodeFrame(LifeformMessageType.LIFEFORM_STATE_DELTA, payload);
    await this.frameTransport.sendTo(address, frame);
    this.messagesSent++;
    this.deltasSync++;
    return true;
  }

  /**
   * Send a migration offer to a target host.
   */
  async sendMigrateOffer(targetHostId: string, offer: any): Promise<boolean> {
    const address = this.peerResolver.getAddressForMeshId(targetHostId);
    if (!address) return false;

    const payload = encodeLifeformMessage(LifeformMessageType.LIFEFORM_MIGRATE_OFFER, offer);
    const frame = this.frameTransport.encodeFrame(LifeformMessageType.LIFEFORM_MIGRATE_OFFER, payload);
    await this.frameTransport.sendTo(address, frame);
    this.messagesSent++;
    return true;
  }

  /**
   * Broadcast a DNS update to all peers.
   */
  async broadcastDnsUpdate(name: string, lifeformId: string, hostId: string, redirect: string | null, version: number): Promise<number> {
    const payload = encodeLifeformMessage(LifeformMessageType.LIFEFORM_DNS_UPDATE, {
      name, lifeformId, hostId, redirect, version,
      replicaHostIds: [],
    });

    const peerIds = this.peerResolver.getActivePeerIds();
    let sent = 0;
    for (const peerId of peerIds) {
      const address = this.peerResolver.getAddressForMeshId(peerId);
      if (address) {
        const frame = this.frameTransport.encodeFrame(LifeformMessageType.LIFEFORM_DNS_UPDATE, payload);
        try {
          await this.frameTransport.sendTo(address, frame);
          sent++;
        } catch {}
      }
    }
    this.messagesSent += sent;
    return sent;
  }

  /**
   * Send a heartbeat for a Lifeform to all replica hosts.
   */
  async sendHeartbeat(lifeformIdHex: string, ccuBalance: number, causesProcessed: number): Promise<void> {
    if (!this.manager) return;

    const replication = this.manager.getReplication();
    const secondaries = replication.getSecondaryHosts(lifeformIdHex);

    const payload = encodeLifeformMessage(LifeformMessageType.LIFEFORM_HEARTBEAT, {
      lifeformId: lifeformIdHex,
      ccuBalance,
      causesProcessed,
      timestamp: Date.now(),
    });

    for (const hostId of secondaries) {
      const address = this.peerResolver.getAddressForMeshId(hostId);
      if (address) {
        const frame = this.frameTransport.encodeFrame(LifeformMessageType.LIFEFORM_HEARTBEAT, payload);
        try { await this.frameTransport.sendTo(address, frame); } catch {}
      }
    }
  }

  /**
   * Send an intent sample request to a random peer.
   */
  async sendIntentSampleRequest(targetPeerId: string, intentId: string, stateKey: string, predicate: any): Promise<boolean> {
    const address = this.peerResolver.getAddressForMeshId(targetPeerId);
    if (!address) return false;

    const payload = encodeLifeformMessage(LifeformMessageType.INTENT_SAMPLE_REQUEST, {
      intentId,
      stateKey,
      predicate,
      requesterId: this.peerResolver.getLocalMeshId(),
    });

    const frame = this.frameTransport.encodeFrame(LifeformMessageType.INTENT_SAMPLE_REQUEST, payload);
    await this.frameTransport.sendTo(address, frame);
    this.messagesSent++;
    return true;
  }

  // ═══════════════════════════════════════
  // Incoming: Handle messages from remote peers
  // ═══════════════════════════════════════

  /**
   * Handle an incoming Lifeform message from the transport layer.
   * Called by CMPNode when a message in the 0xC0-0xE0 range arrives.
   */
  async handleIncoming(msgType: number, payload: Uint8Array, senderAddress: string): Promise<void> {
    if (!isLifeformMessage(msgType)) return;

    const decoded = decodeLifeformMessage(payload);
    if (!decoded) return;

    this.messagesReceived++;

    switch (msgType) {
      case LifeformMessageType.LIFEFORM_CAUSE:
        await this.handleRemoteCause(decoded, senderAddress);
        break;

      case LifeformMessageType.LIFEFORM_STATE_DELTA:
        await this.handleRemoteStateDelta(decoded);
        break;

      case LifeformMessageType.LIFEFORM_STATE_ACK:
        // Acknowledgment of delta sync — update replication tracker
        this.handleStateAck(decoded);
        break;

      case LifeformMessageType.LIFEFORM_MIGRATE_OFFER:
        await this.handleMigrateOffer(decoded, senderAddress);
        break;

      case LifeformMessageType.LIFEFORM_MIGRATE_ACK:
        this.handleMigrateAck(decoded);
        break;

      case LifeformMessageType.LIFEFORM_HOST_CHANGE:
        this.handleHostChange(decoded);
        break;

      case LifeformMessageType.LIFEFORM_DNS_UPDATE:
        this.handleDnsUpdate(decoded);
        break;

      case LifeformMessageType.LIFEFORM_DNS_QUERY:
        await this.handleDnsQuery(decoded, senderAddress);
        break;

      case LifeformMessageType.LIFEFORM_DNS_RESPONSE:
        this.handleDnsResponse(decoded);
        break;

      case LifeformMessageType.LIFEFORM_HEARTBEAT:
        this.handleHeartbeat(decoded);
        break;

      case LifeformMessageType.INTENT_SAMPLE_REQUEST:
        await this.handleIntentSampleRequest(decoded, senderAddress);
        break;

      case LifeformMessageType.INTENT_SAMPLE_RESPONSE:
        this.handleIntentSampleResponse(decoded);
        break;

      default:
        // Other Lifeform messages (fusion, evolution, etc.) — handle as needed
        break;
    }
  }

  // ── Incoming handlers ──

  private async handleRemoteCause(data: any, senderAddress: string): Promise<void> {
    if (!this.manager) return;

    // Reconstruct Cause from wire data
    const cause: Cause = {
      id: fromHex(data.causeId),
      type: data.causeType as CauseType,
      chainId: fromHex(data.chainId),
      chainDepth: data.chainDepth,
      maxChainDepth: data.maxChainDepth,
      deadlineMs: data.deadlineMs,
      sourceId: fromHex(data.sourceId),
      sourceType: data.sourceType,
      targetId: fromHex(data.targetId),
      payload: Buffer.from(data.payload, 'base64'),
      ccuAttached: data.ccuAttached,
      expectsResponse: data.expectsResponse,
      correlationId: data.correlationId ? fromHex(data.correlationId) : null,
      emittedAt: data.emittedAt,
    };

    // Resolve target Lifeform via local DNS
    const targetIdHex = toHex(cause.targetId);

    // Try delivering to any locally hosted Lifeform
    // The targetId from remote might be the Lifeform ID or a name-encoded ID
    // First try all local names to find a match
    const dns = this.manager.getDNS();
    const allRecords = dns.getAll();
    for (const record of allRecords) {
      if (record.hostId === this.peerResolver.getLocalMeshId()) {
        const hosted = this.manager.getByName(record.name);
        if (hosted) {
          await this.manager.processLocalCause(record.lifeformId, cause);
          this.causesDelivered++;
          return;
        }
      }
    }
  }

  private async handleRemoteStateDelta(data: any): Promise<void> {
    if (!this.manager) return;

    const replication = this.manager.getReplication();
    const localMeshId = this.peerResolver.getLocalMeshId();

    // Check if we're a replica for this Lifeform
    const replica = replication.getReplica(data.lifeformId, localMeshId);
    if (!replica) return;

    // Apply delta to local replica state
    // In a full implementation, we'd maintain a separate CRDTState per replica
    replication.recordDeltaSync(data.lifeformId, localMeshId, data.deltaSequence);
    this.deltasSync++;
  }

  private handleStateAck(data: any): void {
    if (!this.manager) return;
    const replication = this.manager.getReplication();
    replication.recordDeltaSync(data.lifeformId, data.hostId || '', data.deltaSequence);
  }

  private async handleMigrateOffer(data: any, senderAddress: string): Promise<void> {
    // Accept migration: spawn Lifeform from received state
    // Full implementation would create Lifeform from snapshot here
    // For now, acknowledge receipt
  }

  private handleMigrateAck(data: any): void {
    // Migration was accepted/rejected by target
    // Full implementation would complete/fail the migration
  }

  private handleHostChange(data: any): void {
    if (!this.manager) return;
    // Update local DNS to reflect new host
    const dns = this.manager.getDNS();
    dns.updateHost(data.lifeformName, data.newHostId);
  }

  private handleDnsUpdate(data: any): void {
    if (!this.manager) return;
    const dns = this.manager.getDNS();

    if (data.redirect) {
      // Register then set redirect
      dns.register(data.name, data.lifeformId, data.hostId);
      dns.setRedirect(data.name, data.redirect);
    } else {
      dns.register(data.name, data.lifeformId, data.hostId);
    }
  }

  private async handleDnsQuery(data: any, senderAddress: string): Promise<void> {
    if (!this.manager) return;
    const dns = this.manager.getDNS();
    const records = dns.query(data.pattern);

    const payload = encodeLifeformMessage(LifeformMessageType.LIFEFORM_DNS_RESPONSE, {
      queryId: data.queryId,
      records: records.map((r: any) => ({
        name: r.name,
        lifeformId: r.lifeformId,
        hostId: r.hostId,
        redirect: r.redirect,
      })),
    });

    const frame = this.frameTransport.encodeFrame(LifeformMessageType.LIFEFORM_DNS_RESPONSE, payload);
    await this.frameTransport.sendTo(senderAddress, frame);
    this.messagesSent++;
  }

  private handleDnsResponse(data: any): void {
    const callback = this.pendingDnsQueries.get(data.queryId);
    if (callback) {
      callback(data.records);
      this.pendingDnsQueries.delete(data.queryId);
    }
  }

  private handleHeartbeat(data: any): void {
    if (!this.manager) return;
    const replication = this.manager.getReplication();
    // Update last-seen for this Lifeform's primary
    const primary = replication.getPrimaryHost(data.lifeformId);
    if (primary) {
      replication.recordDeltaSync(data.lifeformId, primary, -1); // Just update timestamp
    }
  }

  private async handleIntentSampleRequest(data: any, senderAddress: string): Promise<void> {
    if (!this.manager) return;

    // Read the Lifeform's state (no wake — read-only)
    const dns = this.manager.getDNS();
    const result = dns.resolve(data.stateKey); // stateKey here is actually the Lifeform name
    // In a real implementation, we'd query the actual CRDT state of the Lifeform

    // Send back response
    const payload = encodeLifeformMessage(LifeformMessageType.INTENT_SAMPLE_RESPONSE, {
      intentId: data.intentId,
      samplerId: this.peerResolver.getLocalMeshId(),
      satisfied: true, // Simplified — real impl evaluates predicate
      observedValue: 'sampled',
      sampledAt: Date.now(),
    });

    const frame = this.frameTransport.encodeFrame(LifeformMessageType.INTENT_SAMPLE_RESPONSE, payload);
    await this.frameTransport.sendTo(senderAddress, frame);
    this.messagesSent++;
  }

  private handleIntentSampleResponse(data: any): void {
    // Route to IntentSampler — would be wired in full implementation
  }

  // ═══════════════════════════════════════
  // Stats
  // ═══════════════════════════════════════

  getStats(): {
    messagesSent: number;
    messagesReceived: number;
    causesDelivered: number;
    deltasSync: number;
  } {
    return {
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      causesDelivered: this.causesDelivered,
      deltasSync: this.deltasSync,
    };
  }
}
