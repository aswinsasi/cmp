# ⚡ CMP — Compute Mesh Protocol

> **The world's first self-learning, self-parallelizing, zero-config, zero-blockchain, peer-to-peer WASM mesh computer.**

Turn any idle devices on your network into a distributed supercomputer. No servers. No tokens. No setup. Just computation.

```bash
npm install cmp-protocol
```

```bash
npx cmp-protocol start    # Start a mesh node — discovers nearby devices automatically
```

---

## Try It Now

```bash
# Terminal 1 (Machine A)
npx cmp-protocol start

# Terminal 2 (Machine B — same WiFi)
npx cmp-protocol start

# They discover each other automatically. Computation distributes across both.
```

---

## Why CMP?

| | CMP | BOINC | Golem | Ray |
|---|---|---|---|---|
| **Setup** | Zero-config | Server required | Wallet + tokens | Cluster config |
| **Blockchain** | None | None | Ethereum | None |
| **Discovery** | Auto (UDP multicast) | Manual project | DHT | Manual |
| **Task format** | WASM (portable, sandboxed) | Native binaries | Docker/gWASM | Python |
| **Auto-parallelization** | ✅ Bytecode analysis | ❌ Manual | ❌ Manual | Partial |
| **Self-learning** | ✅ Learns optimal strategy | ❌ | ❌ | ❌ |
| **Zero-shot inheritance** | ✅ Phylogenetic engine | ❌ | ❌ | ❌ |
| **Data gravity** | ✅ Ships code to data | ❌ | ❌ | Partial |
| **First line to distributed compute** | 3 lines | Hours | Hours + crypto | 30+ min |

---

## What Makes CMP a World First

### 🧬 Self-Parallelizing Compiler
CMP reads your WASM module's **actual bytecode** — loops, branches, memory access patterns — and autonomously detects how to parallelize it. No annotations. No developer input. The protocol decides.

### 🧠 Self-Learning Protocol
Every execution is recorded. The protocol learns which chunk count is fastest for each computation. Run the same task 10 times → CMP converges to the optimal strategy. No human tuning.

### 🌳 Computational Phylogenetics
A brand-new WASM module you've **never run before** executes with optimal settings on its first run. How? CMP finds structurally similar code in its genome index and **inherits** the strategy — like a newborn animal that already knows how to walk.

### 🌍 Computation Gravity
For large datasets, CMP ships your 50-byte function TO the 2GB dataset — not the other way around. The `GravityPlanner` tracks data locations across the mesh and makes intelligent code-vs-data movement decisions.

### 📡 True Zero-Config
Devices discover each other via UDP multicast. Start two nodes on the same LAN and they form a mesh within seconds. No IP addresses. No port forwarding. No central registry.

### 🔐 WASM Sandboxed
Every task runs in WebAssembly: deterministic, portable, sandboxed. The same binary executes identically on any device. No containers. No VMs.

---

## CLI

```bash
npx cmp-protocol start              # Start mesh node (LAN auto-discovery)
npx cmp-protocol start --ble        # Start with Bluetooth transport
npx cmp-protocol start --webrtc     # Start with WebRTC (cross-network)
npx cmp-protocol start --verbose    # Debug logging
npx cmp-protocol signal [port]      # Start WebRTC signaling server
npx cmp-protocol bench              # Run benchmark
npx cmp-protocol version            # Show version
```

After starting, interactive commands:

```bash
peers                    # Show connected devices
status                   # Show mesh info
encrypt Hello World      # Encrypt text via mesh
decrypt 0a272e...        # Decrypt hex via mesh
```

---

## Code API

### Start a node

```typescript
import { CMPNode } from 'cmp-protocol/packages/core/src/cmp-node';

const node = new CMPNode({ transports: ['lan'] });
await node.start();
console.log(`Online: ${node.shortMeshId()}, ${node.getPeers().length} peers`);
```

### Distribute work

```typescript
import { buildSensorFilter } from 'cmp-protocol/packages/core/src/wasm/workload-modules';

const result = await node.compute(buildSensorFilter(100), sensorData, {
  entryPoint: 'process',
  chunkHint: 4,
});

console.log(`${result.devicesUsed} devices, ${result.totalTimeMs}ms, verified: ${result.verified}`);
```

### Streaming pipelines

