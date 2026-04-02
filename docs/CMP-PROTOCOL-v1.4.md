# CMP v1.4: Mesh Lifeforms — Complete Protocol Specification

**Status:** Implemented  
**Author:** Agent Viscro  
**Date:** March 2026  
**Base:** CMP v1.2 Protocol  
**License:** Specification CC-BY-4.0 / Implementation MIT  
**Repository:** github.com/agentviscro/cmp

---

## Abstract

CMP v1.4 extends the Compute Mesh Protocol from a distributed task execution system into a living computational substrate. Building on v1.2's 8-layer protocol stack and v1.3's five mesh intelligence systems, v1.4 introduces **Mesh Lifeforms** — persistent, autonomous computational entities that live on the mesh, react to causal events, merge and split like biological cells, evolve their own code through natural selection, and commit to verifiable goals.

The result is a system with no direct prior art: autonomous computation that reacts, fuses, evolves, and self-verifies — all on zero infrastructure.

**Implementation:** 50,521 lines TypeScript, 241+ tests, 74 wire protocol message types.

---

## Table of Contents

1. Protocol Overview
2. v1.3 Enhancements
   - 2.1 Mesh Precognition (Layer 9)
   - 2.2 Mesh Immune System
   - 2.3 Computation Metabolism
   - 2.4 Temporal Compute Futures
   - 2.5 Mesh Morphogenesis
3. v1.4 Lifeforms — Architecture
4. Core Types and Identity
5. CRDT State Engine
6. Causal Reactive Execution
7. Lifeform Lifecycle
8. Distribution (Host Selection, Migration, Replication, DNS)
9. Synapses and Communication
10. Computational Fusion/Fission
11. Genome Mutation and Natural Selection
12. Intent Contracts
13. Orchestration Bridge
14. Wire Protocol
15. CLI Reference
16. Implementation Architecture
17. Test Coverage
18. Quick Start

---

## 1. Protocol Overview

### 1.1 Layer Stack

CMP implements a 10-layer protocol stack. Layers 1-8 handle distributed task execution (v1.2). Layer 9 adds mesh precognition (v1.3). Layer 10 introduces autonomous Lifeforms (v1.4).

| Layer | Name | Purpose | Version |
|-------|------|---------|---------|
| 1 | Discovery | BLE/LAN/WiFi Direct/WebRTC peer finding | v1.0 |
| 2 | Capability Exchange | Resource advertisement and profiling | v1.0 |
| 3 | Negotiation | Task bidding and assignment | v1.0 |
| 4 | Distribution | Chunk splitting and routing | v1.0 |
| 5 | Execution | WASM sandboxed computation | v1.0 |
| 6 | Assembly & Verification | Result collection and validation | v1.0 |
| 7 | Certification | Computation certificates (provenance) | v1.1 |
| 8 | Mesh Cognition (MCL) | Learning from past executions | v1.2 |
| 9 | Precognition | Predictive scheduling and caching | v1.3 |
| 10 | Lifeforms | Autonomous computational entities | v1.4 |

### 1.2 Transport Layer

Four transports operate beneath the protocol stack:

| Transport | Range | Speed | Use Case |
|-----------|-------|-------|----------|
| BLE 5.0 | 100m | 2 Mbps | Low-power discovery and small payloads |
| LAN (UDP) | Network | 1 Gbps | Primary transport for local networks |
| WiFi Direct | 200m | 250 Mbps | Peer-to-peer without router |
| WebRTC | Global | Varies | Serverless signaling via shared peers |

### 1.3 What's New

**v1.3** adds five mesh intelligence systems (155 tests, 8,349 lines):
- Mesh Precognition: predictive task scheduling
- Mesh Immune System: threat detection and quarantine
- Computation Metabolism: battery-aware resource management
- Temporal Compute Futures: resource pre-commitment market
- Mesh Morphogenesis: self-organizing sub-meshes

**v1.4** adds Mesh Lifeforms with four unprecedented upgrades (241 tests, 10,360 lines):
- Causal Reactive Execution: event-driven with causal chain tracking
- Computational Fusion/Fission: merging two entities into one
- Genome Mutation + Natural Selection: code evolution as protocol primitive
- Intent Contracts: verifiable goals without consensus

---

## 2. v1.3 Enhancements

### 2.1 Mesh Precognition (Layer 9)

Predicts future task requests based on historical Mesh Execution Records (MERs). Five pattern detectors analyze workload history and pre-position resources.

