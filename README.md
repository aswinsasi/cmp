# CMP — Compute Mesh Protocol

**Turn any devices on the same network into a distributed supercomputer.**

CMP discovers nearby devices, forms a P2P mesh, and distributes computation
automatically. Submit any WASM workload — CMP detects the parallelization
pattern, chunks the data, distributes across devices, executes real WebAssembly,
and merges results. No configuration. No server. No cloud.

[![Tests](https://img.shields.io/badge/tests-350%20passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)]()

```
50,000 sensor readings → sensor_filter(threshold=100) → 30,326 bytes
ALL 30,326 output values > 100 — VERIFIED
3 chunks executed on 3 different remote nodes
Every byte verified. Real WASM. Real nodes. Real distribution.
```

## Quick Start

```bash
git clone https://github.com/aswinsasi/cmp.git
cd cmp
npm install
cd packages/core && npm install sql.js

# Run the real workload demo (2 nodes, 50KB sensor data, byte-verified)
npx tsx tests/v4-real-workload.test.ts

# Run all 350 tests
for t in tests/v4-*.test.ts tests/v5-*.test.ts; do npx tsx $t || exit 1; done
```

## What Makes CMP Different

| Feature | Cloud Functions | Apache Spark | CMP |
|---------|----------------|-------------|-----|
| Setup | AWS account, IAM, API Gateway | Cluster, HDFS, config | `node.start()` |
| Network | Internet required | Cluster network | Any WiFi / LAN |
| Server | Required | Required | **None** |
| Parallelization | Developer writes it | Developer writes it | **Auto-detected** |
| Cost | Per-invocation billing | Cluster cost | **Free (peer devices)** |
| Fault tolerance | Provider-managed | Spark-managed | **Built-in** |

## Architecture

```
┌──────────────────────────────────────────────┐
│                  V4 Bridge                    │
│  ACL → Rate Limit → Compile → Gravity →      │
│  Race Decision → Execute → Merge              │
├──────┬──────┬──────┬──────┬──────┬───────────┤
│Sched-│Task  │Gravi-│Race  │CMP   │Security   │
│uler  │Comp- │ty    │Mgr   │Pipes │+ MeshFS   │
│      │iler  │      │      │      │           │
├──────┴──────┴──────┴──────┴──────┴───────────┤
│              WASM Sandbox                     │
│  Real WebAssembly execution (V8 engine)       │
├──────────────────────────────────────────────┤
│              Wire Handler                     │
│  10 message types (0xF2-0xFB)                │
├──────────────────────────────────────────────┤
│         CMP Core (16 layers)                  │
│  Discovery → Handshake → Negotiation →        │
│  Chunking → Distribution → Execution →        │
│  Assembly → Verification                      │
├──────────────────────────────────────────────┤
│              Transport                        │
│  LAN (UDP broadcast) | VirtualNetwork (test)  │
└──────────────────────────────────────────────┘
```

## The 8 Pillars

### 1. Persistent State
SQLite-backed state store. Jobs, subsystem state, and model checkpoints
survive crashes and restarts.

### 2. Job Queue
Priority-ordered, persistent job queue with auto-retry. Submit background
jobs that execute across the mesh even if you disconnect.

### 3. Unified Scheduler
Scores devices by CPU, memory, GPU, latency, reputation, and data locality.
Picks the optimal execution strategy for each task.

### 4. Universal Task Compiler
Auto-detects parallelization patterns (sort, map, reduce, filter, search,
matrix, ML training) from WASM export names. Generates chunk plans and
merge strategies without developer annotation.

### 5. Speculative Racing
Sends the same task to multiple devices, takes the first result, cancels
the rest. CCU economics: winner earns 100%, losers earn 20% participation.

### 6. Computation Gravity
Decides whether to move code to data or data to code. For a 50-byte filter
function and 2GB of sensor data → ships the function, saves 99.99% bandwidth.

### 7. CMP Pipes
Unix-style streaming pipelines across mesh devices. 8 built-in stages:
filter, map, batch, window, throttle, sample, log, collect. Backpressure
and bottleneck detection built in.

### 8. Security + MeshFS
Wire encryption (XSalsa20-Poly1305), ACL modes (open/whitelist/reputation/deposit),
per-device rate limiting, and a shared mesh filesystem with automatic
parent directory creation and MIME type detection.

## CLI Commands

```bash
npx tsx packages/cli/src/cli.ts start
```

```
cmp> compute hello world              # Full V4 pipeline
cmp> compute --bg long task           # Background job

cmp> pipe define etl: filter:predicate=gt:100 | map:transform=uppercase | collect
cmp> pipe start etl
cmp> pipe push etl some data here
cmp> pipe stop etl                    # → "SOME DATA HERE"

cmp> meshfs write /data/test.csv a,b,c
cmp> meshfs ls /data
cmp> meshfs read /data/test.csv

cmp> job list
cmp> state info
cmp> v4                               # Bridge stats
```

## WASM Workloads

CMP includes real, executable WASM modules built from raw opcodes:

| Module | What it does | Throughput |
|--------|-------------|-----------|
| `sensor_filter` | Keep bytes above threshold | 123 MB/s |
| `grayscale` | RGB→gray (ITU-R BT.601) | 231 MB/s |
| `histogram` | 256-bin byte frequency count | 129 MB/s |
| `moving_average` | Sliding window smoothing | 30 MB/s |
| `rle_compress` | Run-length encoding | 13 MB/s |
| `sensor_scale` | Fixed-point multiply | — |
| `sensor_delta` | Delta encoding | — |
| `sensor_peaks` | Local maxima extraction | — |

```typescript
import { buildSensorFilter, WasmSandbox } from '@agent-viscro/cmp';

const wasm = buildSensorFilter(100);  // Keep bytes > 100
const sandbox = new WasmSandbox();
const result = await sandbox.execute(wasm, sensorData);
// result.output contains only values > 100
```

## Test Results

```
v4-persistence:          33 passed   Persistent State
v4-job-queue:            32 passed   Job Queue
v4-unified-scheduler:    36 passed   Unified Scheduler
v4-task-compiler:        40 passed   Universal Task Compiler
v4-race-manager:         24 passed   Speculative Racing
v4-gravity:              26 passed   Computation Gravity
v4-pipeline:             40 passed   CMP Pipes
v4-security-meshfs:      32 passed   Security + MeshFS
v4-integration:          13 passed   All modules wired
v4-wasm-sandbox:         26 passed   Real WASM execution
v4-wire-handler:         18 passed   Transport ↔ modules
v4-real-workload:         8 passed   50K sensor data, 2 nodes
v5-heavy-and-scale:      12 passed   Grayscale, histogram, 5 nodes
v5-fault-tolerance:      10 passed   Node death, crash recovery
──────────────────────────────────────────────────
Total:                  350 tests, 0 failures
```

## Proven Capabilities

- **Real WASM execution** — not mocked, not simulated. V8 WebAssembly engine.
- **Multi-node distribution** — 5 nodes, chunks distributed across 4 devices.
- **Byte-level verification** — every output value verified against expected.
- **Fault tolerance** — node departure → task completes with remaining peers.
- **Crash recovery** — running jobs survive restart (SQLite persistence).
- **54ms distribution overhead** — for 100KB workload over VirtualNetwork.
- **230 MB/s WASM throughput** — for grayscale image processing.

## Stack

TypeScript strict, Node.js 18+, zero heavy dependencies.

| Dependency | Purpose |
|-----------|---------|
| `tweetnacl` | Ed25519 signatures, XSalsa20-Poly1305 encryption |
| `sql.js` | SQLite for persistent state (WASM-based, no native deps) |

## Repository Structure

```
packages/
  core/           — Protocol implementation (all 8 pillars)
    src/
      compiler/   — Auto-parallelization (10 patterns)
      gravity/    — Code-to-data optimization
      meshfs/     — Shared mesh filesystem
      persistence/— SQLite state store
      pipes/      — Streaming pipelines
      scheduler/  — Job queue, device scoring, racing
      security/   — Encryption, ACL, rate limiting
      wasm/       — WASM sandbox + built-in modules
    tests/        — 350 tests (14 test suites)
  cli/            — Interactive REPL
  transport/      — LAN + VirtualNetwork transports
  runtime/        — WASM execution engine
```

## Author

**Agent Viscro** (Aswin)
Kerala, India

## License

MIT
