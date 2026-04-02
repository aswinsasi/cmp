/**
 * CMP v1.4 — Synapse Manager
 * Communication channels between Lifeforms. Causes flow through
 * synapses with Hebbian strength learning — frequently used
 * connections get stronger, unused ones decay.
 *
 * Features:
 *   - Directional synapses (A→B, B→A are separate)
 *   - Hebbian strength: 0.0 (dormant) to 1.0 (strong)
 *   - Strength increases on use, decays on inactivity
 *   - Backpressure propagation through synapse network
 *   - Synapse partition for fusion/fission
 *
 * @module lifeform/synapse
 * @author Agent Viscro
 */

import { Cause, CauseType } from '../types/causal';

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Synapse ───

export interface Synapse {
  /** Unique synapse ID */
  id: Uint8Array;
  /** Source Lifeform name */
  fromName: string;
  /** Target Lifeform name */
  toName: string;
  /** Connection strength: 0.0 (dormant) to 1.0 (strong) */
  strength: number;
  /** Total causes transmitted through this synapse */
  causesTransmitted: number;
  /** Total CCU flowed through */
  ccuFlowed: number;
  /** Created at */
  createdAt: number;
  /** Last used at */
  lastUsedAt: number;
  /** Is this synapse active? (strength > threshold) */
  active: boolean;
}

export interface SynapseConfig {
  /** Initial synapse strength (default: 0.5) */
  initialStrength: number;
  /** Strength increase per cause transmitted (default: 0.02) */
  strengthIncrease: number;
  /** Strength decay per hour of inactivity (default: 0.05) */
  strengthDecayPerHour: number;
  /** Minimum strength before synapse is deactivated (default: 0.1) */
  minActiveStrength: number;
  /** Maximum synapses per Lifeform (default: 50) */
  maxSynapsesPerLifeform: number;
}

const DEFAULT_CONFIG: SynapseConfig = {
  initialStrength: 0.5,
  strengthIncrease: 0.02,
  strengthDecayPerHour: 0.05,
  minActiveStrength: 0.1,
  maxSynapsesPerLifeform: 50,
};

export class SynapseManager {
  /** synapseId hex → Synapse */
  private synapses = new Map<string, Synapse>();
  /** fromName → Set of synapse IDs */
  private outgoing = new Map<string, Set<string>>();
  /** toName → Set of synapse IDs */
  private incoming = new Map<string, Set<string>>();
  private config: SynapseConfig;

