/**
 * CMP v1.4 — Lifeform Lifecycle Manager
 * Manages a single Lifeform's lifecycle state machine:
 *   SPAWNING → ALIVE → MIGRATING/FUSED/HIBERNATING/DEAD
 *
 * Handles:
 *   - State transitions with validation
 *   - CCU balance tracking (earn, spend, billing)
 *   - Host tracking (primary + replicas)
 *   - Fusion/fission state sub-management
 *
 * @module lifeform/lifecycle
 * @author Agent Viscro
 */

import {
  LifeformSoul,
  LifeformState,
  LifeformConfig,
  LifeformInstance,
  FusionInfo,
} from '../types/lifeform';
import { CauseBilling, DEFAULT_CAUSE_BILLING, calculateHostingCost } from '../types/causal';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// ─── Valid state transitions ───

const VALID_TRANSITIONS: Record<LifeformState, LifeformState[]> = {
  [LifeformState.SPAWNING]:     [LifeformState.ALIVE, LifeformState.DEAD],
  [LifeformState.ALIVE]:        [LifeformState.MIGRATING, LifeformState.FUSED, LifeformState.HIBERNATING, LifeformState.DEAD],
  [LifeformState.MIGRATING]:    [LifeformState.ALIVE, LifeformState.DEAD],
  [LifeformState.FUSED]:        [LifeformState.ALIVE, LifeformState.DEAD],
  [LifeformState.HIBERNATING]:  [LifeformState.ALIVE, LifeformState.DEAD],
  [LifeformState.DEAD]:         [], // Terminal state
};

export class LifeformLifecycle {
  private instance: LifeformInstance;
  private billing: CauseBilling;

  /** State transition log */
  private transitions: Array<{
    from: LifeformState;
    to: LifeformState;
    timestamp: number;
    reason: string;
  }> = [];

  constructor(
    soul: LifeformSoul,
    config: LifeformConfig,
    hostId: Uint8Array,
    billing?: Partial<CauseBilling>,
  ) {
    this.billing = { ...DEFAULT_CAUSE_BILLING, ...billing };

    this.instance = {
      soul,
      state: LifeformState.SPAWNING,
      config,
      genomeHash: new Uint8Array(32), // Will be set when WASM loads
      hostId,
      replicaHosts: [],
      ccuBalance: config.initialCcu,
      causesProcessed: 0,
      ccuEarned: 0,
      ccuSpent: 0,
      lastActiveAt: Date.now(),
      fusionInfo: null,
    };
  }

  // ═══════════════════════════════════════
  // State Transitions
  // ═══════════════════════════════════════

  /**
   * Transition to a new state.
   * Validates the transition is allowed.
   */
  transitionTo(newState: LifeformState, reason: string = ''): boolean {
    const currentState = this.instance.state;
    const allowed = VALID_TRANSITIONS[currentState];

    if (!allowed.includes(newState)) {
      return false; // Invalid transition
    }

    this.transitions.push({
      from: currentState,
      to: newState,
      timestamp: Date.now(),
      reason,
    });

    this.instance.state = newState;

    if (newState === LifeformState.ALIVE) {
      this.instance.lastActiveAt = Date.now();
    }

    return true;
  }

  /**
   * Get current state.
   */
  get state(): LifeformState {
    return this.instance.state;
  }

  /**
   * Check if the Lifeform is in a processable state.
   */
  get isProcessable(): boolean {
    return this.instance.state === LifeformState.ALIVE ||
           this.instance.state === LifeformState.FUSED;
  }

  /**
   * Check if the Lifeform is dead.
   */
  get isDead(): boolean {
    return this.instance.state === LifeformState.DEAD;
  }

  // ═══════════════════════════════════════
  // CCU Economy
  // ═══════════════════════════════════════

  /**
   * Spend CCU (for cause execution, hosting, etc).
   * Returns false if insufficient balance.
   */
  spendCcu(amount: number, reason: string = ''): boolean {
    if (this.instance.ccuBalance < amount) return false;

    this.instance.ccuBalance -= amount;
    this.instance.ccuSpent += amount;
    return true;
  }

  /**
   * Earn CCU (from incoming causes with CCU attached, or work).
   */
  earnCcu(amount: number): void {
    this.instance.ccuBalance += amount;
    this.instance.ccuEarned += amount;
  }

