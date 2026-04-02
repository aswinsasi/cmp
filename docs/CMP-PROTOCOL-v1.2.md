# CMP: Compute Mesh Protocol — Complete Documentation v1.2

**Status:** Production  
**Author:** Agent Viscro  
**Date:** March 2026  
**License:** Specification CC-BY-4.0 / Implementation MIT  
**Repository:** github.com/agentviscro/cmp

---

## Abstract

The Compute Mesh Protocol (CMP) defines an open standard for proximity-based distributed computation across heterogeneous consumer devices. CMP enables nearby devices to dynamically discover each other, negotiate available compute resources, decompose computational tasks, execute workloads in secure sandboxed environments, and reassemble results — all without centralized cloud infrastructure or persistent internet connectivity.

CMP v1.2 implements a complete 8-layer protocol stack with 4 transport mechanisms, a mesh cognition system that learns from past computations, and full end-to-end encryption.

---

## Table of Contents

1. Introduction
2. Protocol Architecture
3. Layer 1: Discovery
4. Layer 2: Capability Exchange
5. Layer 3: Negotiation
6. Layer 4: Distribution
7. Layer 5: Execution
8. Layer 6: Assembly & Verification
9. Layer 7: Certification
10. Layer 8: Mesh Cognition (MCL)
11. Transport Layer
12. Wire Protocol
13. Security Model
14. Incentive Mechanism
15. Fault Tolerance
16. CLI Reference
17. Implementation Architecture
18. Performance Characteristics
19. Quick Start Guide

---

## 1. Introduction

### 1.1 Problem

Modern computation routes all processing through distant cloud data centers. This model has fundamental limitations: latency (50-500ms round-trips), single points of failure (cloud outages, internet disruptions), privacy risks (data traverses networks to reach processing), cost (recurring cloud expenses), and energy waste (data transmission plus data center overhead).

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

### 1.4 Implementation Summary

The reference implementation is written in TypeScript and consists of approximately 19,500 lines of source code and 10,900 lines of tests across 4 packages: @cmp/core, @cmp/transport, @cmp/runtime, and @cmp/cli. The implementation supports Node.js, browser, and React Native environments.

---

## 2. Protocol Architecture

CMP is an 8-layer protocol stack. Layers 1-6 form the core computation pipeline. Layer 7 provides cryptographic certification of results. Layer 8 adds machine learning capabilities that allow the mesh to improve over time.

| Layer | Name | Responsibility |
|-------|------|---------------|
| 8 | Mesh Cognition (MCL) | Learning from past computations, strategy optimization |
| 7 | Certification | Cryptographic proof of distributed execution |
| 6 | Assembly | Result collection, verification, reconstruction |
| 5 | Execution | Sandboxed computation on participating devices |
| 4 | Distribution | Task splitting and chunk assignment |
| 3 | Negotiation | Resource bidding and task matching |
| 2 | Capability | Resource advertisement and capability mapping |
| 1 | Discovery | Device detection and mesh formation |

The transport layer sits below Layer 1 and provides pluggable connectivity via BLE, LAN, and WebRTC.

---

## 3. Layer 1: Discovery

### 3.1 Beacon Format

Devices broadcast 38-byte beacons over the transport layer. The beacon is designed to fit within a single BLE advertisement packet.

```
CMP_BEACON (38 bytes):
  Offset  Size  Field
  0x00    3     magic            0x434D50 ("CMP")
  0x03    1     version          Protocol version (0x01)
  0x04    16    mesh_id          Random per-session node identity
  0x14    8     capability_hash  Truncated SHA-256 of capability profile
  0x1C    8     timestamp        Unix milliseconds, big-endian
  0x24    1     ttl              Hop count (default 3)
  0x25    1     flags            Bit 0: accepting tasks
                                 Bit 1: has pending tasks
                                 Bit 2: relay capable
```

### 3.2 Handshake

After beacon exchange, peers perform an ECDH key exchange using X25519 (Curve25519) to establish a shared session key. No pre-shared credentials are required. The handshake uses two message types: HANDSHAKE_INIT (0x02) and HANDSHAKE_RESPONSE (0x03).

The handshake payload contains:
- Sender's mesh ID (16 bytes)
- Sender's ephemeral X25519 public key (32 bytes)
- Sender's Ed25519 signing public key (32 bytes)
- Nonce (24 bytes)
- Timestamp (8 bytes)

### 3.3 Peer Management

Peers are tracked in a peer table with liveness detection:
- Peers not seen for 30 seconds are marked **stale**
- Peers not seen for 60 seconds are **removed**
- Beacon touch events refresh liveness timestamps
- Transport address mapping: mesh ID to transport address resolution

### 3.4 Address Resolution

The discovery layer maintains a bidirectional mapping between mesh IDs (16-byte protocol identifiers) and transport addresses (strings like "192.168.1.5:43580" or "webrtc:f203f7849d98cb96"). When a message needs to be sent to a specific mesh peer, the discovery layer resolves the mesh ID to the most recent transport address.

---

## 4. Layer 2: Capability Exchange

### 4.1 Capability Profile

After handshake, peers exchange detailed capability profiles containing:

