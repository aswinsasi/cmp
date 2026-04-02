# CMP — Finished Product Roadmap

**From Foundation (7/10) to Production (10/10)**

**Author:** Agent Viscro  
**Date:** March 2026  
**Current State:** 50,521 lines, 445 tests, single-node Lifeforms working  
**Target State:** Multi-device, persistent, mobile-ready, real WASM, one deployed application

---

## Executive Summary

CMP v1.4 is a comprehensive, well-tested protocol implementation with a genuinely novel design. However, it is a foundation — not a finished product. Seven critical gaps must be closed to reach production quality.

| Gap | Current | Target | Effort |
|-----|---------|--------|--------|
| 1. Multi-device Lifeforms | Single-node only | Causes, migration, replication across devices | 3-4 weeks |
| 2. Persistence | In-memory only | SQLite for all state | 1-2 weeks |
| 3. Real WASM Execution | Simplified genome objects | Actual WASM binary mutation | 2-3 weeks |
| 4. Real Cryptography | Placeholder randomBytes | Ed25519 signatures throughout | 1 week |
| 5. Mobile Port | Node.js desktop only | React Native with BLE | 4-6 weeks |
| 6. Benchmarks + Hardening | No performance data | Load testing, profiling, limits | 1-2 weeks |
| 7. First Application | Demo simulations only | SAYDO or equivalent deployed | 3-4 weeks |

**Total estimated effort: 15-22 weeks (one developer, full-time)**

---

## Gap 1: Multi-Device Lifeforms

**Priority: CRITICAL — without this, Lifeforms are just a local actor system**

### 1.1 What's Missing

The LifeformManager, CausalExecutor, ReplicationManager, MigrationManager, IntentSampler, and DistributionBridge all have correct logic and tests — but they operate within a single Node.js process. The callbacks that would send data over the network are stubs.

Specifically, these five network paths don't exist yet:

```
1. Remote Cause Delivery
   Current:  manager.deliverCause() → DNS resolves → if local, process; if remote, stub callback
   Needed:   → serialize Cause → wire protocol encode → CMP Frame → transport send → remote node receives → deserialize → deliver to local manager

2. State Replication
   Current:  CRDTState.extractDelta() works, ReplicationManager tracks sequences
   Needed:   → delta extracted → encode as LIFEFORM_STATE_DELTA message → send to each secondary host → secondary applies delta → sends STATE_ACK

3. Live Migration
   Current:  MigrationManager tracks lifecycle (PENDING→TRANSFERRING→CONFIRMING→COMPLETED)
   Needed:   → snapshot state → encode as MIGRATE_OFFER → send to target → target creates Lifeform from snapshot → sends MIGRATE_ACK → source kills local instance → DNS updates broadcast

4. Intent Sampling
   Current:  IntentSampler selects random peers, evaluates predicates
   Needed:   → select peers from actual mesh peer list → send INTENT_SAMPLE_REQUEST → peer reads Lifeform state via LIFEFORM_STATE_READ → peer evaluates predicate → sends signed INTENT_SAMPLE_RESPONSE

5. Distribution Bridge
   Current:  DistributionBridge.submit() calls a callback stub
   Needed:   → bridge creates actual CMP task (L3 negotiation) → task distributed via existing L4-L6 pipeline → result mapped back to DISTRIBUTION_RESULT Cause
```

### 1.2 Implementation Plan

**Step 1: Lifeform Transport Handler (3 days)**

Create `packages/core/src/lifeform/transport-handler.ts` — the bridge between the Lifeform system and CMP's transport layer.

```typescript
// Conceptual interface
class LifeformTransportHandler {
  constructor(node: CMPNode, manager: LifeformManager) {}

  // Called by CMPNode when a Lifeform message arrives from the network
  handleIncoming(peerId: string, msgType: LifeformMessageType, payload: Uint8Array): void;

  // Called by LifeformManager when it needs to send to a remote host
  sendToHost(hostId: string, msgType: LifeformMessageType, payload: any): Promise<void>;
}
```

This handler registers with `CMPNode.events()` for message types 0xC0-0xE0 and routes them to the correct subsystem.

**Step 2: Wire Remote Cause Delivery (2 days)**

