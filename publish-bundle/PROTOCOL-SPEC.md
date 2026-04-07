# CMP Protocol Specification v5.0

**Compute Mesh Protocol — Formal Specification**

```
Status:        Draft
Version:       5.0
Author:        Agent Viscro (Aswin)
Date:          April 2026
License:       MIT
Repository:    github.com/aswinsasi/cmp
npm:           npmjs.com/package/cmp-protocol
```

---

## Abstract

CMP (Compute Mesh Protocol) is a peer-to-peer protocol for distributing
arbitrary WebAssembly computation across idle consumer devices on a local
network. CMP requires no central server, no blockchain, and no manual
configuration. Devices discover each other via UDP multicast, negotiate
capabilities, distribute WASM task chunks, and assemble verified results.

CMP is the first distributed computation protocol that:
1. Analyzes WASM bytecode to autonomously detect parallelization patterns
2. Learns optimal execution strategies from its own execution history
3. Transfers learned knowledge between structurally similar computations
4. Auto-detects input data structure for boundary-aligned splitting

This document specifies the wire protocol, message formats, state machines,
security model, and intelligence layers for CMP v5.0.

---

## 1. Terminology

| Term | Definition |
|---|---|
| **Mesh** | The set of CMP nodes that have discovered each other |
| **Node** | A single CMP instance running on a device |
| **Submitter** | The node that initiates a computation |
| **Worker** | A node that executes a task chunk |
| **MeshId** | 32-byte Ed25519 public key identifying a node |
| **TaskId** | 32-byte random identifier for a computation |
| **Chunk** | A portion of input data assigned to a single worker |
| **WASM Module** | WebAssembly binary conforming to CMP conventions |
| **Genome** | 64-dimensional vector encoding of a WASM module's bytecode structure |
| **Fingerprint** | Compact hash derived from a WASM module's structural analysis |
| **MER** | Mesh Experience Record — stored execution result for learning |

---

## 2. Architecture Overview

CMP operates in 8 layers:

```
┌─────────────────────────────────────────────┐
│  Layer 8: Computational Phylogenetics       │ Zero-shot inheritance
├─────────────────────────────────────────────┤
│  Layer 7: Self-Learning                     │ Execution history + optimization
├─────────────────────────────────────────────┤
│  Layer 6: Computation Certificates          │ Cryptographic proof
├─────────────────────────────────────────────┤
│  Layer 5: Execution & Assembly              │ WASM sandbox, result merge
├─────────────────────────────────────────────┤
│  Layer 4: Task Splitting & Distribution     │ Bytecode analysis, input detection
├─────────────────────────────────────────────┤
│  Layer 3: Negotiation & Assignment          │ Bidding, capability matching
├─────────────────────────────────────────────┤
│  Layer 2: Capability Exchange               │ Resource profiling
├─────────────────────────────────────────────┤
│  Layer 1: Discovery & Transport             │ UDP multicast, TCP data
└─────────────────────────────────────────────┘
```

---

## 3. Layer 1: Discovery & Transport

### 3.1 Discovery (UDP Multicast)

Nodes announce presence via UDP multicast:

- **Multicast Group**: `239.77.67.80`
- **Port**: `43580`
- **Beacon Interval**: configurable (default: 3000ms)

#### Beacon Packet Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Instance ID (8 bytes)                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|        TCP Port (2 bytes)     |       Beacon Payload (N)      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

Nodes filter their own beacons by Instance ID (not IP), enabling
multiple nodes on the same machine.

### 3.2 Data Transport (TCP)

