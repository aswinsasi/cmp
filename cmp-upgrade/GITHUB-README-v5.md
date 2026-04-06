# ⚡ CMP — Compute Mesh Protocol

> **The world's first zero-config, zero-blockchain, peer-to-peer WASM mesh computer.**

Turn any idle devices on your network into a distributed supercomputer. No servers. No tokens. No setup. Just computation.

```bash
npm install @agent-viscro/cmp
```

```typescript
import { CMPNode, buildSensorFilter } from '@agent-viscro/cmp';

const node = new CMPNode({ transports: ['lan'] });
await node.start();

// Filter 100K sensor readings across 4 devices — automatically
const result = await node.compute(buildSensorFilter(100), sensorData, {
  chunkHint: 4,
});

console.log(`${result.devicesUsed} devices, ${result.totalTimeMs}ms, verified: ${result.verified}`);
```

---

## Why CMP?

| | CMP | BOINC | Golem | Ray |
|---|---|---|---|---|
| **Setup** | Zero-config | Server required | Wallet + tokens | Cluster config |
| **Blockchain** | None | None | Ethereum | None |
| **Discovery** | Auto (UDP multicast) | Manual project | DHT | Manual |
| **Task format** | WASM (portable, sandboxed) | Native binaries | Docker/gWASM | Python |
| **Auto-parallelization** | ✅ Built-in | ❌ Manual | ❌ Manual | Partial |
| **Data gravity** | ✅ Ships code to data | ❌ | ❌ | Partial |
| **First line of code to distributed compute** | 3 lines | Hours | Hours + crypto | 30+ min |

---

## What Makes CMP Different

### 🎯 Auto-Parallelization
CMP's `TaskCompiler` analyzes your WASM module and automatically detects the optimal parallelization pattern — map, filter, reduce, scatter-gather, pipeline, sort-merge. You don't specify how to split; CMP figures it out.

### 🌍 Computation Gravity
For large datasets, CMP ships your 50-byte function TO the 2GB dataset — not the other way around. The `GravityPlanner` tracks data locations across the mesh and makes intelligent code-vs-data movement decisions.

### 🔐 WASM Sandboxed
Every task runs in WebAssembly: deterministic, portable, sandboxed. The same binary executes identically on any device. No containers. No VMs. No native code risks.

### 📡 True Zero-Config
Devices discover each other via UDP multicast. Start two nodes on the same LAN and they form a mesh within seconds. No IP addresses. No port forwarding. No central registry.

---

## Quick Start

### 1. Install

```bash
npm install @agent-viscro/cmp
```

### 2. Start a node

```typescript
import { CMPNode } from '@agent-viscro/cmp';

const node = new CMPNode({ transports: ['lan'] });
await node.start();
console.log(`Online: ${node.shortMeshId()}, ${node.getPeers().length} peers`);
```

### 3. Distribute work

```typescript
import { buildGrayscaleModule } from '@agent-viscro/cmp';

// Convert a 500×500 RGB image to grayscale across all mesh devices
const result = await node.compute(buildGrayscaleModule(), rgbImageData, {
  entryPoint: 'process',
  chunkHint: 4,
});
```

### 4. Use streaming pipelines

```typescript
import { PipelineManager } from '@agent-viscro/cmp';

const pipes = new PipelineManager(node.shortMeshId());
pipes.define('etl', ['filter:predicate=gt:100', 'map:transform=double', 'collect']);
pipes.start('etl');
pipes.push('etl', rawData);
const output = pipes.stop('etl');
```

---

## Built-in WASM Modules

No need to write WASM by hand. CMP includes ready-to-use modules:

| Module | What It Does |
|---|---|
| `buildSensorFilter(threshold)` | Keep values above threshold |
| `buildSensorScale(factor)` | Multiply each value |
| `buildSensorClamp(lo, hi)` | Clamp to range |
| `buildSensorPeaks()` | Detect local maxima |
| `buildGrayscaleModule()` | RGB → grayscale (ITU-R BT.601) |
| `buildHistogramModule()` | 256-bin histogram |
| `buildMovingAverageModule()` | Signal smoothing |
| `buildRLECompressModule()` | Run-length compression |
| `buildXorCipherModule(key)` | XOR encryption |

Or build your own with `WasmModuleBuilder`:

```typescript
import { WasmModuleBuilder, Op } from '@agent-viscro/cmp';
const builder = new WasmModuleBuilder();
// ... define custom WASM logic
const wasmBytes = builder.build();
```

---

## Architecture

```
Device A                    Device B                  Device C
┌──────────┐               ┌──────────┐              ┌──────────┐
│ Submit   │──UDP beacon──→│ Discover │              │ Discover │
│ task     │               │          │              │          │
│ Split    │               │          │              │          │
│ data ────┼──chunk 1─────→│ Execute  │              │          │
│      ────┼──chunk 2──────┼──────────┼─────────────→│ Execute  │
│          │               │ WASM ☑   │              │ WASM ☑   │
│ Assemble │←──result 1────┤          │              │          │
│          │←──result 2────┼──────────┼──────────────┤          │
│ Verify ☑ │               │          │              │          │
└──────────┘               └──────────┘              └──────────┘
```

**Protocol Layers**: Discovery (UDP) → Capabilities → Negotiation → Task Splitting → WASM Execution → Verified Assembly → Computation Certificates

---

## Benchmarks

```bash
# Run scaling benchmark (1, 2, 4, 8 nodes × multiple data sizes)
npm run benchmark

# Run chaos tests (packet loss, latency, node crashes)
npm run test:chaos
```

---

## Demos

```bash
# Distributed image processing (500×500 RGB → grayscale)
npm run demo
```

---

## Project Stats

- **731 files**, ~313,000 lines of TypeScript
- **320+ passing tests**
- **12 built-in WASM modules** (real computation, not byte-shuffling)
- **10 parallelization patterns** detected automatically
- **2 dependencies** (sql.js, tweetnacl)
- **Solo developer** project by Agent Viscro

---

## Protocol Spec

Full formal specification: [PROTOCOL-SPEC.md](./packages/core/PROTOCOL-SPEC.md)

---

## Requirements

- Node.js ≥ 18.0.0
- Devices on the same LAN (UDP multicast)
- That's it.

---

## License

MIT

---

**Built by [Agent Viscro](https://github.com/aswinsasi)** 🇮🇳
