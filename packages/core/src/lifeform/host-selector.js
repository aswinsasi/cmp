"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostSelector = void 0;
const DEFAULT_REQUIREMENTS = {
    minMemoryMb: 64,
    minStorageMb: 10,
    minReputation: 2000,
    requirePluggedIn: false,
};
class HostSelector {
    requirements;
    constructor(requirements) {
        this.requirements = { ...DEFAULT_REQUIREMENTS, ...requirements };
    }
    /**
     * Select the best host from a list of candidates.
     * Returns scored candidates sorted by score (highest first).
     * Returns empty array if no candidates meet requirements.
     */
    selectHost(candidates) {
        const eligible = candidates.filter(c => this.meetsRequirements(c));
        if (eligible.length === 0)
            return [];
        const scored = eligible.map(c => this.scoreCandidate(c));
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }
    /**
     * Select the single best host.
     */
    selectBest(candidates) {
        const scored = this.selectHost(candidates);
        return scored.length > 0 ? scored[0] : null;
    }
    /**
     * Select N hosts for replication.
     */
    selectReplicas(candidates, count, excludeHost) {
        const filtered = excludeHost
            ? candidates.filter(c => c.deviceId !== excludeHost)
            : candidates;
        const scored = this.selectHost(filtered);
        return scored.slice(0, count);
    }
    /**
     * Check if a candidate meets minimum requirements.
     */
    meetsRequirements(candidate) {
        if (candidate.availableMemMb < this.requirements.minMemoryMb)
            return false;
        if (candidate.scratchMb < this.requirements.minStorageMb)
            return false;
        if (candidate.reputation < this.requirements.minReputation)
            return false;
        if (candidate.currentLifeformCount >= candidate.maxLifeforms)
            return false;
        if (candidate.throttled)
            return false;
        if (candidate.batteryPct < 10)
            return false;
        if (this.requirements.requirePluggedIn && !candidate.pluggedIn)
            return false;
        return true;
    }
    /**
     * Score a candidate (0.0 to 1.0).
     */
    scoreCandidate(candidate) {
        const reasons = [];
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
        }
        else {
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
exports.HostSelector = HostSelector;
//# sourceMappingURL=host-selector.js.map