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

import { PheromoneField, PheromoneEvent } from './pheromone-field';
import { QuorumSensor, QuorumEvent } from './quorum-sensor';
import { SwarmDecisionEngine, SwarmDecisionEvent } from './swarm-decision';
import {
  ConsciousnessConfig,
  DEFAULT_CONSCIOUSNESS_CONFIG,
  ConsciousnessMessageType,
  PheromoneType,
  PheromoneDepositWire,
  QuorumSignalWire,
  QuorumAction,
  SwarmDecisionInitWire,
  SwarmDecisionSampleWire,
  MeshBehavior,
  EmergenceNotifyWire,
} from '../types/consciousness';

// ─── Emergence Event ───

export interface EmergenceEvent {
  previousBehavior: MeshBehavior;
  newBehavior: MeshBehavior;
  reason: string;
  confidence: number;
  timestamp: number;
}

// ─── Layer 11 ───

export class ConsciousnessLayer {
  /** Pheromone-based stigmergy field */
  readonly pheromones: PheromoneField;
  /** Quorum sensing engine */
  readonly quorum: QuorumSensor;
  /** Swarm decision engine */
  readonly swarm: SwarmDecisionEngine;

  private config: ConsciousnessConfig;
  private deviceId: string;
  private currentBehavior: MeshBehavior = MeshBehavior.NORMAL;
  private emergenceTimer: ReturnType<typeof setInterval> | null = null;

  /** Callback to send messages to mesh peers */
  private sendMessage: ((msgType: number, payload: any) => void) | null = null;

  /** Emergence listeners */
  private emergenceListeners = new Set<(event: EmergenceEvent) => void>();

  constructor(deviceId: string, config?: Partial<ConsciousnessConfig>) {
    this.deviceId = deviceId;
    this.config = { ...DEFAULT_CONSCIOUSNESS_CONFIG, ...config };

    // Initialize subsystems
    this.pheromones = new PheromoneField(deviceId, config);
    this.quorum = new QuorumSensor(deviceId, config);
    this.swarm = new SwarmDecisionEngine(deviceId, config);

    // Wire internal event flows
    this.wireInternals();
  }

  /**
   * Set the transport callback for sending messages to mesh.
   * Called with (messageType, jsonPayload).
   */
  setTransport(sendFn: (msgType: number, payload: any) => void): void {
    this.sendMessage = sendFn;

    // Wire subsystem broadcast callbacks
    this.pheromones.onDiffuseCallback((wire) => {
      sendFn(ConsciousnessMessageType.PHEROMONE_DEPOSIT, wire);
    });

    this.quorum.onBroadcast((wire) => {
      sendFn(ConsciousnessMessageType.QUORUM_SIGNAL, wire);
    });

    this.swarm.onBroadcasts(
      (wire) => sendFn(ConsciousnessMessageType.SWARM_DECISION_INIT, wire),
      (wire) => sendFn(ConsciousnessMessageType.SWARM_DECISION_SAMPLE, wire),
    );
  }

  /** Start the consciousness layer */
  start(): void {
    this.pheromones.start();

    // Periodically evaluate emergent behavior
    this.emergenceTimer = setInterval(
      () => this.evaluateEmergence(),
      this.config.emergenceEvalIntervalMs,
    );
  }

  /** Stop the consciousness layer */
  stop(): void {
    this.pheromones.stop();
    this.swarm.stop();
    if (this.emergenceTimer) {
      clearInterval(this.emergenceTimer);
      this.emergenceTimer = null;
    }
  }

  /** Update mesh size for quorum calculations */
  setMeshSize(size: number): void {
    this.quorum.setMeshSize(size);
  }

  /** Subscribe to emergence events */
  onEmergence(listener: (event: EmergenceEvent) => void): void {
    this.emergenceListeners.add(listener);
  }

  /** Get current mesh behavior */
  getBehavior(): MeshBehavior {
    return this.currentBehavior;
  }

  // ── Incoming Message Handler ──

  /**
   * Handle an incoming Layer 11 message from a peer.
   * Called by CMPNode's message router for types 0xE1-0xE5.
   */
  handleMessage(msgType: number, payload: any): void {
    switch (msgType) {
      case ConsciousnessMessageType.PHEROMONE_DEPOSIT:
        this.pheromones.receive(payload as PheromoneDepositWire);
        break;

      case ConsciousnessMessageType.QUORUM_SIGNAL:
        this.quorum.receiveObservation(payload as QuorumSignalWire);
        break;

      case ConsciousnessMessageType.SWARM_DECISION_INIT:
        this.swarm.receiveInit(payload as SwarmDecisionInitWire);
        break;

      case ConsciousnessMessageType.SWARM_DECISION_SAMPLE:
        this.swarm.receiveSample(payload as SwarmDecisionSampleWire);
        break;

      case ConsciousnessMessageType.EMERGENCE_NOTIFY:
        // Peer is reporting their observed emergence — we can use this
        // as additional signal in our own emergence evaluation
        break;
    }
  }

  // ── Convenience: Quick Pheromone Deposits ──

  /** Record a successful computation (deposits COMPUTE_SUCCESS pheromone) */
  recordSuccess(taskType?: any): void {
    this.pheromones.deposit(PheromoneType.COMPUTE_SUCCESS, 1.0, taskType);
    this.quorum.observe('compute_success', 1.0);
  }

  /** Record a failed computation (deposits COMPUTE_FAILURE pheromone) */
  recordFailure(taskType?: any): void {
    this.pheromones.deposit(PheromoneType.COMPUTE_FAILURE, 0.8, taskType);
    this.quorum.observe('compute_failure', 0.8);
  }