- **CPU:** architecture (x86/ARM/RISC-V), available cores, clock speed MHz, current load percentage
- **Memory:** available MB, total MB, bandwidth
- **GPU:** type (NONE/MOBILE/DISCRETE/NPU), compute units, VRAM MB, features (FP16, INT8, etc.)
- **Storage:** scratch space MB, read/write speed MB/s
- **Power:** source (BATTERY/PLUGGED/SOLAR/UPS), battery percentage, thermal state (NOMINAL/WARM/HOT/THROTTLED)
- **Runtimes:** supported execution environments (WASM, ONNX, TF_LITE, SHADER, CUSTOM)
- **Reputation:** score from 0 to 10000 from the incentive layer

### 4.2 Capability Tiers

Devices are classified into 5 tiers based on their resources:

| Tier | Description | Typical Device |
|------|-------------|----------------|
| T1 | CPU only, less than 1GB RAM | IoT sensors, old phones |
| T2 | Multi-core, 2-4GB | Budget smartphones |
| T3 | CPU plus mobile GPU, 4-8GB | Modern smartphones |
| T4 | CPU plus strong GPU, 8-16GB | Tablets, laptops |
| T5 | CPU plus discrete GPU, 16GB or more | Gaming laptops, workstations |

### 4.3 Refresh Policy

Profiles are exchanged automatically after handshake and refresh every 10 seconds or when a significant change occurs (greater than 20% CPU delta or greater than 256MB memory delta).

### 4.4 Capability Map

The CapabilityMap aggregates all peer capabilities into a mesh-wide resource view. It provides:
- Candidate scoring with weighted factors (resource 40%, speed 25%, reputation 20%, power 15%)
- Budget matching: filters peers that can't meet minimum requirements
- Tier distribution analysis across the mesh
- Exclusion of low-battery (below 15%) and thermally throttled devices

---

## 5. Layer 3: Negotiation

### 5.1 Task Request

When a device needs compute, it sends a TASK_REQUEST to all active peers. The request contains:
- Task ID (16 bytes, randomly generated)
- Requester mesh ID
- Task type (MAP_REDUCE, INFERENCE, PIPELINE, SCATTER_GATHER)
- Required runtime (WASM, ONNX, etc.)
- Payload size in KB
- Compute budget: minimum cores, minimum memory MB, GPU required, deadline in milliseconds
- Security requirements (encryption level, verification mode)
- Priority (LOW, NORMAL, HIGH, URGENT)
- Credits offered

### 5.2 Bidding

Eligible peers evaluate the task request through an 8-gate evaluation:

1. **Reputation gate:** Is our reputation above the participation threshold?
2. **Accepting gate:** Are we currently accepting tasks?
3. **Capacity gate:** Are we below max concurrent tasks?
4. **Battery gate:** Is battery above 15%?
5. **Thermal gate:** Is the device not throttled?
6. **Runtime gate:** Do we support the required runtime?
7. **Resource gate:** Can we meet minimum resource requirements?
8. **Deadline gate:** Can we complete within the deadline?

If all gates pass, the peer constructs a BID containing: offered resources, estimated completion time, self-assessed confidence (0.0 to 1.0), and credits requested.

### 5.3 Scoring and Assignment

Bids are collected for a configurable window (default: 3000ms, early-resolves after minimum bids received plus 200ms grace period). Bids are scored using a weighted function:

```
score = resource_match   * 0.40
      + estimated_time    * 0.25
      + reputation        * 0.20
      + power_stability   * 0.15
      + confidence_bonus  (up to 0.05)
```

Top-scoring peers are assigned task chunks. Assignment messages include the peer's resolved transport address and the specific chunk IDs they should execute.

---

## 6. Layer 4: Distribution

### 6.1 Decomposition Strategies

Tasks are decomposed into chunks using one of four strategies:

| Strategy | Description | Use Case |
|----------|-------------|----------|
| DATA_PARALLEL | Same code on different data partitions | Batch processing, image filters |
| PIPELINE | Sequential stages on different devices | Multi-stage ML pipelines |
| SCATTER_GATHER | Same data to all, collect diverse results | Ensemble inference, consensus |
| MODEL_PARALLEL | Different model parts on different devices | Large models exceeding single device |

### 6.2 Secret Sharing

For CONFIDENTIAL security level tasks, input data is split using XOR-based additive secret sharing before distribution. No single executor device can reconstruct the full input. The protocol also supports Shamir's Secret Sharing with configurable threshold (k-of-n reconstruction) over GF(256) for higher security levels.

### 6.3 Chunk Format

Each chunk sent to an executor contains:
- Chunk ID (16 bytes)
- Parent task ID (16 bytes)
- WASM module binary (content-addressed by SHA-256 hash)
- Encrypted input data partition
- Entry point function name
- Resource limits (memory cap, CPU timeout)

---

## 7. Layer 5: Execution

### 7.1 WASM Sandbox

All distributed computation runs inside a WebAssembly sandbox with strict isolation:

- **Zero filesystem access** — no reads or writes to disk
- **Zero network access** — no HTTP, socket, or DNS calls
- **Zero sensor access** — no camera, microphone, or GPS
- **Memory isolation** — linear memory hard-capped at configured limit
- **CPU timeout** — execution terminated after deadline
- **Memory zeroing** — sandbox memory zeroed on destroy to prevent data leakage

### 7.2 Conformance Levels

