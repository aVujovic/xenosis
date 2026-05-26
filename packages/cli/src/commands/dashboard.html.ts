/**
 * The dashboard single-page UI, inlined as a string so it bundles into the CLI
 * with no extra files to publish. Zero front-end dependencies: hand-rolled SVG
 * graph + an EventSource feed (/api/stream) for live status + logs.
 *
 * Endpoints it talks to (served by dashboard.ts):
 *   GET /api/state          → { graph, services:[{name,port,status}] }
 *   GET /api/logs/:name     → { logs:[{line,stream,ts}] }   (backfill)
 *   GET /api/stream (SSE)   → events: snapshot | status | log
 */
export const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>xenosis dev</title>
<style>
  :root {
    --bg: #0b0d14; --panel: #11131b; --border: #232734; --text: #e6e9f0;
    --soft: #8b93a7; --brand: #818cf8; --up: #34d399; --down: #6b7280;
    --warn: #fbbf24; --err: #f87171;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: var(--bg); color: var(--text); display: flex; height: 100vh;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  header {
    position: absolute; top: 0; left: 0; right: 0; height: 48px; display: flex;
    align-items: center; gap: 12px; padding: 0 18px; z-index: 5;
    border-bottom: 1px solid var(--border); background: rgba(11,13,20,.7);
    backdrop-filter: blur(8px);
  }
  header .logo { font-weight: 700; letter-spacing: .5px; }
  header .logo b { color: var(--brand); }
  header .legend { display: flex; gap: 16px; margin-left: auto; color: var(--soft); font-size: 12px; }
  header .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  #graph { flex: 1; position: relative; padding-top: 48px; overflow: hidden; }
  svg { width: 100%; height: 100%; display: block; }
  .node rect { rx: 10; stroke-width: 1.5; cursor: pointer; }
  .node text { fill: var(--text); font-size: 13px; font-weight: 600; pointer-events: none; }
  .node .sub { fill: var(--soft); font-size: 10px; font-weight: 400; }
  .edge { stroke: #3a4055; stroke-width: 1.6; fill: none; marker-end: url(#arrow); }
  .edge.violation { stroke: var(--err); stroke-dasharray: 5 4; marker-end: url(#arrow-err); }
  aside {
    width: 0; transition: width .18s ease; overflow: hidden; flex-shrink: 0;
    border-left: 1px solid var(--border); background: var(--panel);
    display: flex; flex-direction: column;
  }
  aside.open { width: 460px; }
  .panel-head { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
  .panel-head .dot { width: 10px; height: 10px; border-radius: 50%; }
  .panel-head h2 { margin: 0; font-size: 15px; }
  .panel-head .meta { color: var(--soft); font-size: 12px; margin-left: auto; }
  .panel-head .close { cursor: pointer; color: var(--soft); border: none; background: none; font-size: 18px; }
  .logs { flex: 1; overflow-y: auto; padding: 8px 0; font: 12px/1.5 'JetBrains Mono', ui-monospace, monospace; }
  .logs .ln { padding: 1px 16px; white-space: pre-wrap; word-break: break-word; }
  .logs .ln.err { color: var(--err); }
  .logs .empty { color: var(--soft); padding: 16px; }
  .status-up { background: var(--up); } .status-down { background: var(--down); } .status-starting { background: var(--warn); }
</style>
</head>
<body>
<header>
  <span class="logo"><b>xenosis</b> dev</span>
  <span class="legend">
    <span><i class="status-up"></i>up</span>
    <span><i class="status-starting"></i>starting</span>
    <span><i class="status-down"></i>down</span>
    <span><i style="background:var(--err)"></i>boundary violation</span>
  </span>
</header>
<div id="graph"><svg id="svg"></svg></div>
<aside id="panel">
  <div class="panel-head">
    <span class="dot" id="p-dot"></span>
    <h2 id="p-name"></h2>
    <span class="meta" id="p-meta"></span>
    <button class="close" id="p-close">×</button>
  </div>
  <div class="logs" id="p-logs"></div>
</aside>

<script>
const svg = document.getElementById('svg');
const panel = document.getElementById('panel');
let model = null;          // { graph, services }
let selected = null;       // node name
const status = new Map();  // name -> status

const COLOR = { up: 'var(--up)', down: 'var(--down)', starting: 'var(--warn)' };
const FILL  = { up: '#13241d', down: '#16181f', starting: '#241f12' };

function layout(names) {
  // Simple circular layout — readable for the handful of services in a mesh.
  const w = svg.clientWidth, h = svg.clientHeight;
  const cx = w / 2, cy = h / 2 + 10;
  const r = Math.min(w, h) * 0.34;
  const pos = new Map();
  if (names.length === 1) { pos.set(names[0], { x: cx, y: cy }); return pos; }
  names.forEach((n, i) => {
    const a = (i / names.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(n, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  });
  return pos;
}

function viable(g, from, to) {
  const callee = g.services.find(s => s.name === to);
  if (!callee) return true; // external peer, can't lint
  const ac = callee.allowedCallers;
  if (!ac || ac.length === 0) return true;
  return ac.includes(from);
}

function render() {
  if (!model) return;
  const g = model.graph;
  const names = g.services.map(s => s.name);
  const pos = layout(names);
  const NW = 150, NH = 50;
  let edges = '', nodes = '';

  for (const s of g.services) {
    for (const target of s.calls) {
      const a = pos.get(s.name), b = pos.get(target);
      if (!a || !b) continue; // call to a service not in this workspace
      const ok = viable(g, s.name, target);
      // Trim the line to node edges so the arrowhead sits at the box border.
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const x1 = a.x + ux * (NW / 2 * 0.8), y1 = a.y + uy * (NH / 2 + 4);
      const x2 = b.x - ux * (NW / 2 * 0.92), y2 = b.y - uy * (NH / 2 + 12);
      edges += '<path class="edge' + (ok ? '' : ' violation') +
        '" d="M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2 + '"/>';
    }
  }

  for (const s of g.services) {
    const p = pos.get(s.name); if (!p) continue;
    const st = status.get(s.name) || 'starting';
    const sel = selected === s.name;
    const x = p.x - NW / 2, y = p.y - NH / 2;
    nodes += '<g class="node" data-name="' + s.name + '" transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + NW + '" height="' + NH + '" rx="10" fill="' + FILL[st] +
        '" stroke="' + (sel ? 'var(--brand)' : COLOR[st]) + '" stroke-width="' + (sel ? 2.5 : 1.5) + '"/>' +
      '<circle cx="16" cy="' + (NH / 2) + '" r="5" fill="' + COLOR[st] + '"/>' +
      '<text x="30" y="' + (NH / 2 - 3) + '">' + s.name + '</text>' +
      '<text class="sub" x="30" y="' + (NH / 2 + 12) + '">' + st + '</text>' +
      '</g>';
  }

  svg.innerHTML =
    '<defs>' +
    '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3a4055"/></marker>' +
    '<marker id="arrow-err" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--err)"/></marker>' +
    '</defs>' + edges + nodes;

  svg.querySelectorAll('.node').forEach(n =>
    n.addEventListener('click', () => select(n.dataset.name)));
}

function setStatus(name, st) {
  status.set(name, st);
  render();
  if (selected === name) refreshPanelHead();
}

function refreshPanelHead() {
  const s = model.services.find(x => x.name === selected);
  const st = status.get(selected) || 'starting';
  document.getElementById('p-name').textContent = selected;
  document.getElementById('p-dot').style.background = COLOR[st];
  document.getElementById('p-meta').textContent =
    (s && s.port ? ':' + s.port + ' · ' : '') + st;
}

const logs = document.getElementById('p-logs');
function appendLog(line, stream) {
  const atBottom = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 40;
  const div = document.createElement('div');
  div.className = 'ln' + (stream === 'err' ? ' err' : '');
  div.textContent = line;
  logs.appendChild(div);
  if (atBottom) logs.scrollTop = logs.scrollHeight;
}

async function select(name) {
  selected = name;
  panel.classList.add('open');
  refreshPanelHead();
  logs.innerHTML = '<div class="empty">loading…</div>';
  render();
  const r = await fetch('/api/logs/' + encodeURIComponent(name));
  const { logs: backfill } = await r.json();
  logs.innerHTML = '';
  if (!backfill.length) logs.innerHTML = '<div class="empty">no output yet</div>';
  for (const l of backfill) appendLog(l.line, l.stream);
  logs.scrollTop = logs.scrollHeight;
}

document.getElementById('p-close').addEventListener('click', () => {
  selected = null; panel.classList.remove('open'); render();
});

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', e => {
    model = JSON.parse(e.data);
    for (const s of model.services) status.set(s.name, s.status);
    render();
  });
  es.addEventListener('status', e => {
    const { name, status: st } = JSON.parse(e.data);
    setStatus(name, st);
  });
  es.addEventListener('log', e => {
    const d = JSON.parse(e.data);
    if (d.name === selected) {
      // Clear the "no output yet" placeholder on first line.
      const empty = logs.querySelector('.empty');
      if (empty) empty.remove();
      appendLog(d.line, d.stream);
    }
  });
  es.onerror = () => {/* EventSource auto-reconnects */};
}

window.addEventListener('resize', render);
connect();
</script>
</body>
</html>`;