```
LifeformManager.deliverCause(targetName, cause)
  → DNS resolves to hostId
  → if hostId === localDeviceId → processLocalCause()
  → else → transportHandler.sendToHost(hostId, LIFEFORM_CAUSE, encodedCause)

On receiving end:
  transportHandler.handleIncoming(peerId, LIFEFORM_CAUSE, data)
  → decode CauseMessage
  → resolve targetName via local DNS
  → manager.processLocalCause(lifeformId, cause)
```

**Step 3: Wire Replication (3 days)**

```
After each cause execution:
  delta = state.extractDelta()
  if delta.changedKeys.length > 0:
    for each secondaryHost in replication.getSecondaryHosts(lfId):
      transportHandler.sendToHost(secondaryHost, LIFEFORM_STATE_DELTA, delta)

On receiving end:
  transportHandler.handleIncoming(peerId, LIFEFORM_STATE_DELTA, data)
  → decode StateDeltaMessage
  → find local replica state
  → state.applyDelta(delta)
  → send STATE_ACK back
```

**Step 4: Wire Migration (3 days)**

```
Migration trigger (manual or auto):
  snapshot = state.snapshot()
  lifecycle.transitionTo(MIGRATING)
  transportHandler.sendToHost(targetHost, LIFEFORM_MIGRATE_OFFER, {
    snapshot, genomeHash, ccuBalance, timerData, synapseData
  })

On target:
  handleIncoming(peerId, LIFEFORM_MIGRATE_OFFER, data)
  → spawn Lifeform from snapshot
  → send LIFEFORM_MIGRATE_ACK

On source:
  handleIncoming(peerId, LIFEFORM_MIGRATE_ACK, data)
  → if accepted: kill local instance, broadcast HOST_CHANGE
  → if rejected: transition back to ALIVE
```

**Step 5: Wire Intent Sampling (2 days)**

```
Sampling round:
  peers = actual mesh peer list (not simulated)
  selected = random subset
  for each peer:
    transportHandler.sendToHost(peer, INTENT_SAMPLE_REQUEST, {
      intentId, stateKey, predicate
    })

On sampling peer:
  handleIncoming(peerId, INTENT_SAMPLE_REQUEST, data)
  → resolve Lifeform host via DNS
  → read state key (LIFEFORM_STATE_READ — no wake)
  → evaluate predicate
  → sign result
  → send INTENT_SAMPLE_RESPONSE
```

**Step 6: Wire Distribution Bridge (2 days)**

```
Lifeform calls lf_distribute():
  bridge.submit() → create actual CMP TaskRequest
  → node.submitTask(request) — uses existing L3-L6 pipeline
  → on result: bridge.handleResult() → delivers DISTRIBUTION_RESULT Cause
```

### 1.3 Testing Strategy

- **2-node integration tests:** spawn Lifeform on Node A, send cause from Node B, verify state updated on A
- **Migration tests:** spawn on A, migrate to B, verify A has no Lifeform, B has it with correct state
- **Replication tests:** spawn on A with replica on B, mutate state on A, verify delta arrives at B
- **Intent tests:** spawn on A, declare intent, sample from B, verify predicate evaluated correctly
- Use existing Virtual Transport for in-process multi-node tests (no actual network needed for CI)

### 1.4 Estimated Files

| File | Lines | Purpose |
|------|-------|---------|
| `lifeform/transport-handler.ts` | ~400 | Network bridge |
| `tests/lifeform-multidevice.test.ts` | ~500 | Integration tests |
| CLI wiring updates | ~100 | Connect to CMPNode |
| **Total** | **~1,000** | |

---

## Gap 2: Persistence

**Priority: HIGH — without this, all Lifeforms die on process restart**

### 2.1 What Needs Persisting

| Data | Storage | Frequency |
|------|---------|-----------|
| Lifeform Souls | SQLite | On spawn, on generation change |
| CRDT State snapshots | SQLite (BLOB) | Every N cause executions or timer |
| Intent Contracts | SQLite | On declare/revoke |
| Generation Records | SQLite | On evolution evaluation complete |
| DNS Records | SQLite | On register/update/unregister |
| Synapse connections | SQLite | On create/remove |
| CCU Balances | SQLite | On each cause execution |
| Migration History | SQLite | On complete/fail |