| Level | Runtime | Isolation | Portability |
|-------|---------|-----------|-------------|
| L1 (Required) | WebAssembly | Memory-safe, no system access | Universal |
| L2 (Optional) | Container-Lite | Process isolation | Linux/Android |
| L3 (Optional) | Hardware TEE | Trusted Execution Environment | Device-specific |

WASM (L1) is mandatory. Every CMP device MUST support WASM execution.

### 7.3 Multi-Runtime Support

The runtime layer also supports local (non-distributed) execution in 14 languages: JavaScript, TypeScript, Python, Ruby, PHP, Perl, Lua, Go, Rust, C, C++, Java, Kotlin, and Swift. These run as subprocesses on the local device only and are not sandboxed for mesh distribution. Only WASM modules are distributed across the mesh.

### 7.4 Resource Monitoring

The ResourceMonitor provides real-time tracking of:
- CPU usage percentage
- Memory consumption in MB
- Thermal state (NOMINAL, WARM, HOT, THROTTLED)
- Violation callbacks when limits are exceeded

### 7.5 Code Cache

The CodeCache stores previously loaded WASM modules using content-addressed storage (SHA-256 hash as key). Features:
- Integrity verification on load
- LRU eviction when cache exceeds size limit
- Shared across tasks to avoid redundant module compilation

---

## 8. Layer 6: Assembly & Verification

### 8.1 Verification Modes

| Mode | Description | Overhead |
|------|-------------|----------|
| NONE | Accept without verification | 0% |
| CHECKSUM | Hash comparison of results | ~5% |
| REDUNDANT | Same chunk on N devices, majority vote | Nx compute |
| ZK_PROOF | Zero-knowledge proof of execution | ~30% |

### 8.2 Reassembly

Reassembly strategy depends on the decomposition used:
- **Data Parallel:** Concatenation of chunk results in order
- **Pipeline:** Output from the last stage
- **Scatter-Gather:** All results collected and returned
- **Model Parallel:** Merged based on model topology

### 8.3 Result Format

Each chunk result contains:
- Chunk ID and parent task ID
- Status (SUCCESS, FAILED, TIMEOUT, RESOURCE_VIOLATION)
- Encrypted result payload
- Execution time in milliseconds
- Executor's mesh ID and signature

---

## 9. Layer 7: Certification

### 9.1 Computation Certificates

For tasks requiring cryptographic proof of distributed execution, CMP generates Computation Certificates. These are standalone, verifiable documents proving that multiple independent devices contributed to a computation.

A certificate contains:
- Task ID and timestamp
- List of device attestations (executor mesh IDs, chunk assignments, execution times)
- Cryptographic signatures from each participating device
- Result hash (SHA-256)
- Verification mode used

### 9.2 Certificate Verification

Certificates can be independently verified by any party with access to the participating devices' public keys. The verification process checks:
- All signatures are valid Ed25519 signatures
- Timestamps are within acceptable bounds
- Result hashes match across redundant executions
- The certificate was generated by a valid CMP mesh

---

## 10. Layer 8: Mesh Cognition Layer (MCL)

### 10.1 Overview

The Mesh Cognition Layer (MCL) is CMP's learning system, added in v1.2. It enables the mesh to learn from past computations and optimize future task distribution. MCL operates autonomously — no configuration required.

### 10.2 Mesh Execution Records (MERs)

Every completed task generates a MER containing:
- Task type and decomposition strategy used
- Chunk count and sizes
- Execution times per device
- Resource utilization metrics
- Success/failure status
- Efficiency score (0-100)
- Confidence rating

MERs are stored in SQLite for persistence across sessions.

### 10.3 Components

**Bloom Filter:** Probabilistic data structure for fast MER existence checks. Avoids expensive lookups for common queries.

**DHT (Distributed Hash Table):** Kademlia-based distributed storage. MERs are stored across mesh peers based on content-addressed keys, providing resilience against individual device departure.

**Distributed Mesh Memory (DMM):** The aggregate memory of the mesh. Stores, queries, and evicts MERs based on relevance, age, and confidence scores. Supports task-type filtering and origin tracking.

**Pollinator:** Implements cross-mesh knowledge transfer. When peers from different meshes meet, they exchange relevant MERs — analogous to bees cross-pollinating flowers. This allows strategy optimizations to spread organically across independent mesh networks.

**Evolution Engine:** Applies micro-evolution with simulated annealing to task distribution strategies. Over many computations, the mesh converges on optimal chunk sizes, device selection, and decomposition strategies for each task type.

**Strategy Hints:** Given a task type, the MCL provides a recommended decomposition strategy, chunk count, and device selection criteria based on accumulated MER data.

### 10.4 MER Wire Protocol

MCL introduces 5 new message types:

| Type | Code | Purpose |
|------|------|---------|
| MER_OFFER | 0x70 | Peer advertises available MERs |
| MER_REQUEST | 0x71 | Request specific MERs by ID |
| MER_TRANSFER | 0x72 | Transfer MER data |
| MER_STORE | 0x73 | Store MER in DHT |
| MER_QUERY | 0x74 | Query MERs by task type |

### 10.5 Persistence

MERs persist across node restarts via SQLite. On startup, MERs are loaded from disk with expiration checking. Expired MERs are purged automatically.

---

## 11. Transport Layer

### 11.1 Transport Interface

All transports implement the `ITransport` interface, providing a uniform contract for discovery and data transfer:

