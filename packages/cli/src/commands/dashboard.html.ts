/**
 * The dashboard single-page UI, inlined as a string so it bundles into the CLI
 * with no extra files to publish. Zero front-end dependencies.
 *
 * Layout: a responsive grid of service cards. Click a card to expand it in
 * place and reveal:
 *   • Calls       — peers this service declares (with violation badges if any)
 *   • Called by   — services that declare it as a peer
 *   • Show logs   — opens a side panel streaming this service's stdout/stderr
 *
 * Health is refreshed only on user action (Refresh button in the header) — see
 * dashboard.ts for the rationale (no background polling = quiet `xenosis dev`
 * logs).
 *
 * Endpoints it talks to (served by dashboard.ts):
 *   GET  /api/state         → { graph, services:[{name,port,status}] }
 *   GET  /api/logs/:name    → { logs:[{line,stream,ts}] }   (backfill)
 *   POST /api/refresh       → re-run health checks; status changes broadcast via SSE
 *   GET  /api/stream (SSE)  → events: snapshot | status | log
 */
export const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>xenosis dev</title>
<style>
  :root {
    --bg: #0b0d14; --panel: #11131b; --panel-2: #161823; --border: #232734;
    --border-strong: #2f3447; --text: #e6e9f0; --soft: #8b93a7; --mute: #5a6175;
    --brand: #818cf8; --brand-soft: #4f56a0;
    --up: #34d399; --down: #6b7280; --warn: #fbbf24; --err: #f87171;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: var(--bg); color: var(--text); display: flex; height: 100vh;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  header {
    position: fixed; top: 0; left: 0; right: 0; height: 48px; display: flex;
    align-items: center; gap: 12px; padding: 0 18px; z-index: 5;
    border-bottom: 1px solid var(--border); background: rgba(11,13,20,.72);
    backdrop-filter: blur(8px);
  }
  header .logo { font-weight: 700; letter-spacing: .5px; }
  header .logo b { color: var(--brand); }
  header .legend { display: flex; gap: 16px; margin-left: auto; color: var(--soft); font-size: 12px; }
  header .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  header .refresh {
    margin-left: 16px;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 11px;
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 7px;
    font: inherit; font-size: 12px; cursor: pointer;
    transition: background .12s, border-color .12s, color .12s;
  }
  header .refresh:hover { background: color-mix(in srgb, var(--brand) 14%, var(--panel)); border-color: var(--brand); }
  header .refresh:disabled { cursor: progress; opacity: .7; }
  header .refresh.busy .r-icon { animation: r-spin .8s linear infinite; }
  @keyframes r-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

  main {
    flex: 1; min-width: 0; overflow-y: auto;
    padding: 64px 24px 32px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
    max-width: 1400px; margin: 0 auto;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--border); border-radius: 12px;
    padding: 14px 16px;
    cursor: pointer;
    transition: border-color .14s, background .14s, transform .12s;
  }
  .card:hover { border-color: var(--border-strong); background: var(--panel-2); }
  .card.open {
    grid-column: 1 / -1;
    cursor: default;
    border-color: var(--brand);
    background: var(--panel-2);
  }
  .card-head {
    display: flex; align-items: center; gap: 10px;
  }
  .card .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .card .name { font-weight: 600; font-size: 14px; }
  .card .port { color: var(--mute); font-size: 12px; font-family: 'JetBrains Mono', ui-monospace, monospace; margin-left: auto; }
  .card .status-text { color: var(--soft); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin-top: 3px; }

  /* Expanded body */
  .card .body { display: none; margin-top: 14px; }
  .card.open .body { display: block; }
  .card .actions { display: flex; gap: 8px; margin-top: 14px; }
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 11px;
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 7px;
    font: inherit; font-size: 12px; cursor: pointer;
    transition: background .12s, border-color .12s;
  }
  .btn:hover { background: color-mix(in srgb, var(--brand) 14%, var(--panel)); border-color: var(--brand); }
  .btn.secondary { background: transparent; }

  .sec { margin-top: 12px; }
  .sec-h {
    font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--soft); margin-bottom: 6px;
  }
  .pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border); border-radius: 999px;
    background: var(--bg); color: var(--text);
    font-size: 12px;
    cursor: pointer;
    transition: border-color .12s, background .12s;
  }
  .pill:hover { border-color: var(--brand); }
  .pill i { width: 7px; height: 7px; border-radius: 50%; }
  .pill.unknown { color: var(--mute); }
  .pill .vio { color: var(--err); font-size: 11px; font-weight: 600; margin-left: 2px; }
  .empty-line { color: var(--mute); font-size: 12px; font-style: italic; }

  /* Side panel for logs — unchanged behaviour, simpler chrome */
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

  .status-up { background: var(--up); }
  .status-down { background: var(--down); }
  .status-starting { background: var(--warn); }
