/**
 * CMP v4.0 — Code Shipper
 *
 * Sends functions to remote devices for execution against local data.
 * This is the core of Computation Gravity: instead of moving 2GB of
 * data to the code, move 50 bytes of code to the data.
 *
 * Wire Protocol:
 *   CODE_SHIP (0xFD): A → B
 *     "Here's a function — run it against your local data for key X"
 *   CODE_RESULT (0xFE): B → A
 *     "Here's the result of running your function on my data"
 *
 * @module gravity/code-shipper
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';

const log = new Logger('CodeShip');

// ─── Wire Protocol ───

export const CODE_SHIP_MSG = 0xFD;
export const CODE_RESULT_MSG = 0xFE;

// ─── Ship Request ───

export interface CodeShipRequest {
  /** Unique request ID */
  requestId: string;
  /** Data key to execute against */
  dataKey: string;
  /** WASM module bytes (the function to ship) */
  wasmModule: Uint8Array;
  /** Entry point in the WASM module */
  entryPoint: string;
  /** Optional parameters to pass to the function */
  params: Uint8Array;
  /** Requesting device ID */
  requesterId: string;
  /** Execution deadline (ms) */
  deadlineMs: number;
  /** Timestamp */
  timestamp: number;
}

// ─── Ship Result ───

export interface CodeShipResult {
  requestId: string;
  executorId: string;
  success: boolean;
  data: Uint8Array | null;
  executionTimeMs: number;
  dataReadBytes: number;
  error: string | null;
}

// ─── Wire Formats ───

export interface CodeShipWire {
  reqId: string;
  dataKey: string;
  wasmHex: string;
  entry: string;
  paramsHex: string;
  from: string;
  deadline: number;
  ts: number;
}

export interface CodeResultWire {
  reqId: string;
  executor: string;
  ok: boolean;
  dataHex: string | null;
  execMs: number;
  readBytes: number;
  error: string | null;
}

// ─── Hex Helpers ───

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ─── Pending Request Tracker ───

interface PendingShip {
  request: CodeShipRequest;
  targetDeviceId: string;
  sentAt: number;
  resolve: (result: CodeShipResult) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ─── Code Shipper ───

export class CodeShipper {
  private localDeviceId: string;
  private sendFn: ((deviceId: string, msgType: number, payload: any) => void) | null = null;
  private pending = new Map<string, PendingShip>();
  private nextReqId = 1;

  /** Handler for incoming CODE_SHIP requests (executor side) */
  private executeHandler: ((req: CodeShipRequest) => Promise<CodeShipResult>) | null = null;

  // Stats
  private stats = {
    codeShipped: 0,
    codeShippedBytes: 0,
    resultsReceived: 0,
    dataSavedBytes: 0, // Data NOT transferred thanks to gravity
    avgExecutionTimeMs: 0,
    totalExecutionTimeMs: 0,
  };

  constructor(localDeviceId: string) {
    this.localDeviceId = localDeviceId;
  }

  /**
   * Set transport for sending messages.
   */
  setTransport(sendFn: (deviceId: string, msgType: number, payload: any) => void): void {
    this.sendFn = sendFn;
  }

  /**
   * Set the handler for executing shipped code locally.
   * Called when this device receives a CODE_SHIP from a remote requester.
   */
  setExecuteHandler(handler: (req: CodeShipRequest) => Promise<CodeShipResult>): void {
    this.executeHandler = handler;
  }

  // ══════════════════════════════════════
  // Ship Code (requester side)
  // ══════════════════════════════════════

