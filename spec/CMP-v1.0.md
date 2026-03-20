# CMP: Compute Mesh Protocol — Specification v1.0

**Status:** Draft  
**Author:** Agent Viscro  
**Date:** March 2026  
**License:** CC-BY-4.0  

---

## Abstract

The Compute Mesh Protocol (CMP) defines an open standard for proximity-based distributed computation across heterogeneous consumer devices. CMP enables nearby devices to dynamically discover each other, negotiate available compute resources, decompose computational tasks, execute workloads in secure sandboxed environments, and reassemble results — all without centralized cloud infrastructure or persistent internet connectivity.

## 1. Introduction

### 1.1 Problem

Modern computation routes all processing through distant cloud data centers. This model has fundamental limitations: latency (50-500ms round-trips), single points of failure (cloud outages, internet disruptions), privacy risks (data traverses networks to reach processing), cost (recurring cloud expenses), and energy waste (data transmission + data center overhead).

Meanwhile, billions of consumer devices sit with over 85% idle compute capacity at any given time.

### 1.2 Solution

CMP enables nearby devices — smartphones, tablets, laptops, IoT devices — to form ephemeral compute meshes. Devices discover each other, pool their idle resources, and collectively execute computational tasks with zero infrastructure.

### 1.3 Design Goals

1. **Zero Infrastructure** — No servers, cloud, or persistent internet required
2. **Heterogeneous** — Works across radically different hardware
3. **Security First** — Zero-trust; all computation sandboxed
4. **Privacy Preserving** — Data encrypted; optional secret sharing
5. **Fault Tolerant** — Handles device departure gracefully
6. **Incentive Compatible** — Reciprocity credits encourage participation

## 2. Protocol Architecture

CMP is a 6-layer stack:

| Layer | Name | Responsibility |
|-------|------|---------------|
| 6 | Assembly | Result collection, verification, reconstruction |
| 5 | Execution | Sandboxed computation on participating devices |
| 4 | Distribution | Task splitting and chunk assignment |
| 3 | Negotiation | Resource bidding and task matching |
| 2 | Capability | Resource advertisement and capability mapping |
| 1 | Discovery | Device detection and mesh formation |

### 2.1 Layer 1: Discovery

Devices broadcast 38-byte beacons over BLE, Wi-Fi Direct, or LAN multicast. Beacon frame format:

```
CMP_BEACON (38 bytes):
  magic:           3 bytes  (0x434D50 = "CMP")
  version:         1 byte
  mesh_id:         16 bytes (random per session)
  capability_hash: 8 bytes  (truncated SHA-256)
  timestamp:       8 bytes  (Unix ms, big-endian)
  ttl:             1 byte   (hop count, default 3)
  flags:           1 byte   (bit 0: accepting tasks,
                              bit 1: has pending tasks,
                              bit 2: relay capable)
```

**Transport Mechanisms:**

| Transport | Range | Bandwidth | Use Case |
|-----------|-------|-----------|----------|
| BLE 5.0+ | ~100m | 2 Mbps | Discovery, small control messages |
| Wi-Fi Direct | ~200m | 250 Mbps | Primary data channel |
| LAN | Local | 1 Gbps | Same-network devices |
| Wi-Fi Aware | ~100m | 250 Mbps | Zero-config discovery |

**Handshake:** After beacon exchange, devices perform ECDH key exchange (X25519) to establish a shared session key. No pre-shared credentials required.

**Peer Management:** Peers not seen for 30 seconds are marked stale; removed after 60 seconds.

### 2.2 Layer 2: Capability Exchange

After handshake, peers exchange capability profiles containing:

- **CPU:** architecture, available cores, clock speed, load percentage
- **Memory:** available MB, bandwidth
- **GPU:** type (none/mobile/discrete/NPU), compute units, features
- **Storage:** scratch space, read/write speed
- **Power:** source (battery/plugged/solar), battery %, thermal state
- **Runtimes:** supported execution environments (WASM, ONNX, TF Lite)
- **Reputation:** score (0-10000) from incentive layer

**Capability Tiers:**

| Tier | Description | Example |
|------|-------------|---------|
| T1 | CPU only, < 1GB RAM | IoT sensors, old phones |
| T2 | Multi-core, 2-4GB | Budget smartphones |
| T3 | CPU + mobile GPU, 4-8GB | Modern smartphones |
| T4 | CPU + strong GPU, 8-16GB | Tablets, laptops |
| T5 | CPU + discrete GPU, 16GB+ | Gaming laptops, workstations |

Profiles refresh every 10 seconds or on significant change (>20% CPU delta or >256MB memory delta).

### 2.3 Layer 3: Negotiation

When a device needs compute, it broadcasts a task request. Eligible devices respond with bids.

**Task Request** contains: task type, required runtime, payload size, compute budget (min cores, min memory, GPU required, deadline), security requirements, priority, and credits offered.

**Bid** contains: offered resources, estimated completion time, self-assessed confidence (0.0-1.0), and credits requested.

**Scoring Function:**

```
score = resource_match * 0.40
      + estimated_time * 0.25
      + reputation     * 0.20
      + power_stability * 0.15
      + confidence_bonus (up to 0.05)
```

Bids are collected for a configurable window (default: 500ms), scored, and top candidates are assigned.

### 2.4 Layer 4: Distribution

Tasks are decomposed into chunks using one of four strategies:

