"use strict";
/**
 * CMP Capability Types
 * Layer 2: Device resource profiles and capability classification.
 *
 * @module types/capability
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPABILITY_MEM_DELTA_MB = exports.CAPABILITY_CPU_DELTA = exports.CAPABILITY_REFRESH_MS = exports.GPUFeature = exports.CapabilityTier = exports.Runtime = exports.ThermalState = exports.PowerSource = exports.GPUType = exports.Architecture = void 0;
exports.classifyTier = classifyTier;
var Architecture;
(function (Architecture) {
    Architecture[Architecture["ARM64"] = 0] = "ARM64";
    Architecture[Architecture["X86_64"] = 1] = "X86_64";
    Architecture[Architecture["RISCV"] = 2] = "RISCV";
    Architecture[Architecture["WASM"] = 3] = "WASM";
})(Architecture || (exports.Architecture = Architecture = {}));
var GPUType;
(function (GPUType) {
    GPUType[GPUType["NONE"] = 0] = "NONE";
    GPUType[GPUType["MOBILE"] = 1] = "MOBILE";
    GPUType[GPUType["DISCRETE"] = 2] = "DISCRETE";
    GPUType[GPUType["NPU"] = 3] = "NPU";
})(GPUType || (exports.GPUType = GPUType = {}));
var PowerSource;
(function (PowerSource) {
    PowerSource[PowerSource["BATTERY"] = 0] = "BATTERY";
    PowerSource[PowerSource["PLUGGED"] = 1] = "PLUGGED";
    PowerSource[PowerSource["SOLAR"] = 2] = "SOLAR";
})(PowerSource || (exports.PowerSource = PowerSource = {}));
var ThermalState;
(function (ThermalState) {
    ThermalState[ThermalState["NOMINAL"] = 0] = "NOMINAL";
    ThermalState[ThermalState["WARM"] = 1] = "WARM";
    ThermalState[ThermalState["THROTTLED"] = 2] = "THROTTLED";
})(ThermalState || (exports.ThermalState = ThermalState = {}));
var Runtime;
(function (Runtime) {
    Runtime[Runtime["WASM"] = 0] = "WASM";
    Runtime[Runtime["DOCKER_LITE"] = 1] = "DOCKER_LITE";
    Runtime[Runtime["NATIVE_ARM"] = 2] = "NATIVE_ARM";
    Runtime[Runtime["NATIVE_X86"] = 3] = "NATIVE_X86";
    Runtime[Runtime["ONNX"] = 4] = "ONNX";
    Runtime[Runtime["TF_LITE"] = 5] = "TF_LITE";
})(Runtime || (exports.Runtime = Runtime = {}));
var CapabilityTier;
(function (CapabilityTier) {
    CapabilityTier[CapabilityTier["T1_MINIMAL"] = 1] = "T1_MINIMAL";
    CapabilityTier[CapabilityTier["T2_BASIC"] = 2] = "T2_BASIC";
    CapabilityTier[CapabilityTier["T3_STANDARD"] = 3] = "T3_STANDARD";
    CapabilityTier[CapabilityTier["T4_POWER"] = 4] = "T4_POWER";
    CapabilityTier[CapabilityTier["T5_HEAVY"] = 5] = "T5_HEAVY";
})(CapabilityTier || (exports.CapabilityTier = CapabilityTier = {}));
var GPUFeature;
(function (GPUFeature) {
    GPUFeature["FLOAT16"] = "FLOAT16";
    GPUFeature["FLOAT32"] = "FLOAT32";
    GPUFeature["INT8"] = "INT8";
    GPUFeature["WASM_SIMD"] = "WASM_SIMD";
})(GPUFeature || (exports.GPUFeature = GPUFeature = {}));
/** Refresh capability exchange interval (ms) */
exports.CAPABILITY_REFRESH_MS = 10000;
/** Significant change thresholds that trigger a refresh */
exports.CAPABILITY_CPU_DELTA = 20;
exports.CAPABILITY_MEM_DELTA_MB = 256;
/**
 * Classify a device into a capability tier based on its profile.
 */
function classifyTier(cap) {
    const mem = cap.memory.availableMb;
    const cores = cap.cpu.coresAvailable;
    const hasGPU = cap.gpu.type !== GPUType.NONE;
    if (mem < 1024 && cores <= 2)
        return CapabilityTier.T1_MINIMAL;
    if (mem < 4096 && cores <= 4)
        return CapabilityTier.T2_BASIC;
    if (mem < 8192 && hasGPU)
        return CapabilityTier.T3_STANDARD;
    if (mem < 16384 && hasGPU)
        return CapabilityTier.T4_POWER;
    return CapabilityTier.T5_HEAVY;
}
//# sourceMappingURL=capability.js.map