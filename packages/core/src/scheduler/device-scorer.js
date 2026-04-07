"use strict";
/**
 * CMP v4.0 — Device Scorer
 *
 * Ranks mesh devices for a given task using a weighted scoring formula.
 * Each device gets a score from 0.0 to 1.0 based on:
 *
 *   score = cpuScore     * 0.25
 *         + memScore     * 0.15
 *         + gpuScore     * 0.15
 *         + latencyScore * 0.15
 *         + repScore     * 0.10
 *         + localityScore* 0.20
 *
 * The weights shift based on task type:
 *   - GPU tasks boost gpuScore weight
 *   - Latency-sensitive tasks boost latencyScore weight
 *   - Data-heavy tasks boost localityScore weight
 *
 * @module scheduler/device-scorer
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceScorer = exports.DEFAULT_WEIGHTS = void 0;
const logger_1 = require("../utils/logger");
const capability_1 = require("../types/capability");
const log = new logger_1.Logger('Scorer');
exports.DEFAULT_WEIGHTS = {
    cpu: 0.25,
    memory: 0.15,
    gpu: 0.15,
    latency: 0.15,
    reputation: 0.10,
    dataLocality: 0.20,
};
// ─── Device Scorer ───
class DeviceScorer {
    baseWeights;
    constructor(weights = {}) {
        this.baseWeights = { ...exports.DEFAULT_WEIGHTS, ...weights };
    }
    /**
     * Score a single device for a given task.
     */
    scoreDevice(deviceId, capability, load, hint) {
        const weights = this.adjustWeights(hint);
        const cpuScore = this.scoreCPU(capability, load);
        const memScore = this.scoreMemory(capability, load);
        const gpuScore = this.scoreGPU(capability, hint);
        const latScore = this.scoreLatency(capability);
        const repScore = this.scoreReputation(capability);
        const locScore = this.scoreDataLocality(deviceId, hint);
        const score = cpuScore * weights.cpu +
            memScore * weights.memory +
            gpuScore * weights.gpu +
            latScore * weights.latency +
            repScore * weights.reputation +
            locScore * weights.dataLocality;
        return {
            deviceId,
            score: Math.round(score * 1000) / 1000,
            breakdown: {
                cpu: Math.round(cpuScore * 100) / 100,
                memory: Math.round(memScore * 100) / 100,
                gpu: Math.round(gpuScore * 100) / 100,
                latency: Math.round(latScore * 100) / 100,
                reputation: Math.round(repScore * 100) / 100,
                dataLocality: Math.round(locScore * 100) / 100,
            },
            capability,
            load,
        };
    }
    /**
     * Score and rank multiple devices. Returns sorted (best first).
     */
    rankDevices(devices, hint) {
        const scored = devices.map(d => this.scoreDevice(d.deviceId, d.capability, d.load, hint));
        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }
    /**
     * Pick the best N devices for a task.
     */
    pickBest(devices, hint, count = 1) {
        return this.rankDevices(devices, hint).slice(0, count);
    }
    // ══════════════════════════════════════
    // Individual Scorers (0.0 - 1.0)
    // ══════════════════════════════════════
    /**
     * CPU score: more cores + lower load = higher score.
     */
    scoreCPU(cap, load) {
        if (!cap)
            return 0.3; // Unknown device — pessimistic
        // Core count factor (1-2 cores=0.3, 4=0.6, 8+=1.0)
        const coreFactor = Math.min(1.0, cap.cpu.coresAvailable / 8);
        // Load factor (100% load=0, 0% load=1.0)
        const loadPct = load?.cpuPercent ?? cap.cpu.loadPercent ?? 50;
        const loadFactor = 1.0 - (loadPct / 100);
        // Thermal penalty
        const thermalPenalty = load?.thermalState === 2 ? 0.5 : load?.thermalState === 1 ? 0.8 : 1.0;
        return coreFactor * 0.4 + loadFactor * 0.5 + thermalPenalty * 0.1;
    }
    /**
     * Memory score: more available memory = higher score.
     */
    scoreMemory(cap, load) {
        if (!cap)
            return 0.3;
        const availMb = load?.memoryAvailableMb ?? cap.memory.availableMb;
        // Memory factor (256MB=0.2, 1GB=0.5, 4GB=0.8, 8GB+=1.0)
        if (availMb >= 8192)
            return 1.0;
        if (availMb >= 4096)
            return 0.8;
        if (availMb >= 2048)
            return 0.65;
        if (availMb >= 1024)
            return 0.5;
        if (availMb >= 512)
            return 0.35;
        return 0.2;
    }
    /**
     * GPU score: higher for tasks requiring GPU, penalizes devices without.
     */
    scoreGPU(cap, hint) {
        if (!cap)
            return hint.requiresGPU ? 0.0 : 0.5;
        const gpuType = cap.gpu.type;
        if (hint.requiresGPU) {
            // GPU required: only devices with GPU score well
            if (gpuType === capability_1.GPUType.NONE)
                return 0.0;
            if (gpuType === capability_1.GPUType.DISCRETE)
                return 1.0;
            if (gpuType === capability_1.GPUType.NPU)
                return 0.85;
            if (gpuType === capability_1.GPUType.MOBILE)
                return 0.6;
            return 0.3;
        }
        // GPU not required: mild bonus for having one
        if (gpuType === capability_1.GPUType.DISCRETE)
            return 0.7;
        if (gpuType !== capability_1.GPUType.NONE)
            return 0.55;
        return 0.5;
    }
    /**
     * Latency score: lower latency = higher score.
     */
    scoreLatency(cap) {
        if (!cap)
            return 0.3;
        const latMs = cap.network.latencyMs;
        if (latMs <= 1)
            return 1.0; // Local
        if (latMs <= 5)
            return 0.9; // LAN
        if (latMs <= 20)
            return 0.7; // Fast WiFi
        if (latMs <= 50)
            return 0.5; // Slow WiFi
        if (latMs <= 100)
            return 0.3;
        return 0.1; // Very slow
    }
    /**
     * Reputation score: higher reputation = more trustworthy.
     */
    scoreReputation(cap) {
        if (!cap)
            return 0.3;
        // Reputation: 0-10000 scale, normalized to 0-1
        return Math.min(1.0, cap.reputationScore / 5000);
    }
    /**
     * Data locality score: device that holds the data scores highest.
     */
    scoreDataLocality(deviceId, hint) {
        if (!hint.dataLocationDeviceIds || hint.dataLocationDeviceIds.length === 0) {
            return 0.5; // No locality info — neutral
        }
        if (hint.dataLocationDeviceIds.includes(deviceId)) {
            return 1.0; // Data is here
        }
        return 0.1; // Data is elsewhere — moving code is cheaper
    }
    // ══════════════════════════════════════
    // Weight Adjustment
    // ══════════════════════════════════════
    /**
     * Adjust weights based on task characteristics.
     */
    adjustWeights(hint) {
        const w = { ...this.baseWeights };
        // GPU-heavy tasks: boost GPU weight, reduce others
        if (hint.requiresGPU) {
            w.gpu = 0.35;
            w.cpu = 0.15;
            w.memory = 0.10;
        }
        // Latency-sensitive: boost latency weight
        if (hint.latencySensitive) {
            w.latency = 0.25;
            w.dataLocality = 0.15;
        }
        // Large payload: boost data locality (avoid moving data)
        if (hint.payloadSizeKb > 1024) { // > 1MB
            w.dataLocality = 0.30;
            w.latency = 0.10;
        }
        // Normalize weights to sum to 1.0
        const total = w.cpu + w.memory + w.gpu + w.latency + w.reputation + w.dataLocality;
        if (total > 0 && Math.abs(total - 1.0) > 0.01) {
            w.cpu /= total;
            w.memory /= total;
            w.gpu /= total;
            w.latency /= total;
            w.reputation /= total;
            w.dataLocality /= total;
        }
        return w;
    }
}
exports.DeviceScorer = DeviceScorer;
//# sourceMappingURL=device-scorer.js.map