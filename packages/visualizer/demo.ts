/**
 * CMP v3.0 — Visualizer Demo
 * Starts the mesh visualizer with mock data.
 *
 * Run: npx tsx packages/visualizer/demo.ts
 * Then open: http://localhost:8080
 *
 * @author Agent Viscro
 */

import { VisualizerServer } from './src/server';
import { MeshDataCollector, MockMeshDataSource } from './src/mesh-data-collector';

async function main() {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║    CMP MESH VISUALIZER — Demo Mode        ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');

  // Create mock data source (simulates a 3-device mesh)
  const dataSource = new MockMeshDataSource();
  const collector = new MeshDataCollector(dataSource);

  // Start collecting snapshots every second
  collector.start(1000);

  // Start the HTTP + SSE server
  const server = new VisualizerServer(collector);
  const port = await server.start(8080);

  console.log(`  Dashboard: http://localhost:${port}`);
  console.log('');
  console.log('  Mock mesh:');
  console.log('    • 3 devices (laptop + phone + tablet)');
  console.log('    • 6 Lifeforms (sensors, processor, matcher, monitor, edge)');
  console.log('    • 5 synapses with Hebbian strengths');
  console.log('    • Real-time cause flow');
  console.log('    • Pheromone concentrations');
  console.log('    • GPU, memory pool, neuromorphic stats');
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\\n  Shutting down...');
    collector.stop();
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    collector.stop();
    server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start visualizer:', err);
  process.exit(1);
});
