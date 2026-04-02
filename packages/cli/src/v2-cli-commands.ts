/**
 * CMP v2.0 — CLI Commands for Layers 11-13
 *
 * Drop-in command handlers for the CMP REPL.
 * Import and call from cli.ts:
 *
 *   import { doConsciousness, doSpacetime, doWormhole, doV2Status } from './v2-cli-commands';
 *
 *   case 'consciousness': case 'c11':
 *     doConsciousness(v2bridge, arg);
 *     break;
 *   case 'spacetime': case 'c12':
 *     doSpacetime(v2bridge, arg);
 *     break;
 *   case 'wormhole': case 'c13':
 *     doWormhole(v2bridge, arg);
 *     break;
 *
 * @module cli/v2-cli-commands
 * @author Agent Viscro
 */

import { V2Bridge } from '../../core/src/v2-bridge';
import { PheromoneType } from '../../core/src/types/consciousness';
import { FitnessMetric } from '../../core/src/types/spacetime';
import { TeleportReason } from '../../core/src/types/wormhole';

// ─── Colors ───

const C = {
  r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

// ═══════════════════════════════════════
// Layer 11: Consciousness Commands
// ═══════════════════════════════════════

export function doConsciousness(v2: V2Bridge, arg: string): void {
  const parts = arg.trim().split(/\s+/);
  const cmd = (parts[0] || 'status').toLowerCase();

  switch (cmd) {
    case 'status': {
      const status = v2.consciousness.getStatus();
      const behaviorColor = status.behavior === 'defensive' ? C.red
        : status.behavior === 'dreaming' ? C.blue
        : status.behavior === 'high_demand' ? C.yellow
        : C.green;

      console.log();
      console.log(`  ${C.b}Layer 11: Collective Consciousness${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Behavior      ${C.r}${behaviorColor}${C.b}${status.behavior.toUpperCase()}${C.r}`);
      console.log(`  ${C.d}Pheromones    ${C.r}${C.b}${status.pheromoneCount}${C.r} active`);
      if (status.dominantPheromone) {
        console.log(`  ${C.d}Dominant      ${C.r}${C.cyan}${status.dominantPheromone.type}${C.r} (${status.dominantPheromone.totalConcentration.toFixed(2)})`);
      }
      console.log(`  ${C.d}Quorum States ${C.r}${C.b}${status.quorumStates.length}${C.r} signals tracked`);
      console.log(`  ${C.d}Decisions     ${C.r}${C.b}${status.activeDecisions}${C.r} active, ${C.b}${status.decidedCount}${C.r} decided`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'pheromones': case 'phero': {
      const readings = v2.consciousness.pheromones.readAll();
      if (readings.length === 0) {
        console.log(`  ${C.d}No active pheromones.${C.r}`);
        break;
      }
      console.log();
      console.log(`  ${C.b}Active Pheromone Readings${C.r}`);
      for (const r of readings) {
        const bar = '█'.repeat(Math.min(20, Math.round(r.totalConcentration * 10)));
        const color = r.type === 'danger' ? C.red
          : r.type === 'compute_failure' ? C.yellow
          : r.type === 'compute_success' ? C.green
          : C.cyan;
        console.log(`  ${color}${r.type.padEnd(20)}${C.r} ${bar} ${C.b}${r.totalConcentration.toFixed(2)}${C.r} (${r.depositCount} deposits)`);
      }
      console.log();
      break;
    }

    case 'deposit': {
      const type = (parts[1] || 'compute_success') as PheromoneType;
      const conc = parseFloat(parts[2] || '1.0');
      v2.consciousness.pheromones.deposit(type, conc);
      console.log(`  ${C.green}Deposited${C.r} ${type} pheromone (concentration: ${conc})`);
      break;
    }

    case 'quorum': {
      const states = v2.consciousness.quorum.getAllStates();
      if (states.length === 0) {
        console.log(`  ${C.d}No quorum signals observed.${C.r}`);
        break;
      }
      console.log();
      console.log(`  ${C.b}Quorum States${C.r}`);
      for (const s of states) {
        const pct = (s.quorumPercent * 100).toFixed(0);
        const reached = s.thresholdReached ? `${C.green}REACHED` : `${C.yellow}${pct}%`;
        console.log(`  ${C.cyan}${s.signalType.padEnd(20)}${C.r} ${reached}${C.r} (${s.observerCount}/${s.meshSize} observers)`);
      }
      console.log();
      break;
    }

    case 'decide': {
      const question = parts[1] || 'Should we optimize?';
      const options = parts.slice(2);
      if (options.length < 2) {
        console.log(`  ${C.d}Usage: consciousness decide <question> <option1> <option2> [option3]${C.r}`);
        break;
      }
      const decision = v2.consciousness.swarm.initiate(question, options);
      console.log(`  ${C.green}Swarm decision initiated:${C.r} ${decision.id}`);
      console.log(`  ${C.d}Question: ${question}${C.r}`);
      console.log(`  ${C.d}Options: ${options.join(', ')}${C.r}`);
      console.log(`  ${C.d}Sampling window: ${decision.samplingWindowMs}ms${C.r}`);
      break;
    }

    case 'decisions': {
      const decided = v2.consciousness.swarm.getDecided();
      const active = v2.consciousness.swarm.getActive();
      if (decided.length === 0 && active.length === 0) {
        console.log(`  ${C.d}No swarm decisions.${C.r}`);
        break;
      }
      console.log();
      if (active.length > 0) {
        console.log(`  ${C.b}Active Decisions${C.r}`);
        for (const d of active) {
          console.log(`  ${C.yellow}${d.id}${C.r} "${d.question}" — ${d.samples.length} samples`);
        }
      }
      if (decided.length > 0) {
        console.log(`  ${C.b}Decided${C.r}`);
        for (const d of decided) {
          console.log(`  ${C.green}${d.id}${C.r} "${d.question}" → ${C.b}${d.result?.winner}${C.r} (confidence: ${d.result?.confidence.toFixed(2)})`);
        }
      }
      console.log();
      break;
    }

    default:
      console.log(`  ${C.d}Usage: consciousness [status|pheromones|deposit|quorum|decide|decisions]${C.r}`);
  }
}

// ═══════════════════════════════════════
// Layer 12: Spacetime Commands
// ═══════════════════════════════════════

export function doSpacetime(v2: V2Bridge, arg: string): void {
  const parts = arg.trim().split(/\s+/);
  const cmd = (parts[0] || 'status').toLowerCase();

  switch (cmd) {
    case 'status': {
      const status = v2.spacetime.getStatus();
      console.log();
      console.log(`  ${C.b}Layer 12: Computation Spacetime${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}DAG Nodes     ${C.r}${C.b}${status.dagNodes}${C.r}`);
      console.log(`  ${C.d}Branches      ${C.r}${C.b}${status.dagBranches}${C.r} (${status.activeBranches.length} active)`);
      console.log(`  ${C.d}Total Compute ${C.r}${C.b}${status.totalComputeMs}${C.r}ms`);
      console.log(`  ${C.d}Total CCU     ${C.r}${C.b}${status.totalCcu.toFixed(3)}${C.r}`);
      if (status.activeBranches.length > 0) {
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const b of status.activeBranches) {
          const fitnessStr = b.fitness?.causesProcessed > 0
            ? ` (${b.fitness.causesProcessed} causes, ${b.fitness.avgExecutionMs.toFixed(1)}ms avg)`
            : '';
          console.log(`  ${C.cyan}${b.id.padEnd(24)}${C.r} [${b.state}] len=${b.length}${fitnessStr}`);
        }
      }
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'fork': {
      const label = parts[1] || `experiment-${Date.now() % 10000}`;
      const branchId = v2.spacetime.fork(label);
      if (branchId) {
        console.log(`  ${C.green}Forked:${C.r} ${branchId} ("${label}")`);
      } else {
        console.log(`  ${C.red}Fork failed${C.r} — max branches reached or no trunk data`);
      }
      break;
    }

    case 'branches': {
      const branches = v2.spacetime.forker.getAllBranches();
      console.log();
      console.log(`  ${C.b}All Branches${C.r}`);
      for (const b of branches) {
        const stateColor = b.state === 'active' ? C.green
          : b.state === 'racing' ? C.yellow
          : b.state === 'merged' ? C.cyan
          : C.red;
        console.log(`  ${stateColor}${b.state.padEnd(10)}${C.r} ${b.id} "${b.label}" (${b.length} nodes)`);
      }
      console.log();
      break;
    }

    case 'race': {
      const branchIds = parts.slice(1);
      if (branchIds.length < 2) {
        console.log(`  ${C.d}Usage: spacetime race <branchId1> <branchId2> [branchId3]${C.r}`);
        break;
      }
      const raceId = v2.spacetime.startRace(branchIds, FitnessMetric.SPEED);
      if (raceId) {
        console.log(`  ${C.green}Race started:${C.r} ${raceId}`);
        console.log(`  ${C.d}Branches: ${branchIds.join(', ')}${C.r}`);
      } else {
        console.log(`  ${C.red}Race failed${C.r} — check branch IDs exist and are active`);
      }
      break;
    }

    case 'merge': {
      const branchId = parts[1];
      if (!branchId) {
        console.log(`  ${C.d}Usage: spacetime merge <branchId>${C.r}`);
        break;
      }
      const result = v2.spacetime.merge(branchId);
      if (result) {
        console.log(`  ${C.green}Merged:${C.r} ${branchId} → trunk`);
        console.log(`  ${C.d}Fitness: ${result.fitness.causesProcessed} causes, ${result.fitness.totalCcu.toFixed(3)} CCU${C.r}`);
      } else {
        console.log(`  ${C.red}Merge failed${C.r} — branch not found or not active`);
      }
      break;
    }

    case 'timeline': case 'history': {
      const branchId = parts[1] || 'trunk';
      const limit = parseInt(parts[2] || '10');
      const nodes = v2.spacetime.getTimeline(branchId, limit);
      if (nodes.length === 0) {
        console.log(`  ${C.d}No history for branch "${branchId}".${C.r}`);
        break;
      }
      console.log();
      console.log(`  ${C.b}Timeline: ${branchId}${C.r} (${nodes.length} most recent)`);
      for (const n of nodes) {
        console.log(`  ${C.d}#${n.sequence}${C.r} ${n.hash.substring(0, 12)}... ${C.d}cause=${n.causeId} ${n.executionTimeMs}ms ${n.ccuCost.toFixed(3)} CCU${C.r}`);
      }
      console.log();
      break;
    }

    case 'verify': {
      const branchId = parts[1] || 'trunk';
      const result = v2.spacetime.verifyHistory(branchId);
      if (result.valid) {
        console.log(`  ${C.green}✓${C.r} Branch "${branchId}" integrity verified`);
      } else {
        console.log(`  ${C.red}✗${C.r} Branch "${branchId}" INVALID at ${result.invalidAt}`);
      }
      break;
    }

    default:
      console.log(`  ${C.d}Usage: spacetime [status|fork|branches|race|merge|timeline|verify]${C.r}`);
  }
}

// ═══════════════════════════════════════
// Layer 13: Wormhole Commands
// ═══════════════════════════════════════

export function doWormhole(v2: V2Bridge, arg: string): void {
  const parts = arg.trim().split(/\s+/);
  const cmd = (parts[0] || 'status').toLowerCase();

  switch (cmd) {
    case 'status': {
      const status = v2.wormhole.getStatus();
      console.log();
      console.log(`  ${C.b}Layer 13: Cross-Mesh Wormholes${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Local Mesh    ${C.r}${C.b}${status.localMeshFingerprint}${C.r}`);
      console.log(`  ${C.d}Is Wormhole   ${C.r}${status.isWormhole ? `${C.green}Yes` : `${C.d}No`}${C.r}`);
      console.log(`  ${C.d}Wormholes     ${C.r}${C.b}${status.activeWormholes}${C.r} active`);
      console.log(`  ${C.d}Remote Meshes ${C.r}${C.b}${status.remoteMeshes.length}${C.r} known`);
      console.log(`  ${C.d}Teleports     ${C.r}${C.b}${status.activeTeleports}${C.r} active`);
      console.log(`  ${C.d}X-Synapses    ${C.r}${C.b}${status.crossSynapses}${C.r}`);
      if (status.remoteMeshes.length > 0) {
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const m of status.remoteMeshes) {
          console.log(`  ${C.cyan}${m.fingerprint.substring(0, 16)}${C.r} "${m.label}" — ${m.wormholeCount} wormhole(s), ${m.bestLatencyMs}ms`);
        }
      }
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'declare': {
      const remoteFp = parts[1];
      const label = parts[2] || 'remote';
      const latency = parseInt(parts[3] || '100');
      if (!remoteFp) {
        console.log(`  ${C.d}Usage: wormhole declare <remoteMeshFingerprint> [label] [latencyMs]${C.r}`);
        break;
      }
      v2.wormhole.declareWormhole(remoteFp, label, latency);
      console.log(`  ${C.green}Declared wormhole${C.r} → ${remoteFp} ("${label}", ${latency}ms)`);
      break;
    }

    case 'meshes': {
      const meshes = v2.wormhole.discovery.getRemoteMeshes();
      if (meshes.length === 0) {
        console.log(`  ${C.d}No remote meshes known.${C.r}`);
        break;
      }
      console.log();
      console.log(`  ${C.b}Known Remote Meshes${C.r}`);
      for (const m of meshes) {
        console.log(`  ${C.cyan}${m.fingerprint}${C.r}`);
        console.log(`    ${C.d}Label: ${m.label}, Wormholes: ${m.wormholeNodes.length}, Latency: ${m.bestLatencyMs}ms${C.r}`);
      }
      console.log();
      break;
    }

    case 'teleport': {
      const lfName = parts[1];
      const destMesh = parts[2];
      if (!lfName || !destMesh) {
        console.log(`  ${C.d}Usage: wormhole teleport <lifeformName> <destMeshFingerprint>${C.r}`);
        break;
      }
      const teleportId = v2.wormhole.teleport(lfName, lfName, destMesh);
      if (teleportId) {
        console.log(`  ${C.green}Teleport initiated:${C.r} ${teleportId}`);
        console.log(`  ${C.d}${lfName} → ${destMesh}${C.r}`);
      } else {
        console.log(`  ${C.red}Teleport failed${C.r} — no wormhole to ${destMesh}`);
      }
      break;
    }

    case 'synapse': {
      const localLf = parts[1];
      const remoteLf = parts[2];
      const remoteMesh = parts[3];
      if (!localLf || !remoteLf || !remoteMesh) {
        console.log(`  ${C.d}Usage: wormhole synapse <localLifeform> <remoteLifeform> <remoteMesh>${C.r}`);
        break;
      }
      const synapse = v2.wormhole.createCrossSynapse(localLf, remoteLf, remoteMesh);
      if (synapse) {
        console.log(`  ${C.green}Cross-mesh synapse:${C.r} ${synapse.id}`);
        console.log(`  ${C.d}${localLf} ↔ ${remoteLf}@${remoteMesh}${C.r}`);
      } else {
        console.log(`  ${C.red}Failed${C.r} — no wormhole to ${remoteMesh}`);
      }
      break;
    }

    case 'synapses': {
      const all = v2.wormhole.synapses.getAll();
      if (all.length === 0) {
        console.log(`  ${C.d}No cross-mesh synapses.${C.r}`);
        break;
      }
      console.log();
      console.log(`  ${C.b}Cross-Mesh Synapses${C.r}`);
      for (const s of all) {
        console.log(`  ${C.cyan}${s.id}${C.r} ${s.localLifeformName} ↔ ${s.remoteLifeformName}@${s.remoteMeshFingerprint.substring(0, 12)}`);
        console.log(`    ${C.d}weight=${s.weight.toFixed(2)}, signals=${s.signalCount}${C.r}`);
      }
      console.log();
      break;
    }

    default:
      console.log(`  ${C.d}Usage: wormhole [status|declare|meshes|teleport|synapse|synapses]${C.r}`);
  }
}

// ═══════════════════════════════════════
// Enhanced Status (adds v2.0 to existing status)
// ═══════════════════════════════════════

export function doV2Status(v2: V2Bridge): void {
  const s = v2.getStatus();
  const behaviorColor = s.behavior === 'defensive' ? C.red
    : s.behavior === 'dreaming' ? C.blue
    : s.behavior === 'high_demand' ? C.yellow
    : s.behavior === 'growth' ? C.cyan
    : C.green;

  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
  console.log(`  ${C.d}Behavior      ${C.r}${behaviorColor}${C.b}${s.behavior.toUpperCase()}${C.r}`);
  console.log(`  ${C.d}Pheromones    ${C.r}${C.b}${s.pheromoneCount}${C.r}${s.dominantPheromone ? ` ${C.d}(dominant: ${s.dominantPheromone})${C.r}` : ''}`);
  console.log(`  ${C.d}DAG           ${C.r}${C.b}${s.dagNodes}${C.r} nodes, ${C.b}${s.activeBranches}${C.r} branches`);
  console.log(`  ${C.d}Wormholes     ${C.r}${C.b}${s.activeWormholes}${C.r} active, ${C.b}${s.remoteMeshes}${C.r} remote meshes`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
}

// ═══════════════════════════════════════
// Help Text
// ═══════════════════════════════════════

export function v2HelpText(): string {
  return `
  ${C.b}Consciousness (v2.0 Layer 11):${C.r}
    ${C.magenta}consciousness${C.r}                Consciousness status (behavior, pheromones, quorum)
    ${C.magenta}consciousness pheromones${C.r}      Show pheromone concentration readings
    ${C.magenta}consciousness deposit${C.r} <type> [conc]  Deposit a pheromone (compute_success|danger|...)
    ${C.magenta}consciousness quorum${C.r}          Show quorum sensing states
    ${C.magenta}consciousness decide${C.r} <q> <opt1> <opt2>  Start a swarm decision
    ${C.magenta}consciousness decisions${C.r}       List swarm decisions

  ${C.b}Spacetime (v2.0 Layer 12):${C.r}
    ${C.magenta}spacetime${C.r}                    Spacetime status (DAG, branches, races)
    ${C.magenta}spacetime fork${C.r} [label]       Fork a timeline branch
    ${C.magenta}spacetime branches${C.r}           List all branches
    ${C.magenta}spacetime race${C.r} <b1> <b2>     Race branches against each other
    ${C.magenta}spacetime merge${C.r} <branchId>   Merge a branch back to trunk
    ${C.magenta}spacetime timeline${C.r} [branch] [n]  Show recent DAG nodes
    ${C.magenta}spacetime verify${C.r} [branch]    Verify branch integrity

  ${C.b}Wormholes (v2.0 Layer 13):${C.r}
    ${C.magenta}wormhole${C.r}                     Wormhole status (connections, remote meshes)
    ${C.magenta}wormhole declare${C.r} <fp> [label] [ms]  Declare wormhole to remote mesh
    ${C.magenta}wormhole meshes${C.r}              List known remote meshes
    ${C.magenta}wormhole teleport${C.r} <lf> <dest>  Teleport a Lifeform to remote mesh
    ${C.magenta}wormhole synapse${C.r} <local> <remote> <mesh>  Create cross-mesh synapse
    ${C.magenta}wormhole synapses${C.r}            List cross-mesh synapses`;
}
