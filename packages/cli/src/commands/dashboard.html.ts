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
 * Two views toggled in the header:
 *   • Cards (default)  — the grid above; quick at-a-glance per-service status.
 *   • Graph            — heat-mapped peer mesh: edge width = call volume,
 *                         edge color = p95 latency, pulse = breaker / retry burst.
 *
 * Endpoints it talks to (served by dashboard.ts):
 *   GET  /api/state         → { graph, services:[{name,port,status}], edges:[…] }
 *   GET  /api/logs/:name    → { logs:[{line,stream,ts}] }   (backfill)
 *   POST /api/refresh       → re-run health checks; status changes broadcast via SSE
 *   GET  /api/stream (SSE)  → events: snapshot | status | log | edges
 */
export const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>xenosis dev</title>
<style>
  :root {
    --bg: #07080d; --panel: #0d0f17; --panel-2: #11131e; --border: #232739;
    --border-strong: #2d3247; --text: #e6e8f0; --soft: #a4a8c1; --mute: #6b7095;
    --brand: #818cf8; --brand-soft: #4f56a0; --brand-cyan: #06b6d4;
    --up: #34d399; --down: #6b7280; --warn: #fbbf24; --err: #f87171;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: var(--bg); color: var(--text); display: flex; height: 100vh;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  header {
    position: fixed; top: 0; left: 0; right: 0; height: 56px; display: flex;
    align-items: center; padding: 0 22px; z-index: 5;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  /* Brand — sigil + wordmark + env tag, matches xenosis.org header. */
  .hdr-brand {
    display: inline-flex; align-items: center; gap: 10px;
    color: var(--text); font-weight: 600; font-size: 15px;
    letter-spacing: -0.01em;
    text-decoration: none;
    margin-right: 28px;
  }
  .hdr-brand .brand-mark {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 7px;
    background: linear-gradient(135deg, var(--brand), var(--brand-cyan));
    color: white; font-weight: 700; font-size: 13px;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--brand) 35%, transparent);
  }
  .hdr-brand .brand-text { color: var(--text); }
  .hdr-brand .brand-sub {
    color: var(--soft); font-weight: 500;
    padding-left: 10px; margin-left: 2px;
    border-left: 1px solid var(--border);
    font-size: 13px;
  }

  /* Nav — link-style tabs, underline on active, matches site nav. */
  .hdr-nav {
    display: flex; align-items: center; gap: 26px;
    height: 100%;
  }
  .hdr-nav a {
    position: relative;
    display: inline-flex; align-items: center;
    height: 100%;
    padding: 0 2px;
    color: var(--soft);
    font-size: 13.5px; font-weight: 500;
    text-decoration: none;
    letter-spacing: -0.005em;
    transition: color .15s ease;
  }
  .hdr-nav a:hover { color: var(--text); }
  .hdr-nav a.active { color: var(--text); }
  .hdr-nav a.active::after {
    content: '';
    position: absolute; left: 0; right: 0; bottom: -1px;
    height: 2px;
    background: linear-gradient(90deg, var(--brand), var(--brand-cyan));
    border-radius: 2px 2px 0 0;
  }

  .hdr-spacer { flex: 1; }

  /* Right side: legend + refresh. */
  .hdr-right { display: flex; align-items: center; gap: 18px; }
  .hdr-legend { display: flex; gap: 14px; color: var(--soft); font-size: 11.5px; }
  .hdr-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }

  .hdr-refresh {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 6px 12px;
    background: transparent; color: var(--soft);
    border: 1px solid var(--border-strong); border-radius: 8px;
    font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
    transition: color .15s, border-color .15s, background .15s;
  }
  .hdr-refresh:hover {
    color: var(--text);
    border-color: var(--brand);
    background: color-mix(in srgb, var(--brand) 8%, transparent);
  }
  .hdr-refresh:disabled { cursor: progress; opacity: .6; }
  .hdr-refresh.busy .r-icon { animation: r-spin .8s linear infinite; }
  @keyframes r-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

  main {
    flex: 1; min-width: 0; overflow-y: auto;
    padding: 72px 24px 32px;
    transition: padding-right .18s ease;
  }
  /* Cards view: make room for the fixed log panel so cards don't slide under it. */
  body.panel-open.view-cards main { padding-right: 484px; /* 460 panel + 24 gutter */ }

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

  /* Side panel for logs — fixed on the right edge so it sits ABOVE both the
     fixed Graph view and the flex-laid-out Cards view. Stacking is explicit:
     z-index 10 keeps the close button reachable above #graph-view (z-implicit 0).
     Starts below the fixed header (top: 56px). */
  aside {
    position: fixed; top: 56px; right: 0; bottom: 0;
    width: 0; transition: width .18s ease;
    overflow: hidden; z-index: 10;
    border-left: 1px solid var(--border); background: var(--panel);
    display: flex; flex-direction: column;
  }
  aside.open { width: 460px; }
  .panel-head { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
  .panel-head .dot { width: 10px; height: 10px; border-radius: 50%; }
  .panel-head h2 { margin: 0; font-size: 15px; }
  .panel-head .meta { color: var(--soft); font-size: 12px; margin-left: auto; }
  .panel-head .close {
    cursor: pointer; color: var(--soft);
    border: 1px solid var(--border); background: transparent;
    width: 26px; height: 26px; border-radius: 6px;
    font-size: 16px; line-height: 1; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    transition: color .12s, border-color .12s, background .12s;
  }
  .panel-head .close:hover { color: var(--text); border-color: var(--brand); background: color-mix(in srgb, var(--brand) 14%, transparent); }
  .panel-head .close::after { content: ''; }
  .panel-head .close kbd {
    display: none; margin-left: 6px; font: inherit; font-size: 10px;
    color: var(--mute); background: var(--bg); border: 1px solid var(--border);
    border-radius: 3px; padding: 0 4px;
  }
  .logs { flex: 1; overflow-y: auto; padding: 8px 0; font: 12px/1.5 'JetBrains Mono', ui-monospace, monospace; }
  .logs .ln { padding: 1px 16px; white-space: pre-wrap; word-break: break-word; }
  .logs .ln.err { color: var(--err); }
  .logs .empty { color: var(--soft); padding: 16px; }

  .status-up { background: var(--up); }
  .status-down { background: var(--down); }
  .status-starting { background: var(--warn); }

  /* Legacy .view-toggle removed — nav lives in .hdr-nav now. */

  /* Graph view (shown when body has .view-graph) */
  body.view-graph main { display: none; }
  body.view-cards #graph-view, body.view-traces #graph-view, body.view-events #graph-view, body.view-explore #graph-view { display: none; }
  body.view-events main, body.view-explore main { display: none; }
  #graph-view {
    position: fixed; top: 56px; left: 0; right: 0; bottom: 0;
    padding: 24px;
    transition: right .18s ease;
  }
  /* When the log side-panel opens, shrink the graph viewport so the panel
     stays clickable. The aside itself is in normal flow on the right edge,
     but #graph-view is fixed and would otherwise cover it. */
  body.panel-open #graph-view { right: 460px; }
  #graph-svg { width: 100%; height: 100%; display: block; }

  .g-node rect { rx: 11; stroke-width: 1.5; cursor: pointer; }
  .g-node text { fill: var(--text); font-size: 13px; font-weight: 600; pointer-events: none; }
  .g-node .sub { fill: var(--soft); font-size: 10px; font-weight: 400; }
  .g-node.pulse rect { animation: g-pulse 1.4s ease-in-out infinite; }
  @keyframes g-pulse {
    0%, 100% { stroke-opacity: 1; }
    50% { stroke-opacity: .35; }
  }

  .g-edge {
    fill: none;
    stroke-linecap: round;
    transition: stroke-width .3s, stroke .3s;
  }
  .g-edge.violation { stroke-dasharray: 5 4; }
  .g-edge.retry { animation: g-dash 1s linear infinite; stroke-dasharray: 8 6; }
  @keyframes g-dash { to { stroke-dashoffset: -14; } }

  /* Heat scale legend — bottom-right so it doesn't compete with the side log
     panel when both are open. */
  #heat-legend {
    position: absolute; bottom: 18px; right: 24px;
    display: flex; align-items: center; gap: 10px;
    background: rgba(17,19,27,.85); border: 1px solid var(--border); border-radius: 8px;
    padding: 7px 12px; font-size: 11px; color: var(--soft);
    backdrop-filter: blur(8px);
  }
  #heat-legend .scale {
    width: 110px; height: 8px; border-radius: 4px;
    background: linear-gradient(90deg, var(--up) 0%, var(--warn) 50%, var(--err) 100%);
  }
  #heat-legend .hint { color: var(--mute); }

  /* — Traces view (waterfall) — */
  body.view-cards #traces-view, body.view-graph #traces-view, body.view-events #traces-view, body.view-explore #traces-view { display: none; }
  body.view-traces main, body.view-traces #graph-view, body.view-traces #events-view, body.view-traces #explore-view { display: none; }
  body.view-cards #events-view, body.view-graph #events-view, body.view-traces #events-view, body.view-explore #events-view { display: none; }
  body.view-cards #explore-view, body.view-graph #explore-view, body.view-traces #explore-view, body.view-events #explore-view { display: none; }
  body.panel-open #traces-view { right: 460px; }
  #traces-view {
    position: fixed; top: 56px; left: 0; right: 0; bottom: 0;
    display: grid; grid-template-columns: 320px 1fr;
    transition: right .18s ease;
  }
  #traces-list {
    border-right: 1px solid var(--border);
    overflow-y: auto; padding: 12px;
    background: var(--panel);
  }
  #traces-list .empty { color: var(--soft); padding: 16px; font-size: 13px; }
  .trace-item {
    border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; margin-bottom: 8px;
    cursor: pointer; background: var(--bg);
    transition: border-color .12s, background .12s;
  }
  .trace-item:hover { border-color: var(--brand); }
  .trace-item.active { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, transparent); }
  .trace-item .ti-head {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; color: var(--soft); margin-bottom: 4px;
  }
  .trace-item .ti-id { font-family: 'JetBrains Mono', ui-monospace, monospace; }
  .trace-item .ti-entry { font-weight: 600; color: var(--text); font-size: 13px; }
  .trace-item .ti-meta { display: flex; gap: 10px; margin-top: 4px; font-size: 11px; color: var(--mute); }
  .trace-item.failed { border-left: 3px solid var(--err); padding-left: 10px; }

  #traces-detail {
    overflow-y: auto; padding: 18px 22px;
    background: var(--bg);
  }
  #traces-detail .placeholder {
    color: var(--soft); text-align: center; margin-top: 60px;
    font-size: 13px;
  }
  .trace-header {
    display: flex; align-items: flex-end; gap: 18px; margin-bottom: 14px;
  }
  .trace-header h3 { margin: 0; font-size: 15px; }
  .trace-header .id {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    color: var(--soft); font-size: 11px; user-select: all;
  }
  .trace-header .stat {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 8px; border-radius: 4px;
    font-size: 11px; color: var(--soft);
    border: 1px solid var(--border);
  }
  .trace-header .stat.fail { color: var(--err); border-color: color-mix(in srgb, var(--err) 50%, transparent); }
  .trace-header button.copy-tid {
    margin-left: auto; cursor: pointer;
    border: 1px solid var(--border); border-radius: 6px;
    background: transparent; color: var(--soft);
    padding: 4px 9px; font: inherit; font-size: 11px;
  }
  .trace-header button.copy-tid:hover { color: var(--text); border-color: var(--brand); }

  .waterfall {
    border: 1px solid var(--border); border-radius: 10px;
    background: var(--panel);
    padding: 12px 0;
    margin-bottom: 18px;
  }
  .wf-row {
    display: grid; grid-template-columns: 140px 1fr; align-items: center;
    height: 28px; padding: 0 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    cursor: pointer;
    transition: background .12s;
  }
  .wf-row:last-child { border-bottom: 0; }
  .wf-row:hover { background: var(--bg-mute, #11131b); }
  .wf-row.selected { background: color-mix(in srgb, var(--brand) 10%, transparent); }
  .wf-label {
    font-size: 12px; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    padding-right: 10px;
  }
  .wf-label .from { color: var(--soft); }
  .wf-track { position: relative; height: 16px; }
  .wf-bar {
    position: absolute; top: 2px; height: 12px;
    border-radius: 3px;
    min-width: 2px;
    background: var(--up);
  }
  .wf-bar.warn { background: var(--warn); }
  .wf-bar.err  { background: var(--err); }
  .wf-bar.fail { background: repeating-linear-gradient(45deg, var(--err) 0 4px, color-mix(in srgb, var(--err) 60%, var(--bg-mute)) 4px 8px); }
  .wf-bar-label {
    position: absolute; right: -4px; transform: translate(100%, -1px);
    font-size: 10px; color: var(--mute);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    white-space: nowrap;
  }

  .trace-section { margin-top: 14px; }
  .trace-section h4 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--soft); margin: 0 0 8px;
  }
  .trace-body-pre {
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; margin: 0;
    font: 11.5px/1.5 'JetBrains Mono', ui-monospace, monospace;
    overflow-x: auto; max-height: 240px; overflow-y: auto;
    color: var(--text);
    white-space: pre-wrap; word-break: break-word;
  }
  .trace-logs {
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 0; max-height: 280px; overflow-y: auto;
  }
  .trace-logs .ln {
    padding: 1px 14px;
    font: 11.5px/1.5 'JetBrains Mono', ui-monospace, monospace;
    white-space: pre-wrap; word-break: break-word;
  }
  .trace-logs .ln.err { color: var(--err); }
  .trace-logs .ln .svc {
    display: inline-block; min-width: 92px;
    color: var(--brand);
    font-weight: 600;
  }

  /* Time-Travel Replay actions inside the trace call detail */
  .replay-actions {
    display: flex; align-items: center; gap: 8px;
    margin: 10px 0 4px;
    flex-wrap: wrap;
  }
  .replay-actions button {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 11px;
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    font: inherit; font-size: 12px; cursor: pointer;
    transition: background .12s, border-color .12s;
  }
  .replay-actions button:hover { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 14%, var(--panel)); }
  .replay-actions button:disabled { opacity: .55; cursor: progress; }
  .replay-actions .btn-replay svg { color: var(--up); }
  .replay-actions .btn-promote svg { color: var(--brand); }
  .replay-status {
    font-size: 11px; color: var(--soft);
    padding-left: 4px;
  }
  .replay-status.busy { color: var(--warn); }
  .replay-status.ok { color: var(--up); }
  .replay-status.err { color: var(--err); }

  /* Side-by-side diff panel */
  .replay-diff {
    margin-top: 14px;
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--panel);
    overflow: hidden;
  }
  .replay-diff-header {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-mute, var(--bg));
    font-size: 12px;
  }
  .replay-diff-header .replay-eq { color: var(--up); font-weight: 600; }
  .replay-diff-header .replay-diff-flag { color: var(--warn); font-weight: 600; }
  .replay-diff-header .replay-meta {
    margin-left: auto; color: var(--soft);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
  }
  .replay-diff-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    padding: 10px 12px;
  }
  .replay-diff-grid h4 {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--soft); margin: 0 0 5px;
  }
  .replay-diff-grid pre { max-height: 220px; }

  /* — Events view (producer/consumer tree) — */
  #events-view {
    position: fixed; top: 56px; left: 0; right: 0; bottom: 0;
    overflow-y: auto;
    padding: 24px 32px;
  }
  body.panel-open #events-view { right: 460px; }
  #events-content { max-width: 1100px; }
  .ev-api {
    border: 1px solid var(--border); border-radius: 12px; background: var(--panel);
    padding: 16px 18px; margin-bottom: 18px;
  }
  .ev-api-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
  .ev-api-head .ev-name { font-size: 15px; font-weight: 600; color: var(--text); }
  .ev-api-head .ev-pkg { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; color: var(--mute); }
  .ev-api-head .ev-transport {
    font-size: 10.5px; padding: 2px 8px; border-radius: 999px;
    background: color-mix(in srgb, var(--brand) 18%, var(--panel)); color: var(--text);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .ev-api-desc { color: var(--soft); font-size: 12.5px; margin: 4px 0 12px; }
  .ev-topic {
    border-top: 1px solid var(--border); padding: 12px 0;
    display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start;
  }
  .ev-topic:first-of-type { border-top: 0; padding-top: 4px; }
  .ev-topic-head .ev-topic-key {
    font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; color: var(--text);
  }
  .ev-topic-head .ev-topic-wire {
    display: block; margin-top: 2px;
    font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: var(--mute);
  }
  .ev-topic-desc { color: var(--soft); font-size: 11.5px; margin: 4px 0 0; }
  .ev-roles { display: flex; flex-direction: column; gap: 6px; }
  .ev-role {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; padding: 4px 10px; border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 70%, var(--panel));
    border: 1px solid var(--border);
  }
  .ev-role.producer .ev-role-tag { color: var(--up); }
  .ev-role.consumer .ev-role-tag { color: var(--warn); }
  .ev-role.empty { color: var(--mute); font-style: italic; }
  .ev-role-tag {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    font-weight: 600; min-width: 64px;
  }
  .ev-warnings {
    background: color-mix(in srgb, var(--warn) 14%, var(--panel));
    border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border));
    border-radius: 10px; padding: 12px 14px; margin-bottom: 18px;
  }
  .ev-warnings h4 { margin: 0 0 6px; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text); }
  .ev-warnings ul { margin: 0; padding-left: 18px; font-size: 12px; color: var(--text); }

  /* — Explore view (click-through API console) — */
  #explore-view {
    position: fixed; top: 56px; left: 0; right: 0; bottom: 0;
    display: grid; grid-template-columns: 340px 1fr;
    overflow: hidden;
  }
  body.panel-open #explore-view { right: 460px; }
  #explore-list {
    position: static; width: auto; z-index: auto;
    border: 0; border-right: 1px solid var(--border);
    overflow-y: auto;
    background: var(--panel);
    display: flex; flex-direction: column;
  }
  .ex-search-wrap { padding: 12px 14px; border-bottom: 1px solid var(--border); }
  #ex-search {
    width: 100%; box-sizing: border-box;
    padding: 7px 10px;
    background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    font-size: 13px;
  }
  #ex-search:focus { outline: none; border-color: var(--brand); }
  #explore-tree { flex: 1; overflow-y: auto; padding: 6px 0 20px; }
  .ex-svc {
    padding: 10px 14px 4px;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--soft); font-weight: 600;
  }
  .ex-endpoint {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 14px; font-size: 12.5px; cursor: pointer;
    border-left: 3px solid transparent;
    color: var(--text); font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .ex-endpoint:hover { background: color-mix(in srgb, var(--brand) 8%, var(--panel)); }
  .ex-endpoint.active {
    background: color-mix(in srgb, var(--brand) 15%, var(--panel));
    border-left-color: var(--brand);
  }
  .ex-method {
    font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
    min-width: 42px; text-align: center;
    color: var(--text); background: var(--border);
  }
  .ex-method.GET    { background: color-mix(in srgb, var(--up) 28%, var(--panel)); color: var(--up); }
  .ex-method.POST   { background: color-mix(in srgb, var(--warn) 28%, var(--panel)); color: var(--warn); }
  .ex-method.PUT    { background: color-mix(in srgb, var(--brand) 28%, var(--panel)); color: var(--brand); }
  .ex-method.PATCH  { background: color-mix(in srgb, var(--brand) 28%, var(--panel)); color: var(--brand); }
  .ex-method.DELETE { background: color-mix(in srgb, var(--err) 28%, var(--panel)); color: var(--err); }
  .ex-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  #explore-detail {
    overflow-y: auto;
    padding: 24px 28px;
    background: var(--bg);
  }
  .ex-placeholder {
    color: var(--soft); font-size: 13px;
    display: flex; align-items: center; justify-content: center;
    height: 100%;
  }
  .ex-header { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .ex-header .ex-method { font-size: 12px; padding: 4px 10px; min-width: 60px; }
  .ex-header .ex-path { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 15px; font-weight: 500; }
  .ex-service { color: var(--soft); font-size: 12px; margin-bottom: 18px; }
  .ex-section { margin-top: 24px; }
  .ex-section-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--soft); font-weight: 600; margin-bottom: 10px;
  }
  .ex-form { display: flex; flex-direction: column; gap: 12px; }
  .ex-field { display: flex; flex-direction: column; gap: 4px; }
  .ex-field-head { display: flex; align-items: baseline; gap: 8px; }
  .ex-field-name { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; color: var(--text); }
  .ex-field-type { font-size: 11px; color: var(--soft); }
  .ex-required { color: var(--err); font-size: 11px; font-weight: 600; }
  .ex-input {
    padding: 7px 10px; font-size: 13px;
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .ex-input:focus { outline: none; border-color: var(--brand); }
  textarea.ex-input { min-height: 100px; resize: vertical; }
  .ex-desc { font-size: 11px; color: var(--soft); font-style: italic; }
  .ex-try-btn {
    padding: 8px 20px;
    background: var(--brand); color: white;
    border: 0; border-radius: 6px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    align-self: flex-start; margin-top: 8px;
  }
  .ex-try-btn:hover { filter: brightness(1.1); }
  .ex-try-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ex-response {
    background: var(--panel);
    border: 1px solid var(--border); border-radius: 8px;
    overflow: hidden;
  }
  .ex-response-head {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .ex-status {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-weight: 700;
    padding: 3px 8px; border-radius: 4px;
    background: var(--border); color: var(--text);
  }
  .ex-status.ok    { background: color-mix(in srgb, var(--up) 30%, var(--panel)); color: var(--up); }
  .ex-status.err   { background: color-mix(in srgb, var(--err) 30%, var(--panel)); color: var(--err); }
  .ex-duration { color: var(--soft); font-family: 'JetBrains Mono', ui-monospace, monospace; }
  .ex-response pre {
    margin: 0; padding: 12px 14px;
    background: transparent;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px; line-height: 1.55;
    max-height: 460px; overflow-y: auto;
    color: var(--text); white-space: pre-wrap; word-break: break-word;
  }
  .ex-history { display: flex; flex-direction: column; gap: 4px; }
  .ex-history-row {
    display: grid; grid-template-columns: 90px 60px 60px 1fr;
    gap: 10px; align-items: center;
    padding: 4px 10px; font-size: 11.5px;
    color: var(--soft);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    border-radius: 4px; cursor: pointer;
  }
  .ex-history-row:hover { background: color-mix(in srgb, var(--brand) 6%, var(--panel)); color: var(--text); }
</style>
</head>
<body>
<header>
  <a href="#cards" class="hdr-brand" aria-label="Xenosis dev dashboard">
    <span class="brand-mark" aria-hidden="true">X</span>
    <span class="brand-text">Xenosis</span>
    <span class="brand-sub">dev</span>
  </a>

  <nav class="hdr-nav" id="view-toggle" role="tablist" aria-label="View">
    <a href="#cards"   data-view="cards"   class="active" role="tab">Cards</a>
    <a href="#graph"   data-view="graph"   role="tab">Graph</a>
    <a href="#traces"  data-view="traces"  role="tab">Traces</a>
    <a href="#events"  data-view="events"  role="tab">Events</a>
    <a href="#explore" data-view="explore" role="tab">Explore</a>
  </nav>

  <div class="hdr-spacer"></div>

  <div class="hdr-right">
    <span class="hdr-legend">
      <span><i class="status-up"></i>up</span>
      <span><i class="status-starting"></i>starting</span>
      <span><i class="status-down"></i>down</span>
    </span>
    <button id="refresh" class="hdr-refresh" title="Re-run health checks against every service">
      <svg class="r-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
      <span class="r-label">Refresh</span>
    </button>
  </div>
</header>
<main>
  <div id="grid" class="grid"></div>
</main>
<div id="graph-view">
  <svg id="graph-svg"></svg>
  <div id="heat-legend">
    <span>p95</span>
    <div class="scale"></div>
    <span class="hint">edge width = volume · pulse = breaker / retry burst</span>
  </div>
</div>
<div id="traces-view">
  <div id="traces-list"><div class="empty">Loading traces…</div></div>
  <div id="traces-detail"><div class="placeholder">Select a trace from the list.</div></div>
</div>
<div id="events-view">
  <div id="events-content"><div class="empty">Loading event graph…</div></div>
</div>
<div id="explore-view">
  <aside id="explore-list">
    <div class="ex-search-wrap">
      <input id="ex-search" placeholder="Search endpoints…" autocomplete="off" />
    </div>
    <div id="explore-tree"><div class="empty">Loading endpoints…</div></div>
  </aside>
  <section id="explore-detail">
    <div class="ex-placeholder">Select an endpoint from the list to try it.</div>
  </section>
</div>
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
  // Also flag body so the fixed Graph view can shrink and leave the panel
  // (especially its close button) clickable.
  document.body.classList.add('panel-open');
  // Re-center the graph once the panel slide-in transition is done (180ms).
  if (currentView === 'graph') setTimeout(renderGraph, 220);
  refreshPanelHead();
  logsEl.innerHTML = '<div class="empty">loading…</div>';
  const r = await fetch('/api/logs/' + encodeURIComponent(name));
  const { logs: backfill } = await r.json();
  logsEl.innerHTML = '';
  if (!backfill.length) logsEl.innerHTML = '<div class="empty">no output yet</div>';
  for (const l of backfill) appendLog(l.line, l.stream);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function closeLogPanel() {
  logsTarget = null;
  panel.classList.remove('open');
  document.body.classList.remove('panel-open');
  if (currentView === 'graph') setTimeout(renderGraph, 220);
}
document.getElementById('p-close').addEventListener('click', closeLogPanel);
// ESC hides the log panel — quick way to reclaim the full Cards/Graph viewport.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && panel.classList.contains('open')) {
    closeLogPanel();
  }
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

// ── Graph view (heat-mapped peer mesh) ────────────────────────────────────
// Active view is persisted in the URL hash so a hard refresh keeps you where
// you were. Valid values: 'cards' | 'graph'. Anything else falls back to
// 'cards' silently.
const VIEWS = ['cards', 'graph', 'traces', 'events', 'explore'];
function viewFromHash() {
  const h = (location.hash || '').replace(/^#/, '');
  return VIEWS.includes(h) ? h : 'cards';
}
let currentView = viewFromHash();
let edges = []; // [{from,to,count,p95,errorCount,retryBurst,breakerOpen}]
const svg = document.getElementById('graph-svg');

// Apply the initial view immediately, before SSE delivers data — so the
// browser never flashes the wrong layout after a refresh.
function applyView(v) {
  document.body.classList.toggle('view-cards', v === 'cards');
  document.body.classList.toggle('view-graph', v === 'graph');
  document.body.classList.toggle('view-traces', v === 'traces');
  document.body.classList.toggle('view-events', v === 'events');
  document.body.classList.toggle('view-explore', v === 'explore');
  for (const b of document.querySelectorAll('#view-toggle [data-view]')) {
    b.classList.toggle('active', b.dataset.view === v);
  }
}
applyView(currentView);
// Initial-view side-effects: applyView only handles CSS classes. When the
// page loads directly on a non-default view (bookmark or hard-refresh on
// #traces), we also need to kick that view-specific fetch. setView is gated
// by an equality check and would otherwise no-op on initial render.
if (currentView === 'traces') {
  // Defer one tick so the script below (refreshTracesList) has been parsed.
  setTimeout(function () { refreshTracesList(); }, 0);
}
if (currentView === 'events') {
  setTimeout(function () { refreshEventsGraph(); }, 0);
}
if (currentView === 'explore') {
  setTimeout(function () { refreshExplore(); }, 0);
}

document.getElementById('view-toggle').addEventListener('click', e => {
  const el = e.target.closest('[data-view]');
  if (!el) return;
  // Let the anchor update location.hash naturally — the hashchange handler
  // below routes to setView. We only prevent the reload default.
  setView(el.dataset.view);
});

function setView(v) {
  if (currentView === v) return;
  currentView = v;
  applyView(v);
  // Update the URL without a history entry — back button shouldn't be polluted
  // by every toggle, but the hash needs to survive a refresh.
  if (location.hash !== '#' + v) {
    history.replaceState(null, '', '#' + v);
  }
  if (v === 'graph') renderGraph();
  if (v === 'traces') refreshTracesList();
  if (v === 'events') refreshEventsGraph();
  if (v === 'explore') refreshExplore();
}

// Honour manual hash edits or back/forward navigation.
window.addEventListener('hashchange', () => setView(viewFromHash()));

window.addEventListener('resize', () => {
  if (currentView === 'graph') renderGraph();
});

// Color ramp for p95 latency: green < 100ms, yellow at 300, red ≥ 800.
function p95Color(ms) {
  if (ms < 100) return 'var(--up)';
  if (ms < 300) return 'color-mix(in srgb, var(--up) 50%, var(--warn))';
  if (ms < 800) return 'var(--warn)';
  return 'var(--err)';
}

// Width ramp for call volume. Logarithmic so a single hot edge doesn't dwarf the rest.
function widthFor(count, maxCount) {
  if (count === 0 || maxCount === 0) return 1.4;
  const t = Math.log10(1 + count) / Math.log10(1 + maxCount);
  return 1.4 + t * 5.6; // 1.4 → 7px
}

function renderGraph() {
  if (!model || !svg) return;
  const w = svg.clientWidth, h = svg.clientHeight;
  if (w === 0 || h === 0) return; // not yet visible — onresize / setView will retry
  const names = model.graph.services.map(s => s.name);
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.36;
  const pos = new Map();
  if (names.length === 1) pos.set(names[0], { x: cx, y: cy });
  else names.forEach((n, i) => {
    const a = (i / names.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(n, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  });

  const edgeByKey = new Map(edges.map(e => [e.from + '→' + e.to, e]));
  const maxCount = edges.reduce((m, e) => Math.max(m, e.count), 0);

  const NW = 150, NH = 50;
  let edgesSvg = '', nodesSvg = '';

  // Static peer edges from the graph + live heat overlay.
  for (const s of model.graph.services) {
    for (const target of s.calls) {
      const a = pos.get(s.name), b = pos.get(target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const x1 = a.x + ux * (NW / 2 * 0.85), y1 = a.y + uy * (NH / 2 + 6);
      const x2 = b.x - ux * (NW / 2 * 0.95), y2 = b.y - uy * (NH / 2 + 14);

      const live = edgeByKey.get(s.name + '→' + target);
      const violation = !callerAllowed(target, s.name);

      let color = '#3a4055'; // idle default
      let strokeWidth = 1.6;
      let extraClass = '';
      if (live && live.count > 0) {
        color = p95Color(live.p95);
        strokeWidth = widthFor(live.count, maxCount);
        if (live.breakerOpen) { color = 'var(--err)'; extraClass = ' retry'; }
        else if (live.retryBurst) { extraClass = ' retry'; }
      }
      if (violation) { color = 'var(--err)'; extraClass += ' violation'; }
      edgesSvg += '<path class="g-edge' + extraClass + '" stroke="' + color + '" stroke-width="' + strokeWidth.toFixed(2) + '" d="M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2 + '"/>';
    }
  }

  // Nodes
  const COLOR_DOT = { up: 'var(--up)', down: 'var(--down)', starting: 'var(--warn)' };
  for (const svc of model.services) {
    const p = pos.get(svc.name); if (!p) continue;
    const st = status.get(svc.name) || 'starting';
    // Pulse if any outbound edge from this node has breaker open or retry burst.
    const pulse = edges.some(e => e.from === svc.name && (e.breakerOpen || e.retryBurst));
    const x = p.x - NW / 2, y = p.y - NH / 2;
    nodesSvg += '<g class="g-node' + (pulse ? ' pulse' : '') + '" data-name="' + svc.name + '" transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + NW + '" height="' + NH + '" fill="#161823" stroke="' + COLOR_DOT[st] + '" />' +
      '<circle cx="16" cy="' + (NH/2) + '" r="5" fill="' + COLOR_DOT[st] + '"/>' +
      '<text x="30" y="' + (NH/2 - 3) + '">' + svc.name + '</text>' +
      '<text class="sub" x="30" y="' + (NH/2 + 12) + '">' + (svc.port ? ':' + svc.port + ' · ' : '') + st + '</text>' +
      '</g>';
  }

  svg.innerHTML = edgesSvg + nodesSvg;
  // Click on a node opens the side log panel.
  svg.querySelectorAll('.g-node').forEach(n =>
    n.addEventListener('click', () => selectLogs(n.dataset.name)),
  );
}

// ── Traces view (Jaeger-lite waterfall over the trace store) ──────────────
// Plain string concatenation throughout. The whole script body sits inside
// the outer dashboardHtml String.raw template, so any inline template
// literal would be parsed as TS interpolation instead of preserved as-is.
// Plus-concat keeps the source byte-identical to what the browser sees.
const tracesListEl = document.getElementById('traces-list');
const tracesDetailEl = document.getElementById('traces-detail');
let currentTraceId = null;
// Client-side mirror of the trace store. SSE event "trace" keeps it live;
// /api/traces is only fetched once on first view. Newest entries go first.
let tracesIndex = [];
let tracesLoaded = false;

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function fmtMs(n) {
  return n < 1000 ? Math.round(n) + 'ms' : (n / 1000).toFixed(2) + 's';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return c === '&' ? '&amp;'
      : c === '<' ? '&lt;'
      : c === '>' ? '&gt;'
      : c === '"' ? '&quot;'
      : '&#39;';
  });
}

function renderTracesList() {
  if (!tracesLoaded) {
    tracesListEl.innerHTML = '<div class="empty">Loading traces…</div>';
    return;
  }
  if (!tracesIndex.length) {
    tracesListEl.innerHTML = '<div class="empty">No traces yet — make a request that crosses a peer call. The store keeps the last 5 minutes.</div>';
    return;
  }
  tracesListEl.innerHTML = tracesIndex.map(function (t) {
      const entry = t.entry ? (t.entry.from + ' → ' + t.entry.to + '.' + t.entry.method) : '(unknown)';
      const cls = 'trace-item' + (t.failureCount > 0 ? ' failed' : '') + (t.traceId === currentTraceId ? ' active' : '');
      return (
        '<div class="' + cls + '" data-tid="' + escapeHtml(t.traceId) + '">' +
          '<div class="ti-head">' +
            '<span>' + fmtTime(t.startedAt) + '</span>' +
            '<span class="ti-id">' + escapeHtml(t.traceId.slice(0, 8)) + '…</span>' +
          '</div>' +
          '<div class="ti-entry">' + escapeHtml(entry) + '</div>' +
          '<div class="ti-meta">' +
            '<span>' + t.callCount + ' call' + (t.callCount === 1 ? '' : 's') + '</span>' +
            '<span>' + fmtMs(t.durationMs) + '</span>' +
            (t.failureCount > 0 ? '<span style="color:var(--err)">' + t.failureCount + ' fail</span>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');
  tracesListEl.querySelectorAll('.trace-item').forEach(function (el) {
    el.addEventListener('click', function () { selectTrace(el.dataset.tid); });
  });
}

// Initial population — fetched once. From then on, SSE event "trace" keeps
// the local index up to date.
async function refreshTracesList() {
  try {
    const r = await fetch('/api/traces');
    const { traces } = await r.json();
    tracesIndex = traces;
    tracesLoaded = true;
    renderTracesList();
  } catch {
    tracesListEl.innerHTML = '<div class="empty">Failed to load traces.</div>';
  }
}

// Upsert one trace summary into the local index. Called from SSE event:
// puts the trace at the top of the list (newest first) and updates the
// existing entry in place if we already had it (call count grew, etc.).
function upsertTrace(summary) {
  const idx = tracesIndex.findIndex(function (t) { return t.traceId === summary.traceId; });
  if (idx >= 0) tracesIndex.splice(idx, 1);
  tracesIndex.unshift(summary);
  if (tracesIndex.length > 50) tracesIndex.length = 50; // mirror server cap
  tracesLoaded = true;
  if (currentView === 'traces') renderTracesList();
}

async function selectTrace(tid) {
  currentTraceId = tid;
  tracesListEl.querySelectorAll('.trace-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.tid === tid);
  });
  tracesDetailEl.innerHTML = '<div class="placeholder">Loading…</div>';
  try {
    const r = await fetch('/api/trace/' + encodeURIComponent(tid));
    const data = await r.json();
    renderTraceDetail(data);
  } catch {
    tracesDetailEl.innerHTML = '<div class="placeholder">Failed to load trace.</div>';
  }
}

function renderTraceDetail(data) {
  if (!data.calls.length && !data.logs.length) {
    tracesDetailEl.innerHTML = '<div class="placeholder">Empty trace.</div>';
    return;
  }
  const tsArr = data.calls.map(function (c) { return c.ts; })
    .concat(data.logs.map(function (l) { return l.ts; }));
  const t0 = Math.min.apply(null, tsArr);
  const endArr = data.calls.map(function (c) { return (c.ts - t0) + c.durationMs; })
    .concat(data.logs.map(function (l) { return l.ts - t0; }));
  endArr.push(1);
  const totalMs = Math.max.apply(null, endArr);

  function barFor(call, idx) {
    const offset = ((call.ts - t0) / totalMs) * 100;
    const width = Math.max(((call.durationMs || 1) / totalMs) * 100, 0.5);
    let cls = 'wf-bar';
    if (!call.ok) cls += ' fail';
    else if (call.durationMs > 500) cls += ' err';
    else if (call.durationMs > 100) cls += ' warn';
    const labelTxt = fmtMs(call.durationMs) + (call.ok ? '' : ' · ' + (call.errorName || 'fail'));
    return (
      '<div class="wf-row" data-idx="' + idx + '">' +
        '<div class="wf-label"><span class="from">' + escapeHtml(call.from) + ' →</span> ' +
          escapeHtml(call.to) + '.' + escapeHtml(call.method) +
        '</div>' +
        '<div class="wf-track">' +
          '<div class="' + cls + '" style="left:' + offset.toFixed(2) + '%; width:' + width.toFixed(2) + '%;">' +
            '<span class="wf-bar-label">' + labelTxt + '</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  const failureCount = data.calls.filter(function (c) { return !c.ok; }).length;
  const failBadge = failureCount > 0
    ? '<span class="stat fail">' + failureCount + ' failure' + (failureCount === 1 ? '' : 's') + '</span>'
    : '';
  const logsBlock = data.logs.length === 0
    ? '<div class="ln" style="color:var(--soft)">No log lines matched this trace id.</div>'
    : data.logs.map(function (l) {
        const lc = 'ln' + (l.stream === 'err' ? ' err' : '');
        return '<div class="' + lc + '"><span class="svc">' + escapeHtml(l.service) + '</span>' + escapeHtml(l.line) + '</div>';
      }).join('');

  tracesDetailEl.innerHTML =
    '<div class="trace-header">' +
      '<h3>Trace</h3>' +
      '<span class="id" id="trace-id-label">' + escapeHtml(data.traceId) + '</span>' +
      '<span class="stat">' + data.calls.length + ' call' + (data.calls.length === 1 ? '' : 's') + '</span>' +
      '<span class="stat">' + fmtMs(totalMs) + '</span>' +
      failBadge +
      '<button class="copy-tid" id="copy-tid">Copy id</button>' +
    '</div>' +
    '<div class="waterfall" id="wf">' +
      data.calls.map(barFor).join('') +
    '</div>' +
    '<div id="trace-call-detail"></div>' +
    '<div class="trace-section">' +
      '<h4>Correlated logs (' + data.logs.length + ')</h4>' +
      '<div class="trace-logs">' + logsBlock + '</div>' +
    '</div>';

  document.getElementById('copy-tid').addEventListener('click', function () {
    if (navigator.clipboard) navigator.clipboard.writeText(data.traceId);
  });

  const wf = document.getElementById('wf');
  const detailDiv = document.getElementById('trace-call-detail');
  wf.querySelectorAll('.wf-row').forEach(function (row) {
    row.addEventListener('click', function () {
      wf.querySelectorAll('.wf-row').forEach(function (r) { r.classList.remove('selected'); });
      row.classList.add('selected');
      const idx = Number(row.dataset.idx);
      const c = data.calls[idx];
      const reqBlock = c.requestBody !== undefined
        ? '<h4 style="margin-top:12px">Request</h4><pre class="trace-body-pre">' +
            escapeHtml(JSON.stringify(c.requestBody, null, 2)) + '</pre>'
        : '';
      const respBlock = c.responseBody !== undefined
        ? '<h4 style="margin-top:12px">Response</h4><pre class="trace-body-pre">' +
            escapeHtml(JSON.stringify(c.responseBody, null, 2)) + '</pre>'
        : '';
      const errTxt = c.ok ? '' : ' · ' + escapeHtml(c.errorName || 'error');
      detailDiv.innerHTML =
        '<div class="trace-section">' +
          '<h4>' +
            escapeHtml(c.from) + ' → ' + escapeHtml(c.to) + '.' + escapeHtml(c.method) +
            ' <span style="color:var(--mute); font-weight:400">' +
              escapeHtml(c.httpMethod) + ' ' + escapeHtml(c.path) +
              ' · ' + fmtMs(c.durationMs) +
              ' · ' + (c.status == null ? '—' : c.status) + errTxt +
            '</span>' +
          '</h4>' +
          '<div class="replay-actions">' +
            '<button class="btn-replay" data-idx="' + idx + '" title="Re-run this call against the live service. Recorded payload is sent with x-xenosis-replay: true so the receiver can skip side-effects.">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
              ' Replay' +
            '</button>' +
            '<button class="btn-promote" data-idx="' + idx + '" title="Generate a Vitest test file in the callee service&apos;s __tests__/ folder using this payload as the fixture.">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
              ' Promote to test' +
            '</button>' +
            '<span class="replay-status" id="replay-status-' + idx + '"></span>' +
          '</div>' +
          reqBlock + respBlock +
          '<div id="replay-result-' + idx + '"></div>' +
        '</div>';

      // Wire the action buttons. We refetch the trace on success so the
      // selection is fresh, but for replay we want the diff inline.
      const replayBtn = detailDiv.querySelector('.btn-replay');
      const promoteBtn = detailDiv.querySelector('.btn-promote');
      const statusEl = document.getElementById('replay-status-' + idx);
      const resultEl = document.getElementById('replay-result-' + idx);

      if (replayBtn) replayBtn.addEventListener('click', async function () {
        replayBtn.disabled = true;
        promoteBtn && (promoteBtn.disabled = true);
        statusEl.textContent = 'Replaying…';
        statusEl.className = 'replay-status busy';
        try {
          const r = await fetch('/api/trace/' + encodeURIComponent(data.traceId) + '/replay/' + idx, { method: 'POST' });
          const body = await r.json();
          if (!body.ok) {
            const msg = body.error || 'Replay failed';
            statusEl.textContent = '✗ ' + msg + (body.hint ? ' · ' + body.hint : '');
            statusEl.className = 'replay-status err';
            resultEl.innerHTML = '';
          } else {
            statusEl.textContent = '✓ Replayed in ' + fmtMs(body.live.durationMs) + ' (status ' + body.live.status + ')';
            statusEl.className = 'replay-status ok';
            resultEl.innerHTML = renderReplayDiff(body);
          }
        } catch (e) {
          statusEl.textContent = '✗ ' + (e.message || 'Network error');
          statusEl.className = 'replay-status err';
        } finally {
          replayBtn.disabled = false;
          promoteBtn && (promoteBtn.disabled = false);
        }
      });

      if (promoteBtn) promoteBtn.addEventListener('click', async function () {
        replayBtn && (replayBtn.disabled = true);
        promoteBtn.disabled = true;
        statusEl.textContent = 'Writing test…';
        statusEl.className = 'replay-status busy';
        try {
          const r = await fetch('/api/trace/' + encodeURIComponent(data.traceId) + '/promote-test/' + idx, { method: 'POST' });
          const body = await r.json();
          if (!body.ok) {
            const msg = body.error || 'Could not write test';
            statusEl.textContent = '✗ ' + msg + (body.hint ? ' · ' + body.hint : '');
            statusEl.className = 'replay-status err';
          } else {
            statusEl.textContent = '✓ Test written → ' + body.relative;
            statusEl.className = 'replay-status ok';
          }
        } catch (e) {
          statusEl.textContent = '✗ ' + (e.message || 'Network error');
          statusEl.className = 'replay-status err';
        } finally {
          replayBtn && (replayBtn.disabled = false);
          promoteBtn.disabled = false;
        }
      });
    });
  });
  const auto = data.calls.findIndex(function (c) { return !c.ok; });
  const target = wf.querySelector('.wf-row[data-idx="' + (auto >= 0 ? auto : 0) + '"]');
  if (target) target.click();
}

// Side-by-side renderer for replay response: original (recorded) vs. live.
// JSON-byte equality is the signal we surface — strong enough to know if the
// contract is stable. Deeper diffing (key-by-key colour) would be nicer but
// not worth the lib weight; eyes resolve a 1-screen diff fine and the AI can
// do it via the explain_trace tool when it matters.
function renderReplayDiff(body) {
  const origStr = body.original.responseBody === undefined ? '(no body)' : JSON.stringify(body.original.responseBody, null, 2);
  const liveStr = body.live.responseBody === undefined ? '(no body)' : JSON.stringify(body.live.responseBody, null, 2);
  const same = origStr === liveStr;
  return (
    '<div class="replay-diff">' +
      '<div class="replay-diff-header">' +
        '<span class="' + (same ? 'replay-eq' : 'replay-diff-flag') + '">' +
          (same ? '✓ Response unchanged' : '⚠ Response differs') +
        '</span>' +
        '<span class="replay-meta">' +
          'original ' + (body.original.ok ? body.original.status : 'fail') +
          ' · live ' + body.live.status +
        '</span>' +
      '</div>' +
      '<div class="replay-diff-grid">' +
        '<div>' +
          '<h4>Original (recorded)</h4>' +
          '<pre class="trace-body-pre">' + escapeHtml(origStr) + '</pre>' +
        '</div>' +
        '<div>' +
          '<h4>Live (current code)</h4>' +
          '<pre class="trace-body-pre">' + escapeHtml(liveStr) + '</pre>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', e => {
    model = JSON.parse(e.data);
    for (const s of model.services) status.set(s.name, s.status);
    if (Array.isArray(model.edges)) edges = model.edges;
    buildInbound();
    render();
    if (currentView === 'graph') renderGraph();
  });
  es.addEventListener('status', e => {
    const { name, status: st } = JSON.parse(e.data);
    setStatus(name, st);
    if (currentView === 'graph') renderGraph();
  });
  es.addEventListener('edges', e => {
    edges = JSON.parse(e.data);
    if (currentView === 'graph') renderGraph();
  });
  es.addEventListener('trace', e => {
    const summary = JSON.parse(e.data);
    upsertTrace(summary);
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

// ─── Events tab ───────────────────────────────────────────────────────────
async function refreshEventsGraph() {
  const root = document.getElementById('events-content');
  if (!root) return;
  try {
    const resp = await fetch('/api/events-graph');
    const data = await resp.json();
    renderEventsGraph(data, root);
  } catch (err) {
    root.innerHTML = '<div class="empty">Failed to load event graph: ' + escapeHtml(String(err)) + '</div>';
  }
}

function renderEventsGraph(graph, root) {
  if (!graph || !graph.apis || graph.apis.length === 0) {
    root.innerHTML = '<div class="empty">No event APIs referenced by any service. Declare bindings under <code>events</code> in xenosis.config.json and create a <code>defineEventApi</code> package.</div>';
    return;
  }

  let html = '';

  if ((graph.warnings && graph.warnings.length) || graph.orphans.length || graph.unservedConsumers.length) {
    html += '<div class="ev-warnings"><h4>Heads-up</h4><ul>';
    for (const w of (graph.warnings || [])) html += '<li>' + escapeHtml(w) + '</li>';
    for (const o of graph.orphans) html += '<li>Orphan topic <code>' + escapeHtml(o.apiName) + '.' + escapeHtml(o.topicKey) + '</code> (wire <code>' + escapeHtml(o.topic) + '</code>) — published but no consumer in this workspace.</li>';
    for (const u of graph.unservedConsumers) html += '<li>Unserved consumer <code>' + escapeHtml(u.service) + '</code> expects <code>' + escapeHtml(u.apiName) + '.' + escapeHtml(u.topicKey) + '</code> — no producer in this workspace emits it.</li>';
    html += '</ul></div>';
  }

  for (const api of graph.apis) {
    html += '<div class="ev-api">';
    html += '  <div class="ev-api-head">';
    html += '    <span class="ev-name">' + escapeHtml(api.name) + '</span>';
    html += '    <span class="ev-pkg">' + escapeHtml(api.package) + '</span>';
    if (api.defaultTransport) html += '    <span class="ev-transport">' + escapeHtml(api.defaultTransport) + '</span>';
    html += '  </div>';
    for (const t of api.topics) {
      const producers = api.producersByTopic[t.topicKey] || [];
      const consumers = api.consumersByTopic[t.topicKey] || [];
      html += '  <div class="ev-topic">';
      html += '    <div class="ev-topic-head">';
      html += '      <span class="ev-topic-key">' + escapeHtml(t.topicKey) + '</span>';
      html += '      <span class="ev-topic-wire">wire: ' + escapeHtml(t.topic) + '</span>';
      if (t.description) html += '      <p class="ev-topic-desc">' + escapeHtml(t.description) + '</p>';
      html += '    </div>';
      html += '    <div class="ev-roles">';
      if (producers.length === 0 && consumers.length === 0) {
        html += '      <div class="ev-role empty">no role declared yet</div>';
      }
      for (const p of producers) {
        html += '      <div class="ev-role producer"><span class="ev-role-tag">producer</span>' + escapeHtml(p) + '</div>';
      }
      for (const c of consumers) {
        html += '      <div class="ev-role consumer"><span class="ev-role-tag">consumer</span>' + escapeHtml(c) + '</div>';
      }
      html += '    </div>';
      html += '  </div>';
    }
    html += '</div>';
  }

  root.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ─── Explore tab ──────────────────────────────────────────────────────────
// Click-to-call console. Fetches /openapi.json from every service via the
// dashboard proxy, groups by service+verb, renders an auto-generated form
// from each endpoint's requestBody schema, and POSTs to /api/explore/call
// so the browser doesn't have to deal with per-service CORS.
const exState = {
  index: null,          // { services: [{ name, port, doc | error }] }
  filter: '',
  selected: null,       // { service, method, path, op }
  history: [],          // last 20 { ts, service, method, path, status, durationMs }
};

async function refreshExplore() {
  const tree = document.getElementById('explore-tree');
  if (!tree) return;
  try {
    const resp = await fetch('/api/openapi-index');
    exState.index = await resp.json();
    renderExploreTree();
  } catch (err) {
    tree.innerHTML = '<div class="empty">Failed to load endpoints: ' + escapeHtml(String(err)) + '</div>';
  }
}

function exEndpoints() {
  // Flatten { service, method, path, op } from the index, filtered by search.
  if (!exState.index || !Array.isArray(exState.index.services)) return [];
  const rows = [];
  for (const svc of exState.index.services) {
    if (!svc.doc || !svc.doc.paths) continue;
    for (const [p, item] of Object.entries(svc.doc.paths)) {
      for (const [m, op] of Object.entries(item)) {
        if (!['get','post','put','patch','delete'].includes(m)) continue;
        rows.push({ service: svc.name, method: m.toUpperCase(), path: p, op, doc: svc.doc });
      }
    }
  }
  const f = exState.filter.trim().toLowerCase();
  if (!f) return rows;
  return rows.filter((r) =>
    r.path.toLowerCase().includes(f)
    || r.method.toLowerCase().includes(f)
    || r.service.toLowerCase().includes(f)
    || (r.op && r.op.summary && r.op.summary.toLowerCase().includes(f))
  );
}

function renderExploreTree() {
  const tree = document.getElementById('explore-tree');
  if (!tree) return;
  const rows = exEndpoints();
  if (!rows.length) {
    if (!exState.index || !Array.isArray(exState.index.services)) {
      tree.innerHTML = '<div class="empty">Loading endpoints…</div>';
    } else {
      tree.innerHTML = '<div class="empty">No endpoints. Are the services running?</div>';
    }
    return;
  }
  // Group by service.
  const bySvc = new Map();
  for (const r of rows) {
    if (!bySvc.has(r.service)) bySvc.set(r.service, []);
    bySvc.get(r.service).push(r);
  }
  let html = '';
  for (const [svc, list] of bySvc) {
    html += '<div class="ex-svc">' + escapeHtml(svc) + '</div>';
    for (const r of list) {
      const key = r.service + '|' + r.method + '|' + r.path;
      const active = exState.selected && (exState.selected.service + '|' + exState.selected.method + '|' + exState.selected.path) === key;
      html += '<div class="ex-endpoint' + (active ? ' active' : '') + '" data-key="' + escapeHtml(key) + '">';
      html += '<span class="ex-method ' + r.method + '">' + r.method + '</span>';
      html += '<span class="ex-path">' + escapeHtml(r.path) + '</span>';
      html += '</div>';
    }
  }
  tree.innerHTML = html;
  tree.querySelectorAll('.ex-endpoint').forEach((el) => {
    el.addEventListener('click', () => {
      const [svc, method, path] = el.dataset.key.split('|');
      selectExploreEndpoint(svc, method, path);
    });
  });
}

function selectExploreEndpoint(service, method, path) {
  const rows = exEndpoints();
  const row = rows.find((r) => r.service === service && r.method === method && r.path === path);
  if (!row) return;
  exState.selected = row;
  renderExploreTree();
  renderExploreDetail();
}

function resolveRef(doc, ref) {
  if (!ref || !ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let node = doc;
  for (const p of parts) {
    if (!node || typeof node !== 'object') return null;
    node = node[p];
  }
  return node || null;
}

function inputTypeFor(schema) {
  if (!schema) return 'text';
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'checkbox';
  return 'text';
}

function renderFieldRow(name, schema, required, doc) {
  const resolved = schema && schema.$ref ? resolveRef(doc, schema.$ref) : schema;
  const s = resolved || {};
  const type = s.type || (s.enum ? 'enum' : (s.properties ? 'object' : 'text'));
  const desc = s.description ? '<div class="ex-desc">' + escapeHtml(s.description) + '</div>' : '';
  const req = required ? '<span class="ex-required">required</span>' : '';
  const typeLabel = s.enum ? 'enum' : (Array.isArray(s.type) ? s.type.join('|') : (s.type || 'any'));

  let input;
  if (s.enum && Array.isArray(s.enum)) {
    input = '<select class="ex-input" data-name="' + escapeHtml(name) + '" data-type="enum">';
    for (const v of s.enum) input += '<option value="' + escapeHtml(String(v)) + '">' + escapeHtml(String(v)) + '</option>';
    input += '</select>';
  } else if (type === 'boolean') {
    input = '<input class="ex-input" type="checkbox" data-name="' + escapeHtml(name) + '" data-type="boolean" />';
  } else if (type === 'object' || type === 'array') {
    const placeholder = type === 'array' ? '[ ]' : '{ }';
    const dflt = s.default !== undefined ? JSON.stringify(s.default, null, 2) : '';
    input = '<textarea class="ex-input" data-name="' + escapeHtml(name) + '" data-type="json" placeholder="' + placeholder + '">' + escapeHtml(dflt) + '</textarea>';
  } else {
    const dflt = s.default !== undefined ? String(s.default) : '';
    input = '<input class="ex-input" type="' + inputTypeFor(s) + '" data-name="' + escapeHtml(name) + '" data-type="' + escapeHtml(type) + '" value="' + escapeHtml(dflt) + '" />';
  }

  return (
    '<div class="ex-field">'
    + '<div class="ex-field-head">'
    + '<span class="ex-field-name">' + escapeHtml(name) + '</span>'
    + '<span class="ex-field-type">' + escapeHtml(typeLabel) + '</span>'
    + req
    + '</div>'
    + input
    + desc
    + '</div>'
  );
}

function renderExploreDetail() {
  const detail = document.getElementById('explore-detail');
  if (!detail) return;
  const sel = exState.selected;
  if (!sel) {
    detail.innerHTML = '<div class="ex-placeholder">Select an endpoint from the list to try it.</div>';
    return;
  }
  const op = sel.op || {};
  const doc = sel.doc;

  // Path params: /order/{id} → prompt for id
  const pathParams = [];
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(sel.path)) !== null) pathParams.push(m[1]);

  // Merge explicit parameters + path template captures.
  const params = Array.isArray(op.parameters) ? op.parameters.slice() : [];
  for (const p of pathParams) {
    if (!params.some((x) => x.name === p && x.in === 'path')) {
      params.push({ name: p, in: 'path', required: true, schema: { type: 'string' } });
    }
  }

  // Body schema
  const requestBody = op.requestBody;
  let bodySchema = null;
  let bodyRequired = new Set();
  if (requestBody && requestBody.content && requestBody.content['application/json']) {
    let s = requestBody.content['application/json'].schema;
    if (s && s.$ref) s = resolveRef(doc, s.$ref);
    bodySchema = s;
    if (s && Array.isArray(s.required)) bodyRequired = new Set(s.required);
  }

  let html = '';
  html += '<div class="ex-header">';
  html += '<span class="ex-method ' + sel.method + '">' + sel.method + '</span>';
  html += '<span class="ex-path">' + escapeHtml(sel.path) + '</span>';
  html += '</div>';
  html += '<div class="ex-service">' + escapeHtml(sel.service);
  if (op.summary) html += ' · ' + escapeHtml(op.summary);
  html += '</div>';
  if (op.description) html += '<div class="ex-desc">' + escapeHtml(op.description) + '</div>';

  html += '<form class="ex-form" id="ex-form" onsubmit="return false;">';

  if (params.length) {
    html += '<div class="ex-section"><div class="ex-section-title">Parameters</div>';
    for (const p of params) {
      html += '<div class="ex-field" data-param-in="' + escapeHtml(p.in) + '" data-param-name="' + escapeHtml(p.name) + '">';
      html += '<div class="ex-field-head">';
      html += '<span class="ex-field-name">' + escapeHtml(p.name) + '</span>';
      html += '<span class="ex-field-type">' + escapeHtml(p.in) + '</span>';
      if (p.required) html += '<span class="ex-required">required</span>';
      html += '</div>';
      const t = (p.schema && p.schema.type) || 'string';
      html += '<input class="ex-input" data-param-in="' + escapeHtml(p.in) + '" data-param-name="' + escapeHtml(p.name) + '" type="' + (t === 'integer' || t === 'number' ? 'number' : 'text') + '" />';
      if (p.description) html += '<div class="ex-desc">' + escapeHtml(p.description) + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  if (bodySchema && bodySchema.properties) {
    html += '<div class="ex-section"><div class="ex-section-title">Request body</div>';
    for (const [name, sub] of Object.entries(bodySchema.properties)) {
      html += renderFieldRow(name, sub, bodyRequired.has(name), doc);
    }
    html += '</div>';
  } else if (bodySchema) {
    // free-form body
    html += '<div class="ex-section"><div class="ex-section-title">Request body (raw JSON)</div>';
    html += '<textarea class="ex-input" id="ex-raw-body" placeholder="{ }"></textarea>';
    html += '</div>';
  }

  html += '<button class="ex-try-btn" id="ex-try">Try it →</button>';
  html += '</form>';

  html += '<div class="ex-section" id="ex-response-section" style="display:none">';
  html += '<div class="ex-section-title">Response</div>';
  html += '<div class="ex-response" id="ex-response"></div>';
  html += '</div>';

  if (exState.history.length) {
    html += '<div class="ex-section"><div class="ex-section-title">History</div>';
    html += '<div class="ex-history">';
    for (const h of exState.history.slice(0, 20)) {
      const cls = h.ok ? 'ok' : 'err';
      html += '<div class="ex-history-row">';
      html += '<span class="ex-status ' + cls + '">' + escapeHtml(String(h.status)) + '</span>';
      html += '<span class="ex-duration">' + escapeHtml(h.durationMs + 'ms') + '</span>';
      html += '<span>' + escapeHtml(h.method) + '</span>';
      html += '<span>' + escapeHtml(h.path) + '</span>';
      html += '</div>';
    }
    html += '</div></div>';
  }

  detail.innerHTML = html;

  const btn = document.getElementById('ex-try');
  if (btn) btn.addEventListener('click', tryExploreCall);
}

function readFormValues() {
  const form = document.getElementById('ex-form');
  if (!form) return { pathParams: {}, query: {}, headers: {}, body: undefined };
  const pathParams = {}, query = {}, headers = {};
  form.querySelectorAll('input[data-param-in], select[data-param-in]').forEach((el) => {
    const target = el.dataset.paramIn === 'path' ? pathParams
                : el.dataset.paramIn === 'query' ? query
                : el.dataset.paramIn === 'header' ? headers : null;
    if (!target) return;
    if (el.value !== '') target[el.dataset.paramName] = el.value;
  });

  // Body
  let body;
  const raw = form.querySelector('#ex-raw-body');
  if (raw) {
    if (raw.value.trim()) {
      try { body = JSON.parse(raw.value); } catch { body = raw.value; }
    }
  } else {
    body = {};
    form.querySelectorAll('.ex-field [data-name]').forEach((el) => {
      const name = el.dataset.name;
      const t = el.dataset.type;
      if (t === 'boolean') {
        if (el.checked) body[name] = true;
        return;
      }
      const v = el.value;
      if (v === '' || v == null) return;
      if (t === 'number' || t === 'integer') body[name] = Number(v);
      else if (t === 'json') { try { body[name] = JSON.parse(v); } catch { body[name] = v; } }
      else if (t === 'enum') body[name] = v;
      else body[name] = v;
    });
    if (Object.keys(body).length === 0) body = undefined;
  }
  return { pathParams, query, headers, body };
}

async function tryExploreCall() {
  const sel = exState.selected;
  if (!sel) return;
  const btn = document.getElementById('ex-try');
  if (btn) { btn.disabled = true; btn.textContent = 'Calling…'; }

  const vals = readFormValues();
  let path = sel.path;
  for (const [k, v] of Object.entries(vals.pathParams)) {
    path = path.replace('{' + k + '}', encodeURIComponent(v));
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(vals.query)) qs.append(k, String(v));
  const qsStr = qs.toString();
  if (qsStr) path += (path.includes('?') ? '&' : '?') + qsStr;

  const respBox = document.getElementById('ex-response');
  const respSec = document.getElementById('ex-response-section');
  respSec.style.display = '';
  respBox.innerHTML = '<div class="ex-response-head">Calling ' + escapeHtml(sel.method + ' ' + path) + '…</div>';

  try {
    const r = await fetch('/api/explore/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service: sel.service,
        method: sel.method,
        path,
        headers: vals.headers,
        body: vals.body,
      }),
    });
    const data = await r.json();
    const status = data.status ?? '—';
    const ok = data.ok === true;
    const dur = data.durationMs ?? 0;
    const bodyStr = typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2);
    respBox.innerHTML =
      '<div class="ex-response-head">'
      + '<span class="ex-status ' + (ok ? 'ok' : 'err') + '">' + escapeHtml(String(status)) + '</span>'
      + '<span class="ex-duration">' + escapeHtml(dur + 'ms') + '</span>'
      + '<span>' + escapeHtml(sel.method + ' ' + path) + '</span>'
      + '</div>'
      + '<pre>' + escapeHtml(bodyStr) + '</pre>';
    exState.history.unshift({ ts: Date.now(), service: sel.service, method: sel.method, path, status, ok, durationMs: dur });
    if (exState.history.length > 20) exState.history.length = 20;
  } catch (err) {
    respBox.innerHTML =
      '<div class="ex-response-head"><span class="ex-status err">ERR</span></div>'
      + '<pre>' + escapeHtml(String(err)) + '</pre>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Try it →'; }
  }
}

// Search filter — the script tag runs at end of body, so the input already exists.
(function () {
  const search = document.getElementById('ex-search');
  if (search) search.addEventListener('input', (e) => {
    exState.filter = e.target.value;
    renderExploreTree();
  });
})();

</script>
</body>
</html>`;
