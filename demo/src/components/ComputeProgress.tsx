/**
 * ComputeProgress Component
 * Shows the phases of distributed computation with chunk-level progress.
 *
 * @author Agent Viscro
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ComputeState, ComputePhase, ChunkProgress } from '../hooks/useCompute';

interface Props {
  state: ComputeState;
}

const PHASE_LABELS: Record<ComputePhase, string> = {
  idle: 'Ready',
  negotiating: 'Negotiating with mesh...',
  distributing: 'Distributing chunks...',
  executing: 'Executing on mesh...',
  assembling: 'Assembling results...',
  complete: 'Complete!',
  error: 'Error',
};

const PHASE_COLORS: Record<ComputePhase, string> = {
  idle: '#64748B',
  negotiating: '#3B82F6',
  distributing: '#8B5CF6',
  executing: '#F59E0B',
  assembling: '#10B981',
  complete: '#10B981',
  error: '#EF4444',
};

export function ComputeProgress({ state }: Props) {
  if (state.phase === 'idle') return null;

  return (
    <View style={styles.container}>
      {/* Phase indicator */}
      <View style={styles.phaseRow}>
        <View style={[styles.phaseDot, { backgroundColor: PHASE_COLORS[state.phase] }]} />
        <Text style={[styles.phaseText, { color: PHASE_COLORS[state.phase] }]}>
          {PHASE_LABELS[state.phase]}
        </Text>
      </View>

      {/* Overall progress bar */}
      <View style={styles.progressBarOuter}>
        <View
          style={[
            styles.progressBarInner,
            {
              width: `${state.progress * 100}%`,
              backgroundColor: PHASE_COLORS[state.phase],
            },
          ]}
        />
      </View>
      <Text style={styles.progressText}>{Math.round(state.progress * 100)}%</Text>

      {/* Chunk-level progress */}
      {state.chunks.length > 0 && (
        <View style={styles.chunksContainer}>
          <Text style={styles.chunksLabel}>Chunks</Text>
          {state.chunks.map((chunk, i) => (
            <ChunkRow key={chunk.chunkId} chunk={chunk} index={i} />
          ))}
        </View>
      )}

      {/* Result summary */}
      {state.phase === 'complete' && (
        <View style={styles.resultContainer}>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Time</Text>
            <Text style={styles.resultValue}>{state.totalTimeMs}ms</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Devices</Text>
            <Text style={styles.resultValue}>{state.devicesUsed}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Chunks</Text>
            <Text style={styles.resultValue}>{state.chunksExecuted}</Text>
          </View>
        </View>
      )}

      {/* Error */}
      {state.error && (
        <Text style={styles.errorText}>{state.error}</Text>
      )}
    </View>
  );
}

function ChunkRow({ chunk, index }: { chunk: ChunkProgress; index: number }) {
  const statusColor =
    chunk.status === 'complete' ? '#10B981' :
    chunk.status === 'executing' ? '#F59E0B' :
    chunk.status === 'failed' ? '#EF4444' : '#475569';

  return (
    <View style={styles.chunkRow}>
      <Text style={styles.chunkIndex}>#{index}</Text>
      <View style={styles.chunkBarOuter}>
        <View
          style={[
            styles.chunkBarInner,
            { width: `${chunk.progress * 100}%`, backgroundColor: statusColor },
          ]}
        />
      </View>
      <Text style={[styles.chunkStatus, { color: statusColor }]}>
        {chunk.status === 'complete' && chunk.timeMs ? `${chunk.timeMs}ms` : chunk.status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  phaseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  phaseText: {
    fontSize: 16,
    fontWeight: '600',
  },
  progressBarOuter: {
    height: 6,
    backgroundColor: '#1E293B',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarInner: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 16,
    fontFamily: 'monospace',
  },
  chunksContainer: {
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingTop: 12,
  },
  chunksLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  chunkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  chunkIndex: {
    color: '#475569',
    fontSize: 11,
    fontFamily: 'monospace',
    width: 24,
  },
  chunkBarOuter: {
    flex: 1,
    height: 4,
    backgroundColor: '#1E293B',
    borderRadius: 2,
    overflow: 'hidden',
    marginHorizontal: 8,
  },
  chunkBarInner: {
    height: '100%',
    borderRadius: 2,
  },
  chunkStatus: {
    fontSize: 10,
    fontFamily: 'monospace',
    width: 60,
    textAlign: 'right',
  },
  resultContainer: {
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingTop: 12,
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  resultRow: {
    alignItems: 'center',
  },
  resultLabel: {
    color: '#64748B',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  resultValue: {
    color: '#10B981',
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginTop: 8,
  },
});