**Pattern Detectors:**
- Periodic Detector: recurring tasks at regular intervals
- Diurnal Detector: daily usage patterns (morning peaks, evening lulls)
- Burst Detector: rapid sequences of similar tasks
- Payload Similarity: tasks with similar input data
- Peer Correlation: tasks triggered by specific peer behavior

**Components:**
- `DreamScheduler`: analyzes MERs, runs detectors, generates predictions
- `PhantomCache`: pre-caches predicted results
- `MispredictionTracker`: measures accuracy, adjusts confidence
- `ConfirmationShortcut`: bypasses negotiation for high-confidence predictions
- `SpeculativeDistributor`: pre-distributes chunks before requests arrive

**Message Types:** 0x80-0x84 (PREDICTION_HINT, PHANTOM_CACHE_OFFER, PHANTOM_CACHE_HIT, SPECULATIVE_DISTRIBUTE, PREDICTION_CONFIRM)

**CLI:** `dream [status|predictions|cache|stats|generate|flush]`

### 2.2 Mesh Immune System

Detects and quarantines malicious or misbehaving devices using behavioral analysis.

**Threat Types:**
- Result Manipulation: returning incorrect computation results
- Free-riding: consuming resources without contributing
- Sybil Attack: creating multiple fake identities
- Resource Lying: advertising capabilities that don't exist
- Replay Attack: re-submitting old results
- DoS Flooding: overwhelming peers with requests

**Components:**
- `ThreatDetector`: rule-based and statistical threat detection
- `AntibodyGenerator`: creates pattern-matching rules from confirmed threats
- `QuarantineManager`: isolates suspicious devices with severity levels

**Message Types:** 0x90-0x93 (THREAT_ALERT, ANTIBODY_SHARE, QUARANTINE_VOTE, QUARANTINE_NOTIFY)

**CLI:** `immune [status|antibodies|quarantine|threats|behavior]`

### 2.3 Computation Metabolism

Battery-aware resource management with five metabolic states. Replaces the binary "battery above 15% → accept" gate with a nuanced energy budget.

**Metabolic States:**

| State | Condition | Behavior |
|-------|-----------|----------|
| ANABOLIC | Plugged in, full charge | Accepts all work, bids aggressively |
| HOMEOSTATIC | Normal battery (30-80%) | Normal bidding |
| CATABOLIC | Battery below 30% | Only HIGH priority tasks |
| CHARGING | Plugged in, charging | Moderate acceptance |
| DORMANT | Battery below 10% | Excluded from all assignment |

**Components:**
- `MetabolicProfile`: tracks energy state per device
- `MetabolicNegotiator`: adjusts bid prices based on metabolic state
- `MeshBreathing`: collective mesh-wide energy rhythm

**CLI:** `metabolism [status|mesh|forecast]`

### 2.4 Temporal Compute Futures

A market for pre-committing compute resources. Devices can sell future capacity; buyers lock in resources at a fixed CCU price.

**Components:**
- `FutureMarket`: order book for compute futures
- `ScheduledTaskQueue`: executes tasks when futures mature

**Message Types:** 0xA0-0xA5 (FUTURE_LIST, FUTURE_BUY, FUTURE_CONFIRM, FUTURE_CANCEL, FUTURE_SETTLE, FUTURE_QUERY)

**CLI:** `futures [status|list|sell|my]`

### 2.5 Mesh Morphogenesis

Self-organizing sub-meshes ("organs") based on workload affinity. As meshes grow, devices that frequently handle the same task types cluster together automatically.

**Algorithm:**
1. Track per-device task type affinity (EMA)
2. Devices with high specialization scores become "specialists"
3. When 3+ specialists exist for the same type, they form an "organ"
4. Tasks route to the appropriate organ first (abbreviated negotiation)
5. Organs dissolve when inactive

**Components:**
- `AffinityTracker`: per-device task type affinity with EMA and decay
- `OrganManager`: organ formation, membership, health, dissolution, merging
- `OrganRouter`: routes tasks to organs, falls back to mesh-wide
- `MorphogenSignaler`: chemical-gradient-inspired signals for organ formation

**Message Types:** 0xB0-0xB4 (MORPHOGEN_SIGNAL, ORGAN_ANNOUNCE, ORGAN_JOIN, ORGAN_ACK, ORGAN_ROUTE)

**CLI:** `organs [status|list|affinity|routing|events|simulate]`

---

## 3. v1.4 Lifeforms — Architecture

A Lifeform is a persistent, autonomous computational entity that lives on the mesh. Unlike ephemeral CMP tasks (which execute and disappear), a Lifeform:

- **Persists** — maintains CRDT state across cause executions
- **Reacts** — computes only when caused (not polling)
- **Migrates** — moves between host devices for optimal placement
- **Replicates** — maintains state replicas for fault tolerance
- **Fuses** — merges with another Lifeform into a composite entity
- **Evolves** — mutates its own code; natural selection picks winners
- **Commits** — declares verifiable intent contracts
- **Orchestrates** — submits distributed tasks to the CMP pipeline

**Architecture:**

```
┌─────────────────────────────────────────────────┐
│                LifeformManager                   │
│  (orchestrates all Lifeforms on a device)        │
├─────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Lifeform │  │ Lifeform │  │ Lifeform │ ...  │
│  │  "sensor" │  │"processor"│  │ "monitor" │     │
│  ├──────────┤  ├──────────┤  ├──────────┤      │
│  │ Soul     │  │ Soul     │  │ Soul     │      │
│  │ CRDTState│  │ CRDTState│  │ CRDTState│      │
│  │ CauseQueue│ │ CauseQueue│ │ CauseQueue│     │
│  │ Executor │  │ Executor │  │ Executor │      │
│  │ Lifecycle│  │ Lifecycle│  │ Lifecycle│      │
│  └──────────┘  └──────────┘  └──────────┘      │
├─────────────────────────────────────────────────┤
│  DNS │ Synapses │ Replication │ Migration       │
├─────────────────────────────────────────────────┤
│  FusionEngine │ EvolutionEngine │ IntentSystem  │
├─────────────────────────────────────────────────┤
│  DistributionBridge → CMP L3-L6 Pipeline        │
└─────────────────────────────────────────────────┘
```

---

## 4. Core Types and Identity

### 4.1 Lifeform Soul

Every Lifeform has a cryptographic identity called a Soul:

```typescript
interface LifeformSoul {
  id: Uint8Array;           // 16-byte unique ID
  name: string;             // Human-readable, DNS-resolvable
  publicKey: Uint8Array;    // Ed25519 (32 bytes)
  secretKey: Uint8Array;    // Ed25519 (64 bytes, host-only)
  creatorId: Uint8Array;    // Device that spawned this Lifeform
  bornAt: number;           // Birth timestamp
  generation: number;       // 0 = original, >0 = mutant
  parentId: Uint8Array | null; // Parent (for evolved Lifeforms)
}
```

### 4.2 Lifecycle States

```
SPAWNING → ALIVE → MIGRATING → ALIVE
                 → FUSED → ALIVE (fission)
                 → HIBERNATING → ALIVE
                 → DEAD (terminal)
```

Valid transitions are enforced by the state machine. DEAD is terminal — no recovery.

### 4.3 Configuration

```typescript
interface LifeformConfig {
  name: string;                    // Unique name
  wasmModule: Uint8Array;          // Genome (WASM binary)
  initialState: Record<string, any>; // Starting CRDT state
  initialCcu: number;              // Starting CCU balance
  minReplicas: number;             // Fault tolerance (default: 1)
  maxReplicas: number;             // Maximum replicas (default: 3)
  autoMigrate: boolean;            // Auto-move to better hosts
  mutationLibraryHash: Uint8Array | null; // Evolution library
  maxCausesPerSecond: number;      // Backpressure threshold
  maxStateSizeBytes: number;       // State size limit (default: 1MB)
}
```

---

## 5. CRDT State Engine

Lifeform state uses Conflict-free Replicated Data Types (CRDTs), enabling merge without conflicts — the technology that makes Fusion possible.

### 5.1 Implemented CRDTs

| Type | Operation | Merge Strategy | Use Case |
|------|-----------|----------------|----------|
| GCounter | increment | max per node | Monotonic counting |
| PNCounter | increment, decrement | max per node (P and N) | Bidirectional counting |
| LWWRegister | set | highest timestamp wins | Simple key-value |
| ORSet | add, remove | union elements, union tombstones | Distributed sets |
| MVRegister | set | preserve concurrent values | Conflict-visible state |

### 5.2 CRDTState Manager

The `CRDTState` class wraps a map of named CRDTs with operations:

- `get(key)` / `set(key, value)` — LWWRegister auto-created
- `increment(key)` / `decrement(key)` — PNCounter operations
- `addToSet(key, element)` / `removeFromSet(key, element)` — ORSet operations
- `merge(otherState, namespace?)` — conflict-free merge (enables Fusion)
- `partition(prefix)` — split state by namespace (enables Fission)
- `extractDelta()` — changed keys since last extraction (efficient sync)
- `snapshot()` / `restore()` — full serialization (migration/persistence)
- `estimateSize()` — byte size estimate (for hosting cost billing)

