<p align="center">
  <h1 align="center">Compute Mesh Protocol</h1>
  <p align="center"><strong>Turn nearby devices into a supercomputer. No cloud. No internet.</strong></p>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#demo">Demo</a> •
  <a href="#benchmark">Benchmark</a> •
  <a href="./spec/CMP-v1.0.md">Protocol Spec</a> •
  <a href="./docs/API.md">API Docs</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/tests-150%20passing-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/protocol%20layers-6%2F6-brightgreen" alt="Layers">
</p>

---

## The Problem

Your phone uses 10% of its CPU most of the time. The 6 phones around you are also idle. Meanwhile, AI inference gets routed to a cloud server 2000km away.

**CMP lets nearby devices pool their idle compute and work together — with zero infrastructure.**

## Quick Start

```bash
npm install @cmp/core
```

```typescript
import { CMPNode } from '@cmp/core';

const node = new CMPNode();
await node.start();                                    // Join the mesh
const result = await node.compute(wasmModule, input);  // Distribute & execute
console.log(result.data);                              // Assembled output
await node.stop();
```

**That's it.** Your device discovers nearby CMP nodes, negotiates resources, distributes work, executes in sandboxes, and assembles results — all in that one `compute()` call.

## How It Works

CMP is a 6-layer protocol stack. Each layer handles one responsibility:

```
┌─────────────────────────────────────────────┐
│  Layer 6: Assembly          Result collection, verification, merge  │
│  Layer 5: Execution         WASM sandbox, resource limits           │
│  Layer 4: Distribution      Task decomposition, chunk assignment    │
│  Layer 3: Negotiation       Bid/assign cycle, scoring               │
│  Layer 2: Capability        Device profiling, resource mapping      │
│  Layer 1: Discovery         Beacon, handshake, mesh formation       │
└─────────────────────────────────────────────┘
         ▼ Transport: BLE / Wi-Fi Direct / LAN ▼
```

**Discovery:** Devices broadcast 38-byte beacons over BLE/Wi-Fi/LAN. ECDH key exchange establishes encrypted sessions.

**Capability:** Each device advertises its CPU, memory, GPU, battery, and available runtimes. A mesh-wide Capability Map tracks all resources.

**Negotiation:** When you need compute, your device broadcasts a task request. Nearby devices bid with their available resources. Bids are scored (resource fit 40%, speed 25%, reputation 20%, power stability 15%) and winners are assigned.

**Distribution:** Tasks are decomposed into chunks using data-parallel, pipeline, scatter-gather, or model-parallel strategies. CONFIDENTIAL tasks use XOR-based secret sharing — no single device sees the full input.

**Execution:** Chunks run inside WASM sandboxes with strict memory/CPU limits. Zero filesystem, network, or sensor access. Memory is zeroed on completion.

**Assembly:** Results are collected, verified (optional redundant execution with majority voting), and merged based on the decomposition strategy.

## Demo

> 5 phones. No internet. Distributed AI inference in 3 seconds.

*[Demo video coming — see [Launch Plan](./docs/LAUNCH_PLAN.md)]*

## Benchmark

Results from `cmp bench` (5 virtual nodes on a single machine):

| Metric | Result |
|--------|--------|
| Mesh formation (5 nodes) | ~2.2 seconds |
| Peer discovery | 4/4 peers found |
| Aggregate resources | 4 cores, 17.6 GB |
| End-to-end compute (1KB input) | ~325ms |
| Chunks distributed | 4 |

Run it yourself:

```bash
cd packages/cli
npx tsx src/cli.ts bench
```

## Use Cases

**Edge AI without cloud.** A rural health clinic with 15 phones but no internet runs a diagnostic model across the mesh.

**Disaster response.** After a flood destroys cell towers, 200 phones in a relief camp form a compute mesh for coordination algorithms.

**Privacy-preserving processing.** Analyze your financial documents across your own devices. Data never leaves the room.

**Collaborative compute.** A university lab meshes 50 student laptops into a cluster during off-hours for simulations.

## Architecture

```
cmp/
├── packages/
│   ├── core/           # Protocol logic — types, layers, crypto, mesh
│   ├── transport/      # LAN, BLE, Wi-Fi Direct, Virtual (testing)
│   ├── runtime/        # WASM sandbox, execution, distribution, assembly
│   └── cli/            # Command-line interface
├── spec/               # Protocol specification (RFC-style)
├── examples/           # Demo applications
└── docs/               # Documentation
```

**44 files | 10,550 lines of TypeScript | 150 tests | All 6 layers implemented**

## CLI

```bash
cmp start                    # Start a node, join the mesh
cmp start --share 70         # Share 70% of resources
cmp start --no-accept        # Don't execute others' tasks

cmp compute model.wasm data.bin --deadline 5000    # Submit a task
cmp compute model.wasm data.bin --output result.bin --priority critical

cmp bench                    # Run 5-node benchmark
cmp peers                    # List connected peers
cmp status                   # Show mesh status
```

## Security

CMP operates on a **zero-trust** principle. No device is assumed honest.

- **ECDH key exchange** (X25519) for every peer session
- **All data encrypted** in transit (NaCl secretbox)
- **WASM sandboxes** with zero system access
- **Secret sharing** for CONFIDENTIAL data — no single device sees full input
- **Redundant execution** with majority voting to detect tampering
- **Code verification** — WASM modules verified by SHA-256 hash before execution
- **Memory zeroed** after every computation

## Incentive Model

No cryptocurrency. No payment. CMP uses **reciprocity credits**:

- Earn CCU (Compute Credit Units) by executing tasks for others
- Spend CCU by submitting tasks to the mesh
- New devices get 100 CCU bootstrap credits
- Reputation score (0-10000) based on completion rate, accuracy, and reliability
- Bad actors get deprioritized, then excluded

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

CMP is an open protocol. Propose changes via the **CEP (CMP Enhancement Proposal)** process.

## Protocol Specification

The full protocol specification is at [`spec/CMP-v1.0.md`](./spec/CMP-v1.0.md).

## License

MIT — use CMP for anything. No royalties, no permission needed.

---

<p align="center">
  <strong>"The compute is already there. There's just no protocol to use it collectively."</strong><br>
  <em>— Agent Viscro</em>
</p>