  /** Record a threat detection (deposits DANGER pheromone) */
  recordThreat(severity: number = 1.0): void {
    this.pheromones.deposit(PheromoneType.DANGER, severity);
    this.quorum.observe('threat_detected', severity);
  }

  /** Record high resource availability */
  recordResourceAvailable(): void {
    this.pheromones.deposit(PheromoneType.RESOURCE_AVAILABLE, 0.7);
  }

  /** Record congestion */
  recordCongestion(): void {
    this.pheromones.deposit(PheromoneType.CONGESTION, 0.6);
    this.quorum.observe('congestion', 0.6);
  }

  // ── Status ──

  /** Get comprehensive Layer 11 status */
  getStatus(): ConsciousnessStatus {
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
  private evaluateEmergence(): void {
    const successReading = this.pheromones.read(PheromoneType.COMPUTE_SUCCESS);
    const failureReading = this.pheromones.read(PheromoneType.COMPUTE_FAILURE);
    const dangerReading = this.pheromones.read(PheromoneType.DANGER);
    const resourceReading = this.pheromones.read(PheromoneType.RESOURCE_AVAILABLE);
    const congestionReading = this.pheromones.read(PheromoneType.CONGESTION);

    let newBehavior = MeshBehavior.NORMAL;
    let reason = 'baseline';
    let confidence = 0.5;

    // Priority: DEFENSIVE > HIGH_DEMAND > CONSERVATION > GROWTH > DREAMING > NORMAL

    if (dangerReading.totalConcentration > 1.5 || this.quorum.isInQuorum('threat_detected')) {
      newBehavior = MeshBehavior.DEFENSIVE;
      reason = `danger pheromone concentration=${dangerReading.totalConcentration.toFixed(2)}, threat quorum=${this.quorum.isInQuorum('threat_detected')}`;
      confidence = Math.min(1.0, dangerReading.totalConcentration / 3.0);
    } else if (
      successReading.totalConcentration > 3.0 &&
      congestionReading.totalConcentration > 1.0
    ) {
      newBehavior = MeshBehavior.HIGH_DEMAND;
      reason = `high success (${successReading.totalConcentration.toFixed(2)}) with congestion (${congestionReading.totalConcentration.toFixed(2)})`;
      confidence = Math.min(1.0, successReading.totalConcentration / 5.0);
    } else if (
      resourceReading.totalConcentration < 0.3 &&
      failureReading.totalConcentration > successReading.totalConcentration
    ) {
      newBehavior = MeshBehavior.CONSERVATION;
      reason = `low resources (${resourceReading.totalConcentration.toFixed(2)}), failures > successes`;
      confidence = 0.7;
    } else if (
      resourceReading.totalConcentration > 2.0 &&
      this.pheromones.size > 10
    ) {
      newBehavior = MeshBehavior.GROWTH;
      reason = `abundant resources (${resourceReading.totalConcentration.toFixed(2)}), active field`;
      confidence = Math.min(1.0, resourceReading.totalConcentration / 4.0);
    } else if (
      this.pheromones.size < 3 &&
      successReading.totalConcentration < 0.5
    ) {
      newBehavior = MeshBehavior.DREAMING;
      reason = 'low activity, minimal pheromones';
      confidence = 0.6;
    }

    // Only shift if behavior actually changed
    if (newBehavior !== this.currentBehavior) {
      const event: EmergenceEvent = {
        previousBehavior: this.currentBehavior,
        newBehavior,
        reason,
        confidence,
        timestamp: Date.now(),
      };

      this.currentBehavior = newBehavior;

      // Broadcast emergence to mesh
      if (this.sendMessage) {
        const wire: EmergenceNotifyWire = {
          behavior: newBehavior,
          reason,
          triggeredBy: 'pheromone_analysis',
          confidence,
          timestamp: Date.now(),
        };
        this.sendMessage(ConsciousnessMessageType.EMERGENCE_NOTIFY, wire);
      }

      // Notify local listeners
      for (const listener of this.emergenceListeners) {
        try { listener(event); } catch {}
      }
    }
  }

  // ── Internal Wiring ──

  private wireInternals(): void {
    // When quorum is reached, deposit corresponding pheromone
    // (reinforcement loop: quorum → pheromone → stronger signal)
    this.quorum.onEvent((event) => {
      if (event.kind === 'threshold_reached') {
        if (event.signalType === 'threat_detected') {
          this.pheromones.deposit(PheromoneType.DANGER, 0.9);
        } else if (event.signalType === 'compute_success') {
          this.pheromones.deposit(PheromoneType.COMPUTE_SUCCESS, 0.5);
        }
      }
    });
  }
}

// ─── Status Type ───

export interface ConsciousnessStatus {
  behavior: MeshBehavior;
  pheromoneCount: number;
  dominantPheromone: any;
  quorumStates: any[];
  activeDecisions: number;
  decidedCount: number;
  stats: {
    pheromones: any;
    quorum: any;
    swarm: any;
  };
}

// ─── Exports ───

export { PheromoneField, PheromoneEvent } from './pheromone-field';
export { QuorumSensor, QuorumEvent } from './quorum-sensor';
export { SwarmDecisionEngine, SwarmDecisionEvent, calculateSampleWeight } from './swarm-decision';
export type { SampleWeightFactors } from './swarm-decision';
export type { ConcentrationReading } from './pheromone-field';