### 5.3 Why CRDTs Enable Fusion

When two Lifeforms fuse, their states merge via `CRDTState.merge()`. Because CRDTs are mathematically guaranteed to converge regardless of merge order, there are no conflicts. This is what makes Computational Fusion possible — no other data model supports merging two independent state spaces without coordination.

---

## 6. Causal Reactive Execution

### 6.1 The Causal Model

A Lifeform has no heartbeat. It is inert until something CAUSES it to compute. This replaces the tick-based polling model with an event-driven causal model.

**Cause Types:**

| Type | Trigger |
|------|---------|
| MESSAGE | External message from a device |
| SYNAPSE_SIGNAL | Signal from another Lifeform via synapse |
| TIMER | Timer expiration (one-shot or recurring) |
| STATE_WATCH | CRDT key change detected |
| MESH_EVENT | Peer joined/left/migrated |
| CCU_THRESHOLD | CCU balance crossed a threshold |
| INTENT_VIOLATION | Intent contract violated |
| FUSION_REQUEST | Another Lifeform proposes fusion |
| DISTRIBUTION_RESULT | Distributed computation completed |

### 6.2 Causal Chain Tracking

Every cause carries a `chainId`. When Lifeform A processes a cause and emits a signal that wakes Lifeform B, both executions share the same chain. This enables:

- **Mesh-wide causality visibility:** trace which event caused which computation across the entire mesh
- **Causal billing:** total CCU cost of an entire chain tracked
- **Causal backpressure:** runaway cascades detected and throttled via chain depth limits
- **Causal deadlines:** end-to-end deadline propagation through the chain

### 6.3 CCU-Per-Cause Billing

```
Cost per cause execution:
  baseCost     = 0.01 CCU (minimum wake-up cost)
  computeCost  = executionTimeMs × 0.001 CCU/ms
  stateCost    = stateMutationCount × 0.002 CCU per mutation

  totalCost = baseCost + computeCost + stateCost

State hosting (hourly):
  stateHostingCost = stateSizeBytes / 1MB × 0.5 CCU/hour

An idle Lifeform with 100KB state costs ~0.05 CCU/hour ≈ 1.2 CCU/day.
100 CCU initial funding → 700+ days idle survival.
```

### 6.4 Components

- **CauseQueue:** Priority queue ordered by deadline (tightest first). Enforces backpressure: queue capacity, rate limiting, chain depth limits.
- **CausalExecutor:** Wakes Lifeforms on cause arrival, executes handlers, tracks chains, manages timers, calculates CCU costs.

---

## 7. Lifeform Lifecycle

### 7.1 LifeformLifecycle

Manages state transitions with validation, CCU economy (earn/spend/hosting), host/replica tracking, and fusion sub-state.

**CCU Economy:**
- `spendCcu(amount)` — voluntary spend (rejects if insufficient)
- `earnCcu(amount)` — from incoming cause payments or work
- `recordCauseExecution(cost)` — force-deduct (can go negative, triggers death)
- `chargeHostingCost(stateSize)` — hourly hosting rent

### 7.2 LifeformManager

The central orchestrator on each device. Responsibilities:
- Spawn new Lifeforms (create identity, init state, register DNS)
- Route causes to correct Lifeform via DNS resolution
- Deliver outgoing causes through synapses to other Lifeforms
- Coordinate state replication deltas
- Kill Lifeforms on CCU depletion
- Track resource usage across all hosted Lifeforms

---

## 8. Distribution

### 8.1 Host Selection

Scores candidate devices on four weighted factors:

| Factor | Weight | Metric |
|--------|--------|--------|
| Resources | 35% | Available CPU cores and memory |
| Reputation | 25% | Device trust score (0-10000) |
| Energy | 20% | Plugged in → 100%, battery percentage otherwise |
| Load | 20% | Current Lifeforms / max Lifeforms |

Filters out: throttled devices, battery below 10%, reputation below 2000, full capacity.

### 8.2 Migration

Live migration protocol: PENDING → TRANSFERRING → CONFIRMING → COMPLETED/FAILED.

Transfers CRDT state snapshot, genome hash, CCU balance, timer data, and synapse connections. DNS updates automatically to point to the new host.

### 8.3 Replication

Primary/secondary model for fault tolerance. Secondaries receive delta updates (only changed CRDT keys). Health monitoring detects stale replicas. Automatic promotion: healthiest secondary becomes primary on failure.