  /**
   * Ship a function to a remote device for execution.
   * Returns a promise that resolves with the result.
   */
  async shipCode(
    targetDeviceId: string,
    dataKey: string,
    wasmModule: Uint8Array,
    entryPoint: string,
    params: Uint8Array = new Uint8Array(0),
    deadlineMs: number = 30000,
  ): Promise<CodeShipResult> {
    if (!this.sendFn) {
      throw new Error('No transport set — call setTransport() first');
    }

    const requestId = `ship-${this.nextReqId++}`;

    const request: CodeShipRequest = {
      requestId,
      dataKey,
      wasmModule,
      entryPoint,
      params,
      requesterId: this.localDeviceId,
      deadlineMs,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`CODE_SHIP timeout: ${requestId} to ${targetDeviceId} (${deadlineMs}ms)`));
      }, deadlineMs);

      // Track pending request
      this.pending.set(requestId, {
        request,
        targetDeviceId,
        sentAt: Date.now(),
        resolve,
        reject,
        timeout,
      });

      // Send CODE_SHIP
      const wire: CodeShipWire = {
        reqId: requestId,
        dataKey,
        wasmHex: toHex(wasmModule),
        entry: entryPoint,
        paramsHex: toHex(params),
        from: this.localDeviceId,
        deadline: deadlineMs,
        ts: Date.now(),
      };

      this.sendFn!(targetDeviceId, CODE_SHIP_MSG, wire);

      this.stats.codeShipped++;
      this.stats.codeShippedBytes += wasmModule.length + params.length;

      log.info(
        `CODE_SHIP sent: ${requestId} → ${targetDeviceId} ` +
        `(${wasmModule.length}B code, key="${dataKey}")`
      );
    });
  }

  // ══════════════════════════════════════
  // Handle Incoming Messages
  // ══════════════════════════════════════

  /**
   * Handle an incoming CODE_SHIP request (executor side).
   */
  async handleCodeShip(wire: CodeShipWire): Promise<void> {
    if (!this.executeHandler) {
      log.warn(`Received CODE_SHIP but no execute handler set — ignoring ${wire.reqId}`);
      return;
    }

    const request: CodeShipRequest = {
      requestId: wire.reqId,
      dataKey: wire.dataKey,
      wasmModule: fromHex(wire.wasmHex),
      entryPoint: wire.entry,
      params: fromHex(wire.paramsHex),
      requesterId: wire.from,
      deadlineMs: wire.deadline,
      timestamp: wire.ts,
    };

    log.info(`CODE_SHIP received: ${wire.reqId} from ${wire.from} (key="${wire.dataKey}")`);

    try {
      const result = await this.executeHandler(request);

      // Send CODE_RESULT back
      if (this.sendFn) {
        const resultWire: CodeResultWire = {
          reqId: result.requestId,
          executor: this.localDeviceId,
          ok: result.success,
          dataHex: result.data ? toHex(result.data) : null,
          execMs: result.executionTimeMs,
          readBytes: result.dataReadBytes,
          error: result.error,
        };
        this.sendFn(wire.from, CODE_RESULT_MSG, resultWire);
      }
    } catch (err: any) {
      // Send error result
      if (this.sendFn) {
        const errorWire: CodeResultWire = {
          reqId: wire.reqId,
          executor: this.localDeviceId,
          ok: false,
          dataHex: null,
          execMs: 0,
          readBytes: 0,
          error: err.message,
        };
        this.sendFn(wire.from, CODE_RESULT_MSG, errorWire);
      }
    }
  }

  /**
   * Handle an incoming CODE_RESULT (requester side).
   */
  handleCodeResult(wire: CodeResultWire): void {
    const pending = this.pending.get(wire.reqId);
    if (!pending) {
      log.warn(`CODE_RESULT for unknown request: ${wire.reqId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(wire.reqId);

    const result: CodeShipResult = {
      requestId: wire.reqId,
      executorId: wire.executor,
      success: wire.ok,
      data: wire.dataHex ? fromHex(wire.dataHex) : null,
      executionTimeMs: wire.execMs,
      dataReadBytes: wire.readBytes,
      error: wire.error,
    };

    this.stats.resultsReceived++;
    this.stats.totalExecutionTimeMs += result.executionTimeMs;
    this.stats.dataSavedBytes += result.dataReadBytes;

    log.info(
      `CODE_RESULT received: ${wire.reqId} from ${wire.executor} ` +
      `(${wire.ok ? 'ok' : 'fail'}, ${wire.execMs}ms, ${wire.readBytes}B read)`
    );

    pending.resolve(result);
  }

  // ══════════════════════════════════════
  // Stats
  // ══════════════════════════════════════

  getStats(): {
    codeShipped: number;
    codeShippedBytes: number;
    resultsReceived: number;
    dataSavedBytes: number;
    pendingRequests: number;
    avgExecutionTimeMs: number;
  } {
    return {
      ...this.stats,
      pendingRequests: this.pending.size,
      avgExecutionTimeMs: this.stats.resultsReceived > 0
        ? Math.round(this.stats.totalExecutionTimeMs / this.stats.resultsReceived)
        : 0,
    };
  }

  /**
   * Cancel all pending requests.
   */
  cancelAll(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('All code ship requests cancelled'));
    }
    this.pending.clear();
  }
}