### 2.2 Schema

```sql
CREATE TABLE lifeforms (
  id BLOB PRIMARY KEY,          -- 16 bytes
  name TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL,           -- LifeformState enum
  soul_json TEXT NOT NULL,       -- Serialized LifeformSoul
  config_json TEXT NOT NULL,     -- Serialized LifeformConfig
  genome_hash BLOB,             -- 32 bytes
  host_id TEXT NOT NULL,
  ccu_balance REAL NOT NULL,
  causes_processed INTEGER DEFAULT 0,
  ccu_earned REAL DEFAULT 0,
  ccu_spent REAL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE crdt_snapshots (
  lifeform_id BLOB NOT NULL REFERENCES lifeforms(id),
  snapshot_json TEXT NOT NULL,   -- Serialized StateSnapshot
  size_bytes INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (lifeform_id, sequence)
);

CREATE TABLE intents (
  id BLOB PRIMARY KEY,
  lifeform_id BLOB NOT NULL REFERENCES lifeforms(id),
  contract_json TEXT NOT NULL,   -- Full IntentContract
  consecutive_violations INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE generations (
  lifeform_id BLOB NOT NULL,
  generation INTEGER NOT NULL,
  record_json TEXT NOT NULL,     -- GenerationRecord
  created_at INTEGER NOT NULL,
  PRIMARY KEY (lifeform_id, generation)
);

CREATE TABLE synapses (
  id BLOB PRIMARY KEY,
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL,
  strength REAL NOT NULL,
  causes_transmitted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE dns_records (
  name TEXT PRIMARY KEY,
  lifeform_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  redirect TEXT,
  version INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE migration_history (
  id BLOB PRIMARY KEY,
  lifeform_id BLOB NOT NULL,
  from_host TEXT NOT NULL,
  to_host TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  state_size INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

### 2.3 Implementation Plan

**Step 1: SQLite wrapper (1 day)**

Create `packages/core/src/persistence/db.ts` using `better-sqlite3` (synchronous, no async complexity).

```typescript
class CmpDatabase {
  constructor(path: string) {} // Opens or creates DB
  saveLifeform(instance: LifeformInstance): void;
  loadLifeform(id: Uint8Array): LifeformInstance | null;
  loadAllLifeforms(): LifeformInstance[];
  saveSnapshot(lifeformId: Uint8Array, snapshot: StateSnapshot): void;
  loadLatestSnapshot(lifeformId: Uint8Array): StateSnapshot | null;
  // ... similar for intents, generations, synapses, DNS
}
```

**Step 2: Wire into LifeformManager (2 days)**

- On spawn: save soul + config + initial snapshot
- After cause execution: save CCU balance; snapshot state every 100 causes or 60 seconds
- On kill: mark as DEAD in DB (keep for history)
- On startup: load all ALIVE Lifeforms, restore state from snapshots, restore intents, re-register DNS

**Step 3: Recovery logic (1 day)**

- On process start: `LifeformManager.recover()` loads all persisted Lifeforms
- Stale secondaries detected via replication health check
- Interrupted migrations resolved (TRANSFERRING → fail + rollback)

### 2.4 Estimated Files

| File | Lines | Purpose |
|------|-------|---------|
| `persistence/db.ts` | ~500 | SQLite wrapper |
| `persistence/schema.sql` | ~80 | Table definitions |
| `tests/persistence.test.ts` | ~300 | Round-trip tests |
| Manager integration | ~200 | Recovery + save hooks |
| **Total** | **~1,080** | |

### 2.5 Dependency

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

---

## Gap 3: Real WASM Execution

**Priority: HIGH — evolution is the "wow" feature, needs real WASM to be credible**

### 3.1 What's Missing

The current "genome" is a simplified representation: `Map<string, Uint8Array>` for functions, `number[]` for constants. Real WASM mutation requires parsing the WASM binary format.

### 3.2 WASM Binary Structure

A `.wasm` file has sections:

```
Magic + Version (8 bytes)
Section 1: Type (function signatures)
Section 2: Import
Section 3: Function (index → type index)
Section 4: Table
Section 5: Memory
Section 6: Global
Section 7: Export
Section 8: Start
Section 9: Element
Section 10: Code (function bodies)
Section 11: Data
```

Mutation targets:
- **Constants:** i32.const / f64.const instructions in Code section
- **Functions:** entire function bodies in Code section
- **Globals:** initial values in Global section

### 3.3 Implementation Plan

**Option A: Use Binaryen (recommended)**

Binaryen (`binaryen` npm package) provides a full WASM optimizer/transformer. It can parse, modify, and emit WASM binaries.

```typescript
import binaryen from 'binaryen';

