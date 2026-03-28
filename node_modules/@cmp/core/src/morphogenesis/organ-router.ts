/**
 * CMP v1.3 — Organ Router
 * Routes incoming task requests to the appropriate organ first.
 * If an active, healthy organ exists for the task type, tasks are
 * routed internally within the organ (abbreviated negotiation).
 * Falls back to mesh-wide negotiation if no organ or organ fails.
 *
 * @module morphogenesis/organ-router
 * @author Agent Viscro
 */

import { TaskType } from '../types/task';
import { Organ } from '../types/morphogenesis';
import { OrganManager } from './organ-manager';

export interface RouteDecision {
  /** Whether to route through an organ */
  useOrgan: boolean;
  /** The organ to route to (null if mesh-wide) */
  organ: Organ | null;
  /** Member device IDs to negotiate with (subset of mesh) */
  targetDevices: string[];
  /** Reason for the routing decision */
  reason: string;
}

export interface OrganRouterConfig {
  /** Minimum organ health to route tasks to it (default: 0.5) */
  minHealthForRouting: number;
  /** Minimum organ members for routing (default: 2) */
  minMembersForRouting: number;
  /** Timeout for organ-internal negotiation before fallback (ms, default: 2000) */
  organNegotiationTimeoutMs: number;
}

const DEFAULT_CONFIG: OrganRouterConfig = {
  minHealthForRouting: 0.5,
  minMembersForRouting: 2,
  organNegotiationTimeoutMs: 2000,
};

export class OrganRouter {
  private organManager: OrganManager;
  private config: OrganRouterConfig;

  // Stats
  private organRoutes = 0;
  private meshRoutes = 0;
  private organFallbacks = 0;

  constructor(organManager: OrganManager, config?: Partial<OrganRouterConfig>) {
    this.organManager = organManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Decide how to route a task.
   *
   * Algorithm:
   * 1. Check if an active organ exists for this taskType
   * 2. If YES and organ health > minHealthForRouting:
   *    a. Return organ route with organ members as targets
   * 3. If NO:
   *    a. Return mesh-wide route (empty targetDevices = all peers)
   */
  route(taskType: TaskType): RouteDecision {
    const organ = this.organManager.getOrganForType(taskType);

    if (organ &&
        organ.health >= this.config.minHealthForRouting &&
        organ.members.size >= this.config.minMembersForRouting) {
      this.organRoutes++;
      return {
        useOrgan: true,
        organ,
        targetDevices: [...organ.members],
        reason: `Organ ${this.shortId(organ.id)} specializes in this task type (health: ${(organ.health * 100).toFixed(0)}%)`,
      };
    }

    this.meshRoutes++;

    if (organ && organ.health < this.config.minHealthForRouting) {
      return {
        useOrgan: false,
        organ: null,
        targetDevices: [],
        reason: `Organ exists but health too low (${(organ.health * 100).toFixed(0)}% < ${(this.config.minHealthForRouting * 100).toFixed(0)}%)`,
      };
    }

    if (organ && organ.members.size < this.config.minMembersForRouting) {
      return {
        useOrgan: false,
        organ: null,
        targetDevices: [],
        reason: `Organ exists but too few members (${organ.members.size} < ${this.config.minMembersForRouting})`,
      };
    }

    return {
      useOrgan: false,
      organ: null,
      targetDevices: [],
      reason: 'No organ for this task type — mesh-wide negotiation',
    };
  }

  /**
   * Record that an organ route succeeded.
   * Updates the organ's task count and health.
   */
  recordOrganSuccess(organId: string, processingTimeMs: number): void {
    this.organManager.recordTaskProcessed(organId, processingTimeMs);
  }

  /**
   * Record that an organ route failed and fell back to mesh-wide.
   */
  recordOrganFallback(organId: string): void {
    this.organFallbacks++;
    // Reduce organ health on failure
    const organ = this.organManager.getOrgan(organId);
    if (organ) {
      organ.health = Math.max(0, organ.health - 0.1);
    }
  }

  /**
   * Get routing statistics.
   */
  getStats(): {
    organRoutes: number;
    meshRoutes: number;
    organFallbacks: number;
    organRouteRatio: number;
  } {
    const total = this.organRoutes + this.meshRoutes;
    return {
      organRoutes: this.organRoutes,
      meshRoutes: this.meshRoutes,
      organFallbacks: this.organFallbacks,
      organRouteRatio: total > 0 ? this.organRoutes / total : 0,
    };
  }

  /** Get negotiation timeout for organ-internal routing */
  getOrganTimeout(): number {
    return this.config.organNegotiationTimeoutMs;
  }

  private shortId(bytes: Uint8Array): string {
    return Array.from(bytes.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
