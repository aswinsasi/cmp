# CMP — Compute Mesh Protocol

> Decentralized proximity-based distributed computation across heterogeneous devices.

**Author:** Agent Viscro  
**Version:** 1.0.0 (Phase 1)  
**License:** MIT  

---

## What is CMP?

CMP enables nearby devices — phones, laptops, tablets, IoT — to dynamically discover each other and form an **ephemeral supercomputer**. No cloud. No internet. No servers. Just devices pooling their idle compute power over local connections (BLE, Wi-Fi Direct, LAN).

## Phase 1 Status

✅ **Complete Type System** — All protocol messages defined (Beacon, Capability, Task, Chunk, Result, Bid, Assignment, Incentive)  
✅ **Cryptographic Layer** — X25519 ECDH key exchange, Ed25519 signatures, NaCl secretbox encryption  
✅ **Beacon Codec** — 38-byte binary frame (fits single BLE advertisement)  
✅ **Message Serializer** — TLV-based wire format for all protocol messages  
✅ **Peer Table** — Active peer management with liveness tracking and cleanup  
✅ **Event Bus** — Typed internal event system with waitFor/once/on/off  
✅ **LAN Transport** — UDP multicast discovery + TCP framed data transfer  
✅ **Virtual Transport** — In-memory transport for testing and simulation  
✅ **Multi-Transport Aggregator** — Automatic transport selection and routing  
✅ **Discovery Layer** — Beacon exchange, ECDH handshake, mesh formation  
✅ **57 Tests Passing** — Unit tests + multi-node mesh integration tests  

### Phase 2 (Capability Exchange) ✅

✅ **Device Profiler** — Real-time CPU, memory, GPU, storage, power, runtime detection with auto-refresh  
✅ **Capability Map** — Aggregated mesh resource view with candidate scoring, budget matching, tier distribution  
✅ **Capability Exchange Layer** — Automatic profile exchange after handshake, periodic refresh, change detection  
✅ **Candidate Scoring Engine** — Weighted scoring (resource 40%, speed 25%, reputation 20%, power 15%)  
✅ **Budget Filters** — Excludes low battery (< 15%), throttled devices, GPU requirement checking  
✅ **29 Phase 2 Tests Passing** — Profiler, serialization, CapMap queries, 5-node mesh exchange  
✅ **78 Total Tests** — All Phase 1 + Phase 2 passing  

### Phase 3 (Negotiation Engine) ✅

✅ **NegotiationEngine** — Full request → bid → score → assign cycle, weighted bid scoring, winner selection  
✅ **BidHandler** — Executor-side: receives task requests, 8-gate evaluation (accepting? capacity? battery? thermal? runtime? resources? deadline? offer?), auto-bid with confidence/price calculation  
✅ **Task Events** — task:request_received, task:bid_received, task:assigned, chunk:received all wired  
✅ **Assignment Records** — Resolved peer addresses, scored capabilities, chunk IDs for distribution layer  
✅ **16 Phase 3 Tests Passing** — Unit tests + full mesh negotiation with 2/3/5 nodes  
✅ **102 Total Tests** — All Phase 1 + 2 + 3 passing  

### Phase 4 (Execution + Distribution + Assembly) ✅

✅ **WASMSandbox** — Sandboxed WASM execution with memory caps, CPU timeout, zero system access, memory zeroing on destroy  
✅ **ResourceMonitor** — Real-time CPU/memory/thermal monitoring with violation callbacks  
✅ **CodeCache** — Content-addressed WASM module cache with SHA-256 verification, LRU eviction  
✅ **DataSplitter** — XOR-based additive secret sharing (CONFIDENTIAL tasks) + parallel chunk splitting  
✅ **TaskDistributor** — Layer 4: data-parallel, pipeline, scatter-gather, and inference decomposition strategies  
✅ **ExecutionEngine** — Layer 5: full chunk lifecycle (load → decrypt → sandbox → encrypt → result)  
✅ **ResultAssembler** — Layer 6: result collection, redundant verification via majority voting, strategy-based merging  
✅ **32 Phase 4 Tests** — Sandbox, monitor, cache, splitter, distributor, engine, assembler  
✅ **134 Total Tests** — All Phases 1-4 passing  