class WasmGenomeMutator {
  parse(wasmBytes: Uint8Array): binaryen.Module;
  
  mutateConstant(module: binaryen.Module, funcName: string, constIndex: number, newValue: number): void;
  
  swapFunction(module: binaryen.Module, targetFunc: string, replacementBody: binaryen.Module): void;
  
  removeFunction(module: binaryen.Module, funcName: string): void;
  
  emit(module: binaryen.Module): Uint8Array;
  
  validate(module: binaryen.Module): boolean;
}
```

**Option B: Manual WASM parsing (lighter, no dependency)**

Parse only the sections we need (Code, Global) using a custom reader. More work but zero dependencies.

```typescript
class WasmParser {
  parseSections(bytes: Uint8Array): WasmSection[];
  getCodeSection(): CodeSection;
  getGlobalSection(): GlobalSection;
  findConstants(funcBody: Uint8Array): ConstantLocation[];
  replaceConstant(funcBody: Uint8Array, location: ConstantLocation, newValue: number): Uint8Array;
  rebuildBinary(sections: WasmSection[]): Uint8Array;
}
```

### 3.4 Lifeform Runtime

The Lifeform's `onCause` handler currently runs as a TypeScript async function. For real WASM execution:

```typescript
class LifeformRuntime {
  private wasmInstance: WebAssembly.Instance;
  private memory: WebAssembly.Memory;
  
  // Host functions exposed to WASM
  private hostFunctions = {
    lf_state_get: (keyPtr: number, keyLen: number, outPtr: number, outLen: number) => number,
    lf_state_set: (keyPtr: number, keyLen: number, valPtr: number, valLen: number) => void,
    lf_cause_emit: (targetPtr: number, targetLen: number, payloadPtr: number, payloadLen: number, ccu: number) => void,
    lf_timer_set: (delayMs: number, intervalMs: number, payloadPtr: number, payloadLen: number) => number,
    lf_fuse: (targetNamePtr: number, targetNameLen: number, configPtr: number, configLen: number) => void,
    lf_intent_declare: (intentJsonPtr: number, intentJsonLen: number) => void,
    lf_distribute: (hashPtr: number, inputPtr: number, inputLen: number, taskType: number, deadline: number, security: number) => void,
  };
  
  async loadGenome(wasmBytes: Uint8Array): Promise<void>;
  async executeOnCause(causeType: number, causeData: Uint8Array): Promise<ExecutionResult>;
}
```

### 3.5 Estimated Files

| File | Lines | Purpose |
|------|-------|---------|
| `lifeform/wasm-runtime.ts` | ~600 | WASM instantiation + host functions |
| `lifeform/wasm-mutator.ts` | ~400 | Real WASM binary mutation |
| `examples/echo.wat` | ~50 | Simple WAT source for testing |
| `tests/wasm-runtime.test.ts` | ~300 | WASM execution tests |
| **Total** | **~1,350** | |

### 3.6 Dependency

```bash
# Option A
npm install binaryen

