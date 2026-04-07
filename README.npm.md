# CMP — Compute Mesh Protocol

**Turn any devices on your network into a distributed supercomputer.**

CMP is the world's first zero-config, zero-blockchain, peer-to-peer WASM mesh computer. Drop it into any Node.js app and distribute computation across every idle device on your LAN — automatically.

```
npm install @agent-viscro/cmp
```

## 5-Minute Quickstart

### 1. Start a mesh node

```typescript
import { CMPNode } from '@agent-viscro/cmp';

const node = new CMPNode({ transports: ['lan'] });
await node.start();

console.log(`Mesh ID: ${node.shortMeshId()}`);
console.log(`Peers: ${node.getPeers().length}`);
```

Run this on 2+ machines on the same LAN. They discover each other automatically via UDP multicast — no server, no config, no tokens.

### 2. Distribute a computation

```typescript
import { CMPNode, buildSensorFilter } from '@agent-viscro/cmp';

const node = new CMPNode({ transports: ['lan'] });
await node.start();

// Generate some data (e.g., 100K sensor readings)
const sensorData = new Uint8Array(100_000);
for (let i = 0; i < sensorData.length; i++) {
  sensorData[i] = Math.floor(Math.random() * 256);
}

// Build a WASM filter: keep only values > 100
const filterWasm = buildSensorFilter(100);

// Distribute across all available devices
const result = await node.compute(filterWasm, sensorData, {
  entryPoint: 'process',
  chunkHint: 4,    // split across 4 devices
  deadline: 5000,  // 5 second timeout
});

console.log(`Output: ${result.data.length} filtered values`);
console.log(`Devices used: ${result.devicesUsed}`);
console.log(`Time: ${result.totalTimeMs}ms`);
console.log(`Verified: ${result.verified}`);

await node.stop();
```

### 3. Build custom WASM modules

```typescript
import { WasmModuleBuilder, Op } from '@agent-viscro/cmp';

// Build a WASM module that doubles every byte
const builder = new WasmModuleBuilder();
// ... or use built-in modules:

import {
  buildGrayscaleModule,    // RGB → grayscale (ITU-R BT.601)
  buildHistogramModule,     // 256-bin histogram
  buildMovingAverageModule, // signal processing
  buildRLECompressModule,   // run-length encoding compression
  buildSensorScale,         // multiply each value
  buildSensorClamp,         // clamp to range
  buildSensorPeaks,         // detect peaks
} from '@agent-viscro/cmp';
```

## How It Works

```
  Device A (submitter)              Device B (worker)           Device C (worker)
  ┌─────────────────┐              ┌─────────────────┐         ┌─────────────────┐
  │ 1. Submit task   │──discover──→│ Listening...     │         │ Listening...     │
  │ 2. Split data    │             │                  │         │                  │
  │ 3. Send chunk 1 ─┼────────────→│ 4. Execute WASM  │         │                  │
  │    Send chunk 2 ─┼─────────────┼──────────────────┼────────→│ 4. Execute WASM  │
  │                  │             │ 5. Return result ─┼────────→│ 5. Return result │
  │ 6. Assemble     ←┼─────────────┼──────────────────┤         │                  │
  │ 7. Verify        │             │                  │         │                  │
  │ 8. Return result │             │                  │         │                  │
  └─────────────────┘              └─────────────────┘         └─────────────────┘
```

1. **Discovery**: UDP multicast beacons on `239.77.67.80:43580`
2. **Handshake**: Ed25519 key exchange + capability negotiation
3. **Task Analysis**: Auto-detect parallelization pattern (map, filter, reduce, scatter-gather)
4. **Data Splitting**: Chunk input data based on task type and device count
5. **Execution**: Each device runs the WASM module in a sandboxed environment
6. **Assembly**: Results merged according to pattern (concat, reduce, sort-merge)
7. **Verification**: Byte-level output verification

## Key Features

**Zero Configuration**: Devices discover each other via UDP multicast. No server, no registry, no manual IP entry.

**Zero Blockchain**: No tokens, no wallets, no gas fees. Pure peer-to-peer with a credit-based fairness system.

**WASM Sandboxed**: Every task runs in WebAssembly — deterministic, portable, sandboxed. Same binary runs on any device.

**Auto-Parallelization**: The `TaskCompiler` analyzes WASM exports and detects the optimal parallelization pattern automatically.

**Computation Gravity**: For large datasets, CMP ships code to the data instead of data to the code. A 50-byte function moves to a 2GB dataset — not the other way around.

**Streaming Pipelines**: Chain operations with backpressure-aware streaming.

```typescript
const pipes = new PipelineManager(node.shortMeshId());
pipes.define('etl', [
  'filter:predicate=gt:100',
  'map:transform=double',
  'collect',
]);
pipes.start('etl');
pipes.push('etl', rawData);
const result = pipes.stop('etl');
```

## API Reference

### `CMPNode`

```typescript
const node = new CMPNode(config?: CMPNodeConfig);
await node.start();                              // Join the mesh
await node.stop();                               // Leave the mesh
const result = await node.compute(wasm, input, options); // Distribute work
const status = node.getStatus();                 // Mesh status
const peers = node.getPeers();                   // Connected peers
```

### `ComputeOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `entryPoint` | `string` | `'process'` | WASM function to call |
| `chunkHint` | `number` | auto | Number of chunks to split into |
| `deadline` | `number` | `30000` | Timeout in ms |
| `taskType` | `TaskType` | auto | `DATA_PARALLEL`, `MAP_REDUCE`, etc. |
| `priority` | `Priority` | `NORMAL` | Task priority |
| `certify` | `boolean` | `false` | Generate computation certificate |

### `ComputeResult`

| Field | Type | Description |
|---|---|---|
| `data` | `Uint8Array` | Assembled output |
| `totalTimeMs` | `number` | End-to-end time |
| `chunksExecuted` | `number` | Chunks processed |
| `devicesUsed` | `number` | Unique devices used |
| `verified` | `boolean` | Output verified |
| `localFallback` | `boolean` | Whether it ran locally |
| `certificate` | `ComputationCertificate?` | Cryptographic proof |

## WASM Module Convention

CMP WASM modules follow a simple convention:

1. Export `memory` (WebAssembly.Memory, min 1 page)
2. Export `process` function (or custom entry point)
3. Host writes input to `memory[0..inputLen]`
4. Host calls `process(inputLen)` → `outputLen`
5. WASM writes output to `memory[inputLen..inputLen+outputLen]`
6. Host reads `outputLen` bytes from `memory[inputLen]`

## Requirements

- Node.js ≥ 18.0.0
- Devices on the same LAN (UDP multicast must be allowed)
- No external dependencies beyond `sql.js` and `tweetnacl`

## Benchmarks

Run the scaling benchmark:

```bash
npx tsx benchmarks/scaling-benchmark.ts
```

Run chaos tests (packet loss, latency, node crashes):

```bash
npx tsx tests/chaos-network.test.ts
```

## License

MIT — Agent Viscro (Aswin)

## Links

- GitHub: [github.com/aswinsasi/cmp](https://github.com/aswinsasi/cmp)
- Protocol Spec: [PROTOCOL-SPEC.md](./PROTOCOL-SPEC.md)
