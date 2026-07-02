# @xenosisorg/xenosis-mcp

MCP server that gives AI assistants (Claude, Cursor, Copilot, …)
**read-only context about a Xenosis workspace** — peer graph + boundary
violations, parsed service configs (secrets redacted), live health checks, and
OpenAPI specs of running services.

This is *not* a code generator. It is the layer that lets an AI answer
questions about **your specific project**, not Xenosis in general — e.g.

> Why does `orders-service` get a 403 when it calls `payments`?

The AI calls `get_peer_graph`, sees the violation, calls `get_service_config payments`
to confirm `boundaries.allowedCallers`, and points out the mismatched
`peerName`. No hallucination — the data comes from your files.

## Install

The server is launched on demand by your MCP client; you don't need to install
it globally.

## Configure your MCP client

### Claude Desktop / Claude Code

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
the equivalent on your OS:

```jsonc
{
  "mcpServers": {
    "xenosis": {
      "command": "npx",
      "args": ["-y", "@xenosisorg/xenosis-mcp"],
      "env": {
        // Absolute path to the workspace (the directory holding xenosis.workspace.json).
        // Optional — when omitted, the server walks up from its launch cwd.
        "XENOSIS_WORKSPACE_ROOT": "/absolute/path/to/your/workspace"
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "xenosis": {
      "command": "npx",
      "args": ["-y", "@xenosisorg/xenosis-mcp"]
    }
  }
}
```

Cursor launches the server with the workspace as cwd, so `XENOSIS_WORKSPACE_ROOT`
is not needed.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_peer_graph` | Full peer mesh + boundary violations (same data as `xenosis graph --json`). |
| `get_service_config` | Parsed `xenosis.config.json` of one service, secrets redacted. |
| `health_check` | `GET /healthcheck` on each service's local port — up/down. |
| `get_openapi_spec` | OpenAPI 3.1 spec of a running service (routes summary by default, `full: true` for the whole document). |
| `explain_trace` | Correlated timeline of every peer call + log line under one `x-xenosis-trace-id`, redacted bodies included. |
| `simulate_change` | Blast radius of a proposed change: callers, boundary verdict, whether a new `addCaller` would be refused. |
| `get_event_graph` | Async event mesh: producers/consumers per topic, orphan topics, unserved consumers (same data as `xenosis graph --events --json`). |

`health_check`, `get_openapi_spec`, and `explain_trace` require the target
services to be running (start them with `xenosis dev`; `explain_trace` reads
the dashboard's trace store). The others work from the config files and API
packages alone.

## What the server reads

- `xenosis.workspace.json` (workspace root) — to find `structure.services`.
- Each `<services>/*/xenosis.config.json` — service identity, peers, boundaries,
  port, OpenAPI config, events bindings.
- Referenced peer / event API packages (static parse — routes, topics).
- Each running service's `/healthcheck` and `/openapi.json` over `http://localhost:<port>`.
- The `xenosis dev` dashboard's trace store (`/api/trace/:id`, default
  `http://localhost:9000`, override with `XENOSIS_DASHBOARD_URL`).

Nothing outside the workspace; no writes; no network beyond `localhost`.

## Privacy

`get_service_config` redacts any property whose key matches
`token|secret|password|apikey|api_key|jwtsecret` (case-insensitive) and masks
inline credentials in URL strings (`postgres://user:<pw>@host` →
`postgres://user:<redacted>@host`). The AI never sees real secrets through this
tool.