| Strategy | Description | Use Case |
|----------|-------------|----------|
| Data Parallel | Same code on different data partitions | Batch inference, image processing |
| Pipeline | Sequential stages on different devices | Multi-stage ML pipelines |
| Scatter-Gather | Same data to all, collect diverse results | Ensemble inference, consensus |
| Model Parallel | Different model parts on different devices | Large models exceeding single device |

For CONFIDENTIAL tasks, input data is split using XOR-based additive secret sharing. No single executor device can reconstruct the full input.

### 2.5 Layer 5: Execution

All computation runs inside sandboxed environments. CMP defines three conformance levels:

| Level | Runtime | Isolation | Portability |
|-------|---------|-----------|-------------|
| L1 (Required) | WebAssembly | Memory-safe, no system access | Universal |
| L2 (Optional) | Container-Lite | Process isolation | Linux/Android |
| L3 (Optional) | Hardware TEE | Trusted Execution Environment | Device-specific |

WASM (L1) is mandatory. Every CMP device MUST support WASM execution.

**Sandbox Restrictions:** Zero filesystem access. Zero network access. Zero sensor access. Only memory operations, math, and logging permitted. Memory is zeroed after execution.

**Resource Governance:** CPU time limits enforced via timeout. Memory hard-capped. Output size limited. Violations terminate the sandbox immediately.

### 2.6 Layer 6: Assembly

Results are collected and verified before reassembly.

**Verification Modes:**

| Mode | Description | Overhead |
|------|-------------|----------|
| NONE | Accept without verification | 0% |
| CHECKSUM | Hash comparison | ~5% |
| REDUNDANT | Same chunk on N devices, majority vote | Nx compute |
| ZK_PROOF | Zero-knowledge proof of execution | ~30% |

Reassembly strategy depends on decomposition: concatenation for data-parallel, last-stage output for pipeline, all results for scatter-gather.

## 3. Security Model

CMP operates on **zero-trust**: no device is assumed honest.

| Threat | Mitigation |
|--------|-----------|
| Malicious executor returns wrong results | Redundant execution + majority voting |
| Executor extracts input data | Chunk encryption + secret sharing |
| Modified code execution | SHA-256 hash verification before execution |
| Resource abuse | Sandbox limits + timeouts |
| Sybil attack (fake identities) | Proof-of-proximity + reputation system |
| Replay attack | Unique task/chunk IDs + timestamps + nonces |

**Cryptographic Primitives:**
- Key exchange: X25519 (Curve25519 ECDH)
- Symmetric encryption: NaCl secretbox (XSalsa20-Poly1305)
- Hashing: SHA-512 truncated to 256 bits
- Signatures: Ed25519
- Random: Device-native CSPRNG

## 4. Incentive Mechanism

CMP uses reciprocity-based credits (no cryptocurrency):

- **CCU** (Compute Credit Unit) = 1 CPU-core-second at 1GHz ARM Cortex-A76 equivalent
- Earn CCU by executing tasks; spend CCU by submitting tasks
- New devices receive 100 CCU bootstrap credits
- **Reputation** (0-10000) based on: completion rate (35%), accuracy (30%), availability (20%), resource honesty (15%)
- Reputation decays 5% per week of inactivity
- Below 2000: deprioritized. Below 500: excluded.

## 5. Fault Tolerance

- **Heartbeats:** Executors send heartbeats every 2 seconds. 3 missed = suspected. 5 missed = dead.
- **Chunk Reassignment:** Orphaned chunks are re-offered with URGENT priority. If no taker, execute locally.
- **Checkpointing:** Long-running tasks checkpoint every 10 seconds to 2 nearby peers. Replacements resume from checkpoint.
- **Graceful Departure:** Devices send DEPARTURE_NOTICE, giving 5 seconds for reassignment. No reputation penalty.

## 6. Performance Targets

| Metric | Target |
|--------|--------|
| Discovery to mesh formation | < 3 seconds |
| Negotiation round-trip | < 500 ms |
| Protocol overhead | < 10% of payload |
| WASM vs native overhead | < 15% |
| 5-device throughput | > 3x single device |
| Fault recovery | < 2 seconds |

## 7. Governance

- **Open protocol** — no single entity controls CMP
- **CEP process** (CMP Enhancement Proposals) for changes
- **Semantic versioning** with 12-month transition for breaking changes
- **Spec license:** CC-BY-4.0
- **Implementation license:** MIT

## Appendix A: Wire Formats

All non-beacon messages use TLV encoding:

```
MESSAGE:
  type:    1 byte  (MessageType enum)
  length:  4 bytes (big-endian payload length)
  payload: N bytes (JSON in v1.0, protobuf in v1.1)
```

Message types: BEACON (0x01), HANDSHAKE_INIT (0x02), HANDSHAKE_RESPONSE (0x03), CAPABILITY_EXCHANGE (0x04), TASK_REQUEST (0x10), BID (0x11), ASSIGNMENT (0x12), ASSIGNMENT_ACK (0x13), CHUNK_DATA (0x20), CHUNK_RESULT (0x21), HEARTBEAT (0x30), DEPARTURE_NOTICE (0x31).

## Appendix B: Reference Implementation

The reference implementation is available at: `github.com/agentviscro/cmp`

- **Language:** TypeScript 5.x
- **Packages:** @cmp/core, @cmp/transport, @cmp/runtime, @cmp/cli
- **Tests:** 150+ passing
- **Lines:** 10,550+

---

*CMP Specification v1.0 — Agent Viscro — March 2026*
