/**
 * CMP v4.0 — Job CLI Commands
 *
 * CLI handlers for the job queue system.
 *
 * Commands:
 *   job list                    List all jobs
 *   job status <id>             Show job details
 *   job result <id>             Show/save job result
 *   job cancel <id>             Cancel a job
 *   job retry <id>              Retry a failed job
 *   job clear                   Remove completed jobs
 *   job stats                   Job queue statistics
 *
 * Note: 'job submit' is handled directly in cli.ts since it
 * requires access to the CMPNode for compute.
 *
 * @module cli/job-cli-commands
 * @author Agent Viscro
 */

import { JobQueue } from '../../core/src/scheduler/job-queue';
import { Job, JobState, JobStats, TERMINAL_STATES } from '../../core/src/scheduler/job-types';
import { Priority } from '../../core/src/types/task';

// ─── ANSI Colors ───

const C = {
  r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

// ─── State Color ───

function stateColor(state: JobState): string {
  switch (state) {
    case JobState.QUEUED:    return C.yellow;
    case JobState.ASSIGNED:  return C.blue;
    case JobState.RUNNING:   return C.cyan;
    case JobState.COMPLETED: return C.green;
    case JobState.FAILED:    return C.red;
    case JobState.RETRY:     return C.yellow;
    case JobState.CANCELLED: return C.d;
    default:                 return C.r;
  }
}

function priorityLabel(p: Priority): string {
  return ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'][p] ?? 'NORMAL';
}

function formatAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ─── CLI Command Handler ───

export function doJob(queue: JobQueue, subCmd: string, arg: string): void {
  switch (subCmd) {
    case 'list':
    case 'ls':
      doJobList(queue);
      break;

    case 'status':
    case 'info':
      doJobStatus(queue, arg);
      break;

    case 'result':
      doJobResult(queue, arg);
      break;

    case 'cancel':
      doJobCancel(queue, arg);
      break;

    case 'retry':
      doJobRetry(queue, arg);
      break;

    case 'clear':
      doJobClear(queue);
      break;

    case 'stats':
      doJobStats(queue);
      break;

    case 'events':
      doJobEvents(queue);
      break;

    case '':
    case 'help':
    default:
      doJobHelp();
      break;
  }
}

// ─── Sub-commands ───

function doJobList(queue: JobQueue): void {
  const jobs = queue.list();

  if (jobs.length === 0) {
    console.log(`\n  ${C.d}No jobs in queue.${C.r}\n`);
    return;
  }

  console.log(`\n  ${C.b}Jobs${C.r} (${jobs.length} total)\n`);
  console.log(`  ${C.d}${'ID'.padEnd(5)} ${'State'.padEnd(12)} ${'Priority'.padEnd(10)} ${'Age'.padEnd(10)} BG  Info${C.r}`);
  console.log(`  ${C.d}${'─'.repeat(65)}${C.r}`);

  for (const job of jobs) {
    const age = formatAge(Date.now() - job.submittedAt);
    const sc = stateColor(job.state);
    const bg = job.background ? '●' : ' ';
    let info = '';

    if (job.state === JobState.COMPLETED && job.result) {
      info = `${job.result.totalTimeMs}ms, ${job.result.devicesUsed} dev`;
    } else if (job.state === JobState.FAILED) {
      info = job.error?.substring(0, 30) ?? '';
    } else if (job.state === JobState.RETRY) {
      info = `retry ${job.retryCount}/${job.maxRetries}`;
    } else if (job.claimedBy) {
      info = `→ ${job.claimedBy}`;
    }

    console.log(`  ${C.b}#${String(job.id).padEnd(4)}${C.r} ${sc}${job.state.padEnd(12)}${C.r} ${priorityLabel(job.priority).padEnd(10)} ${age.padEnd(10)} ${bg}   ${C.d}${info}${C.r}`);
  }
  console.log();
}

function doJobStatus(queue: JobQueue, idStr: string): void {
  const id = parseInt(idStr, 10);
  if (!id) {
    console.log(`  ${C.d}Usage: job status <id>${C.r}`);
    return;
  }

  const job = queue.get(id);
  if (!job) {
    console.log(`  ${C.red}Job #${id} not found.${C.r}`);
    return;
  }

  const sc = stateColor(job.state);
  console.log(`\n  ${C.b}Job #${job.id}${C.r}`);
  console.log(`  ${C.d}State          ${C.r}${sc}${job.state}${C.r}`);
  console.log(`  ${C.d}Priority       ${C.r}${priorityLabel(job.priority)}`);
  console.log(`  ${C.d}Background     ${C.r}${job.background ? 'yes' : 'no'}`);
  console.log(`  ${C.d}Entry point    ${C.r}${job.definition.entryPoint}`);
  console.log(`  ${C.d}Input size     ${C.r}${job.definition.inputData.length} bytes`);
  console.log(`  ${C.d}WASM size      ${C.r}${job.definition.wasmModule.length} bytes`);
  console.log(`  ${C.d}Deadline       ${C.r}${job.definition.deadlineMs}ms`);
  console.log(`  ${C.d}Max retries    ${C.r}${job.maxRetries}`);
  console.log(`  ${C.d}Retry count    ${C.r}${job.retryCount}`);
  console.log(`  ${C.d}Submitted      ${C.r}${formatAge(Date.now() - job.submittedAt)} ago`);

  if (job.claimedBy) {
    console.log(`  ${C.d}Claimed by     ${C.r}${job.claimedBy}`);
  }

  if (job.startedAt) {
    console.log(`  ${C.d}Started        ${C.r}${formatAge(Date.now() - job.startedAt)} ago`);
  }

  if (job.completedAt) {
    const duration = job.startedAt ? job.completedAt - job.startedAt : 0;
    console.log(`  ${C.d}Completed      ${C.r}${formatAge(Date.now() - job.completedAt)} ago (${duration}ms)`);
  }

  if (job.error) {
    console.log(`  ${C.d}Error          ${C.r}${C.red}${job.error}${C.r}`);
  }

  if (job.result) {
    console.log(`  ${C.d}Result         ${C.r}${job.result.data.length} bytes, ${job.result.totalTimeMs}ms, ${job.result.devicesUsed} devices, ${job.result.chunksExecuted} chunks`);
    console.log(`  ${C.d}Verified       ${C.r}${job.result.verified ? 'yes' : 'no'}`);
    console.log(`  ${C.d}Local fallback ${C.r}${job.result.localFallback ? 'yes' : 'no'}`);
  }

  if (job.tags.length > 0) {
    console.log(`  ${C.d}Tags           ${C.r}${job.tags.join(', ')}`);
  }

  console.log();
}

function doJobResult(queue: JobQueue, idStr: string): void {
  const id = parseInt(idStr, 10);
  if (!id) {
    console.log(`  ${C.d}Usage: job result <id>${C.r}`);
    return;
  }

  const job = queue.get(id);
  if (!job) {
    console.log(`  ${C.red}Job #${id} not found.${C.r}`);
    return;
  }

  if (!job.result) {
    console.log(`  ${C.yellow}Job #${id} has no result yet (state: ${job.state}).${C.r}`);
    return;
  }

  const data = job.result.data;
  console.log(`\n  ${C.b}Job #${id} Result${C.r}`);
  console.log(`  ${C.d}Size       ${C.r}${data.length} bytes`);
  console.log(`  ${C.d}Time       ${C.r}${job.result.totalTimeMs}ms`);
  console.log(`  ${C.d}Devices    ${C.r}${job.result.devicesUsed}`);
  console.log(`  ${C.d}Chunks     ${C.r}${job.result.chunksExecuted}`);

  // Try to decode as text
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (text.length <= 500) {
      console.log(`  ${C.d}Text       ${C.r}${text}`);
    } else {
      console.log(`  ${C.d}Text       ${C.r}${text.substring(0, 200)}... (${text.length} chars)`);
    }
  } catch {
    // Binary data — show hex preview
    const hexPreview = Array.from(data.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`  ${C.d}Hex        ${C.r}${hexPreview}${data.length > 32 ? '...' : ''}`);
  }
  console.log();
}

