# CMP Protocol Specification v5.0

**Compute Mesh Protocol — Formal Specification**

```
Status:        Draft
Version:       5.0
Author:        Agent Viscro (Aswin)
Date:          April 2026
License:       MIT
Repository:    github.com/aswinsasi/cmp
```

---

## Abstract

CMP (Compute Mesh Protocol) is a peer-to-peer protocol for distributing
arbitrary WebAssembly computation across idle consumer devices on a local
network. CMP requires no central server, no blockchain, and no manual
configuration. Devices discover each other via UDP multicast, negotiate
capabilities, distribute WASM task chunks, and assemble verified results.

This document specifies the wire protocol, message formats, state machines,
and security model for CMP v5.0.

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

---

## 2. Architecture Overview

CMP operates in 6 protocol layers:

```
┌─────────────────────────────────────────────┐
│  Layer 6: Computation Certificates          │ Cryptographic proof
├─────────────────────────────────────────────┤
│  Layer 5: Execution & Assembly              │ WASM sandbox, result merge
├─────────────────────────────────────────────┤
│  Layer 4: Task Splitting & Distribution     │ Chunking, scheduling
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

- **Instance ID** (8 bytes): Random per-process ID, used to filter self-beacons
- **TCP Port** (2 bytes, big-endian): Advertised TCP data port
- **Beacon Payload**: Layer 2 beacon data (JSON-encoded capabilities)

Nodes filter their own beacons by Instance ID (not IP), enabling
multiple nodes on the same machine.

### 3.2 Data Transport (TCP)

Reliable data transfer uses TCP with length-framed messages:

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
  meshId: Uint8Array;        // 32-byte Ed25519 public key
  cores: number;             // Available CPU cores
  memoryMb: number;          // Available memory (MB)
  gpuType: GPUType;          // NONE | WEBGL | WEBGPU | CUDA
  gpuMemoryMb: number;       // GPU memory
  wasmSupport: boolean;      // Always true for CMP nodes
  acceptingTasks: boolean;   // Whether node accepts work
  resourceSharePercent: number; // % of resources to share (0-100)
  batteryPct: number;        // Battery level (mobile)
  thermalThrottled: boolean; // Thermal state
}
```

---

## 5. Layer 3: Negotiation

The submitter broadcasts a `TASK_ANNOUNCE` with requirements.
Workers respond with `BID` messages. The submitter selects workers
based on capability match and reputation score.

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

---

## 6. Layer 4: Task Splitting

### 6.1 Auto-Parallelization

The `TaskCompiler` analyzes WASM module exports to detect patterns:

| Pattern | Detection Signal | Split Strategy | Merge Strategy |
|---|---|---|---|
| `MAP_PARALLEL` | `process(ptr, len) → len` | Equal byte splits | Concatenate |
| `FILTER` | Output ≤ input size | Equal byte splits | Concatenate |
| `REDUCE` | Output is fixed size | Equal byte splits | Reduce tree |
| `SCATTER_GATHER` | Multiple exports | Key-based routing | Key merge |
| `SORT_MERGE` | Sort in export name | Equal splits | Merge sort |
| `PIPELINE` | Sequential exports | Pipeline stages | Pass-through |

### 6.2 Data Splitting

Input data is split into `chunkHint` equal chunks (default: peer count).
For structured data (RGB images), chunk boundaries are aligned to record
boundaries (e.g., 3-byte RGB triplets).

---

## 7. Layer 5: Execution

### 7.1 WASM Sandbox

Each chunk executes in an isolated WebAssembly sandbox:

- Memory limit: configurable (default: 256 pages = 16MB)
- Execution timeout: configurable (default: 30s)
- No filesystem access
- No network access
- Optional WASI-like imports (fd_write for console)

### 7.2 WASM Module Convention

```
1. Module exports "memory" (WebAssembly.Memory, min 1 page)
2. Module exports entry point function (default: "process")
3. Host writes input at memory[offset..offset+inputLen]
4. Host calls process(offset, inputLen) → outputLen
5. Host reads output from memory[offset..offset+outputLen]
```

### 7.3 Result Assembly

The submitter waits for all chunk results, then merges according
to the detected pattern. For `MAP_PARALLEL` and `FILTER`, results
are concatenated in chunk order. For `REDUCE`, results are
iteratively reduced.

