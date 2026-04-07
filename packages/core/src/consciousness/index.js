"use strict";
/**
 * CMP v2.0 — Layer 11: Collective Consciousness
 *
 * The mesh thinks as one — without anyone being in charge.
 *
 * Orchestrates three bio-inspired systems:
 *   - PheromoneField: indirect coordination through environment
 *   - QuorumSensor: collective pattern detection
 *   - SwarmDecisionEngine: stochastic distributed decisions
 *
 * Plus: Emergent Behavior Detection — the mesh automatically shifts
 * between behavioral states (NORMAL, HIGH_DEMAND, DEFENSIVE,
 * CONSERVATION, DREAMING, GROWTH) based on pheromone concentrations
 * and quorum signals.
 *
 * Wire Protocol Messages:
 *   0xE1: PHEROMONE_DEPOSIT
 *   0xE2: QUORUM_SIGNAL
 *   0xE3: SWARM_DECISION_INIT
 *   0xE4: SWARM_DECISION_SAMPLE
 *   0xE5: EMERGENCE_NOTIFY
 *
 * @module consciousness
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSampleWeight = exports.SwarmDecisionEngine = exports.QuorumSensor = exports.PheromoneField = exports.ConsciousnessLayer = void 0;
const pheromone_field_1 = require("./pheromone-field");
const quorum_sensor_1 = require("./quorum-sensor");
const swarm_decision_1 = require("./swarm-decision");
const consciousness_1 = require("../types/consciousness");
// ─── Layer 11 ───
class ConsciousnessLayer {
    /** Pheromone-based stigmergy field */
    pheromones;
    /** Quorum sensing engine */
    quorum;
    /** Swarm decision engine */
    swarm;
    config;
    deviceId;
    currentBehavior = consciousness_1.MeshBehavior.NORMAL;
    emergenceTimer = null;
    /** Callback to send messages to mesh peers */
    sendMessage = null;
    /** Emergence listeners */
    emergenceListeners = new Set();
    constructor(deviceId, config) {
        this.deviceId = deviceId;
        this.config = { ...consciousness_1.DEFAULT_CONSCIOUSNESS_CONFIG, ...config };
        // Initialize subsystems
        this.pheromones = new pheromone_field_1.PheromoneField(deviceId, config);
        this.quorum = new quorum_sensor_1.QuorumSensor(deviceId, config);
        this.swarm = new swarm_decision_1.SwarmDecisionEngine(deviceId, config);
        // Wire internal event flows
        this.wireInternals();
    }
    /**
     * Set the transport callback for sending messages to mesh.
     * Called with (messageType, jsonPayload).
     */
    setTransport(sendFn) {
        this.sendMessage = sendFn;
        // Wire subsystem broadcast callbacks
        this.pheromones.onDiffuseCallback((wire) => {
            sendFn(consciousness_1.ConsciousnessMessageType.PHEROMONE_DEPOSIT, wire);
        });
        this.quorum.onBroadcast((wire) => {
            sendFn(consciousness_1.ConsciousnessMessageType.QUORUM_SIGNAL, wire);
        });
        this.swarm.onBroadcasts((wire) => sendFn(consciousness_1.ConsciousnessMessageType.SWARM_DECISION_INIT, wire), (wire) => sendFn(consciousness_1.ConsciousnessMessageType.SWARM_DECISION_SAMPLE, wire));
    }
    /** Start the consciousness layer */
    start() {
        this.pheromones.start();
        // Periodically evaluate emergent behavior
        this.emergenceTimer = setInterval(() => this.evaluateEmergence(), this.config.emergenceEvalIntervalMs);
    }
    /** Stop the consciousness layer */
    stop() {
        this.pheromones.stop();
        this.swarm.stop();
        if (this.emergenceTimer) {
            clearInterval(this.emergenceTimer);
            this.emergenceTimer = null;
        }
    }
    /** Update mesh size for quorum calculations */
    setMeshSize(size) {
        this.quorum.setMeshSize(size);
    }
    /** Subscribe to emergence events */
    onEmergence(listener) {
        this.emergenceListeners.add(listener);
    }
    /** Get current mesh behavior */
    getBehavior() {
        return this.currentBehavior;
    }
    // ── Incoming Message Handler ──
    /**
     * Handle an incoming Layer 11 message from a peer.
     * Called by CMPNode's message router for types 0xE1-0xE5.
     */
    handleMessage(msgType, payload) {
        switch (msgType) {
            case consciousness_1.ConsciousnessMessageType.PHEROMONE_DEPOSIT:
                this.pheromones.receive(payload);
                break;
            case consciousness_1.ConsciousnessMessageType.QUORUM_SIGNAL:
                this.quorum.receiveObservation(payload);
                break;
            case consciousness_1.ConsciousnessMessageType.SWARM_DECISION_INIT:
                this.swarm.receiveInit(payload);
                break;
            case consciousness_1.ConsciousnessMessageType.SWARM_DECISION_SAMPLE:
                this.swarm.receiveSample(payload);
                break;
            case consciousness_1.ConsciousnessMessageType.EMERGENCE_NOTIFY:
                // Peer is reporting their observed emergence — we can use this
                // as additional signal in our own emergence evaluation
                break;
        }
    }
    // ── Convenience: Quick Pheromone Deposits ──
    /** Record a successful computation (deposits COMPUTE_SUCCESS pheromone) */
    recordSuccess(taskType) {
        this.pheromones.deposit(consciousness_1.PheromoneType.COMPUTE_SUCCESS, 1.0, taskType);
        this.quorum.observe('compute_success', 1.0);
    }
    /** Record a failed computation (deposits COMPUTE_FAILURE pheromone) */
    recordFailure(taskType) {
        this.pheromones.deposit(consciousness_1.PheromoneType.COMPUTE_FAILURE, 0.8, taskType);
        this.quorum.observe('compute_failure', 0.8);
    }
    /** Record a threat detection (deposits DANGER pheromone) */
    recordThreat(severity = 1.0) {
        this.pheromones.deposit(consciousness_1.PheromoneType.DANGER, severity);
        this.quorum.observe('threat_detected', severity);
    }
    /** Record high resource availability */
    recordResourceAvailable() {
        this.pheromones.deposit(consciousness_1.PheromoneType.RESOURCE_AVAILABLE, 0.7);
    }
    /** Record congestion */
    recordCongestion() {
        this.pheromones.deposit(consciousness_1.PheromoneType.CONGESTION, 0.6);
        this.quorum.observe('congestion', 0.6);
    }
    // ── Status ──
    /** Get comprehensive Layer 11 status */
    getStatus() {
        return {
            behavior: this.currentBehavior,
            pheromoneCount: this.pheromones.size,
            dominantPheromone: this.pheromones.dominant(),
            quorumStates: this.quorum.getAllStates().filter(s => s.observerCount > 0),
            activeDecisions: this.swarm.getActive().length,
            decidedCount: this.swarm.getDecided().length,
            stats: {
                pheromones: this.pheromones.getStats(),
                quorum: this.quorum.getStats(),
                swarm: this.swarm.getStats(),
            },
        };
    }
    // ── Emergent Behavior Detection ──
    /**
     * Evaluate the mesh's emergent behavior based on collective signals.
     * Called periodically. Determines if the mesh should shift behavior.
     */
    evaluateEmergence() {
        const successReading = this.pheromones.read(consciousness_1.PheromoneType.COMPUTE_SUCCESS);
        const failureReading = this.pheromones.read(consciousness_1.PheromoneType.COMPUTE_FAILURE);
        const dangerReading = this.pheromones.read(consciousness_1.PheromoneType.DANGER);
        const resourceReading = this.pheromones.read(consciousness_1.PheromoneType.RESOURCE_AVAILABLE);
        const congestionReading = this.pheromones.read(consciousness_1.PheromoneType.CONGESTION);
        let newBehavior = consciousness_1.MeshBehavior.NORMAL;
        let reason = 'baseline';
        let confidence = 0.5;
        // Priority: DEFENSIVE > HIGH_DEMAND > CONSERVATION > GROWTH > DREAMING > NORMAL
        if (dangerReading.totalConcentration > 1.5 || this.quorum.isInQuorum('threat_detected')) {
            newBehavior = consciousness_1.MeshBehavior.DEFENSIVE;
            reason = `danger pheromone concentration=${dangerReading.totalConcentration.toFixed(2)}, threat quorum=${this.quorum.isInQuorum('threat_detected')}`;
            confidence = Math.min(1.0, dangerReading.totalConcentration / 3.0);
        }
        else if (successReading.totalConcentration > 3.0 &&
            congestionReading.totalConcentration > 1.0) {
            newBehavior = consciousness_1.MeshBehavior.HIGH_DEMAND;
            reason = `high success (${successReading.totalConcentration.toFixed(2)}) with congestion (${congestionReading.totalConcentration.toFixed(2)})`;
            confidence = Math.min(1.0, successReading.totalConcentration / 5.0);
        }
        else if (resourceReading.totalConcentration < 0.3 &&
            failureReading.totalConcentration > successReading.totalConcentration) {
            newBehavior = consciousness_1.MeshBehavior.CONSERVATION;
            reason = `low resources (${resourceReading.totalConcentration.toFixed(2)}), failures > successes`;
            confidence = 0.7;
        }
        else if (resourceReading.totalConcentration > 2.0 &&
            this.pheromones.size > 10) {
            newBehavior = consciousness_1.MeshBehavior.GROWTH;
            reason = `abundant resources (${resourceReading.totalConcentration.toFixed(2)}), active field`;
            confidence = Math.min(1.0, resourceReading.totalConcentration / 4.0);
        }
        else if (this.pheromones.size < 3 &&
            successReading.totalConcentration < 0.5) {
            newBehavior = consciousness_1.MeshBehavior.DREAMING;
            reason = 'low activity, minimal pheromones';
            confidence = 0.6;
        }
        // Only shift if behavior actually changed
        if (newBehavior !== this.currentBehavior) {
            const event = {
                previousBehavior: this.currentBehavior,
                newBehavior,
                reason,
                confidence,
                timestamp: Date.now(),
            };
            this.currentBehavior = newBehavior;
            // Broadcast emergence to mesh
            if (this.sendMessage) {
                const wire = {
                    behavior: newBehavior,
                    reason,
                    triggeredBy: 'pheromone_analysis',
                    confidence,
                    timestamp: Date.now(),
                };
                this.sendMessage(consciousness_1.ConsciousnessMessageType.EMERGENCE_NOTIFY, wire);
            }
            // Notify local listeners
            for (const listener of this.emergenceListeners) {
                try {
                    listener(event);
                }
                catch { }
            }
        }
    }
    // ── Internal Wiring ──
    wireInternals() {
        // When quorum is reached, deposit corresponding pheromone
        // (reinforcement loop: quorum → pheromone → stronger signal)
        this.quorum.onEvent((event) => {
            if (event.kind === 'threshold_reached') {
                if (event.signalType === 'threat_detected') {
                    this.pheromones.deposit(consciousness_1.PheromoneType.DANGER, 0.9);
                }
                else if (event.signalType === 'compute_success') {
                    this.pheromones.deposit(consciousness_1.PheromoneType.COMPUTE_SUCCESS, 0.5);
                }
            }
        });
    }
}
exports.ConsciousnessLayer = ConsciousnessLayer;
// ─── Exports ───
var pheromone_field_2 = require("./pheromone-field");
Object.defineProperty(exports, "PheromoneField", { enumerable: true, get: function () { return pheromone_field_2.PheromoneField; } });
var quorum_sensor_2 = require("./quorum-sensor");
Object.defineProperty(exports, "QuorumSensor", { enumerable: true, get: function () { return quorum_sensor_2.QuorumSensor; } });
var swarm_decision_2 = require("./swarm-decision");
Object.defineProperty(exports, "SwarmDecisionEngine", { enumerable: true, get: function () { return swarm_decision_2.SwarmDecisionEngine; } });
Object.defineProperty(exports, "calculateSampleWeight", { enumerable: true, get: function () { return swarm_decision_2.calculateSampleWeight; } });
//# sourceMappingURL=index.js.map