### Phase 5 (CMPNode + CLI) ✅

✅ **CMPNode** — Main integration class wiring all 6 layers. Simple API: `start()`, `stop()`, `compute(wasm, input, opts)`, `getStatus()`, `getPeers()`  
✅ **Compute API** — Submit WASM + input data → negotiate → distribute → execute → assemble → return result. Auto local fallback when no peers  
✅ **CLI** — `cmp start`, `cmp compute`, `cmp bench`, `cmp peers`, `cmp status`, `cmp version`, `cmp help`  
✅ **Benchmark** — 5-node virtual mesh: formation ~2.2s, end-to-end compute ~325ms, 4 chunks across 4 devices  
✅ **16 Phase 5 Tests** — Node lifecycle, mesh formation, compute API, sequential tasks, benchmark simulation  
✅ **150 Total Tests** — All Phases 1-5 passing  

## Project Structure

```
cmp/
├── packages/
│   ├── core/                    # Protocol logic (platform-agnostic)
│   │   ├── src/
│   │   │   ├── types/           # All protocol type definitions
│   │   │   ├── layers/          # Discovery, capability, negotiation, profiler
│   │   │   ├── mesh/            # Peer table, event bus
│   │   │   ├── crypto/          # X25519, Ed25519, encryption
│   │   │   └── utils/           # Config, logger, helpers
│   │   └── tests/               # Phase 1-4 test suites
│   ├── transport/               # Transport implementations
│   │   └── src/
│   │       ├── lan-transport.ts # UDP multicast + TCP
│   │       ├── virtual-transport.ts # In-memory (for testing)
│   │       └── multi-transport.ts   # Transport aggregator
│   └── runtime/                 # Execution environment
│       └── src/
│           ├── wasm-sandbox.ts  # WASM sandbox with resource limits
│           ├── resource-monitor.ts # CPU/memory/thermal monitoring
│           ├── code-cache.ts    # Content-addressed module cache
│           ├── data-splitter.ts # Secret sharing + parallel splitting
│           ├── task-distributor.ts # Task decomposition strategies
│           ├── execution-engine.ts # Full chunk execution lifecycle
│           └── result-assembler.ts # Result collection + verification
├── docs/                        # Protocol spec + implementation guide
└── examples/                    # Demo applications
```

## Quick Start

```bash
# Install dependencies
cd packages/core && npm install
cd ../runtime && npm install && cd ../core

# Run all tests (134 total)
npx tsx tests/phase1.test.ts          # 49 passed — types, codec, crypto, transport
npx tsx tests/mesh-discovery.test.ts  # 8 passed  — multi-node discovery
npx tsx tests/phase2.test.ts          # 29 passed — profiler, capMap, exchange
npx tsx tests/phase3.test.ts          # 16 passed — negotiation, bidding
npx tsx tests/phase4.test.ts          # 32 passed — sandbox, distribution, assembly
```

## Architecture

CMP is a 6-layer protocol stack:

| Layer | Name | Status |
|-------|------|--------|
| 1 | Discovery | ✅ Implemented |
| 2 | Capability Exchange | ✅ Implemented |
| 3 | Negotiation | ✅ Implemented |
| 4 | Distribution | ✅ Implemented |
| 5 | Execution (WASM Sandbox) | ✅ Implemented |
| 6 | Assembly & Verification | ✅ Implemented |

## Next Phases

- **Phase 2:** Capability exchange + capability map (2 weeks)
- **Phase 3:** Negotiation engine — bid/assign cycle (2 weeks)
- **Phase 4:** WASM sandbox execution with resource limits (3 weeks)
- **Phase 5:** Task distribution + result assembly (2 weeks)
- **Phase 6:** Full E2E encryption + redundant verification (2 weeks)

## Key Design Decisions

- **TypeScript** — Universal runtime (Node, React Native, browser)
- **tweetnacl** — Pure JS crypto, zero native dependencies
- **JSON serialization v1** — Simple; migrating to protobuf in v1.1
- **Virtual transport** — Enables full mesh simulation in tests without hardware
- **Zero-trust security** — Every device is assumed potentially malicious

---

*"The compute is already there. There's just no protocol to use it collectively."*

— Agent Viscro
