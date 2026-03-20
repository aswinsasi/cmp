/**
 * CMP Discovery Layer
 * Orchestrates mesh formation: beaconing, scanning, handshake,
 * and peer lifecycle management.
 *
 * Flow:
 *   1. Start beaconing (broadcast our presence)
 *   2. Start scanning (listen for others)
 *   3. On beacon received → add to peer table as 'discovered'
 *   4. Initiate ECDH handshake → derive session key
 *   5. On handshake complete → mark peer as 'active'
 *   6. Exchange capability profiles
 *
 * @module layers/discovery
 * @author Agent Viscro
 */

import { ITransport, TransportEvent } from '../../../transport/src/interface';
import { CMPBeacon, MessageType, BEACON_MAGIC } from '../types/beacon';
import { MeshId, PublicKey } from '../types/primitives';
import { encodeBeacon, decodeBeacon, createBeacon, isValidBeacon } from './beacon-codec';
import { encodeMessage, decodeMessage, encodeJSON, decodeJSON, HandshakeInit, HandshakeResponse } from './serializer';
import { PeerTable, PeerEntry } from '../mesh/peer-table';
import { EventBus } from '../mesh/event-bus';
import {
  generateMeshId,
  generateExchangeKeyPair,
  generateSigningKeyPair,
  deriveSharedSecret,
  hash64,
  KeyPair,
} from '../crypto';
import { toHex, shortId } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { CMPConfig } from '../utils/config';

const log = new Logger('Discovery');

export class DiscoveryLayer {
  private meshId: MeshId;
  private exchangeKeyPair: KeyPair;
  private signingKeyPair: KeyPair;
  private peerTable: PeerTable;
  private bus: EventBus;
  private transport: ITransport;
  private config: CMPConfig;
  private running = false;

  /** Track pending handshakes to avoid duplicates */
  private pendingHandshakes = new Set<string>();

  /** Map peer address → meshId hex (for address-to-id resolution) */
  private addressToMeshId = new Map<string, string>();

  constructor(
    transport: ITransport,
    bus: EventBus,
    peerTable: PeerTable,
    config: CMPConfig
  ) {
    this.transport = transport;
    this.bus = bus;
    this.peerTable = peerTable;
    this.config = config;

    // Generate identities
    this.meshId = generateMeshId();
    this.exchangeKeyPair = generateExchangeKeyPair();
    this.signingKeyPair = generateSigningKeyPair();

    log.info(`Node identity: ${shortId(this.meshId)}`);
  }

  /**
   * Get this node's mesh ID.
   */
  getMeshId(): MeshId {
    return this.meshId;
  }

  /**
   * Get this node's signing public key.
   */
  getSigningPublicKey(): PublicKey {
    return this.signingKeyPair.publicKey;
  }

  /**
   * Start the discovery layer: begin beaconing and scanning.
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Wire up transport events
    this.transport.on('peer_discovered', (event) => this.onBeaconReceived(event));
    this.transport.on('message', (event) => this.onMessageReceived(event));

    // Build our beacon
    const capHash = hash64(new Uint8Array(32)); // Placeholder until capability exchange
    const beacon = createBeacon(this.meshId, capHash, {
      acceptingTasks: this.config.acceptingTasks,
    });
    const beaconBytes = encodeBeacon(beacon);

    // Start beaconing and scanning
    await this.transport.startBeaconing(beaconBytes, this.config.beaconIntervalMs);
    await this.transport.startScanning();

    this.running = true;
    log.info('Discovery started', {
      beaconInterval: this.config.beaconIntervalMs,
      transport: this.transport.name,
    });
  }

  /**
   * Stop the discovery layer.
   */
  async stop(): Promise<void> {
    this.running = false;
    await this.transport.stopBeaconing();
    await this.transport.stopScanning();
    this.pendingHandshakes.clear();
    this.addressToMeshId.clear();
  }

  /**
   * Resolve a mesh ID to a transport peer address.
   * Returns the MOST RECENT address for this peer.
   */
  resolveAddress(meshId: MeshId): string | undefined {
    const hex = toHex(meshId);
    let latest: string | undefined;
    for (const [addr, id] of this.addressToMeshId) {
      if (id === hex) latest = addr;
    }
    return latest;
  }

  /**
   * Register a peer's address manually (used when bid arrives from unknown peer).
   */
  registerAddress(meshId: MeshId, address: string): void {
    this.updateAddressMapping(address, toHex(meshId));
  }

  /**
   * Remove all old address entries for a meshId, keeping only the new one.
   */
  private updateAddressMapping(newAddress: string, meshIdHex: string): void {
    // Remove all OLD addresses for this meshId
    for (const [addr, id] of this.addressToMeshId) {
      if (id === meshIdHex && addr !== newAddress) {
        this.addressToMeshId.delete(addr);
      }
    }
    // Set the new address
    this.addressToMeshId.set(newAddress, meshIdHex);
  }

  /**
   * Send a protocol message to a specific peer.
   */
  async sendMessage(peerAddress: string, type: MessageType, payload: Uint8Array): Promise<void> {
    const msg = encodeMessage(type, payload);
    await this.transport.sendTo(peerAddress, msg);
  }

  /**
   * Broadcast a protocol message to all peers.
   */
  async broadcastMessage(type: MessageType, payload: Uint8Array): Promise<void> {
    const msg = encodeMessage(type, payload);
    await this.transport.broadcast(msg);
  }

  // ── Event Handlers ──

