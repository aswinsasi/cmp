"use strict";
/**
 * CMP Capability Map
 * Aggregates capability profiles from all active mesh peers into
 * a queryable resource map. Used by the Negotiation layer to find
 * candidates for task assignment.
 *
 * @module layers/capability-map
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilityMap = void 0;
const capability_1 = require("../types/capability");
const helpers_1 = require("../utils/helpers");
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('CapMap');
class CapabilityMap {
    map = new Map();
    bus;
    constructor(bus) {
        this.bus = bus;
    }
    /**
     * Add or update a peer's capability in the map.
     */
    update(meshId, capability) {
        const hex = (0, helpers_1.toHex)(meshId);
        const isNew = !this.map.has(hex);
        this.map.set(hex, capability);
        if (isNew) {
            log.info(`Peer capability added: ${(0, helpers_1.shortId)(meshId)} [Tier ${(0, capability_1.classifyTier)(capability)}]`, {
                cores: capability.cpu.coresAvailable,
                memMb: capability.memory.availableMb,
                gpu: capability_1.GPUType[capability.gpu.type],
            });
        }
        this.bus.emit('capability:mesh_changed', {
            peerCount: this.map.size,
            totalCores: this.getTotalCores(),
        });
    }
    /**
     * Remove a peer from the capability map.
     */
    remove(meshId) {
        const hex = (0, helpers_1.toHex)(meshId);
        if (this.map.delete(hex)) {
            log.debug(`Peer capability removed: ${(0, helpers_1.shortId)(meshId)}`);
            this.bus.emit('capability:mesh_changed', {
                peerCount: this.map.size,
                totalCores: this.getTotalCores(),
            });
        }
    }
    /**
     * Get a specific peer's capability.
     */
    get(meshId) {
        return this.map.get((0, helpers_1.toHex)(meshId));
    }
    /**
     * Get capability by hex ID.
     */
    getByHex(hexId) {
        return this.map.get(hexId);
    }
    /**
     * Number of peers in the map.
     */
    get size() {
        return this.map.size;
    }
    /**
     * Get all capabilities as an array.
     */
    getAll() {
        return [...this.map.values()];
    }
    // ── Aggregate Queries ──
    /**
     * Get aggregate resource summary of the entire mesh.
     */
    getMeshResources() {
        let totalCores = 0;
        let totalMemoryMb = 0;
        let gpuDevices = 0;
        let totalReputation = 0;
        let totalLatency = 0;
        let latencyCount = 0;
        const tierDistribution = {
            [capability_1.CapabilityTier.T1_MINIMAL]: 0,
            [capability_1.CapabilityTier.T2_BASIC]: 0,
            [capability_1.CapabilityTier.T3_STANDARD]: 0,
            [capability_1.CapabilityTier.T4_POWER]: 0,
            [capability_1.CapabilityTier.T5_HEAVY]: 0,
        };
        for (const cap of this.map.values()) {
            totalCores += cap.cpu.coresAvailable;
            totalMemoryMb += cap.memory.availableMb;
            totalReputation += cap.reputationScore;
            if (cap.gpu.type !== capability_1.GPUType.NONE)
                gpuDevices++;
            if (cap.network.latencyMs > 0) {
                totalLatency += cap.network.latencyMs;
                latencyCount++;
            }
            const tier = (0, capability_1.classifyTier)(cap);
            tierDistribution[tier]++;
        }
        const peerCount = this.map.size;
        return {
            peerCount,
            totalCores,
            totalMemoryMb,
            gpuDevices,
            tierDistribution,
            avgReputationScore: peerCount > 0 ? Math.round(totalReputation / peerCount) : 0,
            avgLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
        };
    }
    /**
     * Get total CPU cores across mesh.
     */
    getTotalCores() {
        let total = 0;
        for (const cap of this.map.values()) {
            total += cap.cpu.coresAvailable;
        }
        return total;
    }
    /**
     * Get total available memory across mesh (MB).
     */
    getTotalMemoryMb() {
        let total = 0;
        for (const cap of this.map.values()) {
            total += cap.memory.availableMb;
        }
        return total;
    }
    // ── Candidate Selection ──
    /**
     * Find peers capable of fulfilling a compute budget.
     * Returns candidates sorted by descending score.
     */
    findCandidates(budget) {
        const candidates = [];
        for (const [hex, cap] of this.map) {
            // Hard filters
            if (!this.meetsBudget(cap, budget))
                continue;
            // Score
            const score = this.scoreCandidate(cap, budget);
            candidates.push({
                meshId: cap.meshId,
                capability: cap,
                tier: (0, capability_1.classifyTier)(cap),
                score,
            });
        }
        // Sort by score descending
        candidates.sort((a, b) => b.score - a.score);
        return candidates;
    }
    /**
     * Find peers at or above a minimum capability tier.
     */
    findByMinTier(minTier) {
        return this.getAll().filter((cap) => (0, capability_1.classifyTier)(cap) >= minTier);
    }
    /**
     * Find peers with a specific runtime.
     */
    findByRuntime(runtime) {
        return this.getAll().filter((cap) => cap.runtimes.includes(runtime));
    }
    /**
     * Find peers with GPU capability.
     */
    findWithGPU() {
        return this.getAll().filter((cap) => cap.gpu.type !== capability_1.GPUType.NONE);
    }
    /**
     * Find the N best candidates for a compute budget.
     */
    findTopN(budget, n) {
        return this.findCandidates(budget).slice(0, n);
    }
    // ── Scoring ──
    /**
     * Check if a device meets the minimum requirements of a compute budget.
     */
    meetsBudget(cap, budget) {
        // Must have at least 1 core
        if (cap.cpu.coresAvailable < 1)
            return false;
        // Must have enough memory for at least one chunk
        // (budget.minMemoryMb is total; per-device minimum is total/minCores)
        const perDeviceMinMem = Math.ceil(budget.minMemoryMb / Math.max(1, budget.minCores));
        if (cap.memory.availableMb < perDeviceMinMem)
            return false;
        // GPU required check
        if (budget.gpuRequired && cap.gpu.type === capability_1.GPUType.NONE)
            return false;
        // Don't assign to devices with very low battery
        if (cap.power.source === capability_1.PowerSource.BATTERY && cap.power.batteryPct < 15)
            return false;
        // Don't assign to thermally throttled devices
        if (cap.power.thermalState === capability_1.ThermalState.THROTTLED)
            return false;
        return true;
    }
    /**
     * Score a candidate for a specific compute budget.
     * Higher score = better candidate.
     *
     * Scoring weights (from protocol spec):
     *   Resource match:  40%
     *   Estimated time:  25% (approximated from CPU speed)
     *   Reputation:      20%
     *   Power stability: 15%
     */
    scoreCandidate(cap, budget) {
        // Resource match (40%) — how well does this device's resources fit the task?
        const coreFit = Math.min(1, cap.cpu.coresAvailable / Math.max(1, budget.minCores));
        const memFit = Math.min(1, cap.memory.availableMb / Math.max(1, budget.minMemoryMb));
        const gpuBonus = budget.gpuRequired && cap.gpu.type !== capability_1.GPUType.NONE ? 0.2 : 0;
        const resourceScore = ((coreFit + memFit) / 2 + gpuBonus) * 0.40;
        // Speed estimate (25%) — normalized compute power
        const computePower = cap.cpu.coresAvailable * cap.cpu.clockMhz;
        const maxExpectedPower = 16 * 4000; // 16 cores @ 4GHz
        const speedScore = Math.min(1, computePower / maxExpectedPower) * 0.25;
        // Reputation (20%)
        const repScore = (cap.reputationScore / 10000) * 0.20;
        // Power stability (15%)
        let powerScore;
        if (cap.power.source === capability_1.PowerSource.PLUGGED) {
            powerScore = 1.0;
        }
        else if (cap.power.source === capability_1.PowerSource.SOLAR) {
            powerScore = 0.6;
        }
        else {
            powerScore = cap.power.batteryPct / 100;
        }
        // Thermal penalty
        if (cap.power.thermalState === capability_1.ThermalState.WARM) {
            powerScore *= 0.7;
        }
        powerScore *= 0.15;
        return resourceScore + speedScore + repScore + powerScore;
    }
    /**
     * Check if the mesh collectively has enough resources for a budget.
     */
    canFulfill(budget) {
        const resources = this.getMeshResources();
        if (resources.totalCores < budget.minCores)
            return false;
        if (resources.totalMemoryMb < budget.minMemoryMb)
            return false;
        if (budget.gpuRequired && resources.gpuDevices === 0)
            return false;
        return true;
    }
    /**
     * Clear all entries.
     */
    clear() {
        this.map.clear();
    }
}
exports.CapabilityMap = CapabilityMap;
//# sourceMappingURL=capability-map.js.map