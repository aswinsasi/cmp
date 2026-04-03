/**
 * CMP v3.0 — CLI Commands
 * Command handlers for all v3.0 subsystems.
 *
 * Usage in cli.ts:
 *   import { doV3Command, v3HelpText } from './v3-cli-commands';
 *   // In command switch:
 *   case 'memory': case 'cortex': case 'gpu': case 'neural':
 *   case 'entangle': case 'evolve': case 'dream3':
 *     doV3Command(v3bridge, cmd, arg);
 *     break;
 *
 * @module cli/v3-cli-commands
 * @author Agent Viscro
 */

import { V3Bridge } from '../../core/src/v3-bridge';

const C = {
  r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function fmt(n: number, d: number = 1): string {
  return n.toFixed(d);
}

function formatBytes(b: number): string {
  if (b > 1e9) return fmt(b / 1e9) + ' GB';
  if (b > 1e6) return fmt(b / 1e6) + ' MB';
  if (b > 1e3) return fmt(b / 1e3) + ' KB';
  return b + ' B';
}

// ═══════════════════════════════════════
// Command Router
// ═══════════════════════════════════════

export async function doV3Command(
  v3: V3Bridge,
  command: string,
  subCmd: string,
  arg: string,
): Promise<void> {
  switch (command) {
    case 'memory': await doMemory(v3, subCmd, arg); break;
    case 'cortex': await doCortex(v3, subCmd, arg); break;
    case 'gpu': await doGPU(v3, subCmd, arg); break;
    case 'neural': doNeural(v3, subCmd); break;
    case 'entangle': doEntangle(v3, subCmd, arg); break;
    case 'evolve': await doEvolve(v3, subCmd); break;
    case 'dream3': await doDream(v3, subCmd); break;
    case 'v3': doV3Status(v3); break;
    default:
      console.log(`  ${C.d}Unknown v3 command: ${command}${C.r}`);
  }
}

// ═══════════════════════════════════════
// Memory (Layer 15)
// ═══════════════════════════════════════

async function doMemory(v3: V3Bridge, sub: string, arg: string): Promise<void> {
  switch (sub) {
    case '':
    case 'status': {
      const stats = v3.memory.getStats();
      console.log(`\n  ${C.b}Mesh Memory (Layer 15)${C.r}`);
      console.log(`  Keys:           ${C.cyan}${stats.totalKeys}${C.r}`);
      console.log(`  Local shards:   ${stats.localShards}`);
      console.log(`  Local bytes:    ${formatBytes(stats.localBytes)}`);
      console.log(`  Mesh estimate:  ${formatBytes(stats.meshBytes)}`);
      console.log(`  Devices:        ${stats.contributingDevices}`);
      console.log(`  Avg redundancy: ${fmt(stats.avgRedundancy)}x`);
      break;
    }

    case 'write': {
      if (!arg) { console.log(`  Usage: memory write <key> <value>`); break; }
      const [key, ...rest] = arg.split(/\s+/);
      const value = rest.join(' ') || 'test-data';
      const data = new TextEncoder().encode(value);
      const distributed = await v3.memory.write(key, data);
      console.log(`  ${C.green}✓${C.r} Wrote "${key}" (${data.length} bytes, ${distributed} shards)`);
      break;
    }

    case 'read': {
      if (!arg) { console.log(`  Usage: memory read <key>`); break; }
      try {
        const result = await v3.memory.read(arg.trim());
        const text = new TextDecoder().decode(result.data);
        console.log(`  ${C.green}✓${C.r} "${arg.trim()}" = ${text}`);
        console.log(`  ${C.d}Shards used: ${result.shardsUsed}, reconstructed in ${result.reconstructionMs}ms${C.r}`);
      } catch (err: any) {
        console.log(`  ${C.red}✗${C.r} ${err.message}`);
      }
      break;
    }

    case 'delete': {
      if (!arg) { console.log(`  Usage: memory delete <key>`); break; }
      const deleted = v3.memory.deleteKey(arg.trim());
      console.log(deleted ? `  ${C.green}✓${C.r} Deleted "${arg.trim()}"` : `  ${C.red}✗${C.r} Not found`);
      break;
    }

    case 'gc': {
      const removed = v3.memory.gc();
      console.log(`  ${C.green}✓${C.r} GC removed ${removed} expired shards`);
      break;
    }

    default:
      console.log(`  Usage: memory [status|write|read|delete|gc]`);
  }
}

// ═══════════════════════════════════════
// Cortex (Layer 14)
// ═══════════════════════════════════════

async function doCortex(v3: V3Bridge, sub: string, arg: string): Promise<void> {
  switch (sub) {
    case '':
    case 'status': {
      const status = v3.cortex.getStatus();
      console.log(`\n  ${C.b}Mesh Cortex (Layer 14)${C.r}`);
      console.log(`  Models loaded:  ${C.cyan}${status.models.length}${C.r}`);
      console.log(`  Memory used:    ${formatBytes(status.totalMemoryUsed)}`);
      console.log(`  Completed:      ${status.completedInferences}`);
      console.log(`  Pending:        ${status.pendingInferences}`);
      for (const m of status.models) {
        console.log(`  ${C.d}├─ ${m.modelName} (${m.totalLayers} layers, ${m.partitions} partitions, devices: ${m.devices.join(', ')})${C.r}`);
      }
      break;
    }

    case 'load': {
      if (!arg) { console.log(`  Usage: cortex load <name> [layers] [dim]`); break; }
      const parts = arg.trim().split(/\s+/);
      const name = parts[0];
      const layers = parseInt(parts[1] || '8');
      const dim = parseInt(parts[2] || '16');
      const weights = new Float32Array(layers * dim * dim);
      for (let i = 0; i < weights.length; i++) weights[i] = (Math.sin(i * 0.1) + 1) * 0.05;
      const modelId = v3.cortex.loadModel({
        modelId: name, modelName: name, totalLayers: layers,
        totalParams: layers * dim * dim, quantization: 8,
        totalSizeBytes: weights.byteLength,
        layerSizes: Array(layers).fill(Math.ceil(weights.byteLength / layers)),
        inputShape: [1, dim], outputShape: [1, dim], hiddenDim: dim,
      }, weights);
      const assignments = v3.cortex.getAssignments(modelId);
      console.log(`  ${C.green}✓${C.r} Loaded "${name}" — ${layers} layers, dim=${dim}, ${assignments.length} partition(s)`);
      break;
    }

    case 'infer': {
      if (!arg) { console.log(`  Usage: cortex infer <modelId>`); break; }
      const modelId = arg.trim();
      try {
        const input = { data: new Float32Array(16).fill(1.0), shape: [1, 16] };
        const result = await v3.cortex.infer(modelId, input);
        console.log(`  ${C.green}✓${C.r} Inference complete in ${fmt(result.totalMs)}ms`);
        console.log(`  ${C.d}Output: [${Array.from(result.output.data.slice(0, 4)).map(v => fmt(v, 3)).join(', ')}, ...]${C.r}`);
        for (const pt of result.partitionTimings) {
          console.log(`  ${C.d}  └─ layers ${pt.layerRange[0]}-${pt.layerRange[1]} on ${pt.device}: ${fmt(pt.computeMs)}ms${C.r}`);
        }
      } catch (err: any) {
        console.log(`  ${C.red}✗${C.r} ${err.message}`);
      }
      break;
    }

    case 'unload': {
      if (!arg) { console.log(`  Usage: cortex unload <modelId>`); break; }
      v3.cortex.unloadModel(arg.trim());
      console.log(`  ${C.green}✓${C.r} Unloaded "${arg.trim()}"`);
      break;
    }

    default:
      console.log(`  Usage: cortex [status|load|infer|unload]`);
  }
}

// ═══════════════════════════════════════
// GPU (Layer 16)
// ═══════════════════════════════════════

async function doGPU(v3: V3Bridge, sub: string, arg: string): Promise<void> {
  switch (sub) {
    case '':
    case 'status': {
      const status = v3.gpu.getStatus();
      console.log(`\n  ${C.b}Mesh GPU (Layer 16)${C.r}`);
      console.log(`  Local GPU:      ${status.localGPU.available ? C.green + status.localGPU.adapterName : C.red + 'none'}${C.r}`);
      console.log(`  Remote GPUs:    ${status.remoteGPUs.length}`);
      console.log(`  Compute est:    ${fmt(status.meshComputeEstimate)} TFLOPS (est.)`);
      console.log(`  Completed:      ${status.completedTasks}`);
      console.log(`  Failed:         ${status.failedTasks}`);
      break;
    }

    case 'matmul': {
      const size = parseInt(arg || '32');
      const A = new Float32Array(size * size);
      const B = new Float32Array(size * size);
      for (let i = 0; i < size * size; i++) { A[i] = Math.random(); B[i] = Math.random(); }
      const result = await v3.gpu.compute('matmul', [
        { label: 'A', data: A, usage: 'storage' },
        { label: 'B', data: B, usage: 'storage' },
      ], [1, 1, 1]);
      console.log(`  ${C.green}✓${C.r} ${size}x${size} matmul in ${fmt(result.computeMs)}ms on ${result.executorDevice}`);
      break;
    }

    case 'relu': {
      const size = parseInt(arg || '1000');
      const data = new Float32Array(size);
      for (let i = 0; i < size; i++) data[i] = Math.random() * 10 - 5;
      const result = await v3.gpu.compute('relu', [
        { label: 'A', data, usage: 'storage' },
      ], [1, 1, 1]);
      const positives = result.outputBuffers[0].filter(v => v > 0).length;
      console.log(`  ${C.green}✓${C.r} ReLU on ${size} elements in ${fmt(result.computeMs)}ms (${positives} positive)`);
      break;
    }

    default:
      console.log(`  Usage: gpu [status|matmul|relu] [size]`);
  }
}

// ═══════════════════════════════════════
// Neuromorphic Routing
// ═══════════════════════════════════════

function doNeural(v3: V3Bridge, sub: string): void {
  switch (sub) {
    case '':
    case 'status': {
      const topo = v3.router.getTopology();
      const stats = v3.router.getStats();
      console.log(`\n  ${C.b}Neuromorphic Router${C.r}`);
      console.log(`  Nodes:          ${C.cyan}${topo.nodes.length}${C.r}`);
      console.log(`  Connections:    ${topo.totalConnections}`);
      console.log(`  Avg weight:     ${fmt(topo.avgWeight, 3)}`);
      console.log(`  Routes:         ${stats.totalRoutes}`);
      console.log(`  Explorations:   ${stats.totalExplorations} (${fmt(stats.explorationRate * 100)}%)`);
      if (topo.dominantPaths.size > 0) {
        console.log(`  Dominant paths:`);
        for (const [type, path] of topo.dominantPaths) {
          console.log(`  ${C.d}  └─ ${type}: ${path.join(' → ')}${C.r}`);
        }
      }
      break;
    }

    case 'topology': {
      const topo = v3.router.getTopology();
      console.log(`\n  ${C.b}Neural Topology${C.r}`);
      for (const conn of topo.connections.slice(0, 20)) {
        const bar = '█'.repeat(Math.round(conn.weight * 10));
        const rate = conn.successRate > 0 ? ` (${fmt(conn.successRate * 100)}% success)` : '';
        console.log(`  ${conn.from.padEnd(12)} → ${conn.to.padEnd(12)} ${fmt(conn.weight, 3)} ${bar}${rate}`);
      }
      if (topo.connections.length > 20) {
        console.log(`  ${C.d}... and ${topo.connections.length - 20} more${C.r}`);
      }
      break;
    }

    case 'log': {
      const log = v3.router.getLearningLog().slice(-10);
      console.log(`\n  ${C.b}Recent Learning Events${C.r}`);
      for (const e of log) {
        const color = e.type === 'ltp' ? C.green : e.type === 'ltd' ? C.red : C.yellow;
        console.log(`  ${color}${e.type.toUpperCase().padEnd(5)}${C.r} ${e.path.join('→')} Δ${fmt(e.weightDelta, 4)}`);
      }
      break;
    }

    default:
      console.log(`  Usage: neural [status|topology|log]`);
  }
}

// ═══════════════════════════════════════
// Entanglement
// ═══════════════════════════════════════

function doEntangle(v3: V3Bridge, sub: string, arg: string): void {
  switch (sub) {
    case '':
    case 'status': {
      const stats = v3.entanglement.getStats();
      console.log(`\n  ${C.b}Computation Entanglement${C.r}`);
      console.log(`  Active:         ${C.cyan}${stats.activeEntanglements}${C.r}`);
      console.log(`  Deltas synced:  ${stats.totalDeltasSynced}`);
      console.log(`  Lifeforms:      ${stats.entangledLifeforms}`);
      break;
    }

    case 'create': {
      const parts = (arg || '').trim().split(/\s+/);
      if (parts.length < 2) { console.log(`  Usage: entangle create <lfA> <lfB> [key1,key2,...]`); break; }
      const keyFilter = parts[2] ? parts[2].split(',') : [];
      const record = v3.entanglement.entangle(parts[0], parts[1], keyFilter);
      if (record) {
        console.log(`  ${C.green}✓${C.r} Entangled ${parts[0]} ↔ ${parts[1]} (id: ${record.id.slice(0, 8)})`);
      } else {
        console.log(`  ${C.red}✗${C.r} Cannot entangle (dead, duplicate, or at max)`);
      }
      break;
    }

    case 'break': {
      if (!arg) { console.log(`  Usage: entangle break <id>`); break; }
      const ok = v3.entanglement.disentangle(arg.trim());
      console.log(ok ? `  ${C.green}✓${C.r} Disentangled` : `  ${C.red}✗${C.r} Not found`);
      break;
    }

    case 'list': {
      if (!arg) { console.log(`  Usage: entangle list <lifeformName>`); break; }
      const records = v3.entanglement.getEntanglements(arg.trim());
      if (records.length === 0) { console.log(`  No entanglements for "${arg.trim()}"`); break; }
      for (const r of records) {
        const partner = r.lifeformA === arg.trim() ? r.lifeformB : r.lifeformA;
        console.log(`  ${r.id.slice(0, 8)} ↔ ${partner} (synced: ${r.deltasSynced})`);
      }
      break;
    }

    default:
      console.log(`  Usage: entangle [status|create|break|list]`);
  }
}

// ═══════════════════════════════════════
// Meta-Evolution
// ═══════════════════════════════════════

async function doEvolve(v3: V3Bridge, sub: string): Promise<void> {
  switch (sub) {
    case '':
    case 'status': {
      const stats = v3.evolver.getStats();
      const genome = v3.evolver.getActiveGenome();
      console.log(`\n  ${C.b}Protocol Meta-Evolution${C.r}`);
      console.log(`  Generation:     ${C.cyan}#${stats.generation}${C.r}`);
      console.log(`  Evaluations:    ${stats.totalEvaluations}`);
      console.log(`  Mutant win rate: ${fmt(stats.mutantWinRate * 100)}%`);
      console.log(`  Active genome:`);
      console.log(`  ${C.d}  fusionCcuThreshold:      ${genome.fusionCcuThreshold}${C.r}`);
      console.log(`  ${C.d}  intentSampleIntervalMs:   ${genome.intentSampleIntervalMs}${C.r}`);
      console.log(`  ${C.d}  catabolicThreshold:       ${genome.catabolicThreshold}${C.r}`);
      console.log(`  ${C.d}  maxCausesPerSecond:       ${genome.maxCausesPerSecond}${C.r}`);
      console.log(`  ${C.d}  neuromorphicLearningRate:  ${genome.neuromorphicLearningRate}${C.r}`);
      break;
    }

    case 'drift': {
      const drift = v3.evolver.getDrift();
      console.log(`\n  ${C.b}Parameter Drift from Defaults${C.r}`);
      for (const [key, d] of Object.entries(drift)) {
        const pct = (d.drift * 100).toFixed(1);
        const color = Math.abs(d.drift) > 0.2 ? C.yellow : C.d;
        console.log(`  ${key.padEnd(35)} ${color}${d.current.toFixed(4).padStart(10)} (${pct > '0' ? '+' : ''}${pct}%)${C.r}`);
      }
      break;
    }

    case 'history': {
      const history = v3.evolver.getHistory().slice(-5);
      console.log(`\n  ${C.b}Recent Generations${C.r}`);
      for (const g of history) {
        const color = g.winner === 'mutant' ? C.green : C.d;
        console.log(`  ${color}Gen #${g.generation}: ${g.winner} wins (parent=${fmt(g.parentScore, 3)} mutant=${fmt(g.mutantScore, 3)}) mutated: ${g.mutatedParams.join(', ')}${C.r}`);
      }
      break;
    }

    default:
      console.log(`  Usage: evolve [status|drift|history]`);
  }
}

// ═══════════════════════════════════════
// Dreaming
// ═══════════════════════════════════════

async function doDream(v3: V3Bridge, sub: string): Promise<void> {
  switch (sub) {
    case '':
    case 'status': {
      const stats = v3.dreaming.getStats();
      const stateColor = stats.state === 'dreaming' ? C.magenta : stats.state === 'awake' ? C.green : C.yellow;
      console.log(`\n  ${C.b}Mesh Dreaming${C.r}`);
      console.log(`  State:          ${stateColor}${stats.state.toUpperCase()}${C.r}`);
      console.log(`  Total dreams:   ${stats.totalDreams}`);
      console.log(`  Total phases:   ${stats.totalPhases}`);
      console.log(`  Dream time:     ${fmt(stats.totalDreamTimeMs / 1000)}s`);
      console.log(`  Fossils:        ${stats.fossils}`);
      console.log(`  Idle:           ${fmt(stats.idleMs / 1000)}s`);
      break;
    }

    case 'now': {
      console.log(`  ${C.magenta}Entering dream state...${C.r}`);
      const report = await v3.dreaming.startDreaming();
      console.log(`  ${C.green}✓${C.r} Dream complete in ${fmt(report.durationMs)}ms`);
      console.log(`  Phases: ${report.phasesCompleted.join(', ')}`);
      for (const [phase, result] of report.phaseResults) {
        console.log(`  ${C.d}  └─ ${phase}: ${result.summary}${C.r}`);
      }
      if (report.interrupted) console.log(`  ${C.yellow}⚠ Interrupted by incoming activity${C.r}`);
      break;
    }

    case 'fossils': {
      const fossils = v3.dreaming.getFossils();
      if (fossils.length === 0) { console.log(`  No fossils discovered yet.`); break; }
      console.log(`\n  ${C.b}Computation Fossils${C.r}`);
      for (const f of fossils) {
        console.log(`  ${C.cyan}${f.patternType}${C.r} (${fmt(f.confidence * 100)}%) ${f.description}`);
      }
      break;
    }

    case 'report': {
      const report = v3.dreaming.getLastReport();
      if (!report) { console.log(`  No dream reports yet.`); break; }
      console.log(`\n  ${C.b}Last Dream Report${C.r}`);
      console.log(`  Duration: ${fmt(report.durationMs)}ms`);
      console.log(`  Phases:   ${report.phasesCompleted.length}`);
      for (const [phase, result] of report.phaseResults) {
        console.log(`  ${C.d}  └─ ${phase} (${fmt(result.durationMs)}ms): ${result.summary}${C.r}`);
      }
      break;
    }

    default:
      console.log(`  Usage: dream3 [status|now|fossils|report]`);
  }
}

// ═══════════════════════════════════════
// V3 Status Summary
// ═══════════════════════════════════════

function doV3Status(v3: V3Bridge): void {
  const s = v3.getStatus();
  console.log(`
  ${C.b}CMP v3.0 Status${C.r}
  ─────────────────────────────────────
  ${C.cyan}Layer 14 — Mesh Cortex${C.r}
    Models: ${s.cortexModels}  Inferences: ${s.cortexInferences}

  ${C.cyan}Layer 15 — Holographic Memory${C.r}
    Keys: ${s.memoryKeys}  Shards: ${s.memoryLocalShards}  Bytes: ${formatBytes(s.memoryLocalBytes)}

  ${C.cyan}Layer 16 — Mesh GPU${C.r}
    Devices: ${s.gpuDevices}  Completed: ${s.gpuCompleted}

  ${C.cyan}Neuromorphic Router${C.r}
    Nodes: ${s.neuralNodes}  Connections: ${s.neuralConnections}  Avg: ${fmt(s.neuralAvgWeight, 3)}

  ${C.cyan}Entanglement${C.r}
    Active: ${s.entanglements}  Syncs: ${s.entanglementSyncs}

  ${C.cyan}Meta-Evolution${C.r}
    Generation: #${s.protocolGeneration}  Win rate: ${fmt(s.mutantWinRate * 100)}%

  ${C.cyan}Dreaming${C.r}
    State: ${s.dreamState}  Dreams: ${s.totalDreams}  Fossils: ${s.fossils}
  `);
}

// ═══════════════════════════════════════
// Help Text
// ═══════════════════════════════════════

export function v3HelpText(): string {
  return `
  ${C.b}Mesh Cortex (v3.0 — Layer 14):${C.r}
    ${C.magenta}cortex${C.r}                       Cortex status (models, inferences)
    ${C.magenta}cortex load${C.r} <name> [layers] [dim]  Load a model into the cortex
    ${C.magenta}cortex infer${C.r} <modelId>       Run inference
    ${C.magenta}cortex unload${C.r} <modelId>      Unload a model

  ${C.b}Holographic Memory (v3.0 — Layer 15):${C.r}
    ${C.magenta}memory${C.r}                       Memory pool status
    ${C.magenta}memory write${C.r} <key> <value>   Write data to mesh memory
    ${C.magenta}memory read${C.r} <key>            Read data from mesh memory
    ${C.magenta}memory delete${C.r} <key>          Delete a key
    ${C.magenta}memory gc${C.r}                    Garbage collect expired shards

  ${C.b}Mesh GPU (v3.0 — Layer 16):${C.r}
    ${C.magenta}gpu${C.r}                          GPU status (local + remote)
    ${C.magenta}gpu matmul${C.r} [size]            Run matrix multiply (default 32x32)
    ${C.magenta}gpu relu${C.r} [size]              Run ReLU activation (default 1000)

  ${C.b}Neuromorphic Router (v3.0):${C.r}
    ${C.magenta}neural${C.r}                       Router status (nodes, weights, routes)
    ${C.magenta}neural topology${C.r}              Show connection weights
    ${C.magenta}neural log${C.r}                   Recent learning events

  ${C.b}Entanglement (v3.0):${C.r}
    ${C.magenta}entangle${C.r}                     Entanglement status
    ${C.magenta}entangle create${C.r} <a> <b>      Entangle two Lifeforms
    ${C.magenta}entangle break${C.r} <id>          Break an entanglement
    ${C.magenta}entangle list${C.r} <name>         List entanglements for a Lifeform

  ${C.b}Meta-Evolution (v3.0):${C.r}
    ${C.magenta}evolve${C.r}                       Protocol evolution status + active genome
    ${C.magenta}evolve drift${C.r}                 Parameter drift from defaults
    ${C.magenta}evolve history${C.r}               Recent generation results

  ${C.b}Mesh Dreaming (v3.0):${C.r}
    ${C.magenta}dream3${C.r}                       Dream state + stats
    ${C.magenta}dream3 now${C.r}                   Force a dream cycle now
    ${C.magenta}dream3 fossils${C.r}               Show discovered computation fossils
    ${C.magenta}dream3 report${C.r}                Last dream report

  ${C.b}V3 Overview:${C.r}
    ${C.magenta}v3${C.r}                           Full v3.0 status summary`;
}