### 8.4 Lifeform DNS

Name resolution mapping human-readable Lifeform names to host device IDs. Supports redirect chains for Fusion (old names → composite name) and wildcard queries.

---

## 9. Synapses and Communication

Directional communication channels between Lifeforms with Hebbian learning.

**Properties:**
- Directional: A→B and B→A are separate synapses
- Strength: 0.0 (dormant) to 1.0 (strong)
- Hebbian: strength increases with use (+0.02 per transmission)
- Decay: strength decreases with inactivity (-0.05 per hour)
- Deactivation: strength below 0.1 → synapse deactivated

**Fusion Transfer:** All synapses from both components redirect to the composite entity.

**Fission Partition:** Synapses split evenly back to components.

---

## 10. Computational Fusion/Fission

**The completely unprecedented feature.** No system in computing has ever merged two independent computational entities.

### 10.1 Fusion Protocol

```
T0  Lifeform A proposes fusion with B
T1  B evaluates and accepts/rejects
T2  State merge (CRDT merge — conflict-free)
T3  Genome composition (both WASM modules loaded)
T4  CCU pooling (contribution ratio + escrow)
T5  Synapse transfer (all connections → composite)
T6  Composite spawns, components enter FUSED state
T7  DNS redirects: old names → composite name
```

### 10.2 State Merge Strategies

| Strategy | Behavior |
|----------|----------|
| NAMESPACE_PREFIX | A's `temp` → `sensor-a.temp`, B's `temp` → `processor-b.temp` |
| CRDT_MERGE | Merge CRDTs directly (same-type keys merge, different-type namespaced) |
| TIMESTAMP_WINS | LWW semantics — most recent value survives |

### 10.3 CCU Pooling

```
Contribution ratio: 0.6 (A contributes 60%)
A has 100 CCU → contributes 60, escrows 40
B has 80 CCU  → contributes 32, escrows 48
Pool: 92 CCU
```

Escrow is returned on fission. CCU earned while fused is split by contribution ratio.

### 10.4 Fission Protocol

```
T0  Trigger: manual, timer, low CCU, intent satisfied
T1  State partition by namespace prefix
T2  CCU division: escrow returned + earned split
T3  Synapse partition
T4  Components respawn independently
T5  DNS redirects cleared
```

### 10.5 Fission Triggers

| Trigger | Fires When |
|---------|-----------|
| LOW_CCU | Composite CCU balance < 1 |
| DURATION_EXPIRED | maxFusionDurationMs elapsed |
| INTENT_SATISFIED | A declared intent is met |
| LOW_LOAD | Load drops below threshold |
| MANUAL_ONLY | Only explicit fission command |

### 10.6 Why Fusion Is Unprecedented

```
Actor systems:     A sends message to B. They remain independent.
Microservices:     Service A calls B's API. They remain independent processes.
Process merge:     No OS supports merging two running processes.
Database join:     Joins combine DATA, not computation.
Smart contracts:   A contract can call another, but storage/identity separate.

CMP Fusion:        A and B BECOME ONE ENTITY. Shared state. Composed code.
                   Joint identity. Pooled economics. Can split later.
```

---

## 11. Genome Mutation and Natural Selection

### 11.1 Mutation Types

| Type | Effect |
|------|--------|
| CONSTANT_MUTATION | Change a numeric constant (explicit value or ±10% perturbation) |
| GLOBAL_MUTATION | Modify a global variable's initial value |
| FUNCTION_SWAP | Replace a function body with one from mutation library |
| FUNCTION_INSERT | Add a new function from mutation library |
| FUNCTION_REMOVE | Remove a non-essential function |
| CROSSOVER | Combine functions/constants/globals from two parent genomes |

### 11.2 Evaluation Protocol

After mutation, both parent and mutant run for an evaluation period. The FitnessEvaluator compares:

| Metric | Weight | Better = |
|--------|--------|----------|
| Response time | 20% | Lower |
| CCU efficiency (earned/spent) | 30% | Higher |
| Error rate | 25% | Lower |
| Throughput (causes/hour) | 15% | Higher |
| Intent satisfaction | 10% | Higher |

### 11.3 Selection Pressure

Three forces determine survival:

- **Economic Selection (40%):** Lifeforms that earn more CCU than they spend survive.
- **Performance Selection (40%):** Faster, more efficient genomes win evaluations.
- **Social Selection (20%):** Devices can rate Lifeform quality.

Composite fitness below the minimum threshold (default: 0.2) → death.

### 11.4 Generation Tracking

