/**
 * useMesh Hook
 * Manages CMP node lifecycle and mesh state for React Native.
 *
 * @author Agent Viscro
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// Types inline since we can't import from @cmp/core in this skeleton
export interface PeerInfo {
  meshId: string;
  shortId: string;
  state: string;
  tier?: number;
  cores?: number;
  memoryMb?: number;
  latencyMs: number;
}

export interface MeshState {
  running: boolean;
  meshId: string;
  shortId: string;
  peers: PeerInfo[];
  peerCount: number;
  totalCores: number;
  totalMemoryMb: number;
  uptime: number;
}

const INITIAL_STATE: MeshState = {
  running: false,
  meshId: '',
  shortId: '',
  peers: [],
  peerCount: 0,
  totalCores: 0,
  totalMemoryMb: 0,
  uptime: 0,
};

export function useMesh() {
  const [state, setState] = useState<MeshState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const nodeRef = useRef<any>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    try {
      setError(null);

      // In production, this would use:
      // import { CMPNode } from '@cmp/core';
      // const node = new CMPNode({ transports: ['wifi-direct', 'lan'] });
      // await node.start();

      // For demo skeleton, we simulate
      const mockId = Math.random().toString(16).substring(2, 18).padEnd(32, '0');
      nodeRef.current = { meshId: mockId };

      setState(prev => ({
        ...prev,
        running: true,
        meshId: mockId,
        shortId: mockId.substring(0, 8),
      }));

      // Status ticker
      tickerRef.current = setInterval(() => {
        setState(prev => ({
          ...prev,
          uptime: prev.uptime + 1000,
        }));
      }, 1000);

    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const stop = useCallback(async () => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    nodeRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  return { state, error, start, stop, node: nodeRef.current };
}