</style>
</head>
<body>
<header>
  <span class="logo"><b>xenosis</b> dev</span>
  <span class="legend">
    <span><i class="status-up"></i>up</span>
    <span><i class="status-starting"></i>starting</span>
    <span><i class="status-down"></i>down</span>
  </span>
  <button id="refresh" class="refresh" title="Re-run health checks against every service">
    <svg class="r-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
    <span class="r-label">Refresh</span>
  </button>
</header>
<main>
  <div id="grid" class="grid"></div>
</main>
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
const grid = document.getElementById('grid');
const panel = document.getElementById('panel');
const logsEl = document.getElementById('p-logs');

let model = null;          // { graph, services }
const status = new Map();  // peerName -> status
const inboundMap = new Map(); // peerName -> [callers...]  derived once per snapshot
let openCard = null;       // peerName of currently expanded card
let logsTarget = null;     // peerName whose logs are streamed to the side panel

const COLOR = { up: 'var(--up)', down: 'var(--down)', starting: 'var(--warn)' };

function buildInbound() {
  // Reverse-edge index — who calls whom. Derived from graph.services[].calls.
  inboundMap.clear();
  if (!model) return;
  for (const s of model.graph.services) {
    for (const target of s.calls) {
      if (!inboundMap.has(target)) inboundMap.set(target, []);
      inboundMap.get(target).push(s.name);
    }
  }
}

function callerAllowed(calleeName, callerName) {
  const callee = model.graph.services.find(x => x.name === calleeName);
  if (!callee) return true; // external peer — can't lint
  const ac = callee.allowedCallers;
  if (!ac || ac.length === 0) return true;
  return ac.includes(callerName);
}

function statusText(st) { return st || 'starting'; }

function render() {
  if (!model) return;
  grid.innerHTML = '';
  for (const svc of model.services) {
    const isOpen = openCard === svc.name;
    const st = status.get(svc.name) || 'starting';
    const card = document.createElement('div');
    card.className = 'card' + (isOpen ? ' open' : '');
    card.dataset.name = svc.name;
    card.innerHTML = renderCard(svc, st, isOpen);
    card.addEventListener('click', e => {
      // Clicks inside an open card are handled by their own listeners.
      if (isOpen && e.target.closest('.body')) return;
      toggleOpen(svc.name);
    });
    grid.appendChild(card);
  }

  // Wire up actions in the open card.
  if (openCard) {
    const open = grid.querySelector('.card.open');
    if (open) {
      const showBtn = open.querySelector('[data-act="show-logs"]');
      if (showBtn) showBtn.addEventListener('click', () => selectLogs(openCard));
      open.querySelectorAll('[data-jump]').forEach(el =>
        el.addEventListener('click', () => toggleOpen(el.dataset.jump, true)),
      );
    }
  }
}

function renderCard(svc, st, isOpen) {
  const calls = (model.graph.services.find(x => x.name === svc.name) || {}).calls || [];
  const inbound = inboundMap.get(svc.name) || [];
  const portStr = svc.port != null ? ':' + svc.port : '';
  const head =
    '<div class="card-head">' +
      '<span class="dot status-' + st + '"></span>' +
      '<span class="name">' + svc.name + '</span>' +
      '<span class="port">' + portStr + '</span>' +
    '</div>' +
    '<div class="status-text">' + statusText(st) + '</div>';

  if (!isOpen) return head;

  return head +
    '<div class="body">' +
      renderSection('Calls', calls.map(target => peerPill(svc.name, target, 'out'))) +
      renderSection('Called by', inbound.map(caller => peerPill(svc.name, caller, 'in'))) +
      '<div class="actions">' +
        '<button class="btn" data-act="show-logs">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>' +
          'Show logs' +
        '</button>' +
      '</div>' +
    '</div>';
}

