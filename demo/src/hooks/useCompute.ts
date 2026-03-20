/**
 * useCompute Hook
 * Manages distributed computation lifecycle with progress tracking.
 *
 * @author Agent Viscro
 */

import { useState, useCallback, useRef } from 'react';

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
  progress: number; // 0.0 - 1.0
  status: 'pending' | 'executing' | 'complete' | 'failed';
  timeMs?: number;
}

export interface ComputeState {
  phase: ComputePhase;
  progress: number; // Overall 0.0 - 1.0
  chunks: ChunkProgress[];
  result: Uint8Array | null;
  totalTimeMs: number;
  devicesUsed: number;
  chunksExecuted: number;
  error: string | null;
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
};

export function useCompute() {
  const [state, setState] = useState<ComputeState>(INITIAL_STATE);
  const startTimeRef = useRef(0);

  const compute = useCallback(async (
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: { deadline?: number; entryPoint?: string; peerCount?: number } = {}
  ) => {
    startTimeRef.current = Date.now();
    setState({ ...INITIAL_STATE, phase: 'negotiating' });

    try {
      // Phase 1: Negotiation
      await simulateDelay(300);
      const numChunks = options.peerCount || 4;
      const chunks: ChunkProgress[] = Array.from({ length: numChunks }, (_, i) => ({
        chunkId: `chunk-${i}`,
        assignee: `peer-${i}`,
        progress: 0,
        status: 'pending' as const,
      }));

      setState(prev => ({
        ...prev,
        phase: 'distributing',
        progress: 0.15,
        chunks,
      }));

      // Phase 2: Distribution
      await simulateDelay(200);
      setState(prev => ({
        ...prev,
        phase: 'executing',
        progress: 0.25,
      }));

      // Phase 3: Execution (simulate chunk progress)
      for (let step = 0; step < 10; step++) {
        await simulateDelay(100 + Math.random() * 200);

        setState(prev => {
          const updatedChunks = prev.chunks.map((chunk, i) => {
            const chunkProgress = Math.min(1, (step + 1 + Math.random() * 0.5) / 10);
            return {
              ...chunk,
              progress: chunkProgress,
              status: chunkProgress >= 1 ? 'complete' as const : 'executing' as const,
              timeMs: chunkProgress >= 1 ? Math.round(300 + Math.random() * 700) : undefined,
            };
          });

          const completedCount = updatedChunks.filter(c => c.status === 'complete').length;
          const overallProgress = 0.25 + (completedCount / updatedChunks.length) * 0.65;

          return {
            ...prev,
            progress: overallProgress,
            chunks: updatedChunks,
          };
        });
      }

      // Phase 4: Assembly
      setState(prev => ({ ...prev, phase: 'assembling', progress: 0.92 }));
      await simulateDelay(150);

      // Complete
      const totalTime = Date.now() - startTimeRef.current;
      setState({
        phase: 'complete',
        progress: 1,
        chunks: chunks.map(c => ({ ...c, status: 'complete' as const, progress: 1 })),
        result: inputData, // In real impl, this would be the assembled output
        totalTimeMs: totalTime,
        devicesUsed: numChunks,
        chunksExecuted: numChunks,
        error: null,
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

  return { state, compute, reset };
}

function simulateDelay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