---

## 8. Layer 6: Computation Certificates

When `certify: true` is set, the submitter generates a cryptographic
certificate proving computation was performed:

```typescript
interface ComputationCertificate {
  taskId: TaskId;
  wasmHash: Hash256;           // SHA-256 of WASM module
  inputHash: Hash256;          // SHA-256 of input data
  outputHash: Hash256;         // SHA-256 of output data
  participants: DeviceAttestation[];  // Signed attestations
  timestamp: number;
  submitterSignature: Uint8Array;
}
```

Each worker signs an attestation of their chunk execution:

```typescript
interface DeviceAttestation {
  meshId: MeshId;
  chunkIndex: number;
  inputHash: Hash256;
  outputHash: Hash256;
  executionTimeMs: number;
  signature: Uint8Array;       // Ed25519 signature
}
```

---

## 9. Computation Gravity

When data is large relative to code, CMP ships code to data:

### Decision Algorithm

```
if (codeSize < dataTotalSize * 0.01 AND dataPrimaryFraction > 0.6):
    strategy = CODE_TO_DATA
    Ship WASM module to the device holding the data
else:
    strategy = DATA_TO_CODE
    Move data chunks to available workers
```

### Wire Protocol

`CODE_SHIP` (0xFD) sends a WASM module + data key to a remote node.
The remote node executes the module against its local data and returns
results via `CODE_RESULT` (0xFE).

---

## 10. Security Model

### 10.1 Identity

Each node generates an Ed25519 keypair at startup. The public key
serves as the MeshId. All protocol messages are signed.

### 10.2 Encryption

Node-to-node communication is encrypted with AES-256. Session keys
are derived from Ed25519 key exchange (X25519 via tweetnacl).

### 10.3 Access Control

- Rate limiting: per-peer request limits
- ACL: whitelist/blacklist mode for mesh membership
- WASM sandboxing: no host access from task code

### 10.4 Incentive Fairness

A credit-based ledger tracks computation given/received per peer.
Nodes that consume more than they contribute are deprioritized
in future task assignments.

---

## 11. Comparison with Existing Systems

| Feature | CMP | BOINC | Golem | Ray |
|---|---|---|---|---|
| Server required | No | Yes | No* | Yes |
| Blockchain | No | No | Yes (ETH) | No |
| Auto-discovery | UDP multicast | Manual project | DHT | Manual cluster |
| Task format | WASM | Native binary | Docker/gWASM | Python |
| Auto-parallelization | Yes | No | No | Partial |
| Data gravity | Yes | No | No | Partial |
| Mobile support | Planned | Android | No | No |
| Setup time | 0 (zero-config) | Minutes | Minutes + wallet | Minutes |

*Golem uses a decentralized network but requires blockchain interaction.

---

## 12. Implementation Status

| Component | Status | Test Coverage |
|---|---|---|
| UDP Discovery | ✅ Complete | Unit + LAN integration |
| TCP Data Transport | ✅ Complete | Unit + multi-node |
| Capability Exchange | ✅ Complete | Unit |
| Negotiation/Bidding | ✅ Complete | Unit + integration |
| WASM Sandbox | ✅ Complete | Unit (12 modules) |
| Task Compiler | ✅ Complete | Unit (10 patterns) |
| Unified Scheduler | ✅ Complete | Unit + integration |
| Job Queue | ✅ Complete | Unit |
| Computation Gravity | ✅ Complete | Unit |
| Streaming Pipelines | ✅ Complete | Unit |
| Computation Certificates | ✅ Complete | Unit |
| Persistence (SQLite) | ✅ Complete | Unit |
| Security (Ed25519/AES) | ✅ Complete | Unit |
| WebRTC Transport | 🔧 Partial | Basic |
| BLE Transport | 🔧 Stub | — |
| WAN NAT Traversal | ❌ Not started | — |

---

## Appendix A: Message Encoding

All wire messages use the following envelope:

```
[1 byte: message type]
[4 bytes: payload length (BE)]
[N bytes: JSON-encoded payload]
[64 bytes: Ed25519 signature]
```

The signature covers the message type byte + payload bytes.

---

## Appendix B: Built-in WASM Modules

CMP ships with programmatically-generated WASM modules:

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

*End of specification.*
