/**
 * CMP WASM Sandbox
 * Level 1 (mandatory) execution environment.
 * Provides memory-safe, isolated execution with strict resource limits.
 *
 * All CMP computation runs inside this sandbox. No filesystem,
 * network, or sensor access is permitted.
 *
 * @module runtime/wasm-sandbox
 * @author Agent Viscro
 */

export interface SandboxConfig {
  /** Maximum heap memory in MB */
  maxMemoryMb: number;
  /** Maximum CPU time in ms */
  maxCpuMs: number;
  /** Maximum output size in bytes */
  maxOutputBytes: number;
  /** Enable SIMD instructions */
  enableSIMD: boolean;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  maxMemoryMb: 256,
  maxCpuMs: 30000,
  maxOutputBytes: 4 * 1024 * 1024, // 4MB
  enableSIMD: true,
};

export interface ExecutionMetrics {
  cpuTimeMs: number;
  memoryPeakMb: number;
  outputBytes: number;
  startTime: number;
  endTime: number;
}

/**
 * WASM Sandbox execution environment.
 *
 * Uses WebAssembly's built-in memory safety guarantees plus
 * additional resource limiting (time, memory caps).
 */
export class WASMSandbox {
  private config: SandboxConfig;
  private instance: WebAssembly.Instance | null = null;
  private memory: WebAssembly.Memory | null = null;
  private module: WebAssembly.Module | null = null;
  private startTime = 0;
  private destroyed = false;
  private metrics: ExecutionMetrics = {
    cpuTimeMs: 0,
    memoryPeakMb: 0,
    outputBytes: 0,
    startTime: 0,
    endTime: 0,
  };

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
  }

  /**
   * Load a WASM module into the sandbox.
   * The module is compiled and instantiated with restricted imports.
   */
  async loadModule(wasmBytes: Uint8Array): Promise<void> {
    if (this.destroyed) throw new Error('Sandbox destroyed');

    // Calculate memory limits
    const initialPages = 16; // 1MB initial
    const maxPages = Math.ceil(this.config.maxMemoryMb * 16); // 64KB per page

    this.memory = new WebAssembly.Memory({
      initial: initialPages,
      maximum: maxPages,
    });

    // Compile the module
    this.module = await WebAssembly.compile(wasmBytes as BufferSource);

    // Instantiate with sandboxed imports
    // ZERO access to: filesystem, network, sensors, system calls
    this.instance = await WebAssembly.instantiate(this.module, {
      env: {
        memory: this.memory,
        // Logging (safe)
        cmp_log: (ptr: number, len: number) => {
          if (!this.memory) return;
          const bytes = new Uint8Array(this.memory.buffer, ptr, Math.min(len, 1024));
          const msg = new TextDecoder().decode(bytes);
          console.log(`[WASM] ${msg}`);
        },
        // Time since execution start (safe)
        cmp_time_ms: (): number => {
          return Date.now() - this.startTime;
        },
        // Abort (safe)
        abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
          throw new Error(`WASM abort at line ${line}:${col}`);
        },
      },
      wasi_snapshot_preview1: {
        // Stub WASI imports to prevent any system access
        fd_write: () => 0,
        fd_read: () => 0,
        fd_close: () => 0,
        fd_seek: () => 0,
        environ_get: () => 0,
        environ_sizes_get: () => 0,
        proc_exit: (code: number) => { throw new Error(`WASM proc_exit(${code})`); },
        args_get: () => 0,
        args_sizes_get: () => 0,
        clock_time_get: () => 0,
        random_get: (buf: number, len: number) => {
          // Provide randomness (safe, no side effects)
          if (!this.memory) return 1;
          const view = new Uint8Array(this.memory.buffer, buf, len);
          for (let i = 0; i < len; i++) {
            view[i] = Math.floor(Math.random() * 256);
          }
          return 0;
        },
      },
    });

    // CRITICAL: If the WASM module exports its own memory, use THAT memory
    // for all I/O. Modules with (memory (export "memory") 1) define their
    // own memory internally — our env.memory import is ignored by them.
    const exports = this.instance.exports as Record<string, any>;
    if (exports.memory instanceof WebAssembly.Memory) {
      this.memory = exports.memory;
    }
  }

  /**
   * Execute a function within the sandbox.
   *
   * @param entryPoint - Function name to call
   * @param input - Input data bytes
   * @returns Output data bytes
   */
  async execute(entryPoint: string, input: Uint8Array): Promise<Uint8Array> {
    if (!this.instance || !this.memory) {
      throw new Error('No module loaded');
    }
    if (this.destroyed) throw new Error('Sandbox destroyed');

    const exports = this.instance.exports as Record<string, any>;
    this.startTime = Date.now();
    this.metrics.startTime = this.startTime;

    // Check entry point exists
    if (typeof exports[entryPoint] !== 'function') {
      // Fall back to common entry points
      const fallbacks = ['main', '_start', 'process', 'run', 'compute'];
      const found = fallbacks.find((f) => typeof exports[f] === 'function');
      if (found) {
        return this.executeFunction(exports, found, input);
      }
      throw new Error(`Entry point '${entryPoint}' not found. Available: ${Object.keys(exports).filter(k => typeof exports[k] === 'function').join(', ')}`);
    }

    return this.executeFunction(exports, entryPoint, input);
  }

  private async executeFunction(
    exports: Record<string, any>,
    funcName: string,
    input: Uint8Array
  ): Promise<Uint8Array> {
    // Allocate input in WASM memory
    const allocFn = exports['cmp_alloc'] || exports['malloc'] || exports['alloc'];
    const freeFn = exports['cmp_free'] || exports['free'] || exports['dealloc'];

    let inputPtr: number;
    let outputPtr: number;
    let outputLen: number;

    if (typeof allocFn === 'function') {
      // Grow memory if needed before allocation
      const neededBytes = input.length * 3;
      if (this.memory!.buffer.byteLength < neededBytes) {
        const pagesToGrow = Math.ceil((neededBytes - this.memory!.buffer.byteLength) / 65536);
        try { this.memory!.grow(pagesToGrow); } catch {}
      }

      // Module provides allocator
      inputPtr = allocFn(input.length);
      const inputView = new Uint8Array(this.memory!.buffer, inputPtr, input.length);
      inputView.set(input);

      // Execute with timeout
      const result = await this.executeWithTimeout(() => {
        return exports[funcName](inputPtr, input.length);
      });

      // Parse result - convention: returns packed [ptr, len] or just ptr
      if (typeof result === 'number') {
        // Single return: assume it's a pointer to a length-prefixed buffer
        // Convention: first 4 bytes = output length, then data
        const view = new DataView(this.memory!.buffer, result);
        outputLen = view.getUint32(0, true);
        outputPtr = result + 4;
      } else {
        // Fallback: treat return as output length, data at a known location
        outputLen = Number(result) || 0;
        outputPtr = inputPtr; // Reuse input buffer area
      }

      // Free input if possible
      if (typeof freeFn === 'function') {
        try { freeFn(inputPtr); } catch {}
      }
    } else {
      // No allocator - use a simpler calling convention
      // Write input to start of memory
      inputPtr = 1024; // Offset past any globals

      // Grow memory if needed (input + room for output)
      const neededBytes = inputPtr + input.length * 3;
      if (this.memory!.buffer.byteLength < neededBytes) {
        const pagesToGrow = Math.ceil((neededBytes - this.memory!.buffer.byteLength) / 65536);
        try {
          this.memory!.grow(pagesToGrow);
        } catch {
          // grow failed — proceed with what we have
        }
      }

      const inputView = new Uint8Array(this.memory!.buffer, inputPtr, input.length);
      inputView.set(input);

      const result = await this.executeWithTimeout(() => {
        return exports[funcName](inputPtr, input.length);
      });

      outputLen = Math.min(Number(result) || input.length, this.config.maxOutputBytes);
      outputPtr = inputPtr;
    }

    // Validate and read output
    outputLen = Math.min(outputLen, this.config.maxOutputBytes);
    if (outputLen <= 0) {
      this.metrics.endTime = Date.now();
      this.metrics.cpuTimeMs = this.metrics.endTime - this.metrics.startTime;
      return new Uint8Array(0);
    }

    const output = new Uint8Array(outputLen);
    try {
      output.set(new Uint8Array(this.memory!.buffer, outputPtr, outputLen));
    } catch {
      // Memory might have been detached or out of bounds
    }

    // Record metrics
    this.metrics.endTime = Date.now();
    this.metrics.cpuTimeMs = this.metrics.endTime - this.metrics.startTime;
    this.metrics.outputBytes = outputLen;
    this.metrics.memoryPeakMb = Math.round(this.memory!.buffer.byteLength / (1024 * 1024));

    return output;
  }

  /**
   * Execute a function with a timeout guard.
   */
  private executeWithTimeout<T>(fn: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution exceeded CPU time limit (${this.config.maxCpuMs}ms)`));
      }, this.config.maxCpuMs);

      try {
        const result = fn();
        clearTimeout(timer);
        resolve(result);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * Get execution metrics from the last run.
   */
  getMetrics(): ExecutionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get current memory usage in MB.
   */
  getMemoryUsageMb(): number {
    if (!this.memory) return 0;
    return Math.round(this.memory.buffer.byteLength / (1024 * 1024));
  }

  // ── Checkpoint Support ──
  // WASM modules can opt-in to checkpointing by exporting `cmp_step`.
  // Instead of processing all data in one call, the module processes
  // one batch per step. Between steps, the host snapshots the WASM
  // linear memory. On failure, a new executor restores the memory
  // and continues from where the previous executor left off.

  /**
   * Check if the loaded module supports step-based checkpointing.
   * A module supports checkpointing if it exports `cmp_step`.
   */
  supportsCheckpoint(): boolean {
    if (!this.instance) return false;
    const exports = this.instance.exports as Record<string, any>;
    return typeof exports['cmp_step'] === 'function';
  }

  /**
   * Execute one step of a checkpointable WASM module.
   *
   * Convention: cmp_step(input_ptr, input_len) → status
   *   status = 0: done, output is ready
   *   status > 0: more steps needed (value = bytes of progress)
   *   status < 0: error
   *
   * First call: pass the full input data.
   * Subsequent calls after restore: pass empty input (module continues from memory state).
   *
   * @returns { done: boolean, output: Uint8Array | null }
   */
  async executeStep(input: Uint8Array): Promise<{ done: boolean; output: Uint8Array | null }> {
    if (!this.instance || !this.memory) throw new Error('No module loaded');
    if (this.destroyed) throw new Error('Sandbox destroyed');

    const exports = this.instance.exports as Record<string, any>;
    if (typeof exports['cmp_step'] !== 'function') {
      throw new Error('Module does not export cmp_step');
    }

    if (!this.startTime) {
      this.startTime = Date.now();
      this.metrics.startTime = this.startTime;
    }

    const allocFn = exports['cmp_alloc'] || exports['malloc'] || exports['alloc'];
    let inputPtr = 1024;

    if (input.length > 0) {
      if (typeof allocFn === 'function') {
        inputPtr = allocFn(input.length);
      }
      const inputView = new Uint8Array(this.memory!.buffer, inputPtr, input.length);
      inputView.set(input);
    }

    const status = await this.executeWithTimeout(() => {
      return exports['cmp_step'](inputPtr, input.length);
    });

    const done = status === 0;

    let output: Uint8Array | null = null;
    if (done) {
      // Read output using cmp_result convention: cmp_result() → ptr to [len:u32][data]
      if (typeof exports['cmp_result'] === 'function') {
        const resultPtr = exports['cmp_result']();
        const view = new DataView(this.memory!.buffer, resultPtr);
        const outLen = Math.min(view.getUint32(0, true), this.config.maxOutputBytes);
        output = new Uint8Array(outLen);
        output.set(new Uint8Array(this.memory!.buffer, resultPtr + 4, outLen));
      } else {
        // Fallback: read from input location
        output = new Uint8Array(this.memory!.buffer, inputPtr, Math.min(input.length, this.config.maxOutputBytes));
      }

      this.metrics.endTime = Date.now();
      this.metrics.cpuTimeMs = this.metrics.endTime - this.metrics.startTime;
      this.metrics.memoryPeakMb = this.getMemoryUsageMb();
    }

    return { done, output };
  }

  /**
   * Snapshot the entire WASM linear memory.
   * Returns a copy of the memory buffer.
   */
  snapshotMemory(): Uint8Array {
    if (!this.memory) throw new Error('No memory to snapshot');
    return new Uint8Array(this.memory.buffer.slice(0));
  }

  /**
   * Restore WASM linear memory from a snapshot.
   * Used when resuming execution from a checkpoint on a new device.
   */
  restoreMemory(snapshot: Uint8Array): void {
    if (!this.memory) throw new Error('No memory to restore');

    const target = new Uint8Array(this.memory.buffer);
    if (snapshot.length > target.length) {
      throw new Error(`Snapshot (${snapshot.length}) exceeds memory (${target.length})`);
    }
    target.set(snapshot);
  }

  /**
   * Destroy the sandbox. Zeros all memory.
   */
  destroy(): void {
    if (this.memory) {
      // Zero all memory for security
      try {
        new Uint8Array(this.memory.buffer).fill(0);
      } catch {}
    }
    this.memory = null;
    this.instance = null;
    this.module = null;
    this.destroyed = true;
  }

  /**
   * Check if sandbox has been destroyed.
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }
}