# Option B: no dependency, manual parsing
```

---

## Gap 4: Real Cryptography

**Priority: MEDIUM — current stubs work, real crypto adds security guarantees**

### 4.1 What's Missing

v1.2 core protocol uses real Ed25519/X25519/NaCl (via tweetnacl). But v1.4 Lifeform code uses `randomBytes(32)` as placeholder for keys/signatures.

### 4.2 What Needs Real Crypto

| Component | Current | Target |
|-----------|---------|--------|
| LifeformSoul.publicKey | randomBytes(32) | Ed25519 keypair via tweetnacl |
| LifeformSoul.secretKey | randomBytes(64) | Actual Ed25519 secret key |
| FusionProposal.proposerSignature | randomBytes(64) | Ed25519 sign(proposal, secretKey) |
| CompositeSoul.componentSignatures | randomBytes(64) each | Both components sign composite ID |
| IntentContract.commitment | randomBytes(64) | Lifeform signs the intent declaration |
| IntentSample.signature | randomBytes(64) | Sampling peer signs the result |
| Genome hash | XOR-based placeholder | SHA-256 of WASM binary |

### 4.3 Implementation Plan

Already using `tweetnacl` in the project. Changes are mostly replacing `randomBytes` calls with actual `nacl.sign.keyPair()` and `nacl.sign.detached()`.

```typescript
import nacl from 'tweetnacl';

// In LifeformManager.spawn():
const keypair = nacl.sign.keyPair();
soul.publicKey = keypair.publicKey;
soul.secretKey = keypair.secretKey;

// In FusionEngine.propose():
proposal.proposerSignature = nacl.sign.detached(
  serializeProposal(proposal), proposerSoul.secretKey
);

// In IntentSampler:
sample.signature = nacl.sign.detached(
  serializeSampleResult(sample), samplerSecretKey
);
```

### 4.4 Estimated Effort

~200 lines of changes across 5-6 files. 1-2 days.

---

## Gap 5: Mobile Port (React Native)

**Priority: HIGH — CMP's pitch is "phones pooling compute"**

### 5.1 Architecture

```
React Native App
├── UI Layer (React components)
│   ├── MeshStatus screen
│   ├── Lifeform management screen
│   ├── Peer list screen
│   └── Task history screen
├── CMP Core (TypeScript — shared with Node.js)
│   ├── packages/core/ — direct import
│   └── packages/transport/ — platform-specific adapters
├── Platform Transports
│   ├── BLE Transport (react-native-ble-plx)
│   ├── WiFi Direct Transport (react-native-wifi-direct)
│   ├── LAN Transport (react-native-udp + react-native-tcp-socket)
│   └── WebRTC Transport (react-native-webrtc)
├── Platform Services
│   ├── Battery API → Metabolism integration
│   ├── Background tasks → Lifeform persistence
│   └── Notifications → Peer discovered, intent violated
└── Storage
    ├── SQLite (react-native-sqlite-storage)
    └── MMKV for fast key-value (react-native-mmkv)
