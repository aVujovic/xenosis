import { z } from 'zod';
import type { WorkspaceContext } from '../context';
import { errorReply, fetchWithTimeout, jsonReply } from '../util';

/**
 * `explain_trace` — Phase 2 root-cause helper.
 *
 * Fetches every peer call + correlated log line under a single
 * `x-xenosis-trace-id` from the live `xenosis dev` dashboard, structures
 * them into a timeline, and returns it. The AI consumes that structure to
 * verbalise the chain of events ("orders → pricing timed out at 14:23,
 * payments retried twice then opened the circuit").
 *
 * Requires `xenosis dev` to be running — the trace store lives in the
 * dashboard process's memory, not on disk. When the dashboard is unreachable
 * the tool returns an actionable error so Claude / Cursor surface it to the
 * user instead of confabulating.
 */

const DEFAULT_DASHBOARD_URL = 'http://localhost:9000';

export const EXPLAIN_TRACE_TOOL = {
  name: 'explain_trace',
  config: {
    title: 'Explain a peer-call trace',
    description:
      'Given an x-xenosis-trace-id, returns every peer call (with request/response ' +
      'bodies, durations, statuses) and every log line that mentioned the same id, ' +
      'across all services. Use this to diagnose failures that span multiple ' +
      'services. Requires `xenosis dev` to be running.',
    inputSchema: {
      traceId: z
        .string()
        .min(1)
        .describe('The x-xenosis-trace-id (UUID) emitted by the request-context middleware.'),
    },
  },
} as const;

interface TraceCall {
  from: string; to: string;
  method: string; httpMethod: string; path: string;
  status: number | null; durationMs: number;
  ok: boolean; errorName?: string;
  requestBody?: unknown; responseBody?: unknown;
  spanId?: string; parentSpanId?: string;
  ts: number;
}

interface TraceResponse {
  traceId: string;
  callCount: number;
  logCount: number;
  calls: TraceCall[];
  logs: { service: string; line: string; stream: 'out' | 'err'; ts: number }[];
}

export async function handleExplainTrace(
  _ctx: WorkspaceContext,
  args: { traceId: string },
) {
  const dashboardUrl =
    process.env.XENOSIS_DASHBOARD_URL?.replace(/\/$/, '') ?? DEFAULT_DASHBOARD_URL;
  const url = `${dashboardUrl}/api/trace/${encodeURIComponent(args.traceId)}`;

  let data: TraceResponse;
  try {
    const r = await fetchWithTimeout(url, 2500);
    if (!r.ok) {
      return errorReply(`Dashboard returned HTTP ${r.status} for ${url}.`);
    }
    data = (await r.json()) as TraceResponse;
  } catch (err) {
    return errorReply(
      `Could not reach the dev dashboard at ${url}: ${(err as Error).message}. ` +
        `Start it with \`xenosis dev\`. Override the URL with the XENOSIS_DASHBOARD_URL env var if it's running on a non-default port.`,
    );
  }

  if (data.callCount === 0 && data.logCount === 0) {
    return jsonReply({
      traceId: args.traceId,
      summary: 'No calls or logs found for this trace id.',
      hint:
        'The trace store keeps the last few minutes — make sure the trace happened recently, ' +
        'and that the services were running under `xenosis dev` (so XENOSIS_TELEMETRY_URL was set).',
    });
  }

  // Build a tight summary for the model. Bodies are kept full because they
  // were already redacted + truncated at the source (telemetry.ts) — Claude
  // benefits from seeing the actual payloads.
  const startTs = Math.min(
    ...(data.calls.length ? data.calls.map((c) => c.ts) : [Date.now()]),
    ...(data.logs.length ? data.logs.map((l) => l.ts) : [Date.now()]),
  );
  const offsetMs = (ts: number) => ts - startTs;

  const timeline = data.calls
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((c) => ({
      atMs: offsetMs(c.ts),
      from: c.from,
      to: c.to,
      method: c.method,
      httpMethod: c.httpMethod,
      path: c.path,
      status: c.status,
      durationMs: c.durationMs,
      ok: c.ok,
      ...(c.errorName ? { errorName: c.errorName } : {}),
      ...(c.requestBody !== undefined ? { requestBody: c.requestBody } : {}),
      ...(c.responseBody !== undefined ? { responseBody: c.responseBody } : {}),
      ...(c.spanId ? { spanId: c.spanId } : {}),
      ...(c.parentSpanId ? { parentSpanId: c.parentSpanId } : {}),
    }));

  const failedCalls = timeline.filter((c) => !c.ok);
  const firstFailure = failedCalls[0];

  return jsonReply({
    traceId: args.traceId,
    callCount: data.callCount,
    logCount: data.logCount,
    failureCount: failedCalls.length,
    ...(firstFailure
      ? {
          firstFailure: {
            from: firstFailure.from,
            to: firstFailure.to,
            method: firstFailure.method,
            atMs: firstFailure.atMs,
            status: firstFailure.status,
            errorName: firstFailure.errorName,
          },
        }
      : {}),
    timeline,
    logs: data.logs.map((l) => ({ atMs: offsetMs(l.ts), service: l.service, stream: l.stream, line: l.line })),
    hint:
      'Times are ms-offsets from the earliest event in this trace. ' +
      'Bodies are already redacted + truncated at the source.',
  });
}