function doJobCancel(queue: JobQueue, idStr: string): void {
  const id = parseInt(idStr, 10);
  if (!id) {
    console.log(`  ${C.d}Usage: job cancel <id>${C.r}`);
    return;
  }

  if (queue.cancel(id)) {
    console.log(`  ${C.green}✓${C.r} Job #${id} cancelled.`);
  } else {
    const job = queue.get(id);
    if (!job) {
      console.log(`  ${C.red}Job #${id} not found.${C.r}`);
    } else {
      console.log(`  ${C.yellow}Cannot cancel job #${id} (state: ${job.state}).${C.r}`);
    }
  }
}

function doJobRetry(queue: JobQueue, idStr: string): void {
  const id = parseInt(idStr, 10);
  if (!id) {
    console.log(`  ${C.d}Usage: job retry <id>${C.r}`);
    return;
  }

  if (queue.retry(id)) {
    console.log(`  ${C.green}✓${C.r} Job #${id} requeued for retry.`);
  } else {
    const job = queue.get(id);
    if (!job) {
      console.log(`  ${C.red}Job #${id} not found.${C.r}`);
    } else {
      console.log(`  ${C.yellow}Cannot retry job #${id} (state: ${job.state}).${C.r}`);
    }
  }
}

function doJobClear(queue: JobQueue): void {
  const count = queue.clearCompleted();
  console.log(`  ${C.green}✓${C.r} Cleared ${count} completed/failed/cancelled jobs.`);
}

