"use strict";
/**
 * CMP Device Profiler
 * Collects real-time hardware metrics from the host device
 * and builds a CMPCapability profile for mesh advertisement.
 *
 * Platform: Node.js (desktop/server). Mobile profiler extends this.
 *
 * @module layers/profiler
 * @author Agent Viscro
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceProfiler = void 0;
const os_1 = __importDefault(require("os"));
const capability_1 = require("../types/capability");
const crypto_1 = require("../crypto");
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('Profiler');
const DEFAULT_PROFILER_CONFIG = {
    maxResourceShare: 0.5,
    refreshIntervalMs: capability_1.CAPABILITY_REFRESH_MS,
};
class DeviceProfiler {
    config;
    lastProfile;
    refreshTimer;
    onChangeCallbacks = [];
    constructor(config = {}) {
        this.config = { ...DEFAULT_PROFILER_CONFIG, ...config };
    }
    /**
     * Take a snapshot of current device capabilities.
     */
    async profile(meshId) {
        const cpu = this.profileCPU();
        const memory = this.profileMemory();
        const gpu = this.profileGPU();
        const storage = await this.profileStorage();
        const power = this.profilePower();
        const runtimes = this.detectRuntimes();
        const capability = {
            meshId,
            cpu,
            memory,
            gpu,
            storage,
            network: { meshBandwidthMbps: 0, latencyMs: 0 }, // Set per-peer later
            power,
            runtimes,
            reputationScore: 5000, // Loaded from ledger externally
            availabilitySec: this.estimateAvailability(power),
        };
        // Apply resource sharing cap
        capability.cpu.coresAvailable = Math.max(1, Math.floor(capability.cpu.coresAvailable * this.config.maxResourceShare));
        capability.memory.availableMb = Math.floor(capability.memory.availableMb * this.config.maxResourceShare);
        const prev = this.lastProfile;
        this.lastProfile = capability;
        if (prev && this.hasSignificantChange(prev, capability)) {
            log.debug('Significant capability change detected');
            this.notifyChange(capability);
        }
        return capability;
    }
    /**
     * Get the last profiled capability without re-profiling.
     */
    getLastProfile() {
        return this.lastProfile;
    }
    /**
     * Classify the current device into a capability tier.
     */
    getTier() {
        return this.lastProfile ? (0, capability_1.classifyTier)(this.lastProfile) : undefined;
    }
    /**
     * Generate a hash of current capabilities for beacon advertisement.
     */
    getCapabilityHash() {
        if (!this.lastProfile) {
            return new Uint8Array(8);
        }
        // Hash a summary of key metrics
        const summary = JSON.stringify({
            cores: this.lastProfile.cpu.coresAvailable,
            mem: this.lastProfile.memory.availableMb,
            gpu: this.lastProfile.gpu.type,
            runtimes: this.lastProfile.runtimes,
        });
        return (0, crypto_1.hash64)(new TextEncoder().encode(summary));
    }
    /**
     * Start periodic refresh and change detection.
     */
    startAutoRefresh(meshId) {
        this.stopAutoRefresh();
        this.refreshTimer = setInterval(async () => {
            await this.profile(meshId);
        }, this.config.refreshIntervalMs);
    }
    /**
     * Stop periodic refresh.
     */
    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }
    /**
     * Register a callback for significant capability changes.
     */
    onChange(callback) {
        this.onChangeCallbacks.push(callback);
    }
    // ── CPU Profiling ──
    profileCPU() {
        const cpus = os_1.default.cpus();
        const loadAvg = os_1.default.loadavg()[0]; // 1-min average
        const totalCores = cpus.length;
        const loadPercent = Math.min(100, Math.round((loadAvg / totalCores) * 100));
        // Available cores = total minus estimated busy cores
        const busyCores = Math.ceil(loadAvg);
        const availableCores = Math.max(1, totalCores - busyCores);
        return {
            architecture: this.detectArchitecture(),
            coresAvailable: availableCores,
            clockMhz: cpus[0]?.speed || 0,
            loadPercent,
        };
    }
    detectArchitecture() {
        const arch = os_1.default.arch();
        switch (arch) {
            case 'arm64':
                return capability_1.Architecture.ARM64;
            case 'x64':
                return capability_1.Architecture.X86_64;
            case 'riscv64':
                return capability_1.Architecture.RISCV;
            default:
                return capability_1.Architecture.WASM; // Fallback to WASM-only
        }
    }
    // ── Memory Profiling ──
    profileMemory() {
        const freeMem = os_1.default.freemem();
        const totalMem = os_1.default.totalmem();
        return {
            availableMb: Math.round(freeMem / (1024 * 1024)),
            bandwidthGbps: this.estimateMemBandwidth(),
        };
    }
    estimateMemBandwidth() {
        // Rough estimate based on architecture
        const arch = os_1.default.arch();
        switch (arch) {
            case 'arm64':
                return 25; // LPDDR5 typical
            case 'x64':
                return 40; // DDR4/DDR5 typical
            default:
                return 10;
        }
    }
    // ── GPU Profiling ──
    profileGPU() {
        // Node.js has no native GPU detection.
        // In production, this would use native modules (vulkan-info, nvidia-smi).
        // For now, return NONE with basic detection heuristics.
        const platform = os_1.default.platform();
        const arch = os_1.default.arch();
        // Heuristic: ARM64 likely has mobile GPU or NPU
        if (arch === 'arm64') {
            return {
                type: capability_1.GPUType.MOBILE,
                computeUnits: 4,
                vramMb: 0, // Shared memory on mobile
                supports: new Set([capability_1.GPUFeature.FLOAT16, capability_1.GPUFeature.INT8]),
            };
        }
        // Desktop: assume discrete GPU might be present
        // Real implementation would probe via native module
        return {
            type: capability_1.GPUType.NONE,
            computeUnits: 0,
            vramMb: 0,
            supports: new Set(),
        };
    }
    // ── Storage Profiling ──
    async profileStorage() {
        // Estimate scratch space: use 10% of free memory as temp space cap
        const freeMem = os_1.default.freemem();
        const scratchMb = Math.min(1024, Math.round(freeMem / (1024 * 1024) * 0.1));
        return {
            scratchMb,
            readMbps: 500, // Conservative SSD estimate
            writeMbps: 200,
        };
    }
    // ── Power Profiling ──
    profilePower() {
        // Node.js has no native battery API.
        // Desktop is assumed plugged in.
        // Mobile profiler overrides this.
        return {
            source: capability_1.PowerSource.PLUGGED,
            batteryPct: 100,
            thermalState: capability_1.ThermalState.NOMINAL,
        };
    }
    // ── Runtime Detection ──
    detectRuntimes() {
        const runtimes = [capability_1.Runtime.WASM]; // WASM always supported
        // Detect architecture-specific native runtime
        const arch = os_1.default.arch();
        if (arch === 'arm64') {
            runtimes.push(capability_1.Runtime.NATIVE_ARM);
        }
        else if (arch === 'x64') {
            runtimes.push(capability_1.Runtime.NATIVE_X86);
        }
        // Add user-specified runtimes
        if (this.config.additionalRuntimes) {
            for (const rt of this.config.additionalRuntimes) {
                if (!runtimes.includes(rt)) {
                    runtimes.push(rt);
                }
            }
        }
        return runtimes;
    }
    // ── Availability Estimation ──
    estimateAvailability(power) {
        if (power.source === capability_1.PowerSource.PLUGGED) {
            return 3600; // 1 hour if plugged in
        }
        if (power.source === capability_1.PowerSource.SOLAR) {
            return 1800; // 30 min for solar (variable)
        }
        // Battery: proportional estimate, max 30 min
        return Math.round((power.batteryPct / 100) * 1800);
    }
    // ── Change Detection ──
    /**
     * Check if capability changed significantly enough to warrant a re-broadcast.
     */
    hasSignificantChange(prev, curr) {
        const cpuDelta = Math.abs(prev.cpu.loadPercent - curr.cpu.loadPercent);
        const memDelta = Math.abs(prev.memory.availableMb - curr.memory.availableMb);
        const coreDelta = prev.cpu.coresAvailable !== curr.cpu.coresAvailable;
        const thermalChange = prev.power.thermalState !== curr.power.thermalState;
        const powerChange = prev.power.source !== curr.power.source;
        return (cpuDelta > capability_1.CAPABILITY_CPU_DELTA ||
            memDelta > capability_1.CAPABILITY_MEM_DELTA_MB ||
            coreDelta ||
            thermalChange ||
            powerChange);
    }
    notifyChange(cap) {
        for (const cb of this.onChangeCallbacks) {
            try {
                cb(cap);
            }
            catch (err) {
                log.error('Change callback error', err);
            }
        }
    }
    /**
     * Destroy and stop all background tasks.
     */
    destroy() {
        this.stopAutoRefresh();
        this.onChangeCallbacks = [];
        this.lastProfile = undefined;
    }
}
exports.DeviceProfiler = DeviceProfiler;
//# sourceMappingURL=profiler.js.map