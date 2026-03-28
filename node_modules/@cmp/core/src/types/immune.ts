/**
 * CMP v1.3 — Mesh Immune System Type Definitions
 * Adaptive defense system: threat detection, antibody generation,
 * quarantine management, and cross-mesh immune sharing.
 *
 * @module types/immune
 * @author Agent Viscro
 */

// ─── Threat Types ───

export enum ThreatType {
  RESULT_POISONING = 'result_poisoning',
  CAPABILITY_FRAUD = 'capability_fraud',
  TASK_SINKHOLE = 'task_sinkhole',
  BEACON_FLOODING = 'beacon_flooding',
  SYBIL_ATTACK = 'sybil_attack',
  DATA_EXFILTRATION = 'data_exfiltration',
  PROTOCOL_ABUSE = 'protocol_abuse',
  TIMING_ATTACK = 'timing_attack',
  REPUTATION_GAMING = 'reputation_gaming',
  ANOMALOUS = 'anomalous',
}

export enum ThreatSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface ThreatEvent {
  id: string;
  type: ThreatType;
  severity: ThreatSeverity;
  suspectId: Uint8Array;
  evidence: ThreatEvidence;
  detectedAt: number;
  detectionMethod: DetectionMethod;
}

export interface ThreatEvidence {
  description: string;
  dataPoints: Array<{ key: string; expected: string; actual: string }>;
  incidentCount: number;
  observationWindowMs: number;
  confidence: number;
}

export enum DetectionMethod {
  REDUNDANT_MISMATCH = 'redundant_mismatch',
  STATISTICAL_ANOMALY = 'statistical_anomaly',
  ANTIBODY_MATCH = 'antibody_match',
  RATE_VIOLATION = 'rate_violation',
  CAPABILITY_MISMATCH = 'capability_mismatch',
}

// ─── Antibody Types ───

export interface Antibody {
  id: string;
  threatType: ThreatType;
  signature: BehavioralSignature;
  severity: ThreatSeverity;
  activationCount: number;
  createdAt: number;
  lastActivatedAt: number;
  originMeshFingerprint: string;
  falsePositiveCount: number;
  confidence: number;
  expiresAt: number;
}

export interface BehavioralSignature {
  rules: SignatureRule[];
}

export interface SignatureRule {
  metric: SignatureMetric;
  operator: 'gt' | 'lt' | 'eq' | 'between' | 'pattern';
  value: number | [number, number] | string;
  windowMs: number;
}

export enum SignatureMetric {
  RESULT_ERROR_RATE = 'result_error_rate',
  TIMEOUT_RATE = 'timeout_rate',
  CAPABILITY_HONESTY = 'capability_honesty',
  BEACON_RATE = 'beacon_rate',
  IDENTITY_MULTIPLICITY = 'identity_multiplicity',
  BID_TIMING_VARIANCE = 'bid_timing_variance',
  CHERRY_PICK_RATIO = 'cherry_pick_ratio',
  REPUTATION_VELOCITY = 'reputation_velocity',
}

// ─── Quarantine Types ───

export enum QuarantineLevel {
  WATCH = 'watch',
  RESTRICTED = 'restricted',
  EXPELLED = 'expelled',
}

export interface QuarantineEntry {
  deviceId: Uint8Array;
  level: QuarantineLevel;
  triggeredBy: string;
  startedAt: number;
  expiresAt: number;
  appealable: boolean;
}

// ─── Config ───

export interface ImmuneSystemConfig {
  /** Minimum incidents before generating antibody (default: 3) */
  minIncidentsForAntibody: number;
  /** Antibody TTL if never activated (ms, default: 7 days) */
  antibodyTtlMs: number;
  /** Quarantine duration for MEDIUM threats (ms, default: 1 hour) */
  mediumQuarantineDurationMs: number;
  /** Quarantine duration for HIGH threats (ms, default: 24 hours) */
  highQuarantineDurationMs: number;
  /** Maximum false positives before antibody is disabled (default: 5) */
  maxFalsePositives: number;
  /** Enable antibody sharing via Pollinator (default: true) */
  enablePollinatedImmunity: boolean;
  /** Minimum confidence to share antibody via Pollinator (default: 0.8) */
  minShareConfidence: number;
}

// ─── Device Behavior Tracking ───

export interface DeviceBehaviorRecord {
  deviceId: string;
  totalTasksAssigned: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksTimedOut: number;
  resultMismatches: number;
  beaconsReceived: number;
  lastBeaconAt: number;
  bidTimings: number[];
  highValueTasksAccepted: number;
  lowValueTasksRejected: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

// ─── Wire Protocol ───

export enum ImmuneMessageType {
  ANTIBODY_OFFER = 0x90,
  ANTIBODY_REQUEST = 0x91,
  ANTIBODY_TRANSFER = 0x92,
  QUARANTINE_NOTIFY = 0x93,
}
