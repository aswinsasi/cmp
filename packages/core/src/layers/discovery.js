"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscoveryLayer = void 0;
const beacon_1 = require("../types/beacon");
const beacon_codec_1 = require("./beacon-codec");
const serializer_1 = require("./serializer");
const crypto_1 = require("../crypto");
const helpers_1 = require("../utils/helpers");
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('Discovery');
class DiscoveryLayer {
    meshId;
    exchangeKeyPair;
    signingKeyPair;
    peerTable;
    bus;
    transport;
    config;
    running = false;
    /** Track pending handshakes to avoid duplicates */
    pendingHandshakes = new Set();
    /** Map peer address → meshId hex (for address-to-id resolution) */
    addressToMeshId = new Map();
    constructor(transport, bus, peerTable, config) {
        this.transport = transport;
        this.bus = bus;
        this.peerTable = peerTable;
        this.config = config;
        // Generate identities
        this.meshId = (0, crypto_1.generateMeshId)();
        this.exchangeKeyPair = (0, crypto_1.generateExchangeKeyPair)();
        this.signingKeyPair = (0, crypto_1.generateSigningKeyPair)();
        log.info(`Node identity: ${(0, helpers_1.shortId)(this.meshId)}`);
    }
    /**
     * Get this node's mesh ID.
     */
    getMeshId() {
        return this.meshId;
    }
    /**
     * Get this node's signing public key.
     */
    getSigningPublicKey() {
        return this.signingKeyPair.publicKey;
    }
    /**
     * Start the discovery layer: begin beaconing and scanning.
     */
    async start() {
        if (this.running)
            return;
        // Wire up transport events
        this.transport.on('peer_discovered', (event) => this.onBeaconReceived(event));
        this.transport.on('message', (event) => this.onMessageReceived(event));
        // Build our beacon
        const capHash = (0, crypto_1.hash64)(new Uint8Array(32)); // Placeholder until capability exchange
        const beacon = (0, beacon_codec_1.createBeacon)(this.meshId, capHash, {
            acceptingTasks: this.config.acceptingTasks,
        });
        const beaconBytes = (0, beacon_codec_1.encodeBeacon)(beacon);
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
    async stop() {
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
    resolveAddress(meshId) {
        const hex = (0, helpers_1.toHex)(meshId);
        let latest;
        for (const [addr, id] of this.addressToMeshId) {
            if (id === hex)
                latest = addr;
        }
        return latest;
    }
    /**
     * Register a peer's address manually (used when bid arrives from unknown peer).
     */
    registerAddress(meshId, address) {
        this.updateAddressMapping(address, (0, helpers_1.toHex)(meshId));
    }
    /**
     * Remove all old address entries for a meshId, keeping only the new one.
     */
    updateAddressMapping(newAddress, meshIdHex) {
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
    async sendMessage(peerAddress, type, payload) {
        const msg = (0, serializer_1.encodeMessage)(type, payload);
        await this.transport.sendTo(peerAddress, msg);
    }
    /**
     * Broadcast a protocol message to all peers.
     */
    async broadcastMessage(type, payload) {
        const msg = (0, serializer_1.encodeMessage)(type, payload);
        await this.transport.broadcast(msg);
    }
    // ── Event Handlers ──
    onBeaconReceived(event) {
        if (!this.running || !event.data || !event.peerAddress)
            return;
        const beacon = (0, beacon_codec_1.decodeBeacon)(event.data);
        if (!beacon || !(0, beacon_codec_1.isValidBeacon)(beacon))
            return;
        // Ignore our own beacons
        if ((0, helpers_1.toHex)(beacon.meshId) === (0, helpers_1.toHex)(this.meshId))
            return;
        const peerHex = (0, helpers_1.toHex)(beacon.meshId);
        // Update address mapping (removes stale addresses for this peer)
        this.updateAddressMapping(event.peerAddress, peerHex);
        // Get current peer state before update
        const existingPeer = this.peerTable.get(beacon.meshId);
        const wasLostOrNew = !existingPeer || existingPeer.state === 'discovered' || existingPeer.state === 'stale';
        // Update peer table
        const peer = this.peerTable.upsert(beacon.meshId, {
            state: wasLostOrNew ? 'discovered' : existingPeer.state,
            transports: [event.transport],
        });
        // Touch beacon for liveness
        this.peerTable.touchBeacon(beacon.meshId, event.transport);
        // Initiate handshake if peer is new, reconnecting, or stale
        if (wasLostOrNew && !this.pendingHandshakes.has(peerHex)) {
            this.initiateHandshake(event.peerAddress, beacon.meshId);
        }
    }
    onMessageReceived(event) {
        if (!this.running || !event.data || !event.peerAddress)
            return;
        const msg = (0, serializer_1.decodeMessage)(event.data);
        if (!msg)
            return;
        switch (msg.type) {
            case beacon_1.MessageType.HANDSHAKE_INIT:
                this.handleHandshakeInit(event.peerAddress, msg.payload);
                break;
            case beacon_1.MessageType.HANDSHAKE_RESPONSE:
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
    async initiateHandshake(peerAddress, peerId) {
        const peerHex = (0, helpers_1.toHex)(peerId);
        this.pendingHandshakes.add(peerHex);
        log.debug(`Initiating handshake with ${(0, helpers_1.shortId)(peerId)}`);
        const init = {
            meshId: Array.from(this.meshId),
            exchangePublicKey: Array.from(this.exchangeKeyPair.publicKey),
            signingPublicKey: Array.from(this.signingKeyPair.publicKey),
        };
        try {
            await this.sendMessage(peerAddress, beacon_1.MessageType.HANDSHAKE_INIT, (0, serializer_1.encodeJSON)(init));
        }
        catch (err) {
            log.warn(`Handshake init failed for ${(0, helpers_1.shortId)(peerId)}`, err);
            this.pendingHandshakes.delete(peerHex);
        }
    }
    async handleHandshakeInit(peerAddress, payload) {
        const init = (0, serializer_1.decodeJSON)(payload);
        if (!init)
            return;
        const peerId = new Uint8Array(init.meshId);
        const peerExchangeKey = new Uint8Array(init.exchangePublicKey);
        const peerSigningKey = new Uint8Array(init.signingPublicKey);
        log.debug(`Received handshake init from ${(0, helpers_1.shortId)(peerId)}`);
        // Derive shared secret
        const sessionKey = (0, crypto_1.deriveSharedSecret)(this.exchangeKeyPair.secretKey, peerExchangeKey);
        // Update peer table with session key and public key
        this.peerTable.upsert(peerId, {
            state: 'active',
            sessionKey,
            publicKey: peerSigningKey,
        });
        this.updateAddressMapping(peerAddress, (0, helpers_1.toHex)(peerId));
        // Send response
        const response = {
            meshId: Array.from(this.meshId),
            exchangePublicKey: Array.from(this.exchangeKeyPair.publicKey),
            signingPublicKey: Array.from(this.signingKeyPair.publicKey),
        };
        try {
            await this.sendMessage(peerAddress, beacon_1.MessageType.HANDSHAKE_RESPONSE, (0, serializer_1.encodeJSON)(response));
        }
        catch (err) {
            log.warn(`Handshake response failed for ${(0, helpers_1.shortId)(peerId)}`);
        }
        log.info(`Handshake complete with ${(0, helpers_1.shortId)(peerId)}`);
        this.bus.emit('peer:handshake_complete', { meshId: peerId });
    }
    async handleHandshakeResponse(peerAddress, payload) {
        const response = (0, serializer_1.decodeJSON)(payload);
        if (!response)
            return;
        const peerId = new Uint8Array(response.meshId);
        const peerExchangeKey = new Uint8Array(response.exchangePublicKey);
        const peerSigningKey = new Uint8Array(response.signingPublicKey);
        const peerHex = (0, helpers_1.toHex)(peerId);
        // Derive shared secret
        const sessionKey = (0, crypto_1.deriveSharedSecret)(this.exchangeKeyPair.secretKey, peerExchangeKey);
        // Update peer table
        this.peerTable.upsert(peerId, {
            state: 'active',
            sessionKey,
            publicKey: peerSigningKey,
        });
        this.pendingHandshakes.delete(peerHex);
        this.updateAddressMapping(peerAddress, peerHex);
        log.info(`Handshake complete with ${(0, helpers_1.shortId)(peerId)}`);
        this.bus.emit('peer:handshake_complete', { meshId: peerId });
    }
    resolveMeshId(peerAddress) {
        const hex = this.addressToMeshId.get(peerAddress);
        if (!hex)
            return undefined;
        const peer = this.peerTable.getByHex(hex);
        return peer?.meshId;
    }
}
exports.DiscoveryLayer = DiscoveryLayer;
//# sourceMappingURL=discovery.js.map