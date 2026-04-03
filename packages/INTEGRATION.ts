/**
 * CMP v3.0 — Integration Instructions
 *
 * Add these changes to wire v3.0 modules into the existing CLI and CMPNode.
 * Total: ~30 lines of changes across 2 files.
 *
 * ════════════════════════════════════════════════
 * FILE 1: packages/cli/src/cli.ts
 * ════════════════════════════════════════════════
 *
 * STEP 1: Add import at the top (after the v2 import on line 21):
 *
 *   import { doV3Command, v3HelpText } from './v3-cli-commands';
 *
 *
 * STEP 2: Add v3bridge creation after v2bridge creation (around line 170-180).
 *   Find where v2bridge is created, and add below it:
 *
 *   // v3.0: Cortex, Holographic, GPU, Neuromorphic, Entanglement, Meta-Evolution, Dreaming
 *   const { V3Bridge } = await import('../../core/src/v3-bridge');
 *   const v3bridge = new V3Bridge(
 *     node.getMeshIdHex(),
 *     () => node.getPeers().map(p => ({ deviceId: p.meshIdHex, address: p.address, latencyMs: p.latencyMs ?? 5 })),
 *     async (deviceId, data) => { /* transport send */ },
 *   );
 *   v3bridge.start();
 *   log('◈', C.magenta, 'v3.0 systems active', 'Cortex, Memory, GPU, Neural, Entangle, Evolve, Dream');
 *
 *
 * STEP 3: Add v3 command cases in the switch statement (around line 558-570).
 *   Find the 'help' case and add BEFORE it:
 *
 *   case 'memory':
 *   case 'cortex':
 *   case 'gpu':
 *   case 'neural':
 *   case 'entangle':
 *   case 'evolve':
 *   case 'dream3':
 *   case 'v3':
 *     {
 *       if (!v3bridge) { console.log(`  ${C.d}v3.0 not available.${C.r}`); break; }
 *       const v3Sub = (arg.split(/\s+/)[0] || '').toLowerCase();
 *       const v3Arg = arg.substring(v3Sub.length).trim();
 *       await doV3Command(v3bridge, cmd, v3Sub, v3Arg);
 *     }
 *     break;
 *
 *
 * STEP 4: Add v3 help text in the help case.
 *   Find where v2HelpText() is called (line ~660) and add below it:
 *
 *   ${v3HelpText()}
 *
 *
 * STEP 5: Add v3bridge.stop() in the quit handler (around line 670):
 *
 *   if (v3bridge) v3bridge.stop();
 *
 *
 * ════════════════════════════════════════════════
 * FILE 2: packages/core/src/v2-bridge.ts (OPTIONAL)
 * ════════════════════════════════════════════════
 *
 * No changes needed. V3Bridge operates independently alongside V2Bridge.
 * Both can run simultaneously — they use different subsystems.
 *
 *
 * ════════════════════════════════════════════════
 * FILE 3: packages/core/src/types/index.ts
 * ════════════════════════════════════════════════
 *
 * Add these exports so types are available from the barrel:
 *
 *   export * from './holographic';
 *   export * from './neuromorphic';
 *   export * from './entanglement';
 *   export * from './cortex';
 *   export * from './gpu';
 *   export * from './meta-evolution';
 *   export * from './dreaming';
 *
 *
 * ════════════════════════════════════════════════
 * TESTING
 * ════════════════════════════════════════════════
 *
 * After integration, start the CLI:
 *
 *   npx tsx packages/cli/src/cli.ts start
 *
 * Then try:
 *
 *   cmp> v3                              # Full v3.0 status
 *   cmp> memory write hello "world"      # Write to mesh memory
 *   cmp> memory read hello               # Read back
 *   cmp> cortex load testnet 8 16        # Load 8-layer model
 *   cmp> cortex infer testnet            # Run inference
 *   cmp> gpu matmul 32                   # 32x32 matrix multiply
 *   cmp> gpu relu 1000                   # ReLU on 1000 elements
 *   cmp> neural                          # Router status
 *   cmp> neural topology                 # Connection weights
 *   cmp> evolve                          # Protocol evolution status
 *   cmp> dream3                          # Dream state
 *   cmp> dream3 now                      # Force a dream cycle
 */
