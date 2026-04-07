# CMP — Compute Mesh Protocol

**Turn any devices on your network into a distributed supercomputer.**

CMP is the world's first self-learning, self-parallelizing, zero-config, zero-blockchain, peer-to-peer WASM mesh computer.

```bash
npm install cmp-protocol
```

## Quick Start — CLI

```bash
npx cmp-protocol start              # Start mesh node (auto-discovers LAN devices)
npx cmp-protocol start --ble        # Start with Bluetooth
npx cmp-protocol start --webrtc     # Start with WebRTC (cross-network)
npx cmp-protocol start --verbose    # Debug logging
npx cmp-protocol signal [port]      # Start WebRTC signaling server
npx cmp-protocol bench              # Run benchmark
npx cmp-protocol version            # Show version
```

After starting, interactive commands:

```bash
peers                    # Show connected devices
status                   # Show mesh info
encrypt Hello World      # Encrypt text via mesh
decrypt 0a272e...        # Decrypt hex via mesh
```

## Quick Start — Code

### 1. Start a mesh node

```typescript
import { CMPNode } from 'cmp-protocol/packages/core/src/cmp-node';

const node = new CMPNode({ transports: ['lan'] });
await node.start();

console.log(`Mesh ID: ${node.shortMeshId()}`);
console.log(`Peers: ${node.getPeers().length}`);
```

Run on 2+ machines on the same LAN. They discover each other automatically via UDP multicast — no server, no config, no tokens.

### 2. Distribute a computation

```typescript
import { CMPNode } from 'cmp-protocol/packages/core/src/cmp-node';
import { buildSensorFilter } from 'cmp-protocol/packages/core/src/wasm/workload-modules';

const node = new CMPNode({ transports: ['lan'] });
await node.start();

// Generate 100K sensor readings
const sensorData = new Uint8Array(100_000);
for (let i = 0; i < sensorData.length; i++) {
  sensorData[i] = Math.floor(Math.random() * 256);
}

// Build a WASM filter: keep only values > 100
const filterWasm = buildSensorFilter(100);

// Distribute across all available devices
const result = await node.compute(filterWasm, sensorData, {
  entryPoint: 'process',
  chunkHint: 4,
  deadline: 5000,
});

console.log(`Output: ${result.data.length} filtered values`);
console.log(`Devices used: ${result.devicesUsed}`);
console.log(`Time: ${result.totalTimeMs}ms`);
console.log(`Verified: ${result.verified}`);

await node.stop();
```

### 3. Built-in WASM modules

```typescript
import { buildGrayscaleModule } from 'cmp-protocol/packages/core/src/wasm/heavy-workloads';
import { buildSensorScale } from 'cmp-protocol/packages/core/src/wasm/workload-modules';
import { buildXorCipherModule } from 'cmp-protocol/packages/core/src/wasm/builtin-wasm-modules';

// RGB → grayscale (ITU-R BT.601)
// 256-bin histogram
// Signal smoothing (moving average)
// Run-length compression
// Multiply each value
// Clamp to range
// Detect peaks
// XOR encryption
// Byte sort
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

## What Makes CMP Unique

**Self-Parallelizing**: Analyzes WASM bytecode to autonomously detect the optimal parallelization pattern — map, filter, reduce, sort, pipeline. No developer annotation needed.

**Self-Learning**: Records execution history and converges to optimal chunk count over time. The protocol gets smarter with every execution.

**Computational Phylogenetics**: New WASM modules inherit optimization strategies from similar code that ran before — zero-shot optimal parallelization on first execution.

**Computation Gravity**: Ships code to data (not data to code) when the function is smaller than the dataset.

**Zero Configuration**: UDP multicast discovery. No server, no registry, no blockchain, no tokens.

**WASM Sandboxed**: Every task runs in WebAssembly — deterministic, portable, sandboxed.

## Key Features

| Feature | Description |
|---|---|
| Auto-Parallelization | Bytecode analysis detects parallelization pattern |
| Self-Learning | Learns optimal strategy from execution history |
| Phylogenetic Inheritance | New code inherits strategy from similar ancestors |
| Computation Gravity | Ships code to data, not data to code |
| Input Structure Detection | Auto-detects RGB, CSV, JSON — splits at record boundaries |
| Merge Verification | Proves distributed result matches local execution |
| Streaming Pipelines | Chain operations with backpressure |
| Computation Certificates | Cryptographic proof of distributed execution |
| Credit-Based Fairness | Incentive ledger tracks contribution/consumption |
| Ed25519 + AES-256 | Full encryption and signing |

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

## CLI Commands

| Command | Description |
|---|---|
| `npx cmp-protocol start` | Start mesh node (LAN auto-discovery) |
| `npx cmp-protocol start --ble` | Start with Bluetooth transport |
| `npx cmp-protocol start --webrtc` | Start with WebRTC transport |
| `npx cmp-protocol start --verbose` | Start with debug logging |
| `npx cmp-protocol signal [port]` | Start WebRTC signaling server |
| `npx cmp-protocol bench` | Run performance benchmark |
| `npx cmp-protocol version` | Show version |

## Tests

```bash
npx tsx node_modules/cmp-protocol/packages/core/tests/self-parallelizing.test.ts
npx tsx node_modules/cmp-protocol/packages/core/tests/self-learning.test.ts
npx tsx node_modules/cmp-protocol/packages/core/tests/phylogenetics.test.ts
npx tsx node_modules/cmp-protocol/packages/core/tests/chaos-network.test.ts
```

## Requirements

- Node.js ≥ 18.0.0
- Devices on the same LAN (UDP multicast must be allowed)

## License

MIT — Agent Viscro (Aswin)

## Links

- GitHub: [github.com/aswinsasi/cmp](https://github.com/aswinsasi/cmp)
- npm: [npmjs.com/package/cmp-protocol](https://www.npmjs.com/package/cmp-protocol)
- Protocol Spec: [PROTOCOL-SPEC.md](./packages/core/PROTOCOL-SPEC.md)
