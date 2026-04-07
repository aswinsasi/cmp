"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifeformTransportHandler = void 0;
const lifeform_1 = require("../types/lifeform");
const wire_protocol_1 = require("./wire-protocol");
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}
// ─── Transport Handler ───
class LifeformTransportHandler {
    peerResolver;
    frameTransport;
    manager = null;
    /** Pending DNS queries: queryId → resolve callback */
    pendingDnsQueries = new Map();
    /** Stats */
    messagesSent = 0;
    messagesReceived = 0;
    causesDelivered = 0;
    deltasSync = 0;
    constructor(peerResolver, frameTransport) {
        this.peerResolver = peerResolver;
        this.frameTransport = frameTransport;
    }
    /** Connect to LifeformManager */
    setManager(manager) {
        this.manager = manager;
    }
    // ═══════════════════════════════════════
    // Outgoing: Send to remote peers
    // ═══════════════════════════════════════
    /**
     * Send a cause to a remote host.
     * Called by LifeformManager when DNS resolves to a non-local host.
     */
    async sendCause(targetHostId, cause) {
        const address = this.peerResolver.getAddressForMeshId(targetHostId);
        if (!address)
            return false;
        const payload = (0, wire_protocol_1.encodeLifeformMessage)(lifeform_1.LifeformMessageType.LIFEFORM_CAUSE, {
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
        const frame = this.frameTransport.encodeFrame(lifeform_1.LifeformMessageType.LIFEFORM_CAUSE, payload);
        await this.frameTransport.sendTo(address, frame);
        this.messagesSent++;
        this.causesDelivered++;
        return true;
    }
    /**
     * Send a state delta to a replica host.
     */
    async sendStateDelta(targetHostId, lifeformIdHex, delta) {
        const address = this.peerResolver.getAddressForMeshId(targetHostId);
        if (!address)
            return false;
        const payload = (0, wire_protocol_1.encodeLifeformMessage)(lifeform_1.LifeformMessageType.LIFEFORM_STATE_DELTA, {
            lifeformId: lifeformIdHex,
            deltaSequence: delta.sequence,
            changedKeys: delta.changedKeys,
            changes: delta.changes,
            extractedAt: delta.extractedAt,
        });
        const frame = this.frameTransport.encodeFrame(lifeform_1.LifeformMessageType.LIFEFORM_STATE_DELTA, payload);
        await this.frameTransport.sendTo(address, frame);
        this.messagesSent++;
        this.deltasSync++;
        return true;
    }
    /**
     * Send a migration offer to a target host.
     */
    async sendMigrateOffer(targetHostId, offer) {
        const address = this.peerResolver.getAddressForMeshId(targetHostId);
        if (!address)
            return false;
        const payload = (0, wire_protocol_1.encodeLifeformMessage)(lifeform_1.LifeformMessageType.LIFEFORM_MIGRATE_OFFER, offer);
        const frame = this.frameTransport.encodeFrame(lifeform_1.LifeformMessageType.LIFEFORM_MIGRATE_OFFER, payload);
        await this.frameTransport.sendTo(address, frame);
        this.messagesSent++;
        return true;
    }
    /**
     * Broadcast a DNS update to all peers.
     */
    async broadcastDnsUpdate(name, lifeformId, hostId, redirect, version) {
        const payload = (0, wire_protocol_1.encodeLifeformMessage)(lifeform_1.LifeformMessageType.LIFEFORM_DNS_UPDATE, {
            name, lifeformId, hostId, redirect, version,
            replicaHostIds: [],
        });
        const peerIds = this.peerResolver.getActivePeerIds();
        let sent = 0;
        for (const peerId of peerIds) {
            const address = this.peerResolver.getAddressForMeshId(peerId);
            if (address) {
                const frame = this.frameTransport.encodeFrame(lifeform_1.LifeformMessageType.LIFEFORM_DNS_UPDATE, payload);
                try {
                    await this.frameTransport.sendTo(address, frame);
                    sent++;
                }
                catch { }
            }
        }
        this.messagesSent += sent;
        return sent;
    }
    /**
     * Send a heartbeat for a Lifeform to all replica hosts.
     */
    async sendHeartbeat(lifeformIdHex, ccuBalance, causesProcessed) {
        if (!this.manager)
            return;
        const replication = this.manager.getReplication();
        const secondaries = replication.getSecondaryHosts(lifeformIdHex);
        const payload = (0, wire_protocol_1.encodeLifeformMessage)(lifeform_1.LifeformMessageType.LIFEFORM_HEARTBEAT, {
            lifeformId: lifeformIdHex,
            ccuBalance,
            causesProcessed,
            timestamp: Date.now(),
        });
        for (const hostId of secondaries) {
            const address = this.peerResolver.getAddressForMeshId(hostId);
            if (address) {
                const frame = this.frameTransport.encodeFrame(lifeform_1.LifeformMessageType.LIFEFORM_HEARTBEAT, payload);
                try {
                    await this.frameTransport.sendTo(address, frame);
                }
                catch { }
            }
        }
    }
    /**
     * Send an intent sample request to a random peer.
     */
    async sendIntentSampleRequest(targetPeerId, intentId, stateKey, predicate) {
        const address = this.peerResolver.getAddressForMeshId(targetPeerId);
        if (!address)
            return false;
        const payload = (0, wire_protocol_1.encodeLifeformMessage)(lifeform_1.LifeformMessageType.INTENT_SAMPLE_REQUEST, {
            intentId,
            stateKey,
            predicate,
            requesterId: this.peerResolver.getLocalMeshId(),
        });
        const frame = this.frameTransport.encodeFrame(lifeform_1.LifeformMessageType.INTENT_SAMPLE_REQUEST, payload);
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
    async handleIncoming(msgType, payload, senderAddress) {
        if (!(0, wire_protocol_1.isLifeformMessage)(msgType))
            return;
        const decoded = (0, wire_protocol_1.decodeLifeformMessage)(payload);
        if (!decoded)
            return;
        this.messagesReceived++;
        switch (msgType) {
            case lifeform_1.LifeformMessageType.LIFEFORM_CAUSE:
                await this.handleRemoteCause(decoded, senderAddress);
                break;
            case lifeform_1.LifeformMessageType.LIFEFORM_STATE_DELTA:
                await this.handleRemoteStateDelta(decoded);
                break;
            case lifeform_1.LifeformMessageType.LIFEFORM_STATE_ACK:
                // Acknowledgment of delta sync — update replication tracker
                this.handleStateAck(decoded);
                break;
            case lifeform_1.LifeformMessageType.LIFEFORM_MIGRATE_OFFER:
                await this.handleMigrateOffer(decoded, senderAddress);
                break;
            case lifeform_1.LifeformMessageType.LIFEFORM_MIGRATE_ACK:
                this.handleMigrateAck(decoded);
                break;
            case lifeform_1.LifeformMessageType.LIFEFORM_HOST_CHANGE:
                this.handleHostChange(decoded);
                break;
            case lifeform_1.LifeformMessageType.LIFEFORM_DNS_UPDATE:
                this.handleDnsUpdate(decoded);
                break;
            case lifeform_1.LifeformMessageType.LIFEFORM_DNS_QUERY:
                await this.handleDnsQuery(decoded, senderAddress);
                break;
            case lifeform_1.LifeformMessageType.LIFEFORM_DNS_RESPONSE:
                this.handleDnsResponse(decoded);
                break;
            case lifeform_1.LifeformMessageType.LIFEFORM_HEARTBEAT:
                this.handleHeartbeat(decoded);
                break;
            case lifeform_1.LifeformMessageType.INTENT_SAMPLE_REQUEST:
                await this.handleIntentSampleRequest(decoded, senderAddress);
                break;
            case lifeform_1.LifeformMessageType.INTENT_SAMPLE_RESPONSE:
                this.handleIntentSampleResponse(decoded);
                break;
            default:
                // Other Lifeform messages (fusion, evolution, etc.) — handle as needed
                break;
        }
    }
    // ── Incoming handlers ──
    async handleRemoteCause(data, senderAddress) {
        if (!this.manager)
            return;
        // Reconstruct Cause from wire data
        const cause = {
            id: fromHex(data.causeId),
            type: data.causeType,
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
    async handleRemoteStateDelta(data) {
        if (!this.manager)
            return;
        const replication = this.manager.getReplication();
        const localMeshId = this.peerResolver.getLocalMeshId();
        // Check if we're a replica for this Lifeform
        const replica = replication.getReplica(data.lifeformId, localMeshId);
        if (!replica)
            return;
        // Apply delta to local replica state
        // In a full implementation, we'd maintain a separate CRDTState per replica
        replication.recordDeltaSync(data.lifeformId, localMeshId, data.deltaSequence);
        this.deltasSync++;
    }
    handleStateAck(data) {
        if (!this.manager)
            return;
        const replication = this.manager.getReplication();
        replication.recordDeltaSync(data.lifeformId, data.hostId || '', data.deltaSequence);
    }
    async handleMigrateOffer(data, senderAddress) {
        // Accept migration: spawn Lifeform from received state
        // Full implementation would create Lifeform from snapshot here
        // For now, acknowledge receipt
    }
    handleMigrateAck(data) {
        // Migration was accepted/rejected by target
        // Full implementation would complete/fail the migration
    }
    handleHostChange(data) {
        if (!this.manager)
            return;
        // Update local DNS to reflect new host
        const dns = this.manager.getDNS();
        dns.updateHost(data.lifeformName, data.newHostId);
    }
    handleDnsUpdate(data) {
        if (!this.manager)
            return;
        const dns = this.manager.getDNS();
        if (data.redirect) {
            // Register then set redirect
            dns.register(data.name, data.lifeformId, data.hostId);
            dns.setRedirect(data.name, data.redirect);
        }
        else {
            dns.register(data.name, data.lifeformId, data.hostId);
        }
    }
    async handleDnsQuery(data, senderAddress) {
        if (!this.manager)
            return;
        const dns = this.manager.getDNS();
        const records = dns.query(data.pattern);
        const payload = (0, wire_protocol_1.encodeLifeformMessage)(lifeform_1.LifeformMessageType.LIFEFORM_DNS_RESPONSE, {
            queryId: data.queryId,
            records: records.map((r) => ({
                name: r.name,
                lifeformId: r.lifeformId,
                hostId: r.hostId,
                redirect: r.redirect,
            })),
        });
        const frame = this.frameTransport.encodeFrame(lifeform_1.LifeformMessageType.LIFEFORM_DNS_RESPONSE, payload);
        await this.frameTransport.sendTo(senderAddress, frame);
        this.messagesSent++;
    }
    handleDnsResponse(data) {
        const callback = this.pendingDnsQueries.get(data.queryId);
        if (callback) {
            callback(data.records);
            this.pendingDnsQueries.delete(data.queryId);
        }
    }
    handleHeartbeat(data) {
        if (!this.manager)
            return;
        const replication = this.manager.getReplication();
        // Update last-seen for this Lifeform's primary
        const primary = replication.getPrimaryHost(data.lifeformId);
        if (primary) {
            replication.recordDeltaSync(data.lifeformId, primary, -1); // Just update timestamp
        }
    }
    async handleIntentSampleRequest(data, senderAddress) {
        if (!this.manager)
            return;
        // Read the Lifeform's state (no wake — read-only)
        const dns = this.manager.getDNS();
        const result = dns.resolve(data.stateKey); // stateKey here is actually the Lifeform name
        // In a real implementation, we'd query the actual CRDT state of the Lifeform
        // Send back response
        const payload = (0, wire_protocol_1.encodeLifeformMessage)(lifeform_1.LifeformMessageType.INTENT_SAMPLE_RESPONSE, {
            intentId: data.intentId,
            samplerId: this.peerResolver.getLocalMeshId(),
            satisfied: true, // Simplified — real impl evaluates predicate
            observedValue: 'sampled',
            sampledAt: Date.now(),
        });
        const frame = this.frameTransport.encodeFrame(lifeform_1.LifeformMessageType.INTENT_SAMPLE_RESPONSE, payload);
        await this.frameTransport.sendTo(senderAddress, frame);
        this.messagesSent++;
    }
    handleIntentSampleResponse(data) {
        // Route to IntentSampler — would be wired in full implementation
    }
    // ═══════════════════════════════════════
    // Stats
    // ═══════════════════════════════════════
    getStats() {
        return {
            messagesSent: this.messagesSent,
            messagesReceived: this.messagesReceived,
            causesDelivered: this.causesDelivered,
            deltasSync: this.deltasSync,
        };
    }
}
exports.LifeformTransportHandler = LifeformTransportHandler;
//# sourceMappingURL=transport-handler.js.map