```typescript
interface ITransport {
  readonly name: string;
  readonly maxPayloadBytes: number;
  readonly estimatedBandwidthMbps: number;

  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;

  startBeaconing(beaconData: Uint8Array, intervalMs: number): Promise<void>;
  stopBeaconing(): Promise<void>;
  startScanning(): Promise<void>;
  stopScanning(): Promise<void>;

  sendTo(peerAddress: string, data: Uint8Array): Promise<void>;
  broadcast(data: Uint8Array): Promise<void>;

  on(event: string, handler: TransportEventHandler): void;
  off(event: string, handler: TransportEventHandler): void;
}
```

Transport events: `peer_discovered`, `peer_lost`, `message`, `error`.

### 11.2 LAN Transport

UDP multicast for beacon discovery plus TCP for reliable data transfer.

- **Discovery:** UDP multicast on 239.77.67.80:43580
- **Data:** TCP server on a random high port (advertised in beacon header)
- **Self-filtering:** 8-byte random instance ID prevents processing own beacons
- **Same-machine support:** Multiple nodes on the same machine discover each other via instance ID filtering (not IP filtering)
- **Fallback:** UDP broadcast on 255.255.255.255 for networks where multicast is blocked (mobile hotspots)

UDP beacon packet format:
```
[instanceId: 8 bytes][tcpPort: 2 bytes BE][beacon payload: N bytes]
```

TCP framing:
```
[payloadLength: 4 bytes BE][payload: N bytes]
```

Estimated bandwidth: 1000 Mbps. Max payload: 1 MB.

### 11.3 BLE Transport

Bluetooth Low Energy transport for laptop-to-laptop mesh communication.

- **Discovery:** BLE advertisements carry CMP beacon in manufacturer data
- **Data transfer:** GATT characteristics (write + notify)
- **Large messages:** Fragmented into 480-byte chunks with `[totalLen: 4B][offset: 4B][payload]` headers
- **Reassembly:** 10-second timeout for incomplete fragment buffers

GATT service UUID: `434d5000-0000-0000-0000-000000000001`
Manufacturer ID: 0x4D43 ("CM")

Dependencies: `@stoprocent/noble` (central/scan) and `@stoprocent/bleno` (peripheral/advertise).

Estimated bandwidth: 2 Mbps. Max payload: 1 MB (fragmented).

### 11.4 WebRTC Transport

WebRTC DataChannel transport for high-throughput, low-latency mesh data transfer with NAT traversal capability. Added in v1.2.

#### 11.4.1 Architecture

- **Discovery:** Beacons exchanged via pluggable signaling channel
- **Connection:** RTCPeerConnection with STUN/TURN for NAT traversal
- **Data Transfer:** Reliable ordered DataChannel ("cmp-data")
- **Large Messages:** Fragmented with `[0xFF magic: 1B][totalLen: 4B][offset: 4B][seqId: 4B][chunk]` headers

Estimated bandwidth: 250 Mbps. Max payload: 16 MB (fragmented over 64KB DataChannel chunks).

#### 11.4.2 Signaling Strategies

Two pluggable signaling modes:

**WebSocket Signaling:** Connects to a lightweight relay server for NAT traversal. The server is a dumb relay — no state, no auth (or optional HMAC-SHA256 token auth). Supports auto-reconnect with linear backoff.

```typescript
const signaling = new WebSocketSignaling('ws://signal.example.com:9090');
```

**InBand Signaling:** Uses an existing CMP transport (LAN or BLE) as the signaling channel. SDP offers/answers and ICE candidates are serialized as JSON and prefixed with `0xFC` byte to distinguish from regular CMP messages. Fully serverless — zero additional infrastructure.

```typescript
const signaling = new InBandSignaling(lanTransport);
```

#### 11.4.3 Connection Lifecycle

1. Peer A sees beacon from Peer B via signaling channel
2. Higher instance ID initiates (prevents simultaneous offers)
3. Initiator creates RTCPeerConnection and DataChannel, sends SDP offer
4. Responder sets remote description, creates answer, sends it back
5. Both sides trickle ICE candidates
6. ICE connects (typically "host" candidate type on same LAN)
7. DataChannel opens — ready for CMP messages

Conflict resolution uses the "polite peer" pattern: if both sides simultaneously create offers, the peer with the lower instance ID yields and accepts the other's offer.

#### 11.4.4 Production Features

**Backpressure:** Queue-and-drain system. Sends pause at 1MB high-water mark on the DataChannel buffer. Queued messages auto-drain on `onbufferedamountlow` event. Rejects new sends at 16MB queue cap.

**ICE Restart:** On ICE `disconnected` state, a 3-second grace period allows natural recovery. If still disconnected, the initiator triggers `createOffer({ iceRestart: true })`. Capped at 3 ICE restart attempts before falling back to full reconnection.

**Peer Reconnection:** Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s, capped at 30s. Configurable max attempts (default 5). Only reconnects to peers with known beacons.

**RTCStats Collection:** Periodic `getStats()` extracts round-trip time, bytes/packets sent/received, packet loss, and ICE candidate types (host/srflx/relay). Accessible via `getStats()` and `collectStatsNow()`.

**TURN Credential Refresh:** Configurable `refreshIceServers` callback for rotating TURN credentials. Hot-updates existing connections via `setConfiguration()`.

