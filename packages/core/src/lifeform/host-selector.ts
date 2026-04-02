/**
 * CMP v1.4 — Host Selector
 * Selects the optimal host device for a Lifeform based on:
 *   - Available resources (CPU, memory, storage)
 *   - Device reputation
 *   - Metabolic state (prefer ANABOLIC hosts)
 *   - Current Lifeform load on the device
 *   - Network proximity to peers
 *
 * @module lifeform/host-selector
 * @author Agent Viscro
 */

export interface HostCandidate {
  /** Device mesh ID (hex) */
  deviceId: string;
  /** Available CPU cores */
  availableCores: number;
  /** Available memory MB */
  availableMemMb: number;
  /** Available scratch storage MB */
  scratchMb: number;
  /** Device reputation (0-10000) */
  reputation: number;
  /** Number of Lifeforms already hosted */
  currentLifeformCount: number;
  /** Maximum Lifeforms this device accepts */
  maxLifeforms: number;
  /** Is the device plugged in? */
  pluggedIn: boolean;
  /** Battery percentage (0-100) */
  batteryPct: number;
  /** Is device thermally throttled? */
  throttled: boolean;
}

export interface HostRequirements {
  /** Minimum memory MB needed */
  minMemoryMb: number;
  /** Minimum storage MB */
  minStorageMb: number;
  /** Minimum reputation */
  minReputation: number;
  /** Require plugged-in host? */
  requirePluggedIn: boolean;
}

export interface HostScore {
  deviceId: string;
  score: number;
  reasons: string[];
}

const DEFAULT_REQUIREMENTS: HostRequirements = {
  minMemoryMb: 64,
  minStorageMb: 10,
  minReputation: 2000,
  requirePluggedIn: false,
};

export class HostSelector {
  private requirements: HostRequirements;

  constructor(requirements?: Partial<HostRequirements>) {
    this.requirements = { ...DEFAULT_REQUIREMENTS, ...requirements };
  }

  /**
   * Select the best host from a list of candidates.
   * Returns scored candidates sorted by score (highest first).
   * Returns empty array if no candidates meet requirements.
   */
  selectHost(candidates: HostCandidate[]): HostScore[] {
    const eligible = candidates.filter(c => this.meetsRequirements(c));
    if (eligible.length === 0) return [];

    const scored = eligible.map(c => this.scoreCandidate(c));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /**
   * Select the single best host.
   */
  selectBest(candidates: HostCandidate[]): HostScore | null {
    const scored = this.selectHost(candidates);
    return scored.length > 0 ? scored[0] : null;
  }

  /**
   * Select N hosts for replication.
   */
  selectReplicas(candidates: HostCandidate[], count: number, excludeHost?: string): HostScore[] {
    const filtered = excludeHost
      ? candidates.filter(c => c.deviceId !== excludeHost)
      : candidates;
    const scored = this.selectHost(filtered);
    return scored.slice(0, count);
  }

  /**
   * Check if a candidate meets minimum requirements.
   */
  private meetsRequirements(candidate: HostCandidate): boolean {
    if (candidate.availableMemMb < this.requirements.minMemoryMb) return false;
    if (candidate.scratchMb < this.requirements.minStorageMb) return false;
    if (candidate.reputation < this.requirements.minReputation) return false;
    if (candidate.currentLifeformCount >= candidate.maxLifeforms) return false;
    if (candidate.throttled) return false;
    if (candidate.batteryPct < 10) return false;
    if (this.requirements.requirePluggedIn && !candidate.pluggedIn) return false;
    return true;
  }

  /**
   * Score a candidate (0.0 to 1.0).
   */
  private scoreCandidate(candidate: HostCandidate): HostScore {
    const reasons: string[] = [];
    let score = 0;

    // Resource score (0.35)
    const memScore = Math.min(1, candidate.availableMemMb / 1024);
    const cpuScore = Math.min(1, candidate.availableCores / 4);
    const resourceScore = (memScore * 0.6 + cpuScore * 0.4);
    score += resourceScore * 0.35;
    reasons.push(`resources: ${(resourceScore * 100).toFixed(0)}%`);

    // Reputation score (0.25)
    const repScore = Math.min(1, candidate.reputation / 10000);
    score += repScore * 0.25;
    reasons.push(`reputation: ${(repScore * 100).toFixed(0)}%`);

    // Energy score (0.20)
    let energyScore = 0;
    if (candidate.pluggedIn) {
      energyScore = 1.0;
      reasons.push('plugged_in');
    } else {
      energyScore = candidate.batteryPct / 100;
      reasons.push(`battery: ${candidate.batteryPct}%`);
    }
    score += energyScore * 0.20;

    // Load score — prefer less loaded devices (0.20)
    const loadRatio = candidate.currentLifeformCount / Math.max(1, candidate.maxLifeforms);
    const loadScore = 1 - loadRatio;
    score += loadScore * 0.20;
    reasons.push(`load: ${candidate.currentLifeformCount}/${candidate.maxLifeforms}`);

    return { deviceId: candidate.deviceId, score, reasons };
  }
}