function doJobStats(queue: JobQueue): void {
  const stats = queue.getStats();

  console.log(`\n  ${C.b}Job Queue Statistics${C.r}`);
  console.log(`  ${C.d}Total jobs        ${C.r}${stats.total}`);
  console.log(`  ${C.d}Queued            ${C.r}${stats.queued}`);
  console.log(`  ${C.d}Running           ${C.r}${stats.running}`);
  console.log(`  ${C.d}Completed         ${C.r}${C.green}${stats.completed}${C.r}`);
  console.log(`  ${C.d}Failed            ${C.r}${stats.failed > 0 ? C.red : ''}${stats.failed}${C.r}`);
  console.log(`  ${C.d}Cancelled         ${C.r}${stats.cancelled}`);
  console.log(`  ${C.d}Total retries     ${C.r}${stats.totalRetries}`);
  console.log(`  ${C.d}Avg completion    ${C.r}${stats.avgCompletionTimeMs}ms`);
  console.log();
}

function doJobEvents(queue: JobQueue): void {
  const events = queue.getEvents(15);

  if (events.length === 0) {
    console.log(`\n  ${C.d}No job events yet.${C.r}\n`);
    return;
  }

  console.log(`\n  ${C.b}Recent Job Events${C.r}\n`);
  for (const e of events) {
    const time = new Date(e.timestamp).toISOString().substring(11, 19);
    const typeColor = e.type === 'completed' ? C.green : e.type === 'failed' ? C.red : C.cyan;
    console.log(`  ${C.d}${time}${C.r}  ${typeColor}${e.type.padEnd(10)}${C.r} #${e.jobId}${e.details ? `  ${C.d}${e.details}${C.r}` : ''}`);
  }
  console.log();
}

function doJobHelp(): void {
  console.log(`
  ${C.b}Job Queue Commands:${C.r}
    ${C.cyan}job list${C.r}                   List all jobs
    ${C.cyan}job status${C.r} <id>            Show job details
    ${C.cyan}job result${C.r} <id>            Show job result
    ${C.cyan}job cancel${C.r} <id>            Cancel a job
    ${C.cyan}job retry${C.r} <id>             Retry a failed/cancelled job
    ${C.cyan}job clear${C.r}                  Remove completed/failed/cancelled
    ${C.cyan}job stats${C.r}                  Queue statistics
    ${C.cyan}job events${C.r}                 Recent job events
`);
}

// ─── Help Text for main help ───

export function jobHelpText(): string {
  return `
  ${C.b}Job Queue (v4.0):${C.r}
    ${C.magenta}job${C.r} [list|status|result|cancel|retry|clear|stats]  Job management`;
}
