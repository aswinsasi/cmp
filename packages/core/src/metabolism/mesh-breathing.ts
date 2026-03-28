/**
 * CMP v1.3 — Mesh Breathing
 * Aggregates metabolic profiles from all mesh peers into a mesh-wide
 * metabolic summary. Detects whether the mesh is expanding (gaining
 * energy), contracting (losing energy), or stable.
 *
 * Provides 4-hour capacity forecast based on metabolic history.
 *
 * @module metabolism/mesh-breathing
 * @author Agent Viscro
 */

import {
  MetabolicState,
  MetabolicProfile,
  MeshMetabolicSummary,
} from '../types/metabolism';

export class MeshBreathing {
  /** peerId → latest profile */
  private profiles = new Map<string, MetabolicProfile>();

  /** Historical snapshots for capacity forecasting */
  private snapshots: Array<{ timestamp: number; totalBudget: number; efficiency: number }> = [];

  /**
   * Update a peer's metabolic profile.
   */
  updateProfile(peerId: string, profile: MetabolicProfile): void {
    this.profiles.set(peerId, profile);
  }

  /**
   * Remove a peer (left the mesh).
   */
  removeProfile(peerId: string): void {
    this.profiles.delete(peerId);
  }

  /**
   * Generate the mesh-wide metabolic summary.
   */
  getSummary(): MeshMetabolicSummary {
    const distribution: Record<MetabolicState, number> = {
      [MetabolicState.ANABOLIC]: 0,
      [MetabolicState.HOMEOSTATIC]: 0,
      [MetabolicState.CATABOLIC]: 0,
      [MetabolicState.DORMANT]: 0,
      [MetabolicState.CHARGING]: 0,
    };

    let totalBudget = 0;
    let totalEfficiency = 0;
    let totalDelta = 0;

    for (const profile of this.profiles.values()) {
      distribution[profile.state]++;
      totalBudget += profile.energyBudget;
      totalEfficiency += profile.thermalEfficiency;
      totalDelta += profile.energyDelta;
    }

    const deviceCount = this.profiles.size;
    const meshEfficiency = deviceCount > 0 ? totalEfficiency / deviceCount : 0;

    // Determine mesh phase from aggregate energy delta
    let meshPhase: 'expansion' | 'contraction' | 'stable';
    if (totalDelta > 0.1 * deviceCount) {
      meshPhase = 'expansion';
    } else if (totalDelta < -0.1 * deviceCount) {
      meshPhase = 'contraction';
    } else {
      meshPhase = 'stable';
    }

    // Record snapshot for forecasting
    const now = Date.now();
    this.snapshots.push({ timestamp: now, totalBudget, efficiency: meshEfficiency });
    // Keep last 4 hours
    const cutoff = now - 4 * 3600 * 1000;
    this.snapshots = this.snapshots.filter(s => s.timestamp >= cutoff);

    // Generate 4-hour capacity forecast (hourly buckets)
    const forecast = this.generateForecast(totalBudget, totalDelta, deviceCount);

    return {
      stateDistribution: distribution,
      totalEnergyBudget: totalBudget,
      meshEfficiency,
      capacityForecast: forecast,
      meshPhase,
    };
  }

  /**
   * Get the count of devices in each state.
   */
  getStateDistribution(): Record<MetabolicState, number> {
    return this.getSummary().stateDistribution;
  }

  /**
   * Get the total number of tracked peers.
   */
  get size(): number {
    return this.profiles.size;
  }

  /**
   * Get all profiles (for CLI display).
   */
  getAllProfiles(): Array<{ peerId: string; profile: MetabolicProfile }> {
    return [...this.profiles.entries()].map(([peerId, profile]) => ({
      peerId,
      profile,
    }));
  }

  /**
   * Clear all profiles (mesh reset).
   */
  clear(): void {
    this.profiles.clear();
    this.snapshots = [];
  }

  // ── Forecasting ──

  /**
   * Generate 4-hour capacity forecast.
   * Uses current energy delta to project forward.
   */
  private generateForecast(
    currentBudget: number,
    totalDelta: number,
    deviceCount: number,
  ): number[] {
    const forecast: number[] = [];

    for (let hour = 1; hour <= 4; hour++) {
      // Project budget forward based on delta
      let projected = currentBudget + totalDelta * hour;

      // Clamp: can't go below 0 or above deviceCount
      projected = Math.max(0, Math.min(deviceCount, projected));

      forecast.push(Math.round(projected * 100) / 100);
    }

    return forecast;
  }
}