**Fragment Wire Format:**
```
[0xFF: 1B][totalLen: 4B BE][offset: 4B BE][seqId: 4B BE][chunk data]
```

The 0xFF magic byte prevents collision with CMP protocol frames (which start with 0x43 "C").

#### 11.4.5 Signal Server

Standalone WebSocket relay server with production security:

- **HMAC-SHA256 token auth** via `?token=timestamp:hmac` query parameter
- **Per-IP rate limiting** (default 50 messages/second)
- **Connection limits** (default 10 per IP)
- **Max message size** enforcement (default 64KB)
- **Health endpoint** at `/health` with metrics (total messages relayed, connections accepted/rejected)
- **Graceful shutdown** with SIGINT/SIGTERM handlers

Token generation:
```typescript
import { generateSignalToken } from '@cmp/transport';
const token = generateSignalToken('shared-secret', peerId);
// Result: "1711234567:a1b2c3d4e5f6..."
```

### 11.5 Virtual Transport

In-memory transport for testing and mesh simulation. All VirtualTransport instances sharing the same VirtualNetwork can discover and communicate with each other. Supports configurable latency and packet loss simulation.

Estimated bandwidth: unlimited (in-memory). Max payload: 1 MB.

### 11.6 Multi-Transport Aggregator

The MultiTransport wraps multiple transport implementations and provides:
- Unified event forwarding from all child transports
- Automatic transport selection based on bandwidth ranking
- Per-peer transport tracking — remembers which transport discovered each peer
- Payload size capability filtering

Priority ranking (by bandwidth): LAN (1000 Mbps) > WebRTC (250 Mbps) > BLE (2 Mbps).

---

## 12. Wire Protocol

### 12.1 CMP Frame Format (v1.2)

All non-beacon messages use the CMP Frame format:

```
CMP Frame (16-byte header + payload):
  Offset  Size  Field
  0x00    3     magic        0x43 0x4D 0x50 ("CMP")
  0x03    1     version      0x01
  0x04    1     msg_type     MessageType enum
  0x05    1     flags        Bit 0: LZ4 compressed
                             Bit 1: encrypted
                             Bit 2: fragmented
  0x06    2     sequence     uint16 big-endian (monotonic per session)
  0x08    4     payload_len  uint32 big-endian
  0x0C    4     checksum     CRC-32C of payload
  0x10    var   payload      Message-type-specific content
```

Maximum payload size: 16 MB.

### 12.2 Message Types

| Type | Code | Direction | Purpose |
|------|------|-----------|---------|
| BEACON | 0x01 | Broadcast | Discovery advertisement |
| HANDSHAKE_INIT | 0x02 | Unicast | Key exchange initiation |
| HANDSHAKE_RESPONSE | 0x03 | Unicast | Key exchange completion |
| CAPABILITY_EXCHANGE | 0x04 | Unicast | Resource profile sharing |
| TASK_REQUEST | 0x10 | Unicast/Broadcast | Compute task submission |
| BID | 0x11 | Unicast | Resource offer for task |
| ASSIGNMENT | 0x12 | Unicast | Chunk assignment to winner |
| ASSIGNMENT_ACK | 0x13 | Unicast | Executor confirms assignment |
| CHUNK_DATA | 0x20 | Unicast | Code + encrypted input data |
| CHUNK_RESULT | 0x21 | Unicast | Encrypted computation result |
| HEARTBEAT | 0x30 | Unicast | Executor liveness signal |
| DEPARTURE_NOTICE | 0x31 | Broadcast | Graceful node departure |
| CHECKPOINT_STORE | 0x40 | Unicast | Save checkpoint to peer |
| CHECKPOINT_REQUEST | 0x41 | Unicast | Request checkpoint data |
| CHECKPOINT_RESPONSE | 0x42 | Unicast | Return checkpoint data |
| CODE_REQUEST | 0x50 | Unicast | Request WASM module |
| CODE_RESPONSE | 0x51 | Unicast | Deliver WASM module |
| CREDIT_RECEIPT | 0x60 | Unicast | Payment confirmation |
| MER_OFFER | 0x70 | Broadcast | Advertise available MERs |
| MER_REQUEST | 0x71 | Unicast | Request specific MERs |
| MER_TRANSFER | 0x72 | Unicast | Deliver MER data |
| MER_STORE | 0x73 | Unicast | Store MER in DHT |
| MER_QUERY | 0x74 | Unicast | Query MERs by type |

### 12.3 Backward Compatibility

The decoder auto-detects v1.2 CMP Frame format (magic bytes 0x43 0x4D 0x50) versus v1.0 TLV format (first byte is not 0x43). Both formats are handled transparently.

---

## 13. Security Model

### 13.1 Zero-Trust Architecture

CMP operates on zero-trust: no device is assumed honest.

| Threat | Mitigation |
|--------|-----------|
| Malicious executor returns wrong results | Redundant execution plus majority voting |
| Executor extracts input data | Chunk encryption plus secret sharing |
| Modified code execution | SHA-256 hash verification before execution |
| Resource abuse | Sandbox limits plus timeouts |
| Sybil attack (fake identities) | Proof-of-proximity plus reputation system |
| Replay attack | Unique task/chunk IDs plus timestamps plus nonces |
| Man-in-the-middle | ECDH key exchange plus encrypted channels |
| Data leakage after execution | Memory zeroing on sandbox destroy |

