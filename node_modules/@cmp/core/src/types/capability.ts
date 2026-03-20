/**
 * CMP Capability Types
 * Layer 2: Device resource profiles and capability classification.
 *
 * @module types/capability
 * @author Agent Viscro
 */

import { MeshId } from './primitives';

export enum Architecture {
  ARM64 = 0,
  X86_64 = 1,
  RISCV = 2,
  WASM = 3,
}

export enum GPUType {
  NONE = 0,
  MOBILE = 1,
  DISCRETE = 2,
  NPU = 3,
}

export enum PowerSource {
  BATTERY = 0,
  PLUGGED = 1,
  SOLAR = 2,
}

export enum ThermalState {
  NOMINAL = 0,
  WARM = 1,
  THROTTLED = 2,
}

export enum Runtime {
  WASM = 0,
  DOCKER_LITE = 1,
  NATIVE_ARM = 2,
  NATIVE_X86 = 3,
  ONNX = 4,
  TF_LITE = 5,
}

export enum CapabilityTier {
  T1_MINIMAL = 1,
  T2_BASIC = 2,
  T3_STANDARD = 3,
  T4_POWER = 4,
  T5_HEAVY = 5,
}

export enum GPUFeature {
  FLOAT16 = 'FLOAT16',
  FLOAT32 = 'FLOAT32',
  INT8 = 'INT8',
  WASM_SIMD = 'WASM_SIMD',
}

export interface CPUInfo {
  architecture: Architecture;
  coresAvailable: number;
  clockMhz: number;
  loadPercent: number;
}

export interface MemoryInfo {
  availableMb: number;
  bandwidthGbps: number;
}

export interface GPUInfo {
  type: GPUType;
  computeUnits: number;
  vramMb: number;
  supports: Set<GPUFeature>;
}

export interface StorageInfo {
  /** Available scratch space for temporary computation data (MB) */
  scratchMb: number;
  readMbps: number;
  writeMbps: number;
}

export interface NetworkInfo {
  /** Bandwidth to the mesh (Mbps), measured during handshake */
  meshBandwidthMbps: number;
  /** Latency to the requesting node (ms) */
  latencyMs: number;
}

export interface PowerInfo {
  source: PowerSource;
  batteryPct: number;
  thermalState: ThermalState;
}

/**
 * Full device capability profile.
 * Exchanged after handshake and refreshed every 10 seconds.
 */
export interface CMPCapability {
  meshId: MeshId;
  cpu: CPUInfo;
  memory: MemoryInfo;
  gpu: GPUInfo;
  storage: StorageInfo;
  network: NetworkInfo;
  power: PowerInfo;
  runtimes: Runtime[];
  /** 0-10000, from incentive layer */
  reputationScore: number;
  /** Estimated seconds device will remain in mesh */
  availabilitySec: number;
}

/** Refresh capability exchange interval (ms) */
export const CAPABILITY_REFRESH_MS = 10000;

/** Significant change thresholds that trigger a refresh */
export const CAPABILITY_CPU_DELTA = 20;
export const CAPABILITY_MEM_DELTA_MB = 256;

/**
 * Classify a device into a capability tier based on its profile.
 */
export function classifyTier(cap: CMPCapability): CapabilityTier {
  const mem = cap.memory.availableMb;
  const cores = cap.cpu.coresAvailable;
  const hasGPU = cap.gpu.type !== GPUType.NONE;

  if (mem < 1024 && cores <= 2) return CapabilityTier.T1_MINIMAL;
  if (mem < 4096 && cores <= 4) return CapabilityTier.T2_BASIC;
  if (mem < 8192 && hasGPU) return CapabilityTier.T3_STANDARD;
  if (mem < 16384 && hasGPU) return CapabilityTier.T4_POWER;
  return CapabilityTier.T5_HEAVY;
}
