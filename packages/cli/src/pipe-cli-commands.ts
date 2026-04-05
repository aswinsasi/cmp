/**
 * CMP v4.0 — Pipe CLI Commands
 *
 * CLI handlers for CMP Pipes.
 *
 * Commands:
 *   pipe define <name>: stage1 | stage2 | ...   Define a pipeline
 *   pipe start <name>                           Start pipeline
 *   pipe stop <name>                            Stop pipeline
 *   pipe push <name> <data>                     Push data into pipeline
 *   pipe metrics <name>                         Show pipeline metrics
 *   pipe list                                   List all pipelines
 *   pipe remove <name>                          Remove a pipeline
 *
 * @module cli/pipe-cli-commands
 * @author Agent Viscro
 */

import { PipelineManager } from '../../core/src/pipes/pipeline-manager';
import { PipelineState } from '../../core/src/pipes/pipeline-types';

// ─── ANSI Colors ───

const C = {
  r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function stateColor(state: PipelineState): string {
  switch (state) {
    case PipelineState.RUNNING: return C.green;
    case PipelineState.STOPPED: return C.d;
    case PipelineState.FAILED:  return C.red;
    default: return C.yellow;
  }
}

// ─── CLI Handler ───

export function doPipe(mgr: PipelineManager, subCmd: string, arg: string): void {
  switch (subCmd) {
    case 'define':
      doPipeDefine(mgr, arg);
      break;
    case 'start':
      doPipeStart(mgr, arg.trim());
      break;
    case 'stop':
      doPipeStop(mgr, arg.trim());
      break;
    case 'push':
      doPipePush(mgr, arg);
      break;
    case 'metrics':
      doPipeMetrics(mgr, arg.trim());
      break;
    case 'list':
    case 'ls':
      doPipeList(mgr);
      break;
    case 'remove':
    case 'rm':
      doPipeRemove(mgr, arg.trim());
      break;
    case '':
    case 'help':
    default:
      doPipeHelp();
      break;
  }
}

// ─── Sub-commands ───

function doPipeDefine(mgr: PipelineManager, arg: string): void {
  // Parse: "name: stage1 | stage2 | stage3" or "name stage1 | stage2"
  const colonIdx = arg.indexOf(':');
  let name: string;
  let stagesStr: string;

  if (colonIdx >= 0) {
    name = arg.substring(0, colonIdx).trim();
    stagesStr = arg.substring(colonIdx + 1).trim();
  } else {
    const parts = arg.split(/\s+/);
    name = parts[0] || '';
    stagesStr = parts.slice(1).join(' ');
  }

  if (!name || !stagesStr) {
    console.log(`  ${C.d}Usage: pipe define <name>: stage1 | stage2 | stage3${C.r}`);
    console.log(`  ${C.d}Example: pipe define demo: filter:predicate=gt:100 | map:transform=double | collect${C.r}`);
    return;
  }

  // Split on | to get stage specs
  const stageSpecs = stagesStr.split('|').map(s => s.trim()).filter(s => s.length > 0);

  if (stageSpecs.length === 0) {
    console.log(`  ${C.red}No stages specified.${C.r}`);
    return;
  }

  try {
    const inst = mgr.define(name, stageSpecs);
    console.log(`\n  ${C.green}✓${C.r} Pipeline "${C.b}${name}${C.r}" defined: ${inst.stages.length} stages`);
    for (let i = 0; i < stageSpecs.length; i++) {
      const device = inst.stages[i]?.deviceId ?? 'local';
      console.log(`    ${C.d}Stage ${i}:${C.r} ${stageSpecs[i]} ${C.d}→ ${device}${C.r}`);
    }
    console.log();
  } catch (err: any) {
    console.log(`  ${C.red}Error: ${err.message}${C.r}`);
  }
}

function doPipeStart(mgr: PipelineManager, name: string): void {
  if (!name) {
    console.log(`  ${C.d}Usage: pipe start <name>${C.r}`);
    return;
  }

  if (mgr.start(name)) {
    const metrics = mgr.getMetrics(name);
    console.log(`\n  ${C.green}✓${C.r} Pipeline "${C.b}${name}${C.r}" started`);
    if (metrics) {
      for (const s of metrics.stages) {
        console.log(`    ${C.d}Stage ${s.index} (${s.name})${C.r} → ${s.deviceId}`);
      }
    }
    console.log();
  } else {
    console.log(`  ${C.red}Pipeline "${name}" not found or already running.${C.r}`);
  }
}

function doPipeStop(mgr: PipelineManager, name: string): void {
  if (!name) {
    console.log(`  ${C.d}Usage: pipe stop <name>${C.r}`);
    return;
  }

  const inst = mgr.get(name);
  if (!inst) {
    console.log(`  ${C.red}Pipeline "${name}" not found.${C.r}`);
    return;
  }

  const result = mgr.stop(name);
  const uptime = inst.startedAt ? Date.now() - inst.startedAt : 0;

  console.log(`\n  ${C.green}✓${C.r} Pipeline "${C.b}${name}${C.r}" stopped`);
  console.log(`    ${C.d}Items pushed:    ${C.r}${inst.totalItemsPushed}`);
  console.log(`    ${C.d}Items emitted:   ${C.r}${inst.totalItemsEmitted}`);
  console.log(`    ${C.d}Uptime:          ${C.r}${(uptime / 1000).toFixed(1)}s`);

  if (result && result.length > 0) {
    let display: string;
    try {
      display = new TextDecoder('utf-8', { fatal: true }).decode(result);
      if (display.length > 200) display = display.substring(0, 200) + '...';
    } catch {
      display = `[${result.length} bytes]`;
    }
    console.log(`    ${C.d}Collected:       ${C.r}${result.length} bytes`);
    console.log(`    ${C.d}Output:          ${C.r}${display}`);
  }
  console.log();
}

function doPipePush(mgr: PipelineManager, arg: string): void {
  const spaceIdx = arg.indexOf(' ');
  if (spaceIdx < 0) {
    console.log(`  ${C.d}Usage: pipe push <name> <data>${C.r}`);
    return;
  }

  const name = arg.substring(0, spaceIdx).trim();
  const data = arg.substring(spaceIdx + 1).trim();

  if (mgr.push(name, new TextEncoder().encode(data))) {
    console.log(`  ${C.green}✓${C.r} Pushed ${data.length} bytes into "${name}"`);
  } else {
    console.log(`  ${C.red}Push failed — pipeline "${name}" not found or not running.${C.r}`);
  }
}

function doPipeMetrics(mgr: PipelineManager, name: string): void {
  if (!name) {
    console.log(`  ${C.d}Usage: pipe metrics <name>${C.r}`);
    return;
  }

  const metrics = mgr.getMetrics(name);
  if (!metrics) {
    console.log(`  ${C.red}Pipeline "${name}" not found.${C.r}`);
    return;
  }

  console.log(`\n  ${C.b}Pipeline "${name}"${C.r} ${stateColor(metrics.state)}${metrics.state}${C.r}`);
  console.log(`  ${C.d}Uptime:         ${C.r}${(metrics.uptime / 1000).toFixed(1)}s`);
  console.log(`  ${C.d}Items pushed:   ${C.r}${metrics.totalItemsPushed}`);
  console.log(`  ${C.d}Items emitted:  ${C.r}${metrics.totalItemsEmitted}`);

  if (metrics.bottleneckStage !== null) {
    console.log(`  ${C.d}Bottleneck:     ${C.r}${C.red}Stage ${metrics.bottleneckStage}${C.r}`);
  }

  console.log(`\n  ${C.d}${'Stage'.padEnd(6)} ${'Name'.padEnd(15)} ${'Device'.padEnd(12)} ${'Items'.padEnd(8)} ${'Buf'.padEnd(5)} ${'Items/s'.padEnd(10)} ${'Avg ms'.padEnd(8)} BP${C.r}`);
  console.log(`  ${C.d}${'─'.repeat(75)}${C.r}`);

  for (const s of metrics.stages) {
    const bp = s.backpressureActive ? `${C.red}●${C.r}` : `${C.d}○${C.r}`;
    const isBottleneck = metrics.bottleneckStage === s.index;
    const nameColor = isBottleneck ? C.red : C.r;

    console.log(
      `  ${C.b}${String(s.index).padEnd(6)}${C.r}` +
      `${nameColor}${s.name.padEnd(15)}${C.r}` +
      `${C.d}${s.deviceId.padEnd(12)}${C.r}` +
      `${String(s.itemsProcessed).padEnd(8)}` +
      `${String(s.bufferSize).padEnd(5)}` +
      `${String(s.throughput).padEnd(10)}` +
      `${s.avgLatencyMs.toFixed(2).padEnd(8)}` +
      `${bp}`
    );
  }
  console.log();
}

function doPipeList(mgr: PipelineManager): void {
  const pipes = mgr.list();

  if (pipes.length === 0) {
    console.log(`\n  ${C.d}No pipelines defined.${C.r}\n`);
    return;
  }

  console.log(`\n  ${C.b}Pipelines${C.r} (${pipes.length})\n`);
  for (const p of pipes) {
    const sc = stateColor(p.state);
    console.log(`  ${C.cyan}⧫${C.r} ${C.b}${p.name}${C.r}  ${sc}${p.state}${C.r}  ${C.d}${p.stageCount} stages${C.r}`);
  }
  console.log();
}

function doPipeRemove(mgr: PipelineManager, name: string): void {
  if (!name) {
    console.log(`  ${C.d}Usage: pipe remove <name>${C.r}`);
    return;
  }

  if (mgr.remove(name)) {
    console.log(`  ${C.green}✓${C.r} Pipeline "${name}" removed.`);
  } else {
    console.log(`  ${C.red}Pipeline "${name}" not found.${C.r}`);
  }
}

function doPipeHelp(): void {
  console.log(`
  ${C.b}Pipe Commands:${C.r}
    ${C.cyan}pipe define${C.r} <name>: stage1 | stage2 | ...   Define a pipeline
    ${C.cyan}pipe start${C.r} <name>                           Start streaming
    ${C.cyan}pipe stop${C.r} <name>                            Stop and collect output
    ${C.cyan}pipe push${C.r} <name> <data>                     Push data into pipeline
    ${C.cyan}pipe metrics${C.r} <name>                         Show pipeline metrics
    ${C.cyan}pipe list${C.r}                                   List all pipelines
    ${C.cyan}pipe remove${C.r} <name>                          Remove a pipeline

  ${C.b}Built-in Stages:${C.r}
    filter:predicate=gt:100    Pass items where value > 100
    filter:predicate=nonzero   Pass non-zero items
    filter:predicate=contains:hello  Pass text containing "hello"
    map:transform=double       Double each byte
    map:transform=uppercase    Uppercase text
    map:transform=reverse      Reverse bytes
    map:transform=xor:66       XOR with key 66
    batch:size=10              Collect 10 items, emit as batch
    sample:n=5                 Pass every 5th item
    throttle:rate=100          Limit to 100 items/sec
    collect                    Accumulate all (output on stop)
    log:label=debug            Print items to console

  ${C.b}Example:${C.r}
    pipe define demo: filter:predicate=nonzero | map:transform=uppercase | collect
    pipe start demo
    pipe push demo hello
    pipe push demo world
    pipe stop demo
`);
}

// ─── Help Text for main help ───

export function pipeHelpText(): string {
  return `
  ${C.b}Pipes (v4.0):${C.r}
    ${C.magenta}pipe${C.r} define <n>: s1 | s2 | ...   Define streaming pipeline
    ${C.magenta}pipe${C.r} start/stop/push/metrics/list  Pipeline management`;
}
