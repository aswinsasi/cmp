/**
 * CMP v4.0 — State CLI Commands
 *
 * CLI handlers for the persistent state system.
 * Follows the same pattern as v2-cli-commands.ts.
 *
 * Commands:
 *   state              Show quick state summary
 *   state save         Force save all subsystem state to disk
 *   state load         Reload state from disk (dangerous — overwrites memory)
 *   state info         Show detailed DB info (size, subsystems, save history)
 *   state clear        Wipe all saved state from disk
 *   state cortex       Show checkpointed Cortex models
 *
 * Integration:
 *   - Call initStateStore() during CLI startup
 *   - Call saveAllState() during shutdown
 *   - Pass subsystem refs via StateContext
 *
 * @module cli/state-cli-commands
 * @author Agent Viscro
 */

import { V3StateStore, V3StateInfo } from '../../core/src/persistence/v3-state-store';
import { CortexCheckpointManager } from '../../core/src/persistence/cortex-checkpoint';
import { StateMigrator } from '../../core/src/persistence/state-migrator';
import {
  snapshotAll,
  restoreAll,
  SubsystemRefs,
  FullSnapshotResult,
} from '../../core/src/persistence/route-snapshot';

// ─── ANSI Colors ───

const C = {
  r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

// ─── State Context ───

/**
 * Holds references to all subsystem instances needed for state operations.
 * Populated by the CLI during startup.
 */
export interface StateContext {
  store: V3StateStore;
  refs: SubsystemRefs;
}

// ─── Initialization ───

/**
 * Initialize the V3 State Store. Call during CLI startup.
 * Runs schema migrations if needed, loads any existing state.
 */
export async function initStateStore(dbPath: string): Promise<V3StateStore> {
  const store = new V3StateStore(dbPath);
  await store.init();

  // Run migrations
  const migrator = new StateMigrator(store);
  if (migrator.needsMigration()) {
    const result = migrator.migrate();
    if (result.errors.length > 0) {
      console.log(`  ${C.yellow}⚠ State migration had errors: ${result.errors.join(', ')}${C.r}`);
    }
  }

  return store;
}

/**
 * Save all subsystem state to disk. Call during shutdown.
 */
export function saveAllState(ctx: StateContext): FullSnapshotResult {
  return snapshotAll(ctx.refs, ctx.store);
}

/**
 * Load all subsystem state from disk.
 * Returns the restored state — caller re-hydrates subsystems.
 */
export function loadAllState(ctx: StateContext) {
  return restoreAll(ctx.store);
}

// ─── CLI Command Handler ───

/**
 * Handle 'state' CLI commands.
 */
export function doState(ctx: StateContext, subCmd: string): void {
  switch (subCmd) {
    case 'save':
      doStateSave(ctx);
      break;

    case 'load':
      doStateLoad(ctx);
      break;

    case 'info':
      doStateInfo(ctx);
      break;

    case 'clear':
      doStateClear(ctx);
      break;

    case 'cortex':
      doStateCortex(ctx);
      break;

    case '':
    case 'status':
    default:
      doStateStatus(ctx);
      break;
  }
}

// ─── Sub-commands ───

function doStateStatus(ctx: StateContext): void {
  const info = ctx.store.getInfo();
  const subsystems = Object.keys(info.subsystemCounts);

  console.log(`\n  ${C.b}State Store${C.r}`);
  console.log(`  ${C.d}Schema version  ${C.r}v${info.schemaVersion}`);
  console.log(`  ${C.d}DB size         ${C.r}${formatBytes(info.dbSizeBytes)}`);
  console.log(`  ${C.d}Total entries   ${C.r}${info.totalEntries}`);
  console.log(`  ${C.d}Subsystems      ${C.r}${subsystems.length > 0 ? subsystems.join(', ') : '(none saved)'}`);
  console.log(`  ${C.d}Cortex ckpts    ${C.r}${info.cortexCheckpoints}`);

  if (info.lastSaveAt) {
    const ago = Math.round((Date.now() - info.lastSaveAt) / 1000);
    console.log(`  ${C.d}Last save       ${C.r}${info.lastSaveType} (${ago}s ago, ${info.lastSaveDurationMs}ms)`);
  } else {
    console.log(`  ${C.d}Last save       ${C.r}${C.yellow}never${C.r}`);
  }

  console.log(`  ${C.d}Usage: state [save|load|info|clear|cortex]${C.r}\n`);
}

function doStateSave(ctx: StateContext): void {
  console.log(`\n  ${C.cyan}⧫${C.r} Saving all subsystem state...`);
  const start = Date.now();

  const result = saveAllState(ctx);

  console.log(`  ${C.green}✓${C.r} Saved ${C.b}${result.totalKeysWritten}${C.r} keys across ${C.b}${result.subsystems.length}${C.r} subsystems`);

  // Show per-subsystem breakdown
  for (const sub of result.subsystems) {
    if (sub.keysWritten > 0) {
      console.log(`    ${C.d}${sub.subsystem.padEnd(18)}${C.r}${sub.keysWritten} keys  ${formatBytes(sub.totalBytes)}  ${sub.durationMs}ms`);
    }
  }

  console.log(`  ${C.d}Total: ${formatBytes(result.totalBytes)} in ${result.durationMs}ms${C.r}\n`);
}

function doStateLoad(ctx: StateContext): void {
  console.log(`\n  ${C.cyan}⧫${C.r} Loading state from disk...`);

  const restored = loadAllState(ctx);

  // Count how many subsystems had data
  let count = 0;
  if (restored.consciousness.behavior) count++;
  if (restored.spacetime.dagSummary) count++;
  if (restored.wormhole) count++;
  if (restored.precognition.dreamState) count++;
  if (restored.immune.threatLog) count++;
  if (restored.metabolism.profile) count++;
  if (restored.morphogenesis.affinities) count++;
  if (restored.entanglement) count++;
  if (restored.holographic) count++;
  if (restored.metaEvolution.genomeState) count++;

  if (count === 0) {
    console.log(`  ${C.yellow}⚠${C.r} No saved state found.`);
    console.log(`  ${C.d}Run 'state save' to create a checkpoint.${C.r}\n`);
    return;
  }

  console.log(`  ${C.green}✓${C.r} Loaded state for ${C.b}${count}${C.r} subsystems`);

  // Show what was restored
  if (restored.consciousness.behavior) {
    console.log(`    ${C.d}consciousness    ${C.r}behavior: ${restored.consciousness.behavior.currentBehavior}`);
  }
  if (restored.spacetime.dagSummary) {
    console.log(`    ${C.d}spacetime        ${C.r}DAG: ${restored.spacetime.dagSummary.dagNodes} nodes`);
  }
  if (restored.immune.threatLog) {
    console.log(`    ${C.d}immune           ${C.r}${restored.immune.threatLog.recentThreats?.length ?? 0} threats`);
  }
  if (restored.metabolism.profile) {
    console.log(`    ${C.d}metabolism        ${C.r}state: ${restored.metabolism.profile.state}`);
  }
  if (restored.morphogenesis.affinities) {
    const devCount = Object.keys(restored.morphogenesis.affinities.devices || {}).length;
    console.log(`    ${C.d}morphogenesis     ${C.r}${devCount} device affinities`);
  }
  if (restored.entanglement) {
    console.log(`    ${C.d}entanglement     ${C.r}${restored.entanglement.count ?? 0} pairs`);
  }
  if (restored.metaEvolution.genomeState) {
    console.log(`    ${C.d}meta-evolution   ${C.r}genome loaded`);
  }

  console.log(`  ${C.d}Note: in-memory subsystem state was not overwritten.${C.r}`);
  console.log(`  ${C.d}Subsystems will use restored state on next restart.${C.r}\n`);
}

function doStateInfo(ctx: StateContext): void {
  const info = ctx.store.getInfo();

  console.log(`\n  ${C.b}State Store — Detailed Info${C.r}`);
  console.log(`  ${'─'.repeat(42)}`);
  console.log(`  ${C.d}Schema version  ${C.r}v${info.schemaVersion}`);
  console.log(`  ${C.d}DB file size    ${C.r}${formatBytes(info.dbSizeBytes)}`);
  console.log(`  ${C.d}Total entries   ${C.r}${info.totalEntries}`);
  console.log(`  ${C.d}Cortex ckpts    ${C.r}${info.cortexCheckpoints}`);

  // Per-subsystem counts
  if (Object.keys(info.subsystemCounts).length > 0) {
    console.log(`\n  ${C.b}Subsystems${C.r}`);
    for (const [name, count] of Object.entries(info.subsystemCounts)) {
      console.log(`    ${C.d}${name.padEnd(20)}${C.r}${count} entries`);
    }
  }

  // Save history
  if (info.saveHistory.length > 0) {
    console.log(`\n  ${C.b}Save History${C.r} ${C.d}(last ${info.saveHistory.length})${C.r}`);
    for (const h of info.saveHistory) {
      const time = new Date(h.createdAt).toISOString().substring(11, 19);
      console.log(`    ${C.d}${time}  ${h.saveType.padEnd(8)}${C.r}${h.subsystemsSaved} keys  ${formatBytes(h.totalBytes)}  ${h.durationMs}ms`);
    }
  }

  console.log();
}

function doStateClear(ctx: StateContext): void {
  console.log(`\n  ${C.yellow}⚠${C.r} Clearing all saved state...`);
  ctx.store.clearAll();
  console.log(`  ${C.green}✓${C.r} All state cleared.`);
  console.log(`  ${C.d}Next restart will begin with fresh state.${C.r}\n`);
}

function doStateCortex(ctx: StateContext): void {
  const mgr = new CortexCheckpointManager(ctx.store);
  const models = mgr.listCheckpoints();

  console.log(`\n  ${C.b}Cortex Checkpoints${C.r}`);

  if (models.length === 0) {
    console.log(`  ${C.d}No models checkpointed.${C.r}\n`);
    return;
  }

  for (const m of models) {
    const age = Math.round((Date.now() - m.checkpointedAt) / 1000);
    console.log(`  ${C.cyan}⧫${C.r} ${C.b}${m.modelName}${C.r} (${m.modelId})`);
    console.log(`    ${C.d}Partitions     ${C.r}${m.partitions}`);
    console.log(`    ${C.d}Size           ${C.r}${formatBytes(m.totalBytes)}`);
    console.log(`    ${C.d}Integrity      ${C.r}${m.integrityHashCount} hashes`);
    console.log(`    ${C.d}Checkpointed   ${C.r}${age}s ago`);
  }

  console.log();
}

// ─── Help Text ───

export function stateHelpText(): string {
  return `
  ${C.b}State (v4.0):${C.r}
    ${C.magenta}state${C.r}                        State store summary
    ${C.magenta}state save${C.r}                   Force save all subsystem state now
    ${C.magenta}state load${C.r}                   Reload state from disk
    ${C.magenta}state info${C.r}                   Detailed DB info + save history
    ${C.magenta}state clear${C.r}                  Wipe all saved state
    ${C.magenta}state cortex${C.r}                 Show checkpointed Cortex models`;
}

// ─── Util ───

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
