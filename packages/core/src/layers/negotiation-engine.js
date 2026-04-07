"use strict";
/**
 * CMP Negotiation Engine
 * Layer 3: Handles the full request → bid → assign cycle.
 *
 * Requester flow:
 *   1. Build CMPTaskRequest from user's compute options
 *   2. Broadcast to mesh
 *   3. Collect bids within bid window
 *   4. Score and rank bids using weighted scoring
 *   5. Select winners, create assignments
 *   6. Send assignments, wait for ACKs
 *   7. Return assignments for distribution layer
 *
 * @module layers/negotiation
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationEngine = void 0;
const task_1 = require("../types/task");
const capability_1 = require("../types/capability");
const negotiation_1 = require("../types/negotiation");
const beacon_1 = require("../types/beacon");
const serializer_1 = require("./serializer");
const crypto_1 = require("../crypto");
const helpers_1 = require("../utils/helpers");
const logger_1 = require("../utils/logger");
const incentive_1 = require("../types/incentive");
const log = new logger_1.Logger('Negotiation');
class NegotiationEngine {
    config;
    transport;
    bus;
    peerTable;
    capMap;
    discovery;
    signingKeyPair;
    meshId;
    ledger;
    running = false;
    /** Pending bid collections: taskId hex → bid array */
    pendingBids = new Map();
    /** Active task negotiations for tracking */
    activeNegotiations = new Map();
    constructor(meshId, signingKeyPair, transport, bus, peerTable, capMap, discovery, ledger, config) {
        this.meshId = meshId;
        this.signingKeyPair = signingKeyPair;
        this.transport = transport;
        this.bus = bus;
        this.peerTable = peerTable;
        this.capMap = capMap;
        this.discovery = discovery;
        this.ledger = ledger;
        this.config = { ...negotiation_1.DEFAULT_NEGOTIATION_CONFIG, ...config };
    }
    async start() {
        if (this.running)
            return;
        // Listen for incoming bids
        this.transport.on('message', (event) => {
            if (!event.data)
                return;
            const msg = (0, serializer_1.decodeMessage)(event.data);
            if (!msg)
                return;
            switch (msg.type) {
                case beacon_1.MessageType.BID:
                    this.handleIncomingBid(msg.payload, event.peerAddress);
                    break;
                case beacon_1.MessageType.ASSIGNMENT_ACK:
                    this.handleAssignmentAck(msg.payload);
                    break;
            }
        });
        this.running = true;
        log.info('Negotiation engine started');
    }
    async stop() {
        this.running = false;
        // Reject all pending negotiations
        for (const [taskHex, neg] of this.activeNegotiations) {
            if (neg.timer)
                clearTimeout(neg.timer);
        }
        this.activeNegotiations.clear();
        this.pendingBids.clear();
    }
    /**
     * Submit a task to the mesh and negotiate with peers.
     * Returns assignments if successful, or empty array if no peers available.
     */
    async submitTask(request) {
        const startTime = Date.now();
        // 1. Check if mesh can fulfill the request
        if (!this.capMap.canFulfill(request.computeBudget)) {
            log.warn('Mesh cannot fulfill compute budget', {
                needed: request.computeBudget,
                available: this.capMap.getMeshResources(),
            });
        }
        // 2. Build task request
        const taskId = (0, crypto_1.randomBytes)(16);
        const taskRequest = this.buildTaskRequest(taskId, request);
        log.info(`Submitting task ${(0, helpers_1.shortId)(taskId)}`, {
            type: task_1.TaskType[request.taskType],
            cores: request.computeBudget.minCores,
            memMb: request.computeBudget.minMemoryMb,
            deadline: request.computeBudget.deadlineMs,
            priority: task_1.Priority[request.priority ?? task_1.Priority.NORMAL],
        });
        // 3. Set up bid collection BEFORE sending (bids may arrive during send)
        const taskHex = (0, helpers_1.toHex)(taskId);
        this.pendingBids.set(taskHex, []);
        // 4. Send task request to EACH known peer individually
        //    (more reliable than broadcast — TCP connections may be stale)
        const encoded = (0, serializer_1.encodeJSON)(this.serializeTaskRequest(taskRequest));
        const msg = (0, serializer_1.encodeMessage)(beacon_1.MessageType.TASK_REQUEST, encoded);
        const activePeers = this.peerTable.getActive();
        log.info(`Sending task request to ${activePeers.length} active peers`);
        for (const peer of activePeers) {
            const addr = this.discovery.resolveAddress(peer.meshId);
            if (addr) {
                try {
                    await this.transport.sendTo(addr, msg);
                    log.info(`Task request sent to ${(0, helpers_1.shortId)(peer.meshId)} at ${addr}`);
                }
                catch (err) {
                    log.warn(`Failed to send task request to ${(0, helpers_1.shortId)(peer.meshId)}: ${err.message}`);
                }
            }
            else {
                log.warn(`Cannot resolve address for peer ${(0, helpers_1.shortId)(peer.meshId)}`);
            }
        }
        // Also try broadcast as fallback (only if no direct peers found)
        if (activePeers.length === 0) {
            try {
                await this.transport.broadcast(msg);
            }
            catch { }
        }
        this.bus.emit('task:request_received', {
            taskId,
            requesterId: this.meshId,
        });
        // 5. Collect bids within window
        const bids = await this.collectBids(taskHex, this.config.bidWindowMs, activePeers.length);
        log.info(`Collected ${bids.length} bids for task ${(0, helpers_1.shortId)(taskId)}`);
        if (bids.length === 0) {
            this.pendingBids.delete(taskHex);
            return {
                taskId,
                assignments: [],
                totalBidsReceived: 0,
                negotiationTimeMs: Date.now() - startTime,
            };
        }
        // 6. Score and rank bids
        const scored = this.scoreBids(bids, request.computeBudget);
        // 7. Select winners
        const winners = this.selectWinners(scored, request);
        log.info(`Selected ${winners.length} winners for task ${(0, helpers_1.shortId)(taskId)}`);
        // 8. Create and send assignments
        const assignments = await this.createAndSendAssignments(taskId, winners);
        // 9. Emit event
        this.bus.emit('task:assigned', {
            taskId,
            assignees: assignments.map((a) => a.assignment.bidderId),
        });
        return {
            taskId,
            assignments,
            totalBidsReceived: bids.length,
            negotiationTimeMs: Date.now() - startTime,
        };
    }
    // ── Task Request Building ──
    buildTaskRequest(taskId, req) {
        const security = {
            encryption: req.security?.encryption ?? task_1.EncryptionAlgo.AES_256_GCM,
            verifyMode: req.security?.verifyMode ?? task_1.VerifyMode.CHECKSUM,
            dataSensitivity: req.security?.dataSensitivity ?? task_1.SecurityLevel.PRIVATE,
        };
        return {
            taskId,
            requesterId: this.meshId,
            taskType: req.taskType,
            runtimeRequired: req.runtimeRequired,
            payloadSizeKb: req.payloadSizeKb,
            computeBudget: req.computeBudget,
            security,
            chunkHint: req.chunkHint ?? 0,
            priority: req.priority ?? task_1.Priority.NORMAL,
            creditsOffered: req.creditsOffered ?? this.estimateCredits(req),
            signature: new Uint8Array(64), // Filled below
        };
    }
    serializeTaskRequest(req) {
        return {
            taskId: Array.from(req.taskId),
            requesterId: Array.from(req.requesterId),
            taskType: req.taskType,
            runtimeRequired: req.runtimeRequired,
            payloadSizeKb: req.payloadSizeKb,
            computeBudget: req.computeBudget,
            security: req.security,
            chunkHint: req.chunkHint,
            priority: req.priority,
            creditsOffered: req.creditsOffered,
        };
    }
    // ── Bid Collection ──
    collectBids(taskHex, windowMs, expectedBids = 0) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const bids = this.pendingBids.get(taskHex) || [];
                this.pendingBids.delete(taskHex);
                this.activeNegotiations.delete(taskHex);
                resolve(bids);
            }, windowMs);
            this.activeNegotiations.set(taskHex, {
                resolve: (bids) => {
                    clearTimeout(timer);
                    this.pendingBids.delete(taskHex);
                    this.activeNegotiations.delete(taskHex);
                    resolve(bids);
                },
                timer,
                expectedBids,
            });
        });
    }
    handleIncomingBid(payload, peerAddress) {
        const data = (0, serializer_1.decodeJSON)(payload);
        if (!data) {
            log.warn('Failed to decode bid payload');
            return;
        }
        const bid = {
            taskId: new Uint8Array(data.taskId),
            bidderId: new Uint8Array(data.bidderId),
            offeredResources: data.offeredResources,
            estimatedTimeMs: data.estimatedTimeMs,
            confidence: data.confidence,
            creditsRequested: data.creditsRequested,
            signature: new Uint8Array(64),
        };
        // Register bidder's address if we don't already know them
        // (critical for hotspot where discovery is one-directional)
        if (peerAddress) {
            const existing = this.discovery.resolveAddress(bid.bidderId);
            if (!existing) {
                log.info(`Registering unknown bidder ${(0, helpers_1.shortId)(bid.bidderId)} at ${peerAddress}`);
                this.discovery.registerAddress(bid.bidderId, peerAddress);
            }
        }
        const taskHex = (0, helpers_1.toHex)(bid.taskId);
        const bids = this.pendingBids.get(taskHex);
        log.info(`Bid received from ${(0, helpers_1.shortId)(bid.bidderId)} for task ${taskHex.substring(0, 8)}`, {
            hasPendingEntry: bids !== undefined,
            pendingKeys: [...this.pendingBids.keys()].map(k => k.substring(0, 8)),
            estimatedMs: bid.estimatedTimeMs,
            confidence: bid.confidence,
        });
        if (!bids)
            return; // Not our task or window closed
        bids.push(bid);
        log.debug(`Bid received from ${(0, helpers_1.shortId)(bid.bidderId)} for task ${(0, helpers_1.shortId)(bid.taskId)}`, {
            estimatedMs: bid.estimatedTimeMs,
            confidence: bid.confidence,
            credits: bid.creditsRequested,
        });
        this.bus.emit('task:bid_received', {
            taskId: bid.taskId,
            bidderId: bid.bidderId,
            score: 0, // Scored later
        });
        // Early resolution if we have enough bids (minBids = 1 for fast response)
        if (bids.length >= this.config.minBids) {
            const neg = this.activeNegotiations.get(taskHex);
            if (neg) {
                // If all expected peers responded, resolve immediately
                if (neg.expectedBids && bids.length >= neg.expectedBids) {
                    const currentBids = this.pendingBids.get(taskHex);
                    if (currentBids)
                        neg.resolve(currentBids);
                }
                else {
                    // Give a small grace period for additional bids
                    setTimeout(() => {
                        const currentBids = this.pendingBids.get(taskHex);
                        if (currentBids)
                            neg.resolve(currentBids);
                    }, 50);
                }
            }
        }
    }
    // ── Bid Scoring ──
    scoreBids(bids, budget) {
        const w = this.config.scoringWeights;
        return bids
            .map((bid) => {
            // Get peer capability from map
            const cap = this.capMap.get(bid.bidderId);
            if (!cap) {
                // Unknown peer (e.g., hotspot - discovery was one-directional)
                // Score based on bid's self-reported data + confidence
                const timeFit = budget.deadlineMs > 0
                    ? Math.max(0, 1 - bid.estimatedTimeMs / budget.deadlineMs)
                    : 0.5;
                const defaultScore = 0.3 + (timeFit * 0.2) + (bid.confidence * 0.1);
                log.info(`Scoring unknown bidder ${(0, helpers_1.shortId)(bid.bidderId)}: ${defaultScore.toFixed(3)} (no capability data)`);
                return { bid, score: defaultScore };
            }
            // Resource match (40%)
            const coreFit = Math.min(1, (cap.cpu.coresAvailable) / Math.max(1, budget.minCores));
            const memFit = Math.min(1, cap.memory.availableMb / Math.max(1, budget.minMemoryMb));
            const resourceScore = ((coreFit + memFit) / 2) * w.resourceMatch;
            // Estimated time (25%) — lower is better
            const timeFit = budget.deadlineMs > 0
                ? Math.max(0, 1 - bid.estimatedTimeMs / budget.deadlineMs)
                : 0.5;
            const timeScore = timeFit * w.estimatedTime;
            // Reputation (20%)
            const repScore = (cap.reputationScore / 10000) * w.reputation;
            // Power stability (15%)
            let powerScore;
            if (cap.power.source === 1) { // PLUGGED
                powerScore = 1.0;
            }
            else {
                powerScore = cap.power.batteryPct / 100;
            }
            if (cap.power.thermalState === 1)
                powerScore *= 0.7; // WARM
            powerScore *= w.powerStability;
            // Confidence bonus (up to 5% extra)
            const confidenceBonus = bid.confidence * 0.05;
            const totalScore = resourceScore + timeScore + repScore + powerScore + confidenceBonus;
            return { bid, score: totalScore };
        })
            .sort((a, b) => b.score - a.score);
    }
    // ── Winner Selection ──
    selectWinners(scored, request) {
        if (scored.length === 0)
            return [];
        // Determine how many devices we need
        const chunkCount = request.chunkHint || this.estimateChunkCount(request);
        const redundancy = request.security?.verifyMode === task_1.VerifyMode.REDUNDANT ? 2 : 1;
        const needed = Math.min(scored.length, chunkCount * redundancy);
        // Filter out zero-score bids and low-reputation bidders
        const valid = scored.filter((s) => {
            if (s.score <= 0)
                return false;
            // Check requester's own ledger for this bidder's reputation
            const bidderHex = (0, helpers_1.toHex)(s.bid.bidderId);
            if (this.ledger.hasAccount(bidderHex)) {
                const rep = this.ledger.getReputation(bidderHex);
                if (!this.ledger.canParticipate(bidderHex)) {
                    log.info(`Excluding bidder ${(0, helpers_1.shortId)(s.bid.bidderId)}: reputation ${rep} below minimum`);
                    return false;
                }
                // Deprioritize low-reputation bidders (reduce score by 50%)
                if (rep < incentive_1.REPUTATION_LOW_PRIORITY) {
                    s.score *= 0.5;
                    log.debug(`Deprioritized bidder ${(0, helpers_1.shortId)(s.bid.bidderId)}: reputation ${rep} below ${incentive_1.REPUTATION_LOW_PRIORITY}`);
                }
            }
            return true;
        });
        // Re-sort after any score adjustments
        valid.sort((a, b) => b.score - a.score);
        // Select top N
        const winners = valid.slice(0, Math.max(1, needed));
        log.debug(`Winner selection: ${winners.length} of ${scored.length} bids`, {
            chunkCount,
            redundancy,
            topScore: winners[0]?.score.toFixed(3),
            bottomScore: winners[winners.length - 1]?.score.toFixed(3),
        });
        return winners;
    }
    estimateChunkCount(request) {
        // Heuristic: 1 chunk per candidate, min 2, max 10
        const candidates = this.capMap.findCandidates(request.computeBudget);
        return Math.max(2, Math.min(10, candidates.length));
    }
    // ── Assignment Creation ──
    async createAndSendAssignments(taskId, winners) {
        const records = [];
        for (let i = 0; i < winners.length; i++) {
            const winner = winners[i];
            const bidderId = winner.bid.bidderId;
            // Resolve peer address
            const peerAddress = this.discovery.resolveAddress(bidderId);
            if (!peerAddress) {
                log.warn(`Cannot resolve address for winner ${(0, helpers_1.shortId)(bidderId)}, skipping`);
                continue;
            }
            // Get peer capability (may be null for hotspot peers)
            const cap = this.capMap.get(bidderId);
            const assignment = {
                taskId,
                bidderId,
                chunks: [(0, crypto_1.randomBytes)(16)],
                sessionKey: (0, crypto_1.randomBytes)(32),
                deadline: BigInt(Date.now() + 30000),
                signature: new Uint8Array(64),
            };
            // Send assignment
            const encoded = (0, serializer_1.encodeJSON)({
                taskId: Array.from(taskId),
                bidderId: Array.from(bidderId),
                chunks: assignment.chunks.map((c) => Array.from(c)),
                deadline: assignment.deadline.toString(),
            });
            const msg = (0, serializer_1.encodeMessage)(beacon_1.MessageType.ASSIGNMENT, encoded);
            try {
                await this.transport.sendTo(peerAddress, msg);
                // Build capability placeholder if not in map
                const defaultCap = (cap || {
                    meshId: bidderId,
                    cpu: { architecture: capability_1.Architecture.X86_64, coresAvailable: 2, clockMhz: 2000, loadPercent: 50 },
                    memory: { availableMb: 1024, bandwidthGbps: 1 },
                    gpu: { type: capability_1.GPUType.NONE, computeUnits: 0, vramMb: 0, supports: new Set() },
                    storage: { scratchMb: 512, readMbps: 100, writeMbps: 100 },
                    network: { meshBandwidthMbps: 100, latencyMs: 10 },
                    power: { source: capability_1.PowerSource.PLUGGED, batteryPct: 100, thermalState: capability_1.ThermalState.NOMINAL },
                    runtimes: [capability_1.Runtime.WASM],
                    reputationScore: 5000,
                    availabilitySec: 3600,
                });
                const candidate = {
                    meshId: bidderId,
                    capability: defaultCap,
                    tier: 0,
                    score: winner.score,
                };
                records.push({ assignment, peerAddress, capability: candidate, creditsAgreed: winner.bid.creditsRequested });
                log.info(`Assigned to ${(0, helpers_1.shortId)(bidderId)} (score: ${winner.score.toFixed(3)}, credits: ${winner.bid.creditsRequested} CCU)`);
            }
            catch (err) {
                log.warn(`Failed to send assignment to ${(0, helpers_1.shortId)(bidderId)}: ${err.message}`);
            }
        }
        return records;
    }
    handleAssignmentAck(payload) {
        const data = (0, serializer_1.decodeJSON)(payload);
        if (!data)
            return;
        log.debug(`Assignment ACK from ${(0, helpers_1.shortId)(new Uint8Array(data.bidderId))}`, {
            accepted: data.accepted,
        });
    }
    // ── Credit Estimation ──
    estimateCredits(req) {
        // CCU = CPU-core-seconds at 1GHz equivalent
        const estimatedSeconds = req.computeBudget.deadlineMs / 1000;
        const cores = req.computeBudget.minCores;
        return Math.ceil(estimatedSeconds * cores * 1.2); // 20% buffer
    }
}
exports.NegotiationEngine = NegotiationEngine;
//# sourceMappingURL=negotiation-engine.js.map