```typescript
import { PipelineManager } from 'cmp-protocol/packages/core/src/pipes/pipeline-manager';

const pipes = new PipelineManager(node.shortMeshId());
pipes.define('etl', ['filter:predicate=gt:100', 'map:transform=double', 'collect']);
pipes.start('etl');
pipes.push('etl', rawData);
const output = pipes.stop('etl');
```

---

## Built-in WASM Modules

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

---

## Architecture

```
  Device A (submitter)              Device B (worker)           Device C (worker)
  ┌─────────────────┐              ┌─────────────────┐         ┌─────────────────┐
  │ 1. Analyze WASM  │              │                  │         │                  │
  │    bytecode      │              │                  │         │                  │
  │ 2. Check learning│              │                  │         │                  │
  │    history       │              │                  │         │                  │
  │ 3. Check phylo   │              │                  │         │                  │
  │    ancestors     │              │                  │         │                  │
  │ 4. Detect input  │              │                  │         │                  │
  │    structure     │              │                  │         │                  │
  │ 5. Split data   ─┼──chunk 1───→│ 6. Execute WASM  │         │                  │
  │                 ─┼──chunk 2────┼──────────────────┼────────→│ 6. Execute WASM  │
  │ 7. Assemble     ←┼──result 1───┤                  │         │                  │
  │                 ←┼──result 2───┼──────────────────┼─────────┤                  │
  │ 8. Verify ☑      │              │                  │         │                  │
  │ 9. Record result │              │                  │         │                  │
  │    (learning)    │              │                  │         │                  │
  │10. Update genome │              │                  │         │                  │
  │    (phylogenetics)│             │                  │         │                  │
  └─────────────────┘              └─────────────────┘         └─────────────────┘
```

### Self-Learning Compute Flow

```
FIRST RUN: new WASM module
  ├─ BytecodeAnalyzer → detects LINEAR_FILTER (90% confidence)
  ├─ LearningBridge → no history (first time)
  ├─ PhylogeneticsEngine → finds ancestor (85% similar) → inherits 4 chunks
  ├─ Execute → 180ms
  └─ Record: fingerprint=a7f3, chunks=4, time=180ms

SECOND RUN: same WASM
  ├─ LearningBridge → recommends 4 chunks (1 data point)
  ├─ Execute → 175ms
  └─ Record: now 2 data points

TENTH RUN:
  ├─ LearningBridge → recommends 4 chunks (90% confidence, 9 data points)
  └─ Protocol converged to optimal — NO HUMAN TUNED ANYTHING
```

---

## Innovation Stack

| Layer | Innovation | World's First? |
|---|---|---|
| **Bytecode Analysis** | Reads WASM opcodes to detect parallelization pattern | ✅ Yes |
| **Input Structure Detection** | Auto-detects RGB/CSV/JSON, splits at record boundaries | ✅ Yes |
| **Self-Learning** | Records execution history, converges to optimal strategy | ✅ Yes (at protocol level) |
| **Computational Phylogenetics** | New code inherits strategy from similar ancestors | ✅ Yes |
| **Computation Gravity** | Protocol-level code-vs-data movement decision | ✅ Yes |
| **Merge Verification** | Proves distributed result matches local execution | ✅ Yes |
| **Zero-Config Mesh** | UDP multicast discovery, no server, no blockchain | Unique combination |

---

## Tests

```bash
npx cmp-protocol bench                    # Performance benchmark

# Or run test suites directly:
cd packages/core
npx tsx tests/self-parallelizing.test.ts   # Bytecode analysis proof
npx tsx tests/self-learning.test.ts        # Learning convergence proof
npx tsx tests/phylogenetics.test.ts        # Zero-shot inheritance proof
npx tsx tests/chaos-network.test.ts        # Packet loss, latency, crashes
npx tsx tests/v4-real-workload.test.ts     # Real distributed execution
```

---

## Project Stats

- **750+ files**, ~320,000 lines of TypeScript
- **320+ passing tests**
- **12 built-in WASM modules** (real computation, not byte-shuffling)
- **10 parallelization patterns** detected automatically
- **3 dependencies** (sql.js, tweetnacl, tsx)
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

## Links

- npm: [npmjs.com/package/cmp-protocol](https://www.npmjs.com/package/cmp-protocol)
- GitHub: [github.com/aswinsasi/cmp](https://github.com/aswinsasi/cmp)
- Protocol Spec: [PROTOCOL-SPEC.md](./packages/core/PROTOCOL-SPEC.md)

---

**Built by [Agent Viscro](https://github.com/aswinsasi)** 🇮🇳