  private onBeaconReceived(event: TransportEvent): void {
    if (!this.running || !event.data || !event.peerAddress) return;

    const beacon = decodeBeacon(event.data);
    if (!beacon || !isValidBeacon(beacon)) return;

    // Ignore our own beacons
    if (toHex(beacon.meshId) === toHex(this.meshId)) return;

    const peerHex = toHex(beacon.meshId);

    // Update address mapping (removes stale addresses for this peer)
    this.updateAddressMapping(event.peerAddress, peerHex);

    // Get current peer state before update
    const existingPeer = this.peerTable.get(beacon.meshId);
    const wasLostOrNew = !existingPeer || existingPeer.state === 'discovered' || existingPeer.state === 'stale';

    // Update peer table
    const peer = this.peerTable.upsert(beacon.meshId, {
      state: wasLostOrNew ? 'discovered' : existingPeer!.state,
      transports: [event.transport],
    });

    // Touch beacon for liveness
    this.peerTable.touchBeacon(beacon.meshId, event.transport);

    // Initiate handshake if peer is new, reconnecting, or stale
    if (wasLostOrNew && !this.pendingHandshakes.has(peerHex)) {
      this.initiateHandshake(event.peerAddress, beacon.meshId);
    }
  }

  private onMessageReceived(event: TransportEvent): void {
    if (!this.running || !event.data || !event.peerAddress) return;

    const msg = decodeMessage(event.data);
    if (!msg) return;

    switch (msg.type) {
      case MessageType.HANDSHAKE_INIT:
        this.handleHandshakeInit(event.peerAddress, msg.payload);
        break;
      case MessageType.HANDSHAKE_RESPONSE:
        this.handleHandshakeResponse(event.peerAddress, msg.payload);
        break;
      default:
        // Forward non-discovery messages to the bus
        this.bus.emit('transport:message', {
          from: this.resolveMeshId(event.peerAddress) || new Uint8Array(16),
          data: event.data,
          transport: event.transport,
        });
        break;
    }
  }

  // ── Handshake ──

  private async initiateHandshake(peerAddress: string, peerId: MeshId): Promise<void> {
    const peerHex = toHex(peerId);
    this.pendingHandshakes.add(peerHex);

    log.debug(`Initiating handshake with ${shortId(peerId)}`);

    const init: HandshakeInit = {
      meshId: Array.from(this.meshId),
      exchangePublicKey: Array.from(this.exchangeKeyPair.publicKey),
      signingPublicKey: Array.from(this.signingKeyPair.publicKey),
    };

    try {
      await this.sendMessage(
        peerAddress,
        MessageType.HANDSHAKE_INIT,
        encodeJSON(init)
      );
    } catch (err) {
      log.warn(`Handshake init failed for ${shortId(peerId)}`, err);
      this.pendingHandshakes.delete(peerHex);
    }
  }

  private async handleHandshakeInit(peerAddress: string, payload: Uint8Array): Promise<void> {
    const init = decodeJSON<HandshakeInit>(payload);
    if (!init) return;

    const peerId = new Uint8Array(init.meshId);
    const peerExchangeKey = new Uint8Array(init.exchangePublicKey);
    const peerSigningKey = new Uint8Array(init.signingPublicKey);

    log.debug(`Received handshake init from ${shortId(peerId)}`);

    // Derive shared secret
    const sessionKey = deriveSharedSecret(
      this.exchangeKeyPair.secretKey,
      peerExchangeKey
    );

    // Update peer table with session key and public key
    this.peerTable.upsert(peerId, {
      state: 'active',
      sessionKey,
      publicKey: peerSigningKey,
    });

    this.updateAddressMapping(peerAddress, toHex(peerId));

    // Send response
    const response: HandshakeResponse = {
      meshId: Array.from(this.meshId),
      exchangePublicKey: Array.from(this.exchangeKeyPair.publicKey),
      signingPublicKey: Array.from(this.signingKeyPair.publicKey),
    };

    try {
      await this.sendMessage(
        peerAddress,
        MessageType.HANDSHAKE_RESPONSE,
        encodeJSON(response)
      );
    } catch (err) {
      log.warn(`Handshake response failed for ${shortId(peerId)}`);
    }

    log.info(`Handshake complete with ${shortId(peerId)}`);
    this.bus.emit('peer:handshake_complete', { meshId: peerId });
  }

  private async handleHandshakeResponse(peerAddress: string, payload: Uint8Array): Promise<void> {
    const response = decodeJSON<HandshakeResponse>(payload);
    if (!response) return;

    const peerId = new Uint8Array(response.meshId);
    const peerExchangeKey = new Uint8Array(response.exchangePublicKey);
    const peerSigningKey = new Uint8Array(response.signingPublicKey);
    const peerHex = toHex(peerId);

    // Derive shared secret
    const sessionKey = deriveSharedSecret(
      this.exchangeKeyPair.secretKey,
      peerExchangeKey
    );

    // Update peer table
    this.peerTable.upsert(peerId, {
      state: 'active',
      sessionKey,
      publicKey: peerSigningKey,
    });

    this.pendingHandshakes.delete(peerHex);
    this.updateAddressMapping(peerAddress, peerHex);

    log.info(`Handshake complete with ${shortId(peerId)}`);
    this.bus.emit('peer:handshake_complete', { meshId: peerId });
  }

  private resolveMeshId(peerAddress: string): Uint8Array | undefined {
    const hex = this.addressToMeshId.get(peerAddress);
    if (!hex) return undefined;
    const peer = this.peerTable.getByHex(hex);
    return peer?.meshId;
  }
}
