/**
 * useMesh Hook
 * Manages CMP node lifecycle and mesh state for React Native.
 * Wired to real CMPNode with RNLanTransport.
 *
 * @author Agent Viscro
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CMPNode, LogLevel, toHex, shortId } from '../../../packages/core/src';
import type { PeerInfo as CMPPeerInfo, CMPNodeConfig } from '../../../packages/core/src';
import { RNLanTransport } from '../../../packages/transport/src/rn-lan-transport';

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
  credits: number;
  reputation: number;
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
  credits: 0,
  reputation: 0,
  uptime: 0,
};

export function useMesh() {
  const [state, setState] = useState<MeshState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const nodeRef = useRef<CMPNode | null>(null);
  const transportRef = useRef<RNLanTransport | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Refresh peer + status data from the node */
  const refreshState = useCallback(() => {
    const node = nodeRef.current;
    if (!node || !node.isRunning()) return;

    const peers = node.getPeers();
    const status = node.getStatus();

    setState(prev => ({
      ...prev,
      peers,
      peerCount: peers.length,
      totalCores: status.resources.totalCores,
      totalMemoryMb: status.resources.totalMemoryMb,
      credits: status.credits,
      reputation: status.reputation,
      uptime: status.uptime,
    }));
  }, []);

  const start = useCallback(async () => {
    try {
      setError(null);

      // Create RN-specific transport
      const transport = new RNLanTransport();
      transportRef.current = transport;

      // Create CMPNode with RN transport
      const node = new CMPNode({
        _transport: transport,
        acceptingTasks: true,
        beaconIntervalMs: 3000,
        bidWindowMs: 2000,
        logLevel: LogLevel.INFO,
      });

      await node.start();
      nodeRef.current = node;

      setState(prev => ({
        ...prev,
        running: true,
        meshId: node.meshIdHex(),
        shortId: node.shortMeshId(),
        credits: node.getStatus().credits,
        reputation: node.getStatus().reputation,
      }));

      // Wire mesh events to trigger refresh
      const bus = node.events();
      bus.on('peer:discovered', refreshState);
      bus.on('peer:handshake_complete', refreshState);
      bus.on('capability:mesh_changed', refreshState);
      bus.on('peer:lost', refreshState);
      bus.on('credit:earned', refreshState);

      // Periodic refresh (uptime, credits, etc.)
      tickerRef.current = setInterval(refreshState, 2000);

    } catch (err: any) {
      setError(err.message);
      console.error('[CMP] Start failed:', err);
    }
  }, [refreshState]);

  const stop = useCallback(async () => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (nodeRef.current) {
      try { await nodeRef.current.stop(); } catch {}
      nodeRef.current = null;
    }
    transportRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  /**
   * Manually connect to a peer by IP (for hotspot scenarios).
   */
  const connectTo = useCallback((ip: string) => {
    if (transportRef.current) {
      transportRef.current.sendBeaconTo(ip);
      setTimeout(() => transportRef.current?.sendBeaconTo(ip), 500);
      setTimeout(() => transportRef.current?.sendBeaconTo(ip), 1500);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
      if (nodeRef.current) {
        nodeRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return { state, error, start, stop, connectTo, node: nodeRef.current };
}
