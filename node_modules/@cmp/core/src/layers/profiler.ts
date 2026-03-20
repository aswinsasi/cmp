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

import os from 'os';
import {
  CMPCapability,
  CPUInfo,
  MemoryInfo,
  GPUInfo,
  StorageInfo,
  NetworkInfo,
  PowerInfo,
  Architecture,
  GPUType,
  GPUFeature,
  PowerSource,
  ThermalState,
  Runtime,
  CapabilityTier,
  classifyTier,
  CAPABILITY_REFRESH_MS,
  CAPABILITY_CPU_DELTA,
  CAPABILITY_MEM_DELTA_MB,
} from '../types/capability';
import { MeshId } from '../types/primitives';
import { hash64 } from '../crypto';
import { Hash64 } from '../types/primitives';
import { Logger } from '../utils/logger';

const log = new Logger('Profiler');

export interface ProfilerConfig {
  /** Maximum fraction of device resources to advertise (0.0-1.0) */
  maxResourceShare: number;
  /** Refresh interval in ms */
  refreshIntervalMs: number;
  /** Custom runtimes to advertise beyond auto-detected */
  additionalRuntimes?: Runtime[];
}

const DEFAULT_PROFILER_CONFIG: ProfilerConfig = {
  maxResourceShare: 0.5,
  refreshIntervalMs: CAPABILITY_REFRESH_MS,
};

export class DeviceProfiler {
  private config: ProfilerConfig;
  private lastProfile?: CMPCapability;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private onChangeCallbacks: Array<(cap: CMPCapability) => void> = [];

  constructor(config: Partial<ProfilerConfig> = {}) {
    this.config = { ...DEFAULT_PROFILER_CONFIG, ...config };
  }

