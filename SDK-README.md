# cmp-mesh

**Make nearby devices work together.**

Your laptop is slow processing a large file. But there are 3 other laptops on the same WiFi doing nothing. What if they could help?

```bash
npm install cmp-mesh
```

```typescript
import { CMP } from 'cmp-mesh';

const mesh = new CMP();
await mesh.start();

console.log(`Found ${mesh.peers} nearby devices`);

// This runs across ALL nearby devices, not just yours
const result = await mesh.distribute(myData, myWasmCode);

console.log(`Done in ${result.timeMs}ms using ${result.devices} devices`);
```

No server. No cloud. No internet. Devices find each other automatically.

---

## When to use CMP

Use CMP when:
- You have a **heavy computation** (image processing, data analysis, AI inference)
- There are **other devices nearby** on the same network
- You **can't or don't want** to use cloud services
- You need it to work **without internet**

Don't use CMP when:
- The task takes less than 1 second on one device
- You have reliable cloud infrastructure
- You're the only device around

---

## Real Examples

### Example 1: Process images faster

You have 100 photos to convert to grayscale. One laptop: 60 seconds. Four laptops: 15 seconds.

```typescript
import { CMP } from 'cmp-mesh';
import { readFileSync } from 'fs';

const mesh = new CMP();
await mesh.start();
await mesh.waitForPeers(1); // Wait for at least 1 helper

const grayscaleWasm = readFileSync('./grayscale.wasm');
const photo = readFileSync('./photo.raw');

const result = await mesh.distribute(photo, grayscaleWasm);

console.log(result.distributed ? 'Processed on another device!' : 'Processed locally');
console.log(`Time: ${result.timeMs}ms`);
```

### Example 2: Run code on the mesh

```typescript
const mesh = new CMP({ logLevel: 'info' });
await mesh.start();

// This JavaScript runs locally (only WASM distributes)
const result = await mesh.run('js',
  'function process(data) { return JSON.stringify(JSON.parse(data).sort()); }',
  '[5, 3, 1, 4, 2]'
);

console.log(result.output); // "[1,2,3,4,5]"
```

### Example 3: Build a mesh-powered API server

```typescript
import express from 'express';
import { CMP } from 'cmp-mesh';

const app = express();
const mesh = new CMP();
await mesh.start();

app.post('/process', async (req, res) => {
  const input = new Uint8Array(req.body);

  // Heavy processing distributed across office devices
  const result = await mesh.distribute(input, processorWasm, { deadline: 10000 });

  res.json({
    processed: true,
    distributed: result.distributed,
    devices: result.devices,
    timeMs: result.timeMs,
  });
});

app.get('/mesh', (req, res) => {
  res.json(mesh.status());
  // { id: "e3da490e", peers: 4, behavior: "HIGH_DEMAND", ... }
});

app.listen(3000);
```

### Example 4: Classroom — students pool compute

Teacher's laptop starts the mesh. 30 students join automatically.

```typescript
const mesh = new CMP({ logLevel: 'info' });
await mesh.start();

console.log('Waiting for students to join...');
const peers = await mesh.waitForPeers(5, 60000);
console.log(`${peers} students connected!`);

// Train a small ML model using everyone's compute
const trainingData = readFileSync('./dataset.bin');
const modelWasm = readFileSync('./train.wasm');

const result = await mesh.distribute(trainingData, modelWasm, { deadline: 30000 });
console.log(`Model trained in ${result.timeMs}ms across ${result.devices} devices`);
```

---

## How it works (simple version)

1. **You start CMP** → your device broadcasts "I'm here" on the local network
2. **Nearby devices running CMP hear it** → they respond "I'm here too"
3. **You submit a task** → CMP finds the best device(s) to help
4. **The task splits into pieces** → each piece goes to a different device
5. **Each device runs its piece in a secure sandbox** → no one can see each other's data
6. **Results come back and merge** → you get the final answer

All of this happens in milliseconds. Your code just calls `mesh.distribute()`.

---

## Mesh Status

```typescript
console.log(mesh.status());
```

```json
{
  "id": "e3da490e",
  "running": true,
  "peers": 3,
  "credits": 100,
  "behavior": "NORMAL",
  "pheromones": 5,
  "uptime": 45000
}
```

- **peers**: Nearby devices on the mesh
- **credits**: Compute credits (you earn by helping others)
- **behavior**: The mesh's collective mood (NORMAL, HIGH_DEMAND, DEFENSIVE, etc.)
- **pheromones**: Activity markers left by computations (the mesh "remembers" what happened)

---

## CLI (for testing)

```bash
npx cmp-mesh start
```

```
cmp> status           # See mesh status
cmp> peers            # List nearby devices
cmp> run js -c "function process(d) { return d.toUpperCase(); }" "hello"
cmp> consciousness    # See mesh behavior
cmp> help             # All commands
```

---

## FAQ

**Q: Do I need to install CMP on every device?**
Yes. Every device that participates needs to run CMP. It's like a chat app — both sides need it.

**Q: Is my data safe?**
Yes. All data is encrypted in transit. Each computation runs in a WASM sandbox — the executing device cannot access your data outside the sandbox.

**Q: What if a device leaves mid-computation?**
CMP detects it and reassigns the work to another device or falls back to local.

**Q: Does it work without WiFi?**
On computers: needs same network (WiFi or Ethernet). On phones (future): works via Bluetooth with no WiFi at all.

**Q: Can I use this in production?**
It's a working protocol with 800+ tests. For production, you'd want to add monitoring and error handling around the mesh calls.
