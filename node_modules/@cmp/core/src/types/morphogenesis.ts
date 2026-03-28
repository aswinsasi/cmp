/**
 * CMP v1.3 — Mesh Morphogenesis Type Definitions
 * As meshes grow beyond ~15 devices, they self-organize into specialized
 * sub-meshes called "organs" based on workload affinity. Devices that
 * frequently execute the same task types cluster together using
 * chemical-gradient-inspired "morphogen signals."
 *
 * @module types/morphogenesis
 * @author Agent Viscro
 */

import { TaskType } from './task';

// ─── Device Affinity ───

export interface DeviceAffinity {
  /** Device mesh ID (hex) */
  deviceId: string;
  /** Task type → affinity score (0.0 to 1.0) */
  affinities: Map<TaskType, number>;
  /** Strongest affinity */
  primaryAffinity: TaskType;
  /** Affinity strength: 0.0 = generalist, 1.0 = pure specialist */
  specializationScore: number;
  /** Last updated */
  updatedAt: number;
}

// ─── Organ ───

export interface Organ {
  /** Unique organ ID */
  id: Uint8Array;                    // 16 bytes
  /** Task type this organ specializes in */
  specialization: TaskType;
  /** Member device mesh IDs (hex) */
  members: Set<string>;
  /** Formation timestamp */
  formedAt: number;
  /** Organ health: 0.0 (dissolving) to 1.0 (thriving) */
  health: number;
  /** Number of tasks routed through this organ */
  tasksProcessed: number;
  /** Average processing time for specialized tasks */
  avgProcessingTimeMs: number;
  /** Morphogen concentration (signal strength) */
  morphogenConcentration: number;
}

// ─── Morphogen Signal ───

export interface MorphogenSignal {
  /** Signal emitter device (hex) */
  emitterId: string;
  /** Task type attracting */
  taskType: TaskType;
  /** Signal strength (0.0 to 1.0, decays with distance/hops) */
  concentration: number;
  /** Organ ID this signal belongs to (hex, or null for formation signals) */
  organId: string | null;
  /** Hop count (decrements, signal expires at 0) */
  ttl: number;
  /** Timestamp */
  emittedAt: number;
}

// ─── Organ Events ───

export enum OrganEvent {
  FORMING = 'forming',
  DEVICE_JOINED = 'device_joined',
  DEVICE_LEFT = 'device_left',
  MERGING = 'merging',
  DISSOLVING = 'dissolving',
  ACTIVE = 'active',
}

// ─── Config ───

export interface MorphogenesisConfig {
  /** Minimum devices to form an organ (default: 3) */
  minOrganSize: number;
  /** Minimum specialization score to be considered for organ (default: 0.6) */
  minSpecializationScore: number;
  /** Morphogen signal interval (ms, default: 10000) */
  signalIntervalMs: number;
  /** Morphogen decay rate per hop (default: 0.3 — loses 30% per hop) */
  morphogenDecayRate: number;
  /** Maximum TTL for morphogen signals (default: 5 hops) */
  maxMorphogenTtl: number;
  /** Organ dissolution threshold — health below this dissolves (default: 0.2) */
  dissolutionThreshold: number;
  /** Minimum tasks to consider organ "active" (default: 10) */
  minTasksForActive: number;
  /** Affinity decay rate per hour of inactivity (default: 0.05) */
  affinityDecayRate: number;
}

// ─── Wire Protocol ───

export enum MorphogenMessageType {
  MORPHOGEN_SIGNAL = 0xB0,
  ORGAN_ANNOUNCE = 0xB1,
  ORGAN_JOIN = 0xB2,
  ORGAN_ACK = 0xB3,
  ORGAN_ROUTE = 0xB4,
}