  /**
   * Take a snapshot of current device capabilities.
   */
  async profile(meshId: MeshId): Promise<CMPCapability> {
    const cpu = this.profileCPU();
    const memory = this.profileMemory();
    const gpu = this.profileGPU();
    const storage = await this.profileStorage();
    const power = this.profilePower();
    const runtimes = this.detectRuntimes();

    const capability: CMPCapability = {
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
    capability.cpu.coresAvailable = Math.max(
      1,
      Math.floor(capability.cpu.coresAvailable * this.config.maxResourceShare)
    );
    capability.memory.availableMb = Math.floor(
      capability.memory.availableMb * this.config.maxResourceShare
    );

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
  getLastProfile(): CMPCapability | undefined {
    return this.lastProfile;
  }

  /**
   * Classify the current device into a capability tier.
   */
  getTier(): CapabilityTier | undefined {
    return this.lastProfile ? classifyTier(this.lastProfile) : undefined;
  }

  /**
   * Generate a hash of current capabilities for beacon advertisement.
   */
  getCapabilityHash(): Hash64 {
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
    return hash64(new TextEncoder().encode(summary));
  }

  /**
   * Start periodic refresh and change detection.
   */
  startAutoRefresh(meshId: MeshId): void {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(async () => {
      await this.profile(meshId);
    }, this.config.refreshIntervalMs);
  }

  /**
   * Stop periodic refresh.
   */
  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Register a callback for significant capability changes.
   */
  onChange(callback: (cap: CMPCapability) => void): void {
    this.onChangeCallbacks.push(callback);
  }

  // ── CPU Profiling ──

  private profileCPU(): CPUInfo {
    const cpus = os.cpus();
    const loadAvg = os.loadavg()[0]; // 1-min average
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

  private detectArchitecture(): Architecture {
    const arch = os.arch();
    switch (arch) {
      case 'arm64':
        return Architecture.ARM64;
      case 'x64':
        return Architecture.X86_64;
      case 'riscv64':
        return Architecture.RISCV;
      default:
        return Architecture.WASM; // Fallback to WASM-only
    }
  }

  // ── Memory Profiling ──

  private profileMemory(): MemoryInfo {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();

    return {
      availableMb: Math.round(freeMem / (1024 * 1024)),
      bandwidthGbps: this.estimateMemBandwidth(),
    };
  }

  private estimateMemBandwidth(): number {
    // Rough estimate based on architecture
    const arch = os.arch();
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

  private profileGPU(): GPUInfo {
    // Node.js has no native GPU detection.
    // In production, this would use native modules (vulkan-info, nvidia-smi).
    // For now, return NONE with basic detection heuristics.

    const platform = os.platform();
    const arch = os.arch();

    // Heuristic: ARM64 likely has mobile GPU or NPU
    if (arch === 'arm64') {
      return {
        type: GPUType.MOBILE,
        computeUnits: 4,
        vramMb: 0, // Shared memory on mobile
        supports: new Set<GPUFeature>([GPUFeature.FLOAT16, GPUFeature.INT8]),
      };
    }

    // Desktop: assume discrete GPU might be present
    // Real implementation would probe via native module
    return {
      type: GPUType.NONE,
      computeUnits: 0,
      vramMb: 0,
      supports: new Set<GPUFeature>(),
    };
  }

  // ── Storage Profiling ──

  private async profileStorage(): Promise<StorageInfo> {
    // Estimate scratch space: use 10% of free memory as temp space cap
    const freeMem = os.freemem();
    const scratchMb = Math.min(1024, Math.round(freeMem / (1024 * 1024) * 0.1));

    return {
      scratchMb,
      readMbps: 500, // Conservative SSD estimate
      writeMbps: 200,
    };
  }

  // ── Power Profiling ──

  private profilePower(): PowerInfo {
    // Node.js has no native battery API.
    // Desktop is assumed plugged in.
    // Mobile profiler overrides this.
    return {
      source: PowerSource.PLUGGED,
      batteryPct: 100,
      thermalState: ThermalState.NOMINAL,
    };
  }

  // ── Runtime Detection ──

  private detectRuntimes(): Runtime[] {
    const runtimes: Runtime[] = [Runtime.WASM]; // WASM always supported

    // Detect architecture-specific native runtime
    const arch = os.arch();
    if (arch === 'arm64') {
      runtimes.push(Runtime.NATIVE_ARM);
    } else if (arch === 'x64') {
      runtimes.push(Runtime.NATIVE_X86);
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

  private estimateAvailability(power: PowerInfo): number {
    if (power.source === PowerSource.PLUGGED) {
      return 3600; // 1 hour if plugged in
    }
    if (power.source === PowerSource.SOLAR) {
      return 1800; // 30 min for solar (variable)
    }
    // Battery: proportional estimate, max 30 min
    return Math.round((power.batteryPct / 100) * 1800);
  }

  // ── Change Detection ──

  /**
   * Check if capability changed significantly enough to warrant a re-broadcast.
   */
  hasSignificantChange(prev: CMPCapability, curr: CMPCapability): boolean {
    const cpuDelta = Math.abs(prev.cpu.loadPercent - curr.cpu.loadPercent);
    const memDelta = Math.abs(prev.memory.availableMb - curr.memory.availableMb);
    const coreDelta = prev.cpu.coresAvailable !== curr.cpu.coresAvailable;
    const thermalChange = prev.power.thermalState !== curr.power.thermalState;
    const powerChange = prev.power.source !== curr.power.source;

    return (
      cpuDelta > CAPABILITY_CPU_DELTA ||
      memDelta > CAPABILITY_MEM_DELTA_MB ||
      coreDelta ||
      thermalChange ||
      powerChange
    );
  }

  private notifyChange(cap: CMPCapability): void {
    for (const cb of this.onChangeCallbacks) {
      try {
        cb(cap);
      } catch (err) {
        log.error('Change callback error', err);
      }
    }
  }

  /**
   * Destroy and stop all background tasks.
   */
  destroy(): void {
    this.stopAutoRefresh();
    this.onChangeCallbacks = [];
    this.lastProfile = undefined;
  }
}
