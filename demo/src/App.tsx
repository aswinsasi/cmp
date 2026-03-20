/**
 * CMP Demo App
 * Main screen: mesh formation + distributed compute visualization.
 *
 * Two modes:
 *   1. Requester: Pick image → Analyze → See chunks distributed → Get result
 *   2. Executor: Show "Waiting..." → Animate when chunk arrives → Show completion
 *
 * @author Agent Viscro
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useMesh } from './hooks/useMesh';
import { useCompute } from './hooks/useCompute';
import { MeshTopology } from './components/MeshTopology';
import { ComputeProgress } from './components/ComputeProgress';

type Mode = 'requester' | 'executor';

export default function App() {
  const { state: meshState, start, stop } = useMesh();
  const { state: computeState, compute, reset } = useCompute();
  const [mode, setMode] = useState<Mode>('requester');

  const handleStart = useCallback(async () => {
    await start();
  }, [start]);

  const handleCompute = useCallback(async () => {
    // In production: pick image, load WASM model, distribute
    // For demo: simulate with dummy data
    const dummyWasm = new Uint8Array(32);
    const dummyInput = new Uint8Array(1024);
    await compute(dummyWasm, dummyInput, {
      peerCount: meshState.peerCount || 4,
    });
  }, [compute, meshState.peerCount]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#020617" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>CMP</Text>
          <Text style={styles.subtitle}>Compute Mesh Protocol</Text>
        </View>

        {/* Mode Selector */}
        {!meshState.running && (
          <View style={styles.modeSelector}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'requester' && styles.modeBtnActive]}
              onPress={() => setMode('requester')}
            >
              <Text style={[styles.modeBtnText, mode === 'requester' && styles.modeBtnTextActive]}>
                Requester
              </Text>
              <Text style={styles.modeBtnDesc}>Submit tasks</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'executor' && styles.modeBtnActive]}
              onPress={() => setMode('executor')}
            >
              <Text style={[styles.modeBtnText, mode === 'executor' && styles.modeBtnTextActive]}>
                Executor
              </Text>
              <Text style={styles.modeBtnDesc}>Process chunks</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Start / Stop */}
        {!meshState.running ? (
          <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
            <Text style={styles.startBtnText}>Join Mesh</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.statusBar}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>
              Mesh Active — {meshState.shortId}
            </Text>
            <TouchableOpacity onPress={stop}>
              <Text style={styles.stopText}>Leave</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Mesh Topology */}
        {meshState.running && (
          <View style={styles.section}>
            <MeshTopology
              myShortId={meshState.shortId}
              peers={meshState.peers}
              chunks={computeState.chunks}
              isComputing={computeState.phase === 'executing'}
              size={280}
            />
          </View>
        )}

        {/* Mesh Stats */}
        {meshState.running && (
          <View style={styles.statsRow}>
            <StatItem label="Peers" value={`${meshState.peerCount}`} />
            <StatItem label="Cores" value={`${meshState.totalCores}`} />
            <StatItem label="Memory" value={formatMb(meshState.totalMemoryMb)} />
            <StatItem label="Uptime" value={formatUptime(meshState.uptime)} />
          </View>
        )}

        {/* Requester Mode: Compute Button */}
        {meshState.running && mode === 'requester' && computeState.phase === 'idle' && (
          <TouchableOpacity style={styles.computeBtn} onPress={handleCompute}>
            <Text style={styles.computeBtnIcon}>⚡</Text>
            <Text style={styles.computeBtnText}>Analyze with Mesh</Text>
            <Text style={styles.computeBtnSub}>
              Distribute across {meshState.peerCount || '?'} devices
            </Text>
          </TouchableOpacity>
        )}

        {/* Executor Mode: Waiting State */}
        {meshState.running && mode === 'executor' && computeState.phase === 'idle' && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingPulse}>◉</Text>
            <Text style={styles.waitingText}>Waiting for tasks...</Text>
            <Text style={styles.waitingSubtext}>
              This device will process chunks from the mesh
            </Text>
          </View>
        )}

        {/* Compute Progress */}
        {computeState.phase !== 'idle' && (
          <ComputeProgress state={computeState} />
        )}

        {/* Result */}
        {computeState.phase === 'complete' && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Result</Text>
            <View style={styles.resultMain}>
              <Text style={styles.resultClassification}>Normal</Text>
              <Text style={styles.resultConfidence}>94% confidence</Text>
            </View>
            <View style={styles.resultMeta}>
              <Text style={styles.resultMetaText}>
                {computeState.totalTimeMs}ms • {computeState.devicesUsed} devices • {computeState.chunksExecuted} chunks
              </Text>
              <Text style={styles.resultMetaText}>
                Zero cloud. Zero internet.
              </Text>
            </View>
            <TouchableOpacity style={styles.resetBtn} onPress={reset}>
              <Text style={styles.resetBtnText}>Run Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Agent Viscro • CMP v1.0</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

function formatMb(mb: number): string {
  if (!mb) return '0';
  if (mb < 1024) return `${mb}M`;
  return `${(mb / 1024).toFixed(1)}G`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#020617',
  },
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#3B82F6',
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#475569',
    letterSpacing: 2,
    marginTop: 4,
  },

  // Mode selector
  modeSelector: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 12,
  },
  modeBtn: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1E293B',
  },
  modeBtnActive: {
    borderColor: '#3B82F6',
    backgroundColor: '#0F1D3A',
  },
  modeBtnText: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '700',
  },
  modeBtnTextActive: {
    color: '#3B82F6',
  },
  modeBtnDesc: {
    color: '#475569',
    fontSize: 11,
    marginTop: 4,
  },

  // Start button
  startBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    marginBottom: 20,
  },
  startBtnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Status bar
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  statusText: {
    color: '#CBD5E1',
    fontSize: 14,
    flex: 1,
    fontFamily: 'monospace',
  },
  stopText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },

  // Section
  section: {
    alignItems: 'center',
    marginBottom: 16,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    color: '#E2E8F0',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  statLabel: {
    color: '#64748B',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },

  // Compute button
  computeBtn: {
    backgroundColor: '#1E3A5F',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#3B82F6',
    marginBottom: 16,
  },
  computeBtnIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  computeBtnText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  computeBtnSub: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 4,
  },

  // Waiting (executor)
  waitingContainer: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0F172A',
    borderRadius: 16,
    marginBottom: 16,
  },
  waitingPulse: {
    fontSize: 40,
    color: '#10B981',
    marginBottom: 12,
  },
  waitingText: {
    color: '#CBD5E1',
    fontSize: 18,
    fontWeight: '600',
  },
  waitingSubtext: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },

  // Result
  resultCard: {
    backgroundColor: '#052E16',
    borderRadius: 16,
    padding: 24,
    marginTop: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#16A34A',
  },
  resultTitle: {
    color: '#86EFAC',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  resultMain: {
    alignItems: 'center',
    marginBottom: 16,
  },
  resultClassification: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },
  resultConfidence: {
    color: '#10B981',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 4,
  },
  resultMeta: {
    alignItems: 'center',
    marginBottom: 16,
  },
  resultMetaText: {
    color: '#6EE7B7',
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  resetBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  resetBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Footer
  footer: {
    alignItems: 'center',
    marginTop: 32,
  },
  footerText: {
    color: '#334155',
    fontSize: 12,
  },
});
