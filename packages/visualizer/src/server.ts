/**
 * CMP v3.0 — Visualizer Server
 * HTTP server that serves the mesh visualization dashboard.
 * Uses Server-Sent Events (SSE) for real-time updates (no ws dependency needed).
 *
 * Usage:
 *   const server = new VisualizerServer(dataCollector);
 *   await server.start(8080);
 *   // Open http://localhost:8080
 *   server.stop();
 *
 * CLI integration:
 *   cmp> visualizer start       → opens http://localhost:8080
 *   cmp> visualizer stop
 *
 * @module visualizer/server
 * @author Agent Viscro
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MeshDataCollector } from './mesh-data-collector';

export class VisualizerServer {
  private server: http.Server | null = null;
  private collector: MeshDataCollector;
  private sseClients: Set<http.ServerResponse> = new Set();
  private unsubscribe: (() => void) | null = null;
  private port = 0;

  constructor(collector: MeshDataCollector) {
    this.collector = collector;
  }

  async start(port: number = 8080): Promise<number> {
    if (this.server) return this.port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);

      this.server.listen(port, () => {
        const addr = this.server!.address() as { port: number };
        this.port = addr.port;

        // Subscribe to data updates and push via SSE
        this.unsubscribe = this.collector.subscribe((snapshot) => {
          const data = `data: ${JSON.stringify(snapshot)}\n\n`;
          for (const client of this.sseClients) {
            try { client.write(data); } catch { this.sseClients.delete(client); }
          }
        });

        resolve(this.port);
      });
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const client of this.sseClients) {
      try { client.end(); } catch {}
    }
    this.sseClients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  get isRunning(): boolean {
    return this.server !== null;
  }

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/';

    if (url === '/events') {
      // SSE endpoint
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      this.sseClients.add(res);

      // Send current state immediately
      const snapshot = this.collector.getLatest();
      if (snapshot) {
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      }

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    if (url === '/api/snapshot') {
      // REST endpoint for current state
      const snapshot = this.collector.getLatest() ?? this.collector.collect();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(snapshot));
      return;
    }

    if (url === '/' || url === '/index.html') {
      // Serve the dashboard HTML
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }
}

// ─── Embedded Dashboard HTML ───

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CMP Mesh Visualizer</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'SF Mono', 'Consolas', monospace; background: #0a0e17; color: #c8ccd4; overflow: hidden; }
#app { display: grid; grid-template-columns: 1fr 320px; grid-template-rows: 48px 1fr; height: 100vh; }
header { grid-column: 1 / -1; background: #141821; border-bottom: 1px solid #1e2533; display: flex; align-items: center; padding: 0 20px; gap: 16px; }
header h1 { font-size: 15px; font-weight: 600; color: #7b8fff; letter-spacing: 1px; }
header .status { font-size: 12px; color: #4a9; display: flex; align-items: center; gap: 6px; }
header .status .dot { width: 8px; height: 8px; border-radius: 50%; background: #4a9; animation: pulse 2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
header .stats { margin-left: auto; display: flex; gap: 20px; font-size: 12px; color: #6b7280; }
header .stats span { color: #c8ccd4; }

#graph { background: #0d1117; position: relative; overflow: hidden; }
#graph svg { width: 100%; height: 100%; }

#sidebar { background: #141821; border-left: 1px solid #1e2533; overflow-y: auto; padding: 16px; }
.section { margin-bottom: 20px; }
.section h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b7280; margin-bottom: 10px; }

.card { background: #1a1f2e; border: 1px solid #252d3d; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; font-size: 12px; }
.card .name { color: #7b8fff; font-weight: 600; margin-bottom: 4px; }
.card .meta { color: #6b7280; display: flex; gap: 12px; flex-wrap: wrap; }
.card .meta .val { color: #c8ccd4; }

.stat-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; border-bottom: 1px solid #1e2533; }
.stat-row:last-child { border: none; }
.stat-row .label { color: #6b7280; }
.stat-row .value { color: #c8ccd4; font-weight: 500; }
.stat-row .value.green { color: #4a9; }
.stat-row .value.amber { color: #d9a03c; }
.stat-row .value.red { color: #e55; }

.pheromone-bar { height: 4px; border-radius: 2px; margin-top: 3px; transition: width 0.5s; }

.lf-state { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.lf-state.alive { background: #4a9; }
.lf-state.hibernating { background: #d9a03c; }
.lf-state.dead { background: #e55; }
.lf-state.fused { background: #7b8fff; }

svg text { font-family: 'SF Mono', 'Consolas', monospace; }
</style>
</head>
<body>
<div id="app">
  <header>
    <h1>CMP MESH VISUALIZER</h1>
    <div class="status"><div class="dot"></div> <span id="conn-status">Connecting...</span></div>
    <div class="stats">
      Devices <span id="stat-devices">-</span>
      &nbsp;&nbsp;Lifeforms <span id="stat-lifeforms">-</span>
      &nbsp;&nbsp;Causes/s <span id="stat-cps">-</span>
      &nbsp;&nbsp;CCU/s <span id="stat-ccu">-</span>
    </div>
  </header>
  <div id="graph"></div>
  <div id="sidebar">
    <div class="section">
      <h2>Mesh Status</h2>
      <div id="mesh-stats"></div>
    </div>
    <div class="section">
      <h2>Lifeforms</h2>
      <div id="lifeform-list"></div>
    </div>
    <div class="section">
      <h2>Pheromones</h2>
      <div id="pheromone-list"></div>
    </div>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script>
const COLORS = {
  device: '#7b8fff', deviceLocal: '#4a9', connection: '#2a3550',
  lifeform: '#4a9', synapse: '#5a4fcf', causeFlow: '#d9a03c',
  text: '#8b95a5', bg: '#0d1117',
};

let currentSnapshot = null;
let simulation = null;
let svg, g, width, height;

// ─── SSE Connection ───
function connectSSE() {
  const es = new EventSource('/events');
  es.onopen = () => { document.getElementById('conn-status').textContent = 'Live'; };
  es.onmessage = (e) => {
    try {
      currentSnapshot = JSON.parse(e.data);
      updateVisualization(currentSnapshot);
      updateSidebar(currentSnapshot);
      updateHeader(currentSnapshot);
    } catch {}
  };
  es.onerror = () => {
    document.getElementById('conn-status').textContent = 'Reconnecting...';
    setTimeout(() => { es.close(); connectSSE(); }, 3000);
  };
}

// ─── Graph Setup ───
function initGraph() {
  const container = document.getElementById('graph');
  width = container.clientWidth;
  height = container.clientHeight;

  svg = d3.select('#graph').append('svg').attr('viewBox', [0, 0, width, height]);

  // Arrowhead marker
  svg.append('defs').append('marker')
    .attr('id', 'arrowhead').attr('viewBox', '0 0 10 10')
    .attr('refX', 20).attr('refY', 5)
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path').attr('d', 'M0,0 L10,5 L0,10 Z').attr('fill', COLORS.synapse);

  g = svg.append('g');

  // Zoom
  svg.call(d3.zoom().scaleExtent([0.3, 3]).on('zoom', (e) => {
    g.attr('transform', e.transform);
  }));

  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(120))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide(50));
}

// ─── Update Visualization ───
function updateVisualization(snap) {
  if (!snap) return;

  // Build nodes: devices + lifeforms
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  // Device nodes
  for (const d of snap.devices) {
    const node = { id: d.deviceId, type: 'device', label: d.deviceId.slice(0, 8), data: d, r: 24 };
    nodes.push(node);
    nodeMap.set(d.deviceId, node);
  }

  // Lifeform nodes
  for (const lf of snap.lifeforms) {
    const node = { id: 'lf:' + lf.name, type: 'lifeform', label: lf.name, data: lf, r: 14 };
    nodes.push(node);
    nodeMap.set('lf:' + lf.name, node);
    // Link lifeform to host device
    links.push({ source: 'lf:' + lf.name, target: lf.hostDevice, type: 'host' });
  }

  // Device connections
  for (const c of snap.connections) {
    links.push({ source: c.fromDevice, target: c.toDevice, type: 'connection', data: c });
  }

  // Synapses
  for (const s of snap.synapses) {
    const srcId = 'lf:' + s.from;
    const tgtId = 'lf:' + s.to;
    if (nodeMap.has(srcId) && nodeMap.has(tgtId)) {
      links.push({ source: srcId, target: tgtId, type: 'synapse', data: s });
    }
  }

  // Update D3
  // Links
  const link = g.selectAll('.link').data(links, d => d.source.id + '-' + d.target.id + '-' + d.type);
  link.exit().remove();
  const linkEnter = link.enter().append('line').attr('class', 'link');
  const linkMerged = linkEnter.merge(link);
  linkMerged
    .attr('stroke', d => d.type === 'synapse' ? COLORS.synapse : d.type === 'host' ? '#1e2533' : COLORS.connection)
    .attr('stroke-width', d => d.type === 'synapse' ? (d.data?.strength ?? 0.5) * 3 : d.type === 'host' ? 1 : 2)
    .attr('stroke-dasharray', d => d.type === 'host' ? '3,3' : null)
    .attr('marker-end', d => d.type === 'synapse' ? 'url(#arrowhead)' : null)
    .attr('stroke-opacity', d => d.type === 'host' ? 0.3 : 0.7);

  // Nodes
  const node = g.selectAll('.node').data(nodes, d => d.id);
  node.exit().remove();
  const nodeEnter = node.enter().append('g').attr('class', 'node').call(
    d3.drag().on('start', dragStart).on('drag', dragged).on('end', dragEnd)
  );

  nodeEnter.append('circle');
  nodeEnter.append('text').attr('text-anchor', 'middle').attr('dy', d => d.type === 'device' ? 38 : 24);

  const nodeMerged = nodeEnter.merge(node);
  nodeMerged.select('circle')
    .attr('r', d => d.r)
    .attr('fill', d => {
      if (d.type === 'device') return d.data.isLocal ? COLORS.deviceLocal : COLORS.device;
      const s = d.data.state;
      if (s === 'ALIVE') return COLORS.lifeform;
      if (s === 'HIBERNATING') return '#d9a03c';
      if (s === 'FUSED') return '#7b8fff';
      return '#555';
    })
    .attr('stroke', d => d.type === 'device' ? '#fff2' : 'none')
    .attr('stroke-width', 1.5)
    .attr('opacity', d => d.type === 'lifeform' && d.data.state === 'HIBERNATING' ? 0.5 : 0.9);

  nodeMerged.select('text')
    .text(d => d.label.length > 12 ? d.label.slice(0, 12) : d.label)
    .attr('fill', COLORS.text)
    .attr('font-size', d => d.type === 'device' ? '10px' : '9px');

  // Update simulation
  simulation.nodes(nodes);
  simulation.force('link').links(links);
  simulation.alpha(0.3).restart();

  simulation.on('tick', () => {
    linkMerged.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    nodeMerged.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
  });
}

function dragStart(e, d) { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
function dragged(e, d) { d.fx = e.x; d.fy = e.y; }
function dragEnd(e, d) { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }

// ─── Sidebar ───
function updateSidebar(snap) {
  // Mesh stats
  const s = snap.stats;
  document.getElementById('mesh-stats').innerHTML =
    statRow('Behavior', s.meshBehavior, s.meshBehavior === 'DEFENSIVE' ? 'red' : s.meshBehavior === 'HIGH_DEMAND' ? 'amber' : 'green') +
    statRow('Dream State', s.dreamState) +
    statRow('GPU Devices', s.gpuDevices) +
    statRow('Memory Pool', formatBytes(s.memoryPoolUsed) + ' / ' + formatBytes(s.memoryPoolBytes)) +
    statRow('Neural Conns', s.neuromorphicConnections + ' (avg ' + s.neuromorphicAvgWeight.toFixed(2) + ')') +
    statRow('Protocol Gen', '#' + s.protocolGeneration);

  // Lifeforms
  let lfHtml = '';
  for (const lf of snap.lifeforms) {
    const stateClass = lf.state.toLowerCase();
    lfHtml += '<div class="card"><div class="name"><span class="lf-state ' + stateClass + '"></span>' + lf.name + '</div>' +
      '<div class="meta">' +
      '<span>CCU <span class="val">' + lf.ccuBalance.toFixed(1) + '</span></span>' +
      '<span>Causes <span class="val">' + lf.causesProcessed + '</span></span>' +
      '<span>Gen <span class="val">' + lf.generation + '</span></span>' +
      (lf.entangledWith.length > 0 ? '<span>Entangled <span class="val">' + lf.entangledWith.join(', ') + '</span></span>' : '') +
      '</div></div>';
  }
  document.getElementById('lifeform-list').innerHTML = lfHtml;

  // Pheromones
  let phHtml = '';
  const phColors = { compute_success: '#4a9', danger: '#e55', idle: '#6b7280', resource_request: '#d9a03c' };
  for (const [name, value] of Object.entries(s.pheromones)) {
    const pct = Math.min(100, value * 50);
    phHtml += '<div class="stat-row"><span class="label">' + name + '</span><span class="value">' + value.toFixed(2) + '</span></div>' +
      '<div class="pheromone-bar" style="width:' + pct + '%;background:' + (phColors[name] || '#7b8fff') + '"></div>';
  }
  document.getElementById('pheromone-list').innerHTML = phHtml;
}

function updateHeader(snap) {
  document.getElementById('stat-devices').textContent = snap.stats.totalDevices;
  document.getElementById('stat-lifeforms').textContent = snap.stats.totalLifeforms;
  document.getElementById('stat-cps').textContent = snap.stats.causesPerSec;
  document.getElementById('stat-ccu').textContent = snap.stats.ccuFlowPerSec.toFixed(1);
}

function statRow(label, value, color) {
  return '<div class="stat-row"><span class="label">' + label + '</span><span class="value' + (color ? ' ' + color : '') + '">' + value + '</span></div>';
}

function formatBytes(b) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + 'GB';
  if (b > 1e6) return (b / 1e6).toFixed(1) + 'MB';
  if (b > 1e3) return (b / 1e3).toFixed(1) + 'KB';
  return b + 'B';
}

// ─── Init ───
window.addEventListener('load', () => {
  initGraph();
  connectSSE();
});
window.addEventListener('resize', () => {
  const c = document.getElementById('graph');
  width = c.clientWidth; height = c.clientHeight;
  svg.attr('viewBox', [0, 0, width, height]);
  simulation.force('center', d3.forceCenter(width / 2, height / 2));
});
</script>
</body>
</html>`;
