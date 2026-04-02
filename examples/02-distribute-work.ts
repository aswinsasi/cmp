#!/usr/bin/env npx tsx
/**
 * Example 2: Distribute Work
 *
 * Run actual computation on the CMP mesh.
 * This processes real data — sorting numbers, transforming text,
 * analyzing JSON — using nearby devices.
 *
 * Usage:
 *   npx tsx examples/02-distribute-work.ts
 */

import { CMPNode } from '../packages/core/src/cmp-node';
import { LogLevel } from '../packages/core/src/utils/logger';

async function main() {
  const node = new CMPNode({
    transports: ['lan'],
    acceptingTasks: true,
    logLevel: LogLevel.WARN,
  });

  await node.start();
  console.log(`\n  ✓ CMP Node started: ${node.meshIdHex().substring(0, 16)}`);
  console.log(`  Peers: ${node.getStatus().peers}\n`);

  // ── Task 1: Sort numbers ──
  console.log('  ── Task 1: Sort 1000 random numbers ──');
  const numbers = Array.from({ length: 1000 }, () => Math.floor(Math.random() * 10000));
  const sortResult = await node.run(
    `function process(data) {
      const arr = JSON.parse(data.toString());
      arr.sort((a, b) => a - b);
      return JSON.stringify(arr.slice(0, 10));
    }`,
    new TextEncoder().encode(JSON.stringify(numbers)),
    { language: 'javascript', deadline: 5000 },
  );
  const sorted = new TextDecoder().decode(sortResult.data);
  console.log(`  Input:  [${numbers.slice(0, 5).join(', ')}, ...] (1000 numbers)`);
  console.log(`  Output: ${sorted} (first 10 sorted)`);
  console.log(`  Time:   ${sortResult.totalTimeMs}ms`);
  console.log(`  Mode:   ${sortResult.localFallback ? 'Local' : 'Distributed'}\n`);

  // ── Task 2: Text analysis ──
  console.log('  ── Task 2: Word frequency analysis ──');
  const text = `CMP is a decentralized protocol for proximity based distributed computation 
    across heterogeneous devices. CMP enables nearby devices to dynamically discover 
    each other and negotiate compute resources. The mesh forms automatically without 
    any central server or cloud infrastructure. Devices pool their compute power 
    to solve problems faster than any single device could alone.`;
  const textResult = await node.run(
    `function process(data) {
      const text = data.toString().toLowerCase();
      const words = text.split(/\\s+/).filter(w => w.length > 3);
      const freq = {};
      words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return JSON.stringify(sorted);
    }`,
    new TextEncoder().encode(text),
    { language: 'javascript', deadline: 5000 },
  );
  const freqs = JSON.parse(new TextDecoder().decode(textResult.data));
  console.log(`  Input:  "${text.substring(0, 50)}..." (${text.split(/\s+/).length} words)`);
  console.log(`  Top 5 words:`);
  for (const [word, count] of freqs) {
    console.log(`    "${word}" → ${count} times`);
  }
  console.log(`  Time:   ${textResult.totalTimeMs}ms\n`);

  // ── Task 3: JSON data transformation ──
  console.log('  ── Task 3: Transform sensor data ──');
  const sensors = Array.from({ length: 50 }, (_, i) => ({
    id: `sensor-${i}`,
    temperature: 20 + Math.random() * 15,
    humidity: 40 + Math.random() * 40,
    timestamp: Date.now() - Math.random() * 3600000,
  }));
  const sensorResult = await node.run(
    `function process(data) {
      const sensors = JSON.parse(data.toString());
      const avgTemp = sensors.reduce((s, d) => s + d.temperature, 0) / sensors.length;
      const avgHum = sensors.reduce((s, d) => s + d.humidity, 0) / sensors.length;
      const hot = sensors.filter(d => d.temperature > 30).length;
      const humid = sensors.filter(d => d.humidity > 70).length;
      return JSON.stringify({
        count: sensors.length,
        avgTemperature: Math.round(avgTemp * 10) / 10,
        avgHumidity: Math.round(avgHum * 10) / 10,
        hotSensors: hot,
        humidSensors: humid,
        alert: hot > 10 ? 'HIGH_TEMP_WARNING' : 'NORMAL',
      });
    }`,
    new TextEncoder().encode(JSON.stringify(sensors)),
    { language: 'javascript', deadline: 5000 },
  );
  const analysis = JSON.parse(new TextDecoder().decode(sensorResult.data));
  console.log(`  Input:  ${sensors.length} sensor readings`);
  console.log(`  Result:`);
  console.log(`    Avg Temperature: ${analysis.avgTemperature}°C`);
  console.log(`    Avg Humidity:    ${analysis.avgHumidity}%`);
  console.log(`    Hot sensors:     ${analysis.hotSensors}`);
  console.log(`    Alert:           ${analysis.alert}`);
  console.log(`  Time:   ${sensorResult.totalTimeMs}ms\n`);

  // ── Summary ──
  console.log('  ══════════════════════════════════════');
  console.log('  3 real computations completed on CMP.');
  console.log(`  Total peers: ${node.getStatus().peers}`);
  console.log('  ══════════════════════════════════════\n');

  await node.stop();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