Lineage is tracked per Lifeform: generation number, parent/mutant genome hashes, fitness scores, winner. Mutation win rate indicates evolutionary velocity.

---

## 12. Intent Contracts

### 12.1 What This Is

A Lifeform declares a formal, machine-verifiable promise about what it will achieve. The mesh verifies via probabilistic sampling — no re-execution, no global consensus.

Example: *"I promise the temperature stays below 30°C."*

### 12.2 Predicate System

| Operator | Example |
|----------|---------|
| lt, gt, eq, lte, gte | `temperature lt 30` |
| between | `humidity between [40, 60]` |
| contains | `tags contains "critical"` |
| not_empty | `readings not_empty` |
| Compound AND | `temp lt 30 AND humidity gt 40` |
| Compound OR | `status eq "ok" OR backup eq true` |

### 12.3 Sampling Protocol

```
Every sampleIntervalMs:
  1. Select N random peers
  2. Each peer queries Lifeform's CRDT state (read-only, no wake)
  3. Each peer evaluates predicate, signs result
  4. Majority vote: satisfied or violated
  5. Consecutive violations tracked against threshold
  6. Threshold crossed → execute violation action
```

### 12.4 Violation Actions

| Action | Effect |
|--------|--------|
| NOTIFY | Emit INTENT_VIOLATION cause to Lifeform (self-correct) |
| SLASH | Deduct staked CCU, pay beneficiary |
| KILL | Slash + terminate the Lifeform |
| FORCE_FISSION | Split composite Lifeform back to components |

### 12.5 Why Intent Contracts Are New

```
Smart contracts:      Global consensus. Every node re-executes. Expensive.
Traditional services: Trust-based. No verification.
Intent Contracts:     Probabilistic sampling. No re-execution. No consensus.
                      Statistical guarantee (<1% false negative with 5 samples).
                      Byzantine fault tolerance via CRDT replication.
```

---

## 13. Orchestration Bridge

A Lifeform can submit distributed WASM tasks to the CMP mesh from within its cause handler via `lf_distribute()`. This closes the loop: persistent intelligence (Lifeform) orchestrates ephemeral compute (CMP tasks).

```
Lifeform calls lf_distribute(wasmHash, input, taskType, deadline)
  → Bridge creates CMP task request (L3 negotiation)
  → Task distributed across mesh (L4-L6 execution)
  → Result arrives as DISTRIBUTION_RESULT Cause to the Lifeform
```

The Lifeform becomes a compute orchestrator that itself has zero infrastructure, can migrate, fuse, and evolve.

---

## 14. Wire Protocol

### 14.1 Core Messages (v1.2): 0x01-0x1F

22 message types for discovery, capability, negotiation, distribution, execution, assembly, certification, and MCL.

### 14.2 v1.3 Messages: 0x80-0xB4

| Range | System | Count |
|-------|--------|-------|
| 0x80-0x84 | Precognition | 5 |
| 0x90-0x93 | Immune System | 4 |
| 0xA0-0xA5 | Futures | 6 |
| 0xB0-0xB4 | Morphogenesis | 5 |

### 14.3 v1.4 Lifeform Messages: 0xC0-0xE0

| Code | Type | System |
|------|------|--------|
| 0xC0 | LIFEFORM_SPAWN | Core |
| 0xC1 | LIFEFORM_SPAWN_ACK | Core |
| 0xC2 | LIFEFORM_CAUSE | Causal |
| 0xC3 | LIFEFORM_RESPONSE | Core |
| 0xC4 | LIFEFORM_STATE_DELTA | State |
| 0xC5 | LIFEFORM_STATE_ACK | State |
| 0xC6 | LIFEFORM_MIGRATE_OFFER | Migration |
| 0xC7 | LIFEFORM_MIGRATE_ACK | Migration |
| 0xC8 | LIFEFORM_HOST_CHANGE | Migration |
| 0xC9 | LIFEFORM_REPLICATE_OFFER | Replication |
| 0xCA | LIFEFORM_REPLICA_RELEASE | Replication |
| 0xCB | LIFEFORM_DNS_UPDATE | DNS |
| 0xCC | LIFEFORM_DNS_QUERY | DNS |
| 0xCD | LIFEFORM_DNS_RESPONSE | DNS |
| 0xCE | LIFEFORM_SYNAPSE_OFFER | Synapse |
| 0xCF | LIFEFORM_SYNAPSE_ACK | Synapse |
| 0xD0 | LIFEFORM_KILL | Core |
| 0xD1 | LIFEFORM_HEARTBEAT | Core |
| 0xD2 | LIFEFORM_CCU_TOPUP | Economy |
| 0xD3 | LIFEFORM_QUERY | Discovery |
| 0xD4 | LIFEFORM_FUSION_PROPOSE | Fusion |
| 0xD5 | LIFEFORM_FUSION_ACCEPT | Fusion |
| 0xD6 | LIFEFORM_FUSION_REJECT | Fusion |
| 0xD7 | LIFEFORM_FUSION_EXECUTE | Fusion |
| 0xD8 | LIFEFORM_FISSION_NOTIFY | Fission |
| 0xD9 | LIFEFORM_MUTATE | Evolution |
| 0xDA | LIFEFORM_GENERATION_RESULT | Evolution |
| 0xDB | LIFEFORM_INTENT_DECLARE | Intent |
| 0xDC | LIFEFORM_INTENT_REVOKE | Intent |
| 0xDD | INTENT_SAMPLE_REQUEST | Intent |
| 0xDE | INTENT_SAMPLE_RESPONSE | Intent |
| 0xDF | INTENT_VIOLATION | Intent |
| 0xE0 | LIFEFORM_STATE_READ | Intent |