  /**
   * Top up CCU from external source.
   */
  topUpCcu(amount: number): void {
    this.instance.ccuBalance += amount;
  }

  /**
   * Get current CCU balance.
   */
  get ccuBalance(): number {
    return this.instance.ccuBalance;
  }

  /**
   * Calculate and deduct hourly hosting cost.
   * Should be called periodically (e.g. every hour).
   * @returns the cost deducted, or -1 if insufficient balance (triggers death)
   */
  chargeHostingCost(stateSizeBytes: number): number {
    const cost = calculateHostingCost(this.billing, stateSizeBytes);

    if (this.instance.ccuBalance < cost) {
      // Can't afford hosting — Lifeform should die
      return -1;
    }

    this.instance.ccuBalance -= cost;
    this.instance.ccuSpent += cost;
    return cost;
  }

  /**
   * Record a cause execution.
   */
  recordCauseExecution(ccuCost: number): void {
    this.instance.causesProcessed++;
    this.instance.lastActiveAt = Date.now();
    // Always deduct — can go negative (death checked by manager)
    this.instance.ccuBalance -= ccuCost;
    this.instance.ccuSpent += ccuCost;
  }

  // ═══════════════════════════════════════
  // Fusion
  // ═══════════════════════════════════════

  /**
   * Enter fused state.
   */
  fuse(compositeId: Uint8Array, partnerId: Uint8Array, role: 'primary' | 'secondary'): boolean {
    if (!this.transitionTo(LifeformState.FUSED, `Fusion with ${toHex(partnerId).substring(0, 8)}`)) {
      return false;
    }

    this.instance.fusionInfo = {
      compositeId,
      partnerId,
      role,
      fusedAt: Date.now(),
    };

    return true;
  }

  /**
   * Exit fused state (fission).
   */
  unfuse(): boolean {
    if (this.instance.state !== LifeformState.FUSED) return false;

    this.instance.fusionInfo = null;
    return this.transitionTo(LifeformState.ALIVE, 'Fission — restored to independent');
  }

  /**
   * Get fusion info.
   */
  get fusionInfo(): FusionInfo | null {
    return this.instance.fusionInfo;
  }

  // ═══════════════════════════════════════
  // Host Management
  // ═══════════════════════════════════════

  /**
   * Update primary host (after migration).
   */
  setHost(hostId: Uint8Array): void {
    this.instance.hostId = hostId;
  }

  /**
   * Add a replica host.
   */
  addReplica(hostId: Uint8Array): void {
    const hex = toHex(hostId);
    const existing = this.instance.replicaHosts.map(h => toHex(h));
    if (!existing.includes(hex)) {
      this.instance.replicaHosts.push(hostId);
    }
  }

  /**
   * Remove a replica host.
   */
  removeReplica(hostId: Uint8Array): boolean {
    const hex = toHex(hostId);
    const idx = this.instance.replicaHosts.findIndex(h => toHex(h) === hex);
    if (idx >= 0) {
      this.instance.replicaHosts.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Get primary host ID.
   */
  get hostId(): Uint8Array {
    return this.instance.hostId;
  }

  /**
   * Get replica count.
   */
  get replicaCount(): number {
    return this.instance.replicaHosts.length;
  }

  // ═══════════════════════════════════════
  // Genome
  // ═══════════════════════════════════════

  /**
   * Set genome hash (after WASM module loaded).
   */
  setGenomeHash(hash: Uint8Array): void {
    this.instance.genomeHash = hash;
  }

  // ═══════════════════════════════════════
  // Accessors
  // ═══════════════════════════════════════

  /** Get the full instance */
  getInstance(): LifeformInstance {
    return { ...this.instance };
  }

  /** Get the soul */
  get soul(): LifeformSoul {
    return this.instance.soul;
  }

  /** Get the lifeform ID */
  get id(): Uint8Array {
    return this.instance.soul.id;
  }

  /** Get the lifeform name */
  get name(): string {
    return this.instance.soul.name;
  }

  /** Get transition log */
  getTransitions(): typeof this.transitions {
    return [...this.transitions];
  }

  /** Get total causes processed */
  get causesProcessed(): number {
    return this.instance.causesProcessed;
  }

  /** Get last active timestamp */
  get lastActiveAt(): number {
    return this.instance.lastActiveAt;
  }
}
