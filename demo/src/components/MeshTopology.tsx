/**
 * MeshTopology Component
 * Renders a live visualization of mesh nodes as dots connected by lines.
 * Center node is "this device", surrounding nodes are peers.
 * Lines pulse when data flows between nodes.
 *
 * @author Agent Viscro
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { PeerInfo } from '../hooks/useMesh';
import type { ChunkProgress } from '../hooks/useCompute';

interface Props {
  myShortId: string;
  peers: PeerInfo[];
  chunks?: ChunkProgress[];
  isComputing?: boolean;
  size?: number;
}

const COLORS = {
  bg: '#0A0E1A',
  nodeMe: '#3B82F6',
  nodePeer: '#10B981',
  nodeActive: '#F59E0B',
  line: '#1E3A5F',
  lineActive: '#3B82F6',
  text: '#94A3B8',
  textBright: '#E2E8F0',
};

export function MeshTopology({ myShortId, peers, chunks, isComputing, size = 300 }: Props) {
  const center = size / 2;
  const radius = size * 0.35;

  // Calculate peer positions in a circle
  const peerPositions = useMemo(() => {
    return peers.map((peer, i) => {
      const angle = (i / Math.max(1, peers.length)) * Math.PI * 2 - Math.PI / 2;
      return {
        ...peer,
        x: center + Math.cos(angle) * radius,
        y: center + Math.sin(angle) * radius,
      };
    });
  }, [peers, center, radius]);

  // Map chunk assignees to peer indices for active highlighting
  const activeAssignees = new Set(
    (chunks || [])
      .filter(c => c.status === 'executing')
      .map(c => c.assignee)
  );

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Connection lines */}
      {peerPositions.map((peer, i) => {
        const isActive = isComputing && activeAssignees.has(peer.shortId);
        return (
          <View
            key={`line-${i}`}
            style={[
              styles.line,
              {
                position: 'absolute',
                left: center,
                top: center,
                width: Math.sqrt(
                  Math.pow(peer.x - center, 2) + Math.pow(peer.y - center, 2)
                ),
                height: 2,
                backgroundColor: isActive ? COLORS.lineActive : COLORS.line,
                transform: [
                  {
                    rotate: `${Math.atan2(peer.y - center, peer.x - center)}rad`,
                  },
                ],
                transformOrigin: 'left center',
                opacity: isActive ? 1 : 0.4,
              },
            ]}
          />
        );
      })}

      {/* Peer nodes */}
      {peerPositions.map((peer, i) => {
        const isActive = isComputing && activeAssignees.has(peer.shortId);
        const chunk = (chunks || []).find(c => c.assignee === peer.shortId);
        const progress = chunk?.progress || 0;

        return (
          <View key={`peer-${i}`} style={[styles.nodeContainer, { left: peer.x - 20, top: peer.y - 20 }]}>
            <View
              style={[
                styles.node,
                {
                  backgroundColor: isActive ? COLORS.nodeActive : COLORS.nodePeer,
                  width: isActive ? 18 : 14,
                  height: isActive ? 18 : 14,
                  borderRadius: 9,
                },
              ]}
            />
            <Text style={styles.nodeLabel}>{peer.shortId}</Text>
            {isActive && chunk && (
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
              </View>
            )}
          </View>
        );
      })}

      {/* Center node (me) */}
      <View style={[styles.nodeContainer, { left: center - 20, top: center - 20 }]}>
        <View style={[styles.node, styles.nodeCenter]} />
        <Text style={[styles.nodeLabel, styles.nodeLabelCenter]}>
          {myShortId}
        </Text>
        <Text style={styles.meLabel}>YOU</Text>
      </View>

      {/* Peer count */}
      <View style={styles.countContainer}>
        <Text style={styles.countText}>{peers.length} peers</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.bg,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  line: {
    position: 'absolute',
  },
  nodeContainer: {
    position: 'absolute',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  node: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  nodeCenter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.nodeMe,
    borderWidth: 2,
    borderColor: '#60A5FA',
  },
  nodeLabel: {
    color: COLORS.text,
    fontSize: 8,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  nodeLabelCenter: {
    color: COLORS.textBright,
    fontWeight: 'bold',
  },
  meLabel: {
    color: COLORS.nodeMe,
    fontSize: 7,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  progressBarContainer: {
    width: 30,
    height: 3,
    backgroundColor: '#1E293B',
    borderRadius: 1.5,
    marginTop: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: COLORS.nodeActive,
    borderRadius: 1.5,
  },
  countContainer: {
    position: 'absolute',
    bottom: 8,
    right: 12,
  },
  countText: {
    color: COLORS.text,
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
