/**
 * CMP Demo App
 * Real distributed computation on phones via mesh networking.
 *
 * Features:
 *   - Join mesh (auto-discovers nearby phones)
 *   - Encrypt text (XOR cipher distributed across mesh)
 *   - Decrypt ciphertext (symmetric XOR)
 *   - Live mesh topology visualization
 *   - Credit & reputation tracking
 *
 * @author Agent Viscro
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  SafeAreaView,
  Alert,
  Clipboard,
} from 'react-native';
import { useMesh } from './hooks/useMesh';
import { useCompute } from './hooks/useCompute';
import { MeshTopology } from './components/MeshTopology';
import { ComputeProgress } from './components/ComputeProgress';

export default function App() {
  const { state: meshState, error: meshError, start, stop, connectTo, node } = useMesh();
  const { state: computeState, encrypt, decrypt, reset } = useCompute();
  const [inputText, setInputText] = useState('');
  const [connectIp, setConnectIp] = useState('');
  const [showConnect, setShowConnect] = useState(false);

  const handleEncrypt = useCallback(async () => {
    if (!inputText.trim()) return;
    await encrypt(node, inputText.trim());
  }, [encrypt, node, inputText]);

  const handleDecrypt = useCallback(async () => {
    if (!inputText.trim()) return;
    await decrypt(node, inputText.trim());
  }, [decrypt, node, inputText]);

  const handleConnect = useCallback(() => {
    if (connectIp.trim()) {
      connectTo(connectIp.trim());
      setShowConnect(false);
      setConnectIp('');
    }
  }, [connectTo, connectIp]);

  const handleCopy = useCallback(() => {
    if (computeState.outputHex) {
      try {
        Clipboard.setString(computeState.outputHex);
      } catch {}
    }
  }, [computeState.outputHex]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#020617" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>CMP</Text>
          <Text style={styles.subtitle}>Compute Mesh Protocol</Text>
        </View>

        {/* Start / Stop */}
        {!meshState.running ? (
          <TouchableOpacity style={styles.startBtn} onPress={start}>
            <Text style={styles.startBtnText}>Join Mesh</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.statusBar}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>
              {meshState.shortId}
            </Text>
            <TouchableOpacity onPress={() => setShowConnect(!showConnect)}>
              <Text style={styles.connectText}>Connect</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={stop}>
              <Text style={styles.stopText}>Leave</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Connect to IP */}
        {showConnect && meshState.running && (
          <View style={styles.connectRow}>
            <TextInput
              style={styles.connectInput}
              placeholder="192.168.x.x"
              placeholderTextColor="#475569"
              value={connectIp}
              onChangeText={setConnectIp}
              keyboardType="numeric"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.connectBtn} onPress={handleConnect}>
              <Text style={styles.connectBtnText}>Go</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error */}
        {meshError && (
          <Text style={styles.errorText}>{meshError}</Text>
        )}

        {/* Mesh Topology */}
        {meshState.running && (
          <View style={styles.section}>
            <MeshTopology
              myShortId={meshState.shortId}
              peers={meshState.peers}
              chunks={computeState.chunks}
              isComputing={computeState.phase === 'executing'}
              size={260}
            />
          </View>
        )}

        {/* Stats */}
        {meshState.running && (
          <View style={styles.statsRow}>
            <StatItem label="Peers" value={`${meshState.peerCount}`} />
            <StatItem label="Cores" value={`${meshState.totalCores}`} />
            <StatItem label="Credits" value={`${meshState.credits}`} />
            <StatItem label="Rep" value={`${meshState.reputation}`} />
          </View>
        )}

        {/* Input */}
        {meshState.running && computeState.phase === 'idle' && (
          <View style={styles.inputSection}>
            <TextInput
              style={styles.textInput}
              placeholder="Type message to encrypt, or hex to decrypt..."
              placeholderTextColor="#475569"
              value={inputText}
              onChangeText={setInputText}
              multiline
              autoCorrect={false}
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.encryptBtn]}
                onPress={handleEncrypt}
                disabled={!inputText.trim()}
              >
                <Text style={styles.actionBtnIcon}>⚡</Text>
                <Text style={styles.actionBtnText}>Encrypt</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.decryptBtn]}
                onPress={handleDecrypt}
                disabled={!inputText.trim()}
              >
                <Text style={styles.actionBtnIcon}>🔓</Text>
                <Text style={styles.actionBtnText}>Decrypt</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Compute Progress */}
        {computeState.phase !== 'idle' && computeState.phase !== 'complete' && (
          <ComputeProgress state={computeState} />
        )}

        {/* Result */}
        {computeState.phase === 'complete' && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>RESULT</Text>
            <TouchableOpacity onPress={handleCopy}>
              <Text style={styles.resultOutput} numberOfLines={4}>
                {computeState.outputHex}
              </Text>
              <Text style={styles.resultCopyHint}>tap to copy</Text>
            </TouchableOpacity>
            <View style={styles.resultMeta}>
              <Text style={styles.resultMetaText}>
                {computeState.totalTimeMs}ms  •  {computeState.devicesUsed} device{computeState.devicesUsed !== 1 ? 's' : ''}  •  {computeState.chunksExecuted} chunk{computeState.chunksExecuted !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.resultMetaText}>
                Zero cloud. Zero internet.
              </Text>
            </View>
            <TouchableOpacity style={styles.resetBtn} onPress={() => { reset(); setInputText(''); }}>
              <Text style={styles.resetBtnText}>Run Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Executor activity (when chunks arrive from others) */}
        {meshState.running && computeState.phase === 'idle' && !inputText && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingPulse}>◉</Text>
            <Text style={styles.waitingText}>Ready</Text>
            <Text style={styles.waitingSubtext}>
              This device will process chunks from the mesh automatically.
              Type a message above to encrypt it via mesh.
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Agent Viscro • CMP v1.4</Text>
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#020617' },
  container: { flex: 1, backgroundColor: '#020617' },
  content: { padding: 20, paddingBottom: 40 },

  header: { alignItems: 'center', marginBottom: 20, marginTop: 8 },
  title: { fontSize: 36, fontWeight: '800', color: '#3B82F6', letterSpacing: 4 },
  subtitle: { fontSize: 13, color: '#475569', letterSpacing: 2, marginTop: 4 },

  startBtn: { backgroundColor: '#3B82F6', borderRadius: 12, padding: 18, alignItems: 'center', marginBottom: 20 },
  startBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', letterSpacing: 1 },

  statusBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 10, padding: 12, marginBottom: 12, gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  statusText: { color: '#CBD5E1', fontSize: 14, flex: 1, fontFamily: 'monospace' },
  connectText: { color: '#3B82F6', fontSize: 13, fontWeight: '600', marginRight: 12 },
  stopText: { color: '#EF4444', fontSize: 13, fontWeight: '600' },

  connectRow: { flexDirection: 'row', marginBottom: 12, gap: 8 },
  connectInput: { flex: 1, backgroundColor: '#0F172A', borderRadius: 8, padding: 12, color: '#E2E8F0', fontFamily: 'monospace', fontSize: 14 },
  connectBtn: { backgroundColor: '#3B82F6', borderRadius: 8, paddingHorizontal: 20, justifyContent: 'center' },
  connectBtnText: { color: '#FFFFFF', fontWeight: '700' },

  errorText: { color: '#EF4444', fontSize: 13, textAlign: 'center', marginBottom: 12 },

  section: { alignItems: 'center', marginBottom: 12 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#0F172A', borderRadius: 12, padding: 14, marginBottom: 14 },
  statItem: { alignItems: 'center' },
  statValue: { color: '#E2E8F0', fontSize: 17, fontWeight: '700', fontFamily: 'monospace' },
  statLabel: { color: '#64748B', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  inputSection: { marginBottom: 16 },
  textInput: { backgroundColor: '#0F172A', borderRadius: 12, padding: 14, color: '#E2E8F0', fontSize: 15, minHeight: 60, textAlignVertical: 'top', marginBottom: 12 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 2 },
  encryptBtn: { backgroundColor: '#1E3A5F', borderColor: '#3B82F6' },
  decryptBtn: { backgroundColor: '#1E3A2F', borderColor: '#10B981' },
  actionBtnIcon: { fontSize: 24, marginBottom: 4 },
  actionBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  resultCard: { backgroundColor: '#052E16', borderRadius: 16, padding: 20, marginTop: 12, alignItems: 'center', borderWidth: 1, borderColor: '#16A34A' },
  resultTitle: { color: '#86EFAC', fontSize: 11, fontWeight: '600', letterSpacing: 2, marginBottom: 10 },
  resultOutput: { color: '#FFFFFF', fontSize: 14, fontFamily: 'monospace', textAlign: 'center', marginBottom: 4 },
  resultCopyHint: { color: '#6EE7B7', fontSize: 10, textAlign: 'center', marginBottom: 12 },
  resultMeta: { alignItems: 'center', marginBottom: 14 },
  resultMetaText: { color: '#6EE7B7', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  resetBtn: { backgroundColor: '#16A34A', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 24 },
  resetBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  waitingContainer: { alignItems: 'center', padding: 24, backgroundColor: '#0F172A', borderRadius: 16, marginBottom: 16 },
  waitingPulse: { fontSize: 32, color: '#10B981', marginBottom: 8 },
  waitingText: { color: '#CBD5E1', fontSize: 16, fontWeight: '600' },
  waitingSubtext: { color: '#64748B', fontSize: 12, marginTop: 8, textAlign: 'center', lineHeight: 18 },

  footer: { alignItems: 'center', marginTop: 32 },
  footerText: { color: '#334155', fontSize: 12 },
});