### 13.2 Cryptographic Primitives

| Primitive | Algorithm |
|-----------|-----------|
| Key exchange | X25519 (Curve25519 ECDH) |
| Symmetric encryption | NaCl secretbox (XSalsa20-Poly1305) |
| Hashing | SHA-512 truncated to 256 bits |
| Signatures | Ed25519 |
| Random | Device-native CSPRNG |
| Secret sharing | XOR additive (default), Shamir k-of-n over GF(256) (configurable) |
| Integrity | CRC-32C on wire frames |

### 13.3 Encryption Flow

1. Peers establish shared session key via X25519 ECDH handshake
2. All subsequent messages encrypted with NaCl secretbox
3. Task input data encrypted per-chunk with unique nonce
4. Results encrypted with the same session key
5. Sandbox memory zeroed after execution

---

## 14. Incentive Mechanism

### 14.1 Compute Credits (CCU)

CCU (Compute Credit Unit) equals 1 CPU-core-second at 1GHz ARM Cortex-A76 equivalent.

- Earn CCU by executing tasks for other devices
- Spend CCU by submitting tasks to the mesh
- New devices receive 100 CCU bootstrap credits
- Credits are tracked per-node in an in-memory ledger

### 14.2 Reputation System

Reputation score ranges from 0 to 10000, calculated from:

| Factor | Weight |
|--------|--------|
| Completion rate | 35% |
| Result accuracy | 30% |
| Availability | 20% |
| Resource honesty | 15% |

Reputation decays 5% per week of inactivity. Below 2000: deprioritized in bid scoring. Below 500: excluded from task assignment. Successful task completion increases reputation; failures decrease it.

---

## 15. Fault Tolerance

### 15.1 Heartbeats

Executors send HEARTBEAT messages every 2 seconds during chunk execution. 3 missed heartbeats mark the executor as suspected. 5 missed heartbeats mark it as dead.

### 15.2 Chunk Reassignment

Orphaned chunks (from dead executors) are re-offered to the mesh with URGENT priority. If no peer bids within the window, the requester executes the chunk locally as a fallback.

### 15.3 Checkpointing

Long-running tasks checkpoint every 10 seconds. Checkpoints are stored on 2 nearby peers (CHECKPOINT_STORE). If an executor dies, the replacement can resume from the last checkpoint (CHECKPOINT_REQUEST/CHECKPOINT_RESPONSE) rather than restarting from scratch.

### 15.4 Graceful Departure

When a device is about to leave the mesh, it sends a DEPARTURE_NOTICE broadcast, giving the mesh 5 seconds to reassign any active chunks. No reputation penalty for graceful departures. The MCL engine also attempts to hand off accumulated MERs to nearby peers before departure.

### 15.5 Local Fallback

If no peers are available or all bids fail, CMP automatically falls back to local execution on the requesting device. This ensures tasks always complete, even in a single-node mesh.

---

## 16. CLI Reference

### 16.1 Starting Nodes

```bash
# LAN transport (default)
npx tsx packages/cli/src/cli.ts start

# LAN + WebRTC (serverless — SDP/ICE rides LAN multicast)
npx tsx packages/cli/src/cli.ts start --webrtc

# LAN + WebRTC via signal server
npx tsx packages/cli/src/cli.ts start --webrtc --signal ws://localhost:9090

# Bluetooth transport
npx tsx packages/cli/src/cli.ts start --ble

# Debug logging
npx tsx packages/cli/src/cli.ts start --webrtc --verbose

# Custom resource share
npx tsx packages/cli/src/cli.ts start --share 75
```

### 16.2 Signal Server

```bash
# Start signaling relay (default port 9090)
npx tsx packages/cli/src/cli.ts signal

# Custom port
npx tsx packages/cli/src/cli.ts signal 8080

# With HMAC auth (set secret via environment variable)
CMP_SIGNAL_SECRET=mysecret npx tsx packages/cli/src/cli.ts signal 9090
```

### 16.3 REPL Commands

| Command | Description |
|---------|-------------|
| `encrypt [--chunks N] <message>` | Encrypt text via mesh WASM XOR cipher |
| `decrypt <hex>` | Decrypt hex ciphertext |
| `connect <ip>` | Connect to a peer by IP address |
| `peers` | Show connected peers with tier, cores, memory |
| `status` | Show mesh status, credits, MCL info |
| `certify <message>` | Encrypt with Computation Certificate |
| `run <lang> <file\|code> [input]` | Run code (WASM: mesh, others: local) |
| `languages` | Show supported runtime languages |
| `mcl` | MCL status (MERs, pollination, profile) |
| `mcl mers [type]` | List stored MERs |
| `mcl hint [type]` | Show strategy recommendation |
| `mcl export [file.json]` | Export MERs to JSON |
| `mcl purge` | Remove expired MERs |
| `webrtc` | WebRTC transport status |
| `webrtc peers` | List DataChannel peers |
| `webrtc stats` | Show RTT, bandwidth, candidate types |
| `help` | Show all commands |
| `quit` | Graceful shutdown |

### 16.4 Benchmark

```bash
npx tsx packages/cli/src/cli.ts bench
```

Runs a 5-node virtual mesh benchmark: mesh formation, WASM encryption across 4 chunks on 4 devices.

---

## 17. Implementation Architecture

### 17.1 Package Structure