**Total: 74 wire protocol message types** (22 core + 19 v1.3 + 33 v1.4).

### 14.4 Encoding

Lifeform messages use JSON encoding with a `msgType` field (numeric) to avoid collision with payload fields that may contain a `type` property. Messages are wrapped in CMP Frames (16-byte header with 0xC0-0xE0 type codes, prefixed with 0x43 'C' magic byte).

---

## 15. CLI Reference

### 15.1 Core Commands

```
encrypt [--chunks N] <msg>    Encrypt text using mesh WASM cipher
decrypt <hex>                 Decrypt hex ciphertext
connect <ip>                  Connect to a peer by IP
peers                         Show connected peers
status                        Show mesh status
```

### 15.2 v1.3 Commands

```
dream [status|predictions|cache|stats|generate|flush]
immune [status|antibodies|quarantine|threats|behavior]
metabolism [status|mesh|forecast]
futures [status|list|sell|my]
organs [status|list|affinity|routing|events|simulate]
```

### 15.3 v1.4 Lifeform Commands

```
lf                            Manager status
lf spawn <name> [ccu]         Spawn a Lifeform (default: 100 CCU)
lf list                       List all hosted Lifeforms
lf cause <name> [payload]     Send a cause to a Lifeform
lf state <name>               Show CRDT state keys and values
lf kill <name>                Kill a Lifeform
lf synapse <from> <to>        Create a synapse
lf fuse <a> <b> [composite]   Fuse two Lifeforms
lf fission <compositeId>      Split composite back
lf intent <name> <key> <op> <val>  Declare an intent
lf intents <name>             List intents with live verification
lf simulate                   Full demo simulation
```

---

## 16. Implementation Architecture

### 16.1 Project Structure

```
cmp/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── types/              # All type definitions
│   │   │   │   ├── lifeform.ts     # Soul, State, Config, 33 MessageTypes
│   │   │   │   ├── causal.ts       # Cause, CausalChain, Timer, Billing
│   │   │   │   ├── fusion.ts       # FusionProposal, CompositeSoul
│   │   │   │   ├── evolution.ts    # MutationType, FitnessScore
│   │   │   │   ├── intent.ts       # IntentContract, Predicate
│   │   │   │   ├── beacon.ts       # Core MessageType enum
│   │   │   │   ├── task.ts         # TaskType enum
│   │   │   │   └── ...             # v1.2 types
│   │   │   ├── lifeform/           # v1.4 Lifeform implementation
│   │   │   │   ├── crdt/
│   │   │   │   │   ├── crdts.ts    # 5 CRDT implementations
│   │   │   │   │   └── crdt-state.ts # State manager
│   │   │   │   ├── cause-queue.ts  # Priority cause queue
│   │   │   │   ├── causal-executor.ts # Execution engine
│   │   │   │   ├── lifecycle.ts    # State machine + CCU economy
│   │   │   │   ├── host-selector.ts # Host scoring
│   │   │   │   ├── migration.ts    # Live migration
│   │   │   │   ├── replication.ts  # Primary/secondary replicas
│   │   │   │   ├── dns.ts          # Name resolution
│   │   │   │   ├── synapse.ts      # Hebbian connections
│   │   │   │   ├── wire-protocol.ts # 33 message types
│   │   │   │   ├── manager.ts      # Central orchestrator
│   │   │   │   ├── fusion.ts       # Fusion/Fission engine
│   │   │   │   ├── evolution.ts    # Genome mutation + selection
│   │   │   │   ├── intent.ts       # Intent system
│   │   │   │   └── distribution-bridge.ts # CMP pipeline bridge
│   │   │   ├── precognition/       # v1.3 Phase 1
│   │   │   ├── immune/            # v1.3 Phase 2
│   │   │   ├── metabolism/        # v1.3 Phase 3
│   │   │   ├── futures/           # v1.3 Phase 4
│   │   │   └── morphogenesis/     # v1.3 Phase 5
│   │   └── tests/
│   │       ├── lifeform-phase-[a-j].test.ts  # v1.4 tests
│   │       ├── precognition.test.ts           # v1.3 tests
│   │       ├── immune-system.test.ts
│   │       ├── metabolism.test.ts
│   │       ├── futures.test.ts
│   │       ├── morphogenesis.test.ts
│   │       └── phase1.test.ts                 # v1.2 tests
│   ├── transport/              # BLE, LAN, WiFi Direct, WebRTC
│   └── cli/
│       └── src/cli.ts          # 2,359 lines — full REPL
└── docs/
    ├── CMP-PROTOCOL-v1.2.md    # v1.2 spec (1,054 lines)
    └── CMP-PROTOCOL-v1.4.md    # This document
```