```

### 5.2 Implementation Plan

**Phase 1: Core Port (1 week)**

- Create `packages/mobile/` with React Native setup
- Import `packages/core/` directly (TypeScript, no native code)
- Verify all 445 tests pass in React Native's JavaScript engine (Hermes)
- Build a minimal UI: start node, show status, encrypt/decrypt

**Phase 2: BLE Transport (2 weeks)**

- Install `react-native-ble-plx`
- Implement `BLETransport` matching the existing transport interface
- BLE advertising: 38-byte CMP beacon fits in a single BLE advertisement
- BLE data channel: GATT characteristic for CMP frames
- Test: two phones discover each other via BLE

**Phase 3: LAN Transport (1 week)**

- Install `react-native-udp` + `react-native-tcp-socket`
- Port existing LAN transport (UDP multicast + TCP framed)
- Test: phone discovers laptop on same WiFi

**Phase 4: Battery Integration (2 days)**

- Read actual battery level and charging state via `react-native-battery`
- Wire into Metabolism system (replace hardcoded values)
- Test: metabolic state changes as battery drains

**Phase 5: Lifeform UI (1 week)**

- Spawn/kill Lifeforms from the app
- View CRDT state in real-time
- Send causes via UI
- View intent status with live verification
- Fusion/fission controls

**Phase 6: Background Execution (3 days)**

- Use `react-native-background-actions` or Headless JS
- Keep Lifeforms alive when app is backgrounded
- Handle timer causes in background
- Wake on incoming network messages

### 5.3 Key Challenges

| Challenge | Solution |
|-----------|----------|
| Hermes JS engine limitations | Test all core code on Hermes; avoid Node.js-specific APIs |
| BLE MTU limits (23-512 bytes) | CMP already handles fragmentation (0xFF prefix) |
| Background execution limits (iOS) | Use BGTaskScheduler for periodic wake; BLE peripheral mode for passive |
| Battery consumption | Metabolism system already handles this — use real battery data |
| Storage | SQLite via react-native-sqlite-storage |

### 5.4 Estimated Files

| Component | Lines | Time |
|-----------|-------|------|
| RN project setup + navigation | ~500 | 2 days |
| BLE Transport adapter | ~600 | 1 week |
| LAN Transport adapter | ~300 | 3 days |
| Battery integration | ~100 | 1 day |
| Lifeform UI screens | ~1,200 | 1 week |
| Background execution | ~200 | 2 days |
| **Total** | **~2,900** | **4-6 weeks** |

---

## Gap 6: Benchmarks and Hardening

**Priority: MEDIUM — needed for credibility and production readiness**

### 6.1 What to Measure

| Metric | Method | Target |
|--------|--------|--------|
| Causes per second (single Lifeform) | Loop cause delivery, measure throughput | >1,000/sec |
| Max hosted Lifeforms per device | Spawn until OOM or slowdown | >100 on laptop |
| CRDT merge latency (1K keys) | Time merge() with various sizes | <10ms |
| Fusion execution time | Time full fusion cycle | <100ms |
| State snapshot size vs key count | Measure snapshot.sizeBytes | Linear growth |
| Memory per Lifeform | Process RSS with N Lifeforms | <1MB base |
| WebRTC cause delivery latency | Round-trip cause → response | <50ms LAN |
| BLE discovery time | Time from boot to first peer | <5sec |

### 6.2 Implementation

Create `packages/core/benchmarks/`:

```typescript
// benchmark-causes.ts
async function benchmarkCauseProcessing() {
  const mgr = new LifeformManager({ maxHostedLifeforms: 1000 });
  mgr.start();

  const hosted = mgr.spawn(makeConfig('bench', { initialCcu: 100000 }));
  mgr.setHandler('bench', async () => ({ stateMutations: 1, outgoingCauses: [] }));

  const start = performance.now();
  const N = 10000;
  for (let i = 0; i < N; i++) {
    await mgr.deliverCause('bench', makeCause());
  }
  const elapsed = performance.now() - start;

  console.log(`${N} causes in ${elapsed.toFixed(0)}ms = ${(N / elapsed * 1000).toFixed(0)} causes/sec`);
  mgr.stop();
}
```

### 6.3 Hardening Checklist

- [ ] Rate limiting tested under load (>100 causes/sec sustained)
- [ ] Backpressure tested with deep causal chains (depth 64+)
- [ ] Memory leak testing (spawn 1000 Lifeforms, kill 1000, verify RSS returns)
- [ ] CRDT merge with 10K+ keys
- [ ] Concurrent fusion (two fusions at once)
- [ ] DNS redirect chain limit enforced
- [ ] Expired intent cleanup under load
- [ ] Graceful shutdown (all timers cancelled, all state persisted)

### 6.4 Estimated Effort

~500 lines of benchmark code. 1-2 weeks including analysis and fixes.

---

## Gap 7: First Application

**Priority: CRITICAL — proves the system works for real users**

### 7.1 Recommended: SAYDO on CMP Lifeforms

SAYDO (hyperlocal task marketplace) is the ideal first application because it uses every Lifeform capability:

| SAYDO Feature | Lifeform Capability Used |
|---------------|------------------------|
| Task posting | Lifeform spawned per task, CRDT state holds task details |
| Task matching | Synapse network between task-poster and nearby workers |
| Reputation | Intent contracts ("I will complete this task within 2 hours") |
| Payment | CCU economy — task poster funds Lifeform, worker earns CCU |
| Emergency tasks | Fusion — nearby worker Lifeforms fuse for coordinated response |
| Task evolution | Evolution — matching algorithm self-optimizes over time |
| Offline-first | Lifeforms persist on local mesh, sync when connectivity returns |

### 7.2 Architecture

```
SAYDO on CMP
├── WhatsApp Bot (Phase 1 — existing SAYDO design)
│   └── Talks to CMP via HTTP bridge on user's phone
├── Lifeform Types
│   ├── TaskLifeform — one per posted task
│   │   State: { description, category, budget, location, status, bids[] }
│   │   Intent: "status != 'expired' while active"
│   ├── WorkerLifeform — one per registered worker
│   │   State: { skills, rating, location, availability }
│   │   Intent: "availability == true when accepting tasks"
│   └── MatcherLifeform — singleton per ward
│       State: { active_tasks, active_workers, match_history }
│       Synapses: connected to all Task and Worker Lifeforms
│       Evolution: matching algorithm self-optimizes
├── Fusion Use Case
│   Emergency: multiple WorkerLifeforms fuse into ResponseTeam
│   when urgent task needs coordinated labor
└── CCU Economy
    Task poster deposits CCU → TaskLifeform funded
    Worker completes → TaskLifeform transfers CCU to WorkerLifeform
    Incomplete → Intent violation → CCU slashed