```
cmp/
├── packages/
│   ├── core/                       # Protocol logic (platform-agnostic)
│   │   ├── src/
│   │   │   ├── cmp-node.ts        # Main integration class
│   │   │   ├── types/             # All protocol type definitions
│   │   │   │   ├── beacon.ts      # Beacon frame, MessageType enum
│   │   │   │   ├── capability.ts  # CPU, GPU, Memory, Power types
│   │   │   │   ├── certificate.ts # Computation certificate types
│   │   │   │   ├── incentive.ts   # CCU, reputation types
│   │   │   │   ├── mcl.ts         # MER, DHT, Bloom filter types
│   │   │   │   ├── negotiation.ts # Task request, bid, assignment types
│   │   │   │   ├── task.ts        # Task, chunk types
│   │   │   │   └── result.ts      # Result types
│   │   │   ├── layers/            # Protocol layer implementations
│   │   │   │   ├── discovery.ts   # Layer 1: beacon, handshake, peer mgmt
│   │   │   │   ├── profiler.ts    # Device profiling (CPU, memory, GPU)
│   │   │   │   ├── capability-exchange.ts  # Layer 2: profile sharing
│   │   │   │   ├── capability-map.ts       # Mesh-wide resource aggregation
│   │   │   │   ├── negotiation-engine.ts   # Layer 3: requester side
│   │   │   │   ├── bid-handler.ts          # Layer 3: executor side
│   │   │   │   ├── serializer.ts  # Wire protocol codec (v1.0 TLV + v1.2 Frame)
│   │   │   │   └── beacon-codec.ts # 38-byte beacon encoder/decoder
│   │   │   ├── mcl/               # Layer 8: Mesh Cognition
│   │   │   │   ├── engine.ts      # MCL orchestrator
│   │   │   │   ├── mer.ts         # MER creation and scoring
│   │   │   │   ├── bloom.ts       # Bloom filter
│   │   │   │   ├── dht.ts         # Kademlia DHT
│   │   │   │   ├── dmm.ts         # Distributed Mesh Memory
│   │   │   │   ├── pollinator.ts  # Cross-mesh knowledge transfer
│   │   │   │   ├── evolution.ts   # Simulated annealing optimizer
│   │   │   │   ├── hints.ts       # Strategy recommendation engine
│   │   │   │   ├── persistence.ts # SQLite MER storage
│   │   │   │   └── profile.ts     # Mesh behavior profiling
│   │   │   ├── mesh/              # Core mesh infrastructure
│   │   │   │   ├── peer-table.ts  # Active peer management
│   │   │   │   └── event-bus.ts   # Typed event system
│   │   │   ├── crypto/            # Cryptographic primitives
│   │   │   │   └── index.ts       # X25519, Ed25519, NaCl, SHA-512
│   │   │   ├── incentive/         # Credit and reputation system
│   │   │   │   ├── index.ts       # IncentiveLedger
│   │   │   │   └── ledger.ts      # CCU accounting
│   │   │   └── utils/             # Configuration, logging, helpers
│   │   │       ├── config.ts      # Default protocol parameters
│   │   │       ├── logger.ts      # Leveled logger with output hooks
│   │   │       ├── helpers.ts     # Hex, shortId, concat utilities
│   │   │       └── crc32c.ts      # CRC-32C implementation
│   │   └── tests/                 # 20 test suites
│   ├── transport/                  # Transport implementations
│   │   └── src/
│   │       ├── interface.ts       # ITransport contract
│   │       ├── lan-transport.ts   # UDP multicast + TCP
│   │       ├── ble-transport.ts   # Bluetooth Low Energy (GATT)
│   │       ├── webrtc-transport.ts     # WebRTC DataChannel
│   │       ├── webrtc-signaling.ts     # Signaling abstractions
│   │       ├── webrtc-signal-server.ts # Relay server with auth
│   │       ├── virtual-transport.ts    # In-memory (testing)
│   │       ├── multi-transport.ts      # Transport aggregator
│   │       └── rn-lan-transport.ts     # React Native variant
│   ├── runtime/                    # Execution environment
│   │   └── src/
│   │       ├── wasm-sandbox.ts    # WASM sandbox with resource limits
│   │       ├── execution-engine.ts # Full chunk execution lifecycle
│   │       ├── task-distributor.ts # Task decomposition strategies
│   │       ├── result-assembler.ts # Result collection + verification
│   │       ├── data-splitter.ts   # Secret sharing + parallel splitting
│   │       ├── resource-monitor.ts # CPU/memory/thermal monitoring
│   │       ├── code-cache.ts      # Content-addressed module cache
│   │       ├── multi-runtime.ts   # 14-language local execution
│   │       ├── shamir.ts          # Shamir secret sharing
│   │       └── gf256.ts           # Galois Field GF(256) arithmetic
│   ├── cli/                        # Command-line interface
│   │   └── src/cli.ts             # Interactive REPL with all commands
│   └── modules/                    # Pre-compiled WASM modules
│       └── dist/                  # 9 modules: blur, brightness, contrast,
│                                  # grayscale, histogram, invert, sepia,
│                                  # threshold, xor-cipher
└── spec/
    └── CMP-v1.0.md                # Protocol specification
```

### 17.2 Key Dependencies