```
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Frame Length (4 bytes, BE)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Payload (N bytes)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- Maximum frame size: 1,048,576 bytes (1MB)
- Connection pooling: one TCP connection per peer, reused

---

## 4. Layer 2: Capability Exchange

Upon discovery, nodes exchange capability profiles:

```typescript
interface DeviceProfile {
  meshId: Uint8Array;           // 32-byte Ed25519 public key
  cores: number;                // Available CPU cores
  memoryMb: number;             // Available memory (MB)
  gpuType: GPUType;             // NONE | WEBGL | WEBGPU | CUDA
  wasmSupport: boolean;         // Always true for CMP nodes
  acceptingTasks: boolean;      // Whether node accepts work
  resourceSharePercent: number; // % of resources to share (0-100)
  batteryPct: number;           // Battery level (mobile)
  thermalThrottled: boolean;    // Thermal state
}
```

---

## 5. Layer 3: Negotiation

### Message Types

| Code | Name | Direction | Purpose |
|---|---|---|---|
| `0x10` | `TASK_ANNOUNCE` | Submitter → All | Announce task requirements |
| `0x11` | `BID` | Worker → Submitter | Offer to execute |
| `0x12` | `ASSIGN` | Submitter → Worker | Assign chunk |
| `0x13` | `ACCEPT` | Worker → Submitter | Acknowledge assignment |
| `0x20` | `CHUNK_DATA` | Submitter → Worker | Send input data chunk |
| `0x21` | `CHUNK_RESULT` | Worker → Submitter | Return chunk result |
| `0x30` | `HEARTBEAT` | Any → Any | Liveness check |
| `0x31` | `DEPARTURE` | Leaving → All | Graceful leave |
| `0xFD` | `CODE_SHIP` | Any → Any | Ship code to remote data |
| `0xFE` | `CODE_RESULT` | Worker → Requester | Code shipping result |

### Bid Collection

- Bid window: configurable (default: 500ms)
- Early exit: resolves immediately when all expected peers respond
- Grace period: 50ms for additional bids after minBids reached
- Scoring: weighted by capability, reputation, latency, and credits

---

## 6. Layer 4: Task Splitting & Analysis

### 6.1 WASM Bytecode Analysis (Novel)

The `BytecodeAnalyzer` reads the WASM binary's code section and
extracts structural features from the entry point function:

```
Signals extracted:
  - Loop count and nesting depth
  - Memory load/store count and ratio
  - Comparison count (filter signal)
  - Arithmetic count (transform signal)
  - Accumulator pattern (local.get X → add → local.set X)
  - Conditional store (store inside if block = filter)
  - Compare-swap pattern (nested loop + compare + store = sort)
  - Independent write pointer (map signal)