function renderSection(title, items) {
  const inner = items.length
    ? '<div class="pills">' + items.join('') + '</div>'
    : '<div class="empty-line">— none —</div>';
  return '<div class="sec"><div class="sec-h">' + title + '</div>' + inner + '</div>';
}

function peerPill(currentName, otherName, direction) {
  // direction: 'out' = currentName calls otherName; 'in' = otherName calls currentName.
  // Violation rules:
  //   out → currentName needs to be in otherName.allowedCallers
  //   in  → otherName needs to be in currentName.allowedCallers
  const callee = direction === 'out' ? otherName : currentName;
  const caller = direction === 'out' ? currentName : otherName;
  const allowed = callerAllowed(callee, caller);
  const otherStatus = status.get(otherName) || 'starting';
  const known = model.services.find(s => s.name === otherName);
  const dotClass = known ? 'status-' + otherStatus : 'unknown';
  const jump = known ? ' data-jump="' + otherName + '"' : '';
  const cls = 'pill' + (known ? '' : ' unknown');
  return '<span class="' + cls + '"' + jump + '>' +
    (known ? '<i class="' + dotClass + '"></i>' : '') +
    otherName +
    (allowed ? '' : '<span class="vio" title="boundary violation: ' + caller + ' is not in ' + callee + '.allowedCallers">✗ violation</span>') +
    '</span>';
}

function toggleOpen(name, forceOpen) {
  openCard = openCard === name && !forceOpen ? null : name;
  render();
  if (openCard) {
    // Bring the open card into view (it spans the full row at the bottom of layout).
    requestAnimationFrame(() => {
      const el = grid.querySelector('.card.open');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

function setStatus(name, st) {
  status.set(name, st);
  render();
  if (logsTarget === name) refreshPanelHead();
}

function refreshPanelHead() {
  const s = model.services.find(x => x.name === logsTarget);
  const st = status.get(logsTarget) || 'starting';
  document.getElementById('p-name').textContent = logsTarget;
  document.getElementById('p-dot').style.background = COLOR[st];
  document.getElementById('p-meta').textContent =
    (s && s.port ? ':' + s.port + ' · ' : '') + st;
}

function appendLog(line, stream) {
  const atBottom = logsEl.scrollHeight - logsEl.scrollTop - logsEl.clientHeight < 40;
  const div = document.createElement('div');
  div.className = 'ln' + (stream === 'err' ? ' err' : '');
  div.textContent = line;
  logsEl.appendChild(div);
  if (atBottom) logsEl.scrollTop = logsEl.scrollHeight;
}

async function selectLogs(name) {
  logsTarget = name;
  panel.classList.add('open');
  refreshPanelHead();
  logsEl.innerHTML = '<div class="empty">loading…</div>';
  const r = await fetch('/api/logs/' + encodeURIComponent(name));
  const { logs: backfill } = await r.json();
  logsEl.innerHTML = '';
  if (!backfill.length) logsEl.innerHTML = '<div class="empty">no output yet</div>';
  for (const l of backfill) appendLog(l.line, l.stream);
  logsEl.scrollTop = logsEl.scrollHeight;
}

document.getElementById('p-close').addEventListener('click', () => {
  logsTarget = null; panel.classList.remove('open');
});

const refreshBtn = document.getElementById('refresh');
refreshBtn.addEventListener('click', async () => {
  if (refreshBtn.disabled) return;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('busy');
  try {
    await fetch('/api/refresh', { method: 'POST' });
  } catch {
    /* server gone — SSE will reconnect */
  } finally {
    refreshBtn.classList.remove('busy');
    refreshBtn.disabled = false;
  }
});

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', e => {
    model = JSON.parse(e.data);
    for (const s of model.services) status.set(s.name, s.status);
    buildInbound();
    render();
  });
  es.addEventListener('status', e => {
    const { name, status: st } = JSON.parse(e.data);
    setStatus(name, st);
  });
  es.addEventListener('log', e => {
    const d = JSON.parse(e.data);
    if (d.name === logsTarget) {
      const empty = logsEl.querySelector('.empty');
      if (empty) empty.remove();
      appendLog(d.line, d.stream);
    }
  });
  es.onerror = () => {/* EventSource auto-reconnects */};
}

connect();
</script>
</body>
</html>`;
