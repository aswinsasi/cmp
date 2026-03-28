/**
 * useCompute Hook
 * Manages distributed computation lifecycle with real CMPNode.
 * Tracks negotiation → distribution → execution → assembly phases.
 *
 * @author Agent Viscro
 */

import { useState, useCallback, useRef } from 'react';
import { CMPNode, ChunkStatus, toHex, shortId } from '../../../packages/core/src';

export type ComputePhase =
  | 'idle'
  | 'negotiating'
  | 'distributing'
  | 'executing'
  | 'assembling'
  | 'complete'
  | 'error';

export interface ChunkProgress {
  chunkId: string;
  assignee: string;
  progress: number;
  status: 'pending' | 'executing' | 'complete' | 'failed';
  timeMs?: number;
}

export interface ComputeState {
  phase: ComputePhase;
  progress: number;
  chunks: ChunkProgress[];
  result: Uint8Array | null;
  totalTimeMs: number;
  devicesUsed: number;
  chunksExecuted: number;
  error: string | null;
  /** Hex string of encrypted/computed output */
  outputHex: string;
}

const INITIAL_STATE: ComputeState = {
  phase: 'idle',
  progress: 0,
  chunks: [],
  result: null,
  totalTimeMs: 0,
  devicesUsed: 0,
  chunksExecuted: 0,
  error: null,
  outputHex: '',
};

// ── XOR Cipher WASM (104 bytes) ──
// Same module used by CLI. XORs each byte with 0x42. Encrypt twice = decrypt.
const ENCRYPT_WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,5,3,1,0,1,
  7,20,2,6,109,101,109,111,114,121,2,0,7,101,110,99,114,121,112,116,0,0,
  10,54,1,52,1,1,127,65,0,33,2,2,64,3,64,32,2,32,1,79,13,1,32,0,32,2,
  106,32,0,32,2,106,45,0,0,65,194,0,115,58,0,0,32,2,65,1,106,33,2,12,
  0,11,11,32,1,11
]);

export function useCompute() {
  const [state, setState] = useState<ComputeState>(INITIAL_STATE);
  const startTimeRef = useRef(0);

  /**
   * Run the built-in XOR cipher encryption across the mesh.
   */
  const encrypt = useCallback(async (
    node: CMPNode | null,
    message: string,
    options: { chunkHint?: number } = {}
  ) => {
    if (!node) {
      setState(prev => ({ ...prev, phase: 'error', error: 'Node not running' }));
      return;
    }

    startTimeRef.current = Date.now();
    setState({ ...INITIAL_STATE, phase: 'negotiating', progress: 0.1 });

    try {
      const inputBytes = new TextEncoder().encode(message);

      // Wire up events for live progress tracking
      const bus = node.events();
      let phaseSet = false;

      const onBidReceived = () => {
        setState(prev => ({ ...prev, progress: 0.2 }));
      };
      const onAssigned = (d: any) => {
        setState(prev => ({
          ...prev,
          phase: 'distributing',
          progress: 0.3,
        }));
      };
      const onResultReceived = () => {
        if (!phaseSet) {
          phaseSet = true;
          setState(prev => ({ ...prev, phase: 'executing', progress: 0.5 }));
        }
        setState(prev => ({
          ...prev,
          progress: Math.min(0.9, prev.progress + 0.1),
        }));
      };

      bus.on('task:bid_received', onBidReceived);
      bus.on('task:assigned', onAssigned);
      bus.on('result:received', onResultReceived);

      // Run the actual distributed computation
      const result = await node.compute(ENCRYPT_WASM, inputBytes, {
        entryPoint: 'encrypt',
        deadline: 15000,
        ...(options.chunkHint ? { chunkHint: options.chunkHint } : {}),
      });

      // Cleanup listeners
      bus.off('task:bid_received', onBidReceived);
      bus.off('task:assigned', onAssigned);
      bus.off('result:received', onResultReceived);

      // Build output hex
      const outputHex = Array.from(result.data)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const totalTime = Date.now() - startTimeRef.current;

      setState({
        phase: 'complete',
        progress: 1,
        chunks: [], // Could be populated from events
        result: result.data,
        totalTimeMs: totalTime,
        devicesUsed: result.devicesUsed,
        chunksExecuted: result.chunksExecuted,
        error: null,
        outputHex,
      });

    } catch (err: any) {
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: err.message,
      }));
    }
  }, []);

  /**
   * Decrypt hex ciphertext (XOR is symmetric).
   */
  const decrypt = useCallback(async (
    node: CMPNode | null,
    hexInput: string,
    options: { chunkHint?: number } = {}
  ) => {
    if (!node) {
      setState(prev => ({ ...prev, phase: 'error', error: 'Node not running' }));
      return;
    }

    const cleanHex = hexInput.replace(/\s/g, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(cleanHex) || cleanHex.length % 2 !== 0) {
      setState(prev => ({ ...prev, phase: 'error', error: 'Invalid hex input' }));
      return;
    }

    const inputBytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
      inputBytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
    }

    startTimeRef.current = Date.now();
    setState({ ...INITIAL_STATE, phase: 'negotiating', progress: 0.1 });

    try {
      const result = await node.compute(ENCRYPT_WASM, inputBytes, {
        entryPoint: 'encrypt', // XOR is symmetric
        deadline: 15000,
        ...(options.chunkHint ? { chunkHint: options.chunkHint } : {}),
      });

      const plaintext = new TextDecoder().decode(result.data);
      const totalTime = Date.now() - startTimeRef.current;

      setState({
        phase: 'complete',
        progress: 1,
        chunks: [],
        result: result.data,
        totalTimeMs: totalTime,
        devicesUsed: result.devicesUsed,
        chunksExecuted: result.chunksExecuted,
        error: null,
        outputHex: plaintext,
      });

    } catch (err: any) {
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: err.message,
      }));
    }
  }, []);

  /**
   * Run arbitrary WASM computation across the mesh.
   */
  const compute = useCallback(async (
    node: CMPNode | null,
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: { entryPoint?: string; deadline?: number; chunkHint?: number } = {}
  ) => {
    if (!node) {
      setState(prev => ({ ...prev, phase: 'error', error: 'Node not running' }));
      return;
    }

    startTimeRef.current = Date.now();
    setState({ ...INITIAL_STATE, phase: 'negotiating', progress: 0.1 });

    try {
      const result = await node.compute(wasmModule, inputData, {
        entryPoint: options.entryPoint || 'process',
        deadline: options.deadline || 15000,
        ...(options.chunkHint ? { chunkHint: options.chunkHint } : {}),
      });

      const totalTime = Date.now() - startTimeRef.current;

      setState({
        phase: 'complete',
        progress: 1,
        chunks: [],
        result: result.data,
        totalTimeMs: totalTime,
        devicesUsed: result.devicesUsed,
        chunksExecuted: result.chunksExecuted,
        error: null,
        outputHex: Array.from(result.data).map(b => b.toString(16).padStart(2, '0')).join(''),
      });

    } catch (err: any) {
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: err.message,
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, encrypt, decrypt, compute, reset };
}