```

From these signals, the analyzer determines the structural pattern:

| Pattern | Key Signals | Parallelization |
|---|---|---|
| `LINEAR_MAP` | Loop + store + no conditional write | Split equally, concatenate |
| `LINEAR_FILTER` | Loop + conditional store + comparisons | Split equally, concatenate non-empty |
| `LINEAR_REDUCE` | Loop + accumulator + few stores | Split equally, reduce tree |
| `COMPARE_REORDER` | Nested loops + compare-swap | Split, merge-sort |
| `MULTI_PASS` | Multiple sequential loops | Pipeline stages |
| `FIXED_OUTPUT` | Many loads, few stores | Split equally, aggregate |

### 6.2 Input Structure Detection (Novel)

The `InputAnalyzer` examines raw input bytes to detect record boundaries:

| Format | Detection Method | Split Strategy |
|---|---|---|
| JSON Array | `[` prefix, top-level comma scan | Between elements |
| NDJSON | Lines starting with `{` or `[` | At newlines |
| CSV/TSV | Consistent delimiter counts per line | At newlines |
| RGB Pixels | Length divisible by 3, common dimensions | At 3-byte boundaries |
| RGBA Pixels | Length divisible by 4 | At 4-byte boundaries |
| Float32 Array | Length divisible by 4, valid float values | At 4-byte boundaries |
| Raw Bytes | No structure detected | Anywhere |

This prevents the protocol from splitting an RGB pixel or CSV row in half.

---

## 7. Layer 5: Execution

### 7.1 WASM Sandbox

- Memory limit: configurable (default: 256 pages = 16MB)
- Memory auto-growth: grows before input write if needed
- Execution timeout: configurable (default: 30s)
- No filesystem access, no network access

### 7.2 WASM Module Convention

```
1. Module exports "memory" (WebAssembly.Memory, min 1 page)
2. Module exports entry point function (default: "process")
3. Host writes input at memory[offset..offset+inputLen]
4. Host calls process(offset, inputLen) → outputLen
5. Host reads output from memory[offset..offset+outputLen]
```

### 7.3 Result Assembly & Verification

Results merged according to detected pattern. Optional merge verification
runs a small sample locally and compares with distributed output to prove
correctness.

---

## 8. Layer 6: Computation Certificates

```typescript
interface ComputationCertificate {
  taskId: TaskId;
  wasmHash: Hash256;
  inputHash: Hash256;
  outputHash: Hash256;
  participants: DeviceAttestation[];
  timestamp: number;
  submitterSignature: Uint8Array;  // Ed25519
}
```

---

## 9. Layer 7: Self-Learning Protocol (Novel)

### 9.1 Computation Fingerprint

Each WASM module is assigned a fingerprint derived from its bytecode
structural analysis. Same code → same fingerprint. Different constant
values (e.g., filter threshold 100 vs 200) → different fingerprint.

### 9.2 Learning Store

After each execution, the protocol records:

```typescript
interface ExecutionRecord {
  fingerprintHash: string;     // Which computation
  pattern: string;             // Detected pattern
  inputSizeBytes: number;      // How much data
  chunkCount: number;          // How many chunks were used
  deviceCount: number;         // How many devices participated
  totalTimeMs: number;         // How long it took
  verified: boolean;           // Whether result was verified
  timestamp: number;           // When it happened
}
```

### 9.3 Recommendation Engine

Before execution, the protocol checks history:

```
Query: "fingerprint=a7f3, inputSize≈50KB, availableDevices=8"
Result: "4 chunks averaged 180ms across 5 past executions (confidence: 80%)"
Action: Override chunkHint with learned value
```

Records are bucketed by input size (powers of 2) for fuzzy matching.
Only verified results contribute to recommendations.
Confidence = min(dataPoints / 10, 1.0).

### 9.4 Persistence

Learning records persist to SQLite (`cmp-data/learning.db`) and
survive node restarts.

---

## 10. Layer 8: Computational Phylogenetics (Novel)

### 10.1 Genome Encoding

Each WASM module's bytecode analysis is encoded into a 64-dimensional
float vector (the "computation genome"):

```
Dimensions 0-31:   Opcode frequency distribution (32 buckets)
Dimensions 32-39:  Loop structure (count, depth, patterns)
Dimensions 40-47:  Memory access pattern (load/store ratios)
Dimensions 48-51:  I/O characteristics (output ratio, independence)
Dimensions 52-55:  Branch density (if/br patterns)
Dimensions 56-63:  Function complexity (instruction count, calls)
```

### 10.2 Phylogenetic Index

All known genomes are indexed for cosine similarity search.
When a new WASM module arrives that has never been executed:

```
1. Encode its genome (64-dim vector)
2. Search index: find top-5 most similar known genomes
3. If similarity > 0.6: inherit strategy from closest ancestor
4. Confidence = ancestor_confidence × similarity (capped at 0.7)
5. Execute with inherited strategy
6. Record result → this module becomes a new ancestor
```

### 10.3 Strategy Inheritance Rules

- Minimum similarity threshold: 0.6
- Maximum inherited confidence: 0.7 (always leaves room to learn)
- Multiple ancestor agreement boosts confidence by 0.1
- Device count constraint respected (never inherit 8 chunks if only 2 devices)
- Known modules skip inheritance (use direct LearningBridge history)

### 10.4 Evolutionary Tree

The system maintains a computation family tree:

```
├── SensorFilter (100 executions)
│   ├── SensorClamp (inherited, 87% similar)
│   └── SensorPeaks (inherited, 79% similar)
├── Grayscale (50 executions)
│   ├── Sepia (inherited, 88% similar)
│   └── Sharpening (inherited, 92% similar)
└── RLECompress (30 executions)
    └── LZ4Compress (inherited, 71% similar)
```

---

## 11. Computation Gravity

### Decision Algorithm

```
if (codeSize < dataTotalSize * 0.01 AND dataPrimaryFraction > 0.6):
    strategy = CODE_TO_DATA
    Ship WASM module to the device holding the data
else:
    strategy = DATA_TO_CODE
    Move data chunks to available workers
```

---

## 12. Security Model

### 12.1 Identity
Ed25519 keypair per node. Public key = MeshId.

### 12.2 Encryption
AES-256 with session keys derived from X25519 key exchange.

### 12.3 Access Control
Rate limiting, ACL whitelist/blacklist, WASM sandboxing.

### 12.4 Incentive Fairness
Credit-based ledger. Consumers are deprioritized when they exceed
their contribution ratio.

---

## 13. Compute Flow (Complete)

```
CMPNode.compute(wasm, data)
  │
  ├─→ analyzeWasmBytecode(wasm)            Layer 4: read opcodes
  ├─→ analyzeInputStructure(data)          Layer 4: detect RGB/CSV/JSON
  ├─→ learningBridge.recommend()           Layer 7: check exact history
  │     └─ no history?
  │         ├─→ phylogenetics.analyzeAndInherit()  Layer 8: find ancestor
  │         └─ no ancestor? → use bytecode analysis default
  │
  ├─→ negotiation.submitTask()             Layer 3: bid collection
  ├─→ distributor.plan()                   Layer 4: create chunks
  ├─→ splitAtBoundaries()                  Layer 4: align to elements
  │
  ├─→ sendChunkDataToExecutors()           Layer 5: distribute
  ├─→ workers execute WASM                 Layer 5: sandboxed execution
  ├─→ assembler.collectResult()            Layer 5: merge results
  │
  ├─→ learningBridge.recordResult()        Layer 7: store for learning
  ├─→ phylogenetics.recordExecution()      Layer 8: register as ancestor
  └─→ mclEngine.onTaskComplete()           Layer 7: generate MER
```

---

## 14. Comparison with Existing Systems

| Feature | CMP | BOINC | Golem | Ray | Spark |
|---|---|---|---|---|---|
| Server required | No | Yes | No* | Yes | Yes |
| Blockchain | No | No | Yes (ETH) | No | No |
| Auto-discovery | UDP multicast | Manual | DHT | Manual | Manual |
| Task format | WASM | Native binary | Docker/gWASM | Python | JVM |
| Bytecode analysis | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-learning | ✅ | ❌ | ❌ | ❌ | Partial (AQE) |
| Phylogenetic inheritance | ✅ | ❌ | ❌ | ❌ | ❌ |
| Input structure detection | ✅ | ❌ | ❌ | ❌ | ❌ |
| Data gravity | ✅ | ❌ | ❌ | Partial | Partial |
| Zero-config | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 15. Implementation Status

| Component | Status | Test Coverage |
|---|---|---|
| UDP Discovery | ✅ Complete | Unit + LAN integration |
| TCP Data Transport | ✅ Complete | Unit + multi-node |
| Capability Exchange | ✅ Complete | Unit |
| Negotiation/Bidding | ✅ Complete | Unit + integration |
| WASM Sandbox | ✅ Complete | Unit (12 modules) |
| Bytecode Analyzer | ✅ Complete | Unit (6 patterns) |
| Input Analyzer | ✅ Complete | Unit (7 formats) |
| Task Compiler | ✅ Complete | Unit (10 patterns) |
| Self-Learning | ✅ Complete | Unit (convergence proof) |
| Phylogenetics Engine | ✅ Complete | Unit (zero-shot proof) |
| Unified Scheduler | ✅ Complete | Unit + integration |
| Job Queue | ✅ Complete | Unit |
| Computation Gravity | ✅ Complete | Unit |
| Streaming Pipelines | ✅ Complete | Unit |
| Computation Certificates | ✅ Complete | Unit |
| Merge Verification | ✅ Complete | Unit |
| Persistence (SQLite) | ✅ Complete | Unit |
| Security (Ed25519/AES) | ✅ Complete | Unit |
| CLI | ✅ Complete | Manual |
| WebRTC Transport | 🔧 Partial | Basic |
| BLE Transport | 🔧 Stub | — |

---

## Appendix A: Message Encoding

```
[1 byte: message type]
[4 bytes: payload length (BE)]
[N bytes: JSON-encoded payload]
[64 bytes: Ed25519 signature]
```

---

## Appendix B: Built-in WASM Modules

| Module | Function | Input | Output |
|---|---|---|---|
| `SensorFilter(T)` | Keep values > T | byte array | filtered bytes |
| `SensorScale(F)` | Multiply by F | byte array | scaled bytes |
| `SensorClamp(lo,hi)` | Clamp to range | byte array | clamped bytes |
| `SensorPeaks` | Detect local peaks | byte array | peak bytes |
| `Grayscale` | RGB → gray (BT.601) | RGB triplets | gray bytes |
| `Histogram` | 256-bin histogram | byte array | 256×4 counts |
| `MovingAverage(W)` | Window average | byte array | averaged bytes |
| `RLECompress` | Run-length encoding | byte array | compressed |
| `XorCipher(K)` | XOR encryption | byte array | encrypted bytes |
| `ByteSort` | Sort ascending | byte array | sorted bytes |

---

## Appendix C: CLI Commands

| Command | Description |
|---|---|
| `npx cmp-protocol start` | Start mesh node (LAN auto-discovery) |
| `npx cmp-protocol start --ble` | Start with Bluetooth transport |
| `npx cmp-protocol start --webrtc` | Start with WebRTC transport |
| `npx cmp-protocol start --verbose` | Start with debug logging |
| `npx cmp-protocol signal [port]` | Start WebRTC signaling server |
| `npx cmp-protocol bench` | Run performance benchmark |
| `npx cmp-protocol version` | Show version |

---

*End of specification.*