```

### 7.3 Implementation Plan

**Week 1: TaskLifeform + WorkerLifeform**
- Define CRDT schemas for task state and worker state
- Spawn/kill via WhatsApp commands
- Task posting creates TaskLifeform, worker registration creates WorkerLifeform

**Week 2: MatcherLifeform + Synapses**
- Matcher connected to all tasks and workers via synapses
- On new task cause → matcher evaluates all workers → emits match suggestion
- Hebbian learning: frequently matched pairs strengthen

**Week 3: Intent Contracts + CCU Flow**
- Task declares intent: "status will transition to completed within budget_hours"
- Worker declares intent: "availability is true during working hours"
- CCU flow: poster → task → worker on completion

**Week 4: WhatsApp Integration + Testing**
- WhatsApp bot sends causes to Lifeforms
- Lifeform state changes trigger WhatsApp notifications
- End-to-end test in one ward of Chengannur

---

## Build Order (Recommended)

```
Week 1-2:   Gap 2 (Persistence) — SQLite for all state
            Gap 4 (Real Crypto) — Ed25519 throughout
              ↓ Now Lifeforms survive restarts and are cryptographically valid

Week 3-5:   Gap 1 (Multi-Device) — Wire transport layer
              ↓ Now Lifeforms work across actual devices

Week 6-7:   Gap 6 (Benchmarks) — Performance testing + hardening
              ↓ Now we know the system's limits

Week 8-10:  Gap 3 (Real WASM) — Binaryen mutation + runtime
              ↓ Now evolution works on real WASM binaries

Week 11-14: Gap 7 (SAYDO) — First real application
              ↓ Now there's a deployed product

Week 15-20: Gap 5 (Mobile) — React Native port
              ↓ Now it runs on phones — the original vision
```

### Alternative: Fastest Path to Demo

If the goal is to demo CMP at a conference or to investors:

```
Week 1:     Gap 2 (Persistence) — Lifeforms survive restarts
Week 2-3:   Gap 1 (Multi-Device) — 2 laptops, causes flowing between them
Week 4:     Build a simple demo app (temperature monitoring with fusion)
            Two laptops each running a sensor Lifeform
            Temperature spike → automatic fusion → combined response
            Show: spawn, cause, state, intent, fuse, fission — all live
```

This gets a compelling demo in 4 weeks.

---

## Success Criteria: What Makes It 10/10

| Criteria | Measurement |
|----------|-------------|
| Two phones discover each other via BLE and form a mesh | Manual test |
| Lifeform spawned on Phone A, cause sent from Phone B | Integration test |
| Lifeform migrates from Phone A to Phone B when A's battery low | Metabolism trigger + migration |
| Two sensor Lifeforms fuse during emergency, split after | Fusion/fission across devices |
| Lifeform's WASM code mutates, fitter variant survives | Real WASM + evaluation |
| Intent violation detected via sampling from 3 random peers | Multi-device intent sampling |
| Lifeform survives phone restart | Persistence + recovery |
| SAYDO task completed via Lifeform economy | End-to-end application |
| >1000 causes/sec throughput on modern phone | Benchmark verified |
| Full protocol spec published, code on GitHub | Documentation + open source |

When all 10 criteria pass, CMP is a 10/10.

---

*CMP — Finished Product Roadmap*
*Agent Viscro — March 2026*

> *The foundation is built. The architecture is proven. The tests pass.*
> *Now make it real.*