### 16.2 Technology Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 18+
- **Execution:** ts-node (development), tsc (production)
- **Testing:** Node.js built-in test runner (node:test)
- **Monorepo:** packages/core, packages/transport, packages/cli
- **Platform:** Windows (development), Linux/macOS (tested)

---

## 17. Test Coverage

| Component | Tests | Lines |
|-----------|-------|-------|
| **v1.2 Core** | 49 | ~13,800 |
| **v1.3 Precognition** | 39 | 2,623 |
| **v1.3 Immune System** | 30 | 1,786 |
| **v1.3 Metabolism** | 27 | 1,082 |
| **v1.3 Futures** | 24 | 1,237 |
| **v1.3 Morphogenesis** | 35 | 1,621 |
| **v1.4 Phase A: Types + CRDTs** | 48 | 2,310 |
| **v1.4 Phase B: Lifecycle + Executor** | 38 | 1,538 |
| **v1.4 Phase C: Distribution** | 30 | 1,284 |
| **v1.4 Phase D: Synapses + Wire** | 22 | 896 |
| **v1.4 Phase E: LifeformManager** | 20 | 676 |
| **v1.4 Phase F: Fusion/Fission** | 21 | 933 |
| **v1.4 Phase G: Evolution** | 21 | 988 |
| **v1.4 Phase H: Intent System** | 28 | 900 |
| **v1.4 Phase I: Orchestration** | 8 | 452 |
| **v1.4 Phase J: Examples** | 5 | 381 |
| **Total** | **445+** | **~50,521** |

---

## 18. Quick Start

### 18.1 Installation

```bash
git clone https://github.com/agentviscro/cmp.git
cd cmp
npm install
```

### 18.2 Run Tests

```bash
# v1.2 core
npx ts-node --transpile-only packages/core/tests/phase1.test.ts

# v1.3 (any phase)
npx ts-node --transpile-only packages/core/tests/morphogenesis.test.ts

# v1.4 (any phase)
npx ts-node --transpile-only packages/core/tests/lifeform-phase-a.test.ts
npx ts-node --transpile-only packages/core/tests/lifeform-phase-j.test.ts
```

### 18.3 Start a Node

```bash
npx tsx packages/cli/src/cli.ts start --webrtc
```

### 18.4 Try Lifeforms

```bash
cmp> lf simulate            # Full demo: spawn→cause→intent→fuse→fission
cmp> lf spawn sensor-1 100  # Spawn with 100 CCU
cmp> lf cause sensor-1 hello world  # Send a cause
cmp> lf state sensor-1      # View CRDT state
cmp> lf intent sensor-1 causes_received lt 100  # Declare intent
cmp> lf intents sensor-1    # Check intent status
cmp> lf spawn processor-1 75
cmp> lf synapse sensor-1 processor-1
cmp> lf fuse sensor-1 processor-1 smart-node
cmp> lf status              # See fusion stats
```

---

*CMP v1.4 — Mesh Lifeforms*  
*Agent Viscro — March 2026*

> *Autonomous computational entities that react to causal chains, merge and split like biological cells, evolve their own code through natural selection, commit to verifiable goals without consensus, and orchestrate distributed computation — all on zero infrastructure, funded by their own economic output.*

> *There is no system this sentence maps to.*
