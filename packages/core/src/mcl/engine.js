"use strict";
/**
 * CMP MCL Engine
 * The integration layer between the Mesh Cognition Layer and CMPNode.
 *
 * MCLEngine is initialized by CMPNode and called at key lifecycle points:
 *   - onStart(): begin MCL message handling
 *   - onStop(): MER handoff before departure
 *   - onTaskComplete(): generate MER from task results
 *   - onMeshJoined(): offer MERs to new mesh (pollination)
 *   - getHint(): generate strategy hint before task submission
 *   - handleMessage(): route MCL protocol messages
 *
 * This design keeps cmp-node.ts changes minimal (~30 lines)
 * while providing full MCL functionality.
 *
 * @module mcl/engine
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCLEngine = void 0;
const __1 = require("../");
const mcl_1 = require("../types/mcl");
const dmm_1 = require("./dmm");
const mer_1 = require("./mer");
const pollinator_1 = require("./pollinator");
const hints_1 = require("./hints");
const profile_1 = require("./profile");
const log = new __1.Logger('MCLEngine');
/**
 * MCLEngine — integration layer for Mesh Cognition in CMPNode.
 */
class MCLEngine {
    store;
    pollinator;
    config;
    meshId;
    signingSecretKey;
    signingPublicKey;
    transport;
    bus;
    running = false;
    /** Mesh capability signature (LSH hash of aggregate capabilities) */
    meshSignature = new Uint8Array(8);
    /** Environment hash (fuzzy location/time pattern) */
    environmentHash = (0, __1.randomBytes)(8);
    /** Origin mesh hash (changes per mesh session) */
    originMeshHash = (0, __1.randomBytes)(8);
    constructor(opts) {
        this.meshId = opts.meshId;
        this.signingSecretKey = opts.signingSecretKey;
        this.signingPublicKey = opts.signingPublicKey;
        this.transport = opts.transport;
        this.bus = opts.bus;
        this.config = { ...mcl_1.DEFAULT_MCL_CONFIG, ...opts.config };
        this.store = new dmm_1.MERStore({
            maxMers: this.config.maxMers,
            maxPerOrigin: this.config.maxPerOrigin,
            persistence: opts.persistence,
        });
        this.pollinator = new pollinator_1.Pollinator(this.store, this.config);
        // Generate unique origin hash for this mesh session
        this.originMeshHash = (0, __1.hash256)(this.meshId).slice(0, 8);
    }
    // ══════════════════════════════════════════
    // Lifecycle (called by CMPNode)
    // ══════════════════════════════════════════
    /**
     * Start MCL engine. Called by CMPNode.start().
     */
    start() {
        if (this.running)
            return;
        this.running = true;
        // Load persisted MERs from SQLite
        this.store.loadFromPersistence();
        // Purge expired MERs on startup
        this.store.purgeExpired();
        log.info(`MCL Engine started: ${this.store.size} MERs loaded, ` +
            `${this.store.taskTypeCount} task types, ${this.store.originCount} origins`);
        this.bus.emit('mcl:started', { merCount: this.store.size });
    }
    /**
     * Initialize SQLite persistence for MER storage.
     * Must be called before start() if persistence is desired.
     * Async because sql.js requires async WASM initialization.
     *
     * @param dbPath - Path to SQLite database file
     */
    async initPersistence(dbPath) {
        try {
            const { SQLiteMERPersistence } = require('./persistence');
            const persistence = new SQLiteMERPersistence(dbPath);
            await persistence.init();
            this.store.setPersistence(persistence);
            log.info(`SQLite persistence initialized: ${dbPath}`);
        }
        catch (err) {
            log.warn(`SQLite persistence failed, falling back to in-memory: ${err.message}`);
        }
    }
    /**
     * Stop MCL engine. Called by CMPNode.stop().
     * Returns MERs that should be transferred to remaining peers before departure.
     */
    stop() {
        if (!this.running)
            return [];
        this.running = false;
        // Return all MERs for handoff to remaining mesh peers
        const mers = this.store.getAll();
        log.info(`MCL Engine stopping: ${mers.length} MERs available for handoff`);
        return mers;
    }
    // ══════════════════════════════════════════
    // Task Integration (called by CMPNode)
    // ══════════════════════════════════════════
    /**
     * Generate a strategy hint before task submission.
     * Called by CMPNode.compute() before negotiation.
     *
     * @param taskType - Task type being submitted
     * @param currentDeviceCount - Number of active mesh peers
     * @returns Strategy hint, or null if insufficient experience
     */
    getHint(taskType, currentDeviceCount) {
        if (!this.running || !this.config.enabled)
            return null;
        const hint = (0, hints_1.generateHint)(this.store, taskType, this.meshSignature, currentDeviceCount, this.config.minHintConfidence);
        if (hint) {
            this.bus.emit('mcl:hint_generated', {
                taskType,
                confidence: hint.confidence,
                chunkCount: hint.recommendedChunkCount,
                generation: hint.merGeneration,
            });
        }
        return hint;
    }
    /**
     * Apply a strategy hint to task distribution parameters.
     *
     * @param originalChunkHint - Original chunk hint from compute options
     * @param deviceCount - Number of assigned devices
     * @param hint - Strategy hint (from getHint)
     * @returns Adjusted parameters
     */
    applyHintToDistribution(originalChunkHint, deviceCount, hint) {
        return (0, hints_1.applyHint)(originalChunkHint, deviceCount, hint, this.config.minHintConfidence);
    }
    /**
     * Generate a MER after successful task completion.
     * Called by CMPNode when ResultAssembler produces a TaskCompletion.
     *
     * Only generates MERs for verified tasks (REDUNDANT or ZK_PROOF).
     *
     * @param data - Task completion data
     * @returns Generated MER, or null if conditions not met
     */
    onTaskComplete(data) {
        if (!this.running || !this.config.enabled)
            return null;
        // Only generate MERs from verified executions
        if (!data.verified) {
            log.debug('Task not verified, skipping MER generation');
            return null;
        }
        // Calculate overhead percentage
        const overheadPct = data.totalTimeMs > 0
            ? Math.round((data.distributionOverheadMs / data.totalTimeMs) * 100)
            : 0;
        const params = {
            taskType: data.taskType,
            meshSignature: this.meshSignature,
            deviceCount: data.deviceCount,
            strategyUsed: data.strategyUsed,
            chunkCount: data.chunkCount,
            avgChunkSizeKb: data.avgChunkSizeKb,
            performance: {
                totalTimeMs: data.totalTimeMs,
                distributionOverheadPct: Math.min(100, overheadPct),
                executionEfficiency: Math.min(100, Math.max(0, data.executionEfficiency)),
                faultEvents: data.faultEvents,
                reassignmentCount: data.reassignmentCount,
            },
            learnedHints: {
                optimalChunkSizeKb: data.avgChunkSizeKb,
                optimalDeviceCount: data.deviceCount,
                bestTierMapping: new Uint8Array([0, 1, 2, 2, 1]), // default mapping
                bottleneckFlags: 0,
            },
            environmentHash: this.environmentHash,
            originMeshHash: this.originMeshHash,
        };
        const mer = (0, mer_1.createMER)(params, this.signingSecretKey);
        if (this.store.store(mer)) {
            log.info(`MER generated: ${(0, __1.shortId)(mer.merId)} task=${data.taskType} ` +
                `eff=${data.executionEfficiency}% conf=${mer.confidence}`);
            this.bus.emit('mcl:mer_generated', {
                merId: mer.merId,
                taskType: data.taskType,
                confidence: mer.confidence,
                generation: mer.generation,
            });
            return mer;
        }
        return null;
    }
    // ══════════════════════════════════════════
    // Pollination (called by CMPNode)
    // ══════════════════════════════════════════
    /**
     * Build a MER_OFFER when joining a new mesh.
     * Called after handshake + capability exchange completes.
     */
    buildPollination() {
        if (!this.running || !this.config.enabled)
            return null;
        return this.pollinator.buildOffer(this.meshId);
    }
    /**
     * Process a received MER_OFFER from a joining peer.
     * Returns a MER_REQUEST if we want any of the offered MERs.
     */
    processOffer(offer) {
        return this.pollinator.processOffer(offer, this.meshId);
    }
    /**
     * Build a MER_TRANSFER in response to a MER_REQUEST.
     */
    buildTransfer(request) {
        return this.pollinator.buildTransfer(request, this.meshId, this.signingSecretKey);
    }
    /**
     * Process a received MER_TRANSFER — validate and store MERs.
     */
    processTransfer(transfer, senderPublicKey) {
        return this.pollinator.processTransfer(transfer, senderPublicKey);
    }
    // ══════════════════════════════════════════
    // MCL Message Handling
    // ══════════════════════════════════════════
    /**
     * Handle incoming MCL protocol messages.
     * Called by CMPNode's transport message handler.
     *
     * @returns true if the message was handled (MCL type), false otherwise
     */
    handleMessage(type, payload, peerAddress) {
        if (!this.running || !this.config.enabled)
            return false;
        switch (type) {
            case __1.MessageType.MER_OFFER:
                this.handleMEROffer(payload, peerAddress);
                return true;
            case __1.MessageType.MER_REQUEST:
                this.handleMERRequest(payload, peerAddress);
                return true;
            case __1.MessageType.MER_TRANSFER:
                this.handleMERTransfer(payload, peerAddress);
                return true;
            case __1.MessageType.MER_STORE:
                this.handleMERStore(payload);
                return true;
            case __1.MessageType.MER_QUERY:
                // MER_QUERY is handled locally, not over the wire
                return true;
            default:
                return false;
        }
    }
    handleMEROffer(payload, peerAddress) {
        const wire = (0, __1.decodeJSON)(payload);
        if (!wire)
            return;
        log.info(`MER_OFFER from ${peerAddress || 'unknown'}: ${wire.summaries.length} MERs offered`);
        const request = this.processOffer(wire);
        if (!request || !peerAddress)
            return;
        // Send MER_REQUEST back
        const msg = (0, __1.encodeMessage)(__1.MessageType.MER_REQUEST, (0, __1.encodeJSON)(request));
        this.transport.sendTo(peerAddress, msg).catch(err => {
            log.warn(`Failed to send MER_REQUEST: ${err.message}`);
        });
    }
    handleMERRequest(payload, peerAddress) {
        const wire = (0, __1.decodeJSON)(payload);
        if (!wire || !peerAddress)
            return;
        log.info(`MER_REQUEST from ${peerAddress}: ${wire.merIds.length} MERs requested`);
        const transfer = this.buildTransfer(wire);
        const msg = (0, __1.encodeMessage)(__1.MessageType.MER_TRANSFER, (0, __1.encodeJSON)(transfer));
        this.transport.sendTo(peerAddress, msg).catch(err => {
            log.warn(`Failed to send MER_TRANSFER: ${err.message}`);
        });
    }
    handleMERTransfer(payload, _peerAddress) {
        const wire = (0, __1.decodeJSON)(payload);
        if (!wire)
            return;
        // Use signing public key for verification (simplified — in production,
        // we'd look up the sender's key from the peer table)
        const stored = this.processTransfer(wire, this.signingPublicKey);
        log.info(`MER_TRANSFER processed: ${stored} MERs stored`);
    }
    handleMERStore(payload) {
        // Direct MER store from DHT replication (within same mesh)
        const wire = (0, __1.decodeJSON)(payload);
        if (!wire || !wire.merData)
            return;
        const { merFromWire } = require('./mer');
        const mer = merFromWire(wire.merData);
        if (this.store.store(mer)) {
            log.debug(`MER_STORE: stored ${(0, __1.toHex)(mer.merId).substring(0, 8)}`);
        }
    }
    // ══════════════════════════════════════════
    // Profile & Status
    // ══════════════════════════════════════════
    /**
     * Build MCL profile for capability exchange.
     */
    getMCLProfile() {
        return (0, profile_1.buildMCLProfile)(this.store.getAll());
    }
    /**
     * Update mesh signature when capability map changes.
     * Called by CMPNode when capabilities are refreshed.
     */
    updateMeshSignature(capabilityHash) {
        this.meshSignature = capabilityHash.slice(0, 8);
    }
    /**
     * Get MCL status for display/debugging.
     */
    getStatus() {
        return {
            enabled: this.config.enabled,
            merCount: this.store.size,
            taskTypes: this.store.taskTypeCount,
            origins: this.store.originCount,
            pollinationStats: this.pollinator.getStats(),
        };
    }
    /**
     * Get the MER store (for testing/advanced usage).
     */
    getStore() {
        return this.store;
    }
    /**
     * Get the pollinator (for testing/advanced usage).
     */
    getPollinator() {
        return this.pollinator;
    }
    /**
     * Check if MCL is enabled and running.
     */
    isActive() {
        return this.running && this.config.enabled;
    }
}
exports.MCLEngine = MCLEngine;
//# sourceMappingURL=engine.js.map