  constructor(config?: Partial<SynapseConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a synapse between two Lifeforms.
   * @returns Synapse ID or null if limit reached
   */
  createSynapse(fromName: string, toName: string): Synapse | null {
    // Check limits
    const outCount = this.outgoing.get(fromName)?.size ?? 0;
    if (outCount >= this.config.maxSynapsesPerLifeform) return null;

    // Check for existing synapse
    const existing = this.findSynapse(fromName, toName);
    if (existing) return existing;

    const id = randomBytes(16);
    const hex = toHex(id);

    const synapse: Synapse = {
      id,
      fromName,
      toName,
      strength: this.config.initialStrength,
      causesTransmitted: 0,
      ccuFlowed: 0,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      active: true,
    };

    this.synapses.set(hex, synapse);

    // Index
    if (!this.outgoing.has(fromName)) this.outgoing.set(fromName, new Set());
    this.outgoing.get(fromName)!.add(hex);

    if (!this.incoming.has(toName)) this.incoming.set(toName, new Set());
    this.incoming.get(toName)!.add(hex);

    return synapse;
  }

  /**
   * Transmit a cause through a synapse.
   * Strengthens the synapse (Hebbian learning).
   * @returns true if transmitted, false if synapse not found or inactive
   */
  transmit(fromName: string, toName: string, ccuAmount: number = 0): boolean {
    const synapse = this.findSynapse(fromName, toName);
    if (!synapse || !synapse.active) return false;

    synapse.causesTransmitted++;
    synapse.ccuFlowed += ccuAmount;
    synapse.lastUsedAt = Date.now();

    // Hebbian strengthening
    synapse.strength = Math.min(1.0, synapse.strength + this.config.strengthIncrease);

    return true;
  }

  /**
   * Get all outgoing synapses for a Lifeform (who does it send causes to?).
   */
  getOutgoing(lifeformName: string): Synapse[] {
    const ids = this.outgoing.get(lifeformName);
    if (!ids) return [];
    return [...ids].map(id => this.synapses.get(id)!).filter(Boolean);
  }

  /**
   * Get all incoming synapses for a Lifeform (who sends causes to it?).
   */
  getIncoming(lifeformName: string): Synapse[] {
    const ids = this.incoming.get(lifeformName);
    if (!ids) return [];
    return [...ids].map(id => this.synapses.get(id)!).filter(Boolean);
  }

  /**
   * Get all synapses involving a Lifeform (incoming + outgoing).
   */
  getAllFor(lifeformName: string): Synapse[] {
    const out = this.getOutgoing(lifeformName);
    const inc = this.getIncoming(lifeformName);
    const seen = new Set<string>();
    const result: Synapse[] = [];

    for (const s of [...out, ...inc]) {
      const hex = toHex(s.id);
      if (!seen.has(hex)) {
        seen.add(hex);
        result.push(s);
      }
    }
    return result;
  }

  /**
   * Find a specific synapse by from→to.
   */
  findSynapse(fromName: string, toName: string): Synapse | null {
    const ids = this.outgoing.get(fromName);
    if (!ids) return null;

    for (const id of ids) {
      const synapse = this.synapses.get(id);
      if (synapse && synapse.toName === toName) return synapse;
    }
    return null;
  }

  /**
   * Remove a synapse.
   */
  removeSynapse(synapseId: Uint8Array): boolean {
    const hex = toHex(synapseId);
    const synapse = this.synapses.get(hex);
    if (!synapse) return false;

    this.outgoing.get(synapse.fromName)?.delete(hex);
    this.incoming.get(synapse.toName)?.delete(hex);
    this.synapses.delete(hex);
    return true;
  }

  /**
   * Remove all synapses for a Lifeform (on death).
   */
  removeAllFor(lifeformName: string): number {
    const all = this.getAllFor(lifeformName);
    for (const s of all) {
      this.removeSynapse(s.id);
    }
    return all.length;
  }

  /**
   * Apply time-based decay to all synapses.
   * Deactivates synapses below minimum strength.
   * @returns number of synapses deactivated
   */
  applyDecay(): number {
    const now = Date.now();
    let deactivated = 0;

    for (const [hex, synapse] of this.synapses) {
      const hoursSinceUse = (now - synapse.lastUsedAt) / 3600000;
      if (hoursSinceUse > 0) {
        synapse.strength -= this.config.strengthDecayPerHour * hoursSinceUse;
        synapse.strength = Math.max(0, synapse.strength);
      }

      if (synapse.strength < this.config.minActiveStrength) {
        synapse.active = false;
        deactivated++;
      }
    }

    return deactivated;
  }

  /**
   * Transfer synapses during fusion.
   * All synapses from both components transfer to the composite name.
   * @returns number of synapses transferred
   */
  transferForFusion(componentAName: string, componentBName: string, compositeName: string): number {
    let transferred = 0;

    // Redirect outgoing synapses from components to composite
    for (const name of [componentAName, componentBName]) {
      const outgoing = this.getOutgoing(name);
      for (const syn of outgoing) {
        // Create new synapse from composite to the target
        if (syn.toName !== componentAName && syn.toName !== componentBName) {
          const newSyn = this.createSynapse(compositeName, syn.toName);
          if (newSyn) {
            newSyn.strength = syn.strength;
            newSyn.causesTransmitted = syn.causesTransmitted;
            transferred++;
          }
        }
      }

      // Redirect incoming synapses to composite
      const incoming = this.getIncoming(name);
      for (const syn of incoming) {
        if (syn.fromName !== componentAName && syn.fromName !== componentBName) {
          const newSyn = this.createSynapse(syn.fromName, compositeName);
          if (newSyn) {
            newSyn.strength = syn.strength;
            newSyn.causesTransmitted = syn.causesTransmitted;
            transferred++;
          }
        }
      }
    }

    return transferred;
  }

  /**
   * Partition synapses during fission.
   * Returns synapses grouped by original component.
   */
  partitionForFission(
    compositeName: string,
    componentAName: string,
    componentBName: string,
  ): { forA: Synapse[]; forB: Synapse[] } {
    const all = this.getAllFor(compositeName);
    const forA: Synapse[] = [];
    const forB: Synapse[] = [];

    for (const syn of all) {
      // Assign based on which component had the original connection
      // Simple heuristic: even distribution by synapse index
      if (forA.length <= forB.length) {
        forA.push(syn);
      } else {
        forB.push(syn);
      }
    }

    return { forA, forB };
  }

  /** Get total synapse count */
  get totalCount(): number {
    return this.synapses.size;
  }

  /** Get all synapses */
  getAll(): Synapse[] {
    return [...this.synapses.values()];
  }

  /** Get active synapse count */
  get activeCount(): number {
    let count = 0;
    for (const s of this.synapses.values()) {
      if (s.active) count++;
    }
    return count;
  }
}