| Dependency | Purpose |
|------------|---------|
| tweetnacl | Pure JS crypto (X25519, Ed25519, secretbox) |
| better-sqlite3 | MER persistence |
| ws | WebSocket signaling server (optional) |
| @roamhq/wrtc | Node.js WebRTC (optional, for WebRTC transport) |
| @stoprocent/noble | BLE central/scan (optional, for BLE transport) |
| @stoprocent/bleno | BLE peripheral/advertise (optional, for BLE transport) |

Core protocol has zero native dependencies — only tweetnacl (pure JS).

### 17.3 CMPNode API

```typescript
import { CMPNode } from '@cmp/core';

// Create and start a node
const node = new CMPNode({
  transports: ['lan'],
  maxResourceShare: 0.5,    // Share 50% of resources
  acceptingTasks: true,
  logLevel: LogLevel.INFO,
});
await node.start();

// Submit computation
const result = await node.compute(wasmModule, inputData, {
  taskType: TaskType.MAP_REDUCE,
  deadline: 5000,
  securityLevel: SecurityLevel.STANDARD,
  verifyMode: VerifyMode.CHECKSUM,
});

// Access result
console.log(new TextDecoder().decode(result.data));
console.log(`Executed on ${result.devicesUsed} devices in ${result.timeMs}ms`);

// Query mesh status
const status = node.getStatus();  // peers, credits, MERs, capabilities
const peers = node.getPeers();    // detailed peer info

// Shutdown
await node.stop();
```

### 17.4 Adding WebRTC Transport Programmatically

```typescript
import { CMPNode } from '@cmp/core';
import { MultiTransport, LANTransport, WebRTCTransport, InBandSignaling } from '@cmp/transport';

// Build custom transport stack
const multi = new MultiTransport();
const lan = new LANTransport();
multi.register(lan);

// Serverless WebRTC — signals ride LAN multicast
const signaling = new InBandSignaling(lan);
multi.register(new WebRTCTransport(signaling));

// Create node with custom transport
const node = new CMPNode({ _transport: multi });
await node.start();
```

---

## 18. Performance Characteristics

### 18.1 Measured Performance (Two-Node LAN + WebRTC)

| Metric | Value |
|--------|-------|
| Discovery to mesh formation | Less than 3 seconds |
| WebRTC DataChannel RTT | 1.0ms (host-to-host) |
| End-to-end encrypt (11 bytes) | 258ms (mesh), 3047ms (local fallback) |
| Negotiation round-trip (bid + assign) | Less than 200ms |
| WASM sandbox execution | 1ms for XOR cipher |
| MER generation | Less than 10ms |
| Protocol overhead | 16 bytes per frame |

### 18.2 Target Performance

| Metric | Target |
|--------|--------|
| Discovery to mesh formation | Less than 3 seconds |
| Negotiation round-trip | Less than 500ms |
| Protocol overhead | Less than 10% of payload |
| WASM vs native overhead | Less than 15% |
| 5-device throughput | Greater than 3x single device |
| Fault recovery | Less than 2 seconds |

---

## 19. Quick Start Guide

### 19.1 Installation

```bash
git clone https://github.com/agentviscro/cmp.git
cd cmp
npm install
```

Optional transport dependencies:
```bash
# WebRTC (recommended)
npm install @roamhq/wrtc ws

# Bluetooth
npm install @stoprocent/noble @stoprocent/bleno
```

### 19.2 Two-Node Local Test

Terminal 1:
```bash
npx tsx packages/cli/src/cli.ts start --webrtc
```

Terminal 2:
```bash
npx tsx packages/cli/src/cli.ts start --webrtc
```

Wait for "Handshake complete" and "DataChannel open", then in either terminal:
```
cmp> encrypt Hello World
```

Expected output:
```
Mesh         Yes
Time         ~260ms
Devices      1
```

### 19.3 Running Tests

```bash
# Core protocol tests
npx ts-node --transpile-only packages/core/tests/phase1.test.ts
npx ts-node --transpile-only packages/core/tests/phase17-conformance.test.ts

# WebRTC transport tests
npx ts-node --transpile-only packages/transport/tests/webrtc-transport.test.ts

# All tests: 327+ passing across 30+ suites
```

### 19.4 Cross-Network Setup (via Signal Server)

Terminal 1 (signal server):
```bash
npx tsx packages/cli/src/cli.ts signal 9090
```

Terminal 2 (machine A):
```bash
npx tsx packages/cli/src/cli.ts start --webrtc --signal ws://SERVER_IP:9090
```

Terminal 3 (machine B):
```bash
npx tsx packages/cli/src/cli.ts start --webrtc --signal ws://SERVER_IP:9090
```

---

## Appendix A: Governance

- **Open protocol** — no single entity controls CMP
- **CEP process** (CMP Enhancement Proposals) for specification changes
- **Semantic versioning** with 12-month transition period for breaking changes
- **Specification license:** CC-BY-4.0
- **Implementation license:** MIT

## Appendix B: Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | March 2026 | Initial 6-layer protocol, LAN + BLE + Virtual transports |
| v1.2 | March 2026 | Layer 8 MCL, WebRTC transport, CMP Frame wire format, Shamir secret sharing, Computation Certificates, SQLite persistence |

---

*CMP: Compute Mesh Protocol — Complete Documentation v1.2*
*Agent Viscro — March 2026*
*"The compute is already there. There's just no protocol to use it collectively."*
