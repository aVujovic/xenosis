import { z } from 'zod';
import { buildGraph, readServiceNode } from '../graph-core';
import { discoverServices, resolveService } from '../services';
import type { WorkspaceContext } from '../context';
import { errorReply, jsonReply } from '../util';

/**
 * `simulate_change` — Phase 2 blast-radius helper.
 *
 * Given a proposed change to a service, returns:
 *   • Every caller that declares the target as a peer (the immediate blast
 *     radius — the services that import the API package and may need
 *     updating).
 *   • Every boundary that would refuse a new caller (when `addCaller` is
 *     provided): which services currently declare the target as a peer but
 *     are NOT in its `allowedCallers`.
 *   • Pointers to the consumer-side files most likely affected (paths
 *     containing the target peer name).
 *
 * No TypeScript compiler API integration here — that's Phase 3 (codemod
 * generation). Phase 2 is "who am I about to break?", answered from the
 * peer graph + boundaries you already have.
 */

export const SIMULATE_CHANGE_TOOL = {
  name: 'simulate_change',
  config: {
    title: 'Simulate the blast radius of a service change',
    description:
      'Returns the callers of a service (its blast radius), which boundary ' +
      'permissions are in play, and where consumer-side code likely lives. ' +
      'Use this BEFORE proposing edits to a service\'s request/response ' +
      'schema or its allowedCallers list so you can name every caller that ' +
      'will need updating in the same PR.',
    inputSchema: {
      service: z.string().describe('The target service — peerName, config.name, or directory.'),
      method: z
        .string()
        .optional()
        .describe('Optional peer method name (e.g. "createCharge"). When provided, returned hint paths narrow to controller files mentioning it.'),
      addCaller: z
        .string()
        .optional()
        .describe(
          'Optional: a service name you\'re proposing to ADD as a caller. The tool reports whether the target\'s boundaries would currently refuse it.',
        ),
    },
  },
} as const;

export async function handleSimulateChange(
  ctx: WorkspaceContext,
  args: { service: string; method?: string; addCaller?: string },
) {
  const services = await discoverServices(ctx.root, ctx.config.structure.services);
  const target = resolveService(services, args.service);
  if (!target) {
    return errorReply(
      `Service "${args.service}" not found. Known services: ${services.map((s) => s.peerName).join(', ') || '(none)'}.`,
    );
  }

  // Build the graph so we get callers + boundary violations in one go.
  const nodes = await Promise.all(services.map((s) => readServiceNode(s.configPath)));
  const graph = buildGraph(nodes);

  // Callers: every node whose `calls` contains the target's peerName.
  const callers = nodes.filter((n) => n.calls.includes(target.peerName)).map((n) => n.name);

  // Target's boundary policy.
  const targetNode = nodes.find((n) => n.name === target.peerName);
  const allowedCallers = targetNode?.allowedCallers;
  const openToAll = !allowedCallers || allowedCallers.length === 0;

  // Existing violations *into* this target (callers that aren't in the list).
  const existingViolations = graph.violations.filter((v) => v.to === target.peerName);

  // Optional: would `addCaller` be refused?
  let addCallerVerdict: { caller: string; wouldBeRefused: boolean; reason: string } | undefined;
  if (args.addCaller) {
    if (openToAll) {
      addCallerVerdict = {
        caller: args.addCaller,
        wouldBeRefused: false,
        reason: `${target.peerName} is open to all callers (no boundaries.allowedCallers list).`,
      };
    } else if (allowedCallers!.includes(args.addCaller)) {
      addCallerVerdict = {
        caller: args.addCaller,
        wouldBeRefused: false,
        reason: `${args.addCaller} is already in ${target.peerName}.boundaries.allowedCallers.`,
      };
    } else {
      addCallerVerdict = {
        caller: args.addCaller,
        wouldBeRefused: true,
        reason: `Add "${args.addCaller}" to ${target.peerName}.boundaries.allowedCallers (currently: [${allowedCallers!.join(', ')}]) to permit the call.`,
      };
    }
  }

  // Consumer-side hint paths. These are educated guesses — the MCP server is
  // read-only on the filesystem and only knows configs. We surface the peer
  // package name from the target's peers entry to help the AI grep.
  const peerPackages: { caller: string; package?: string }[] = [];
  for (const svc of services) {
    if (!callers.includes(svc.peerName)) continue;
    const peers = (svc.raw.peers as Record<string, { package?: string }> | undefined) ?? {};
    const binding = peers[target.peerName];
    peerPackages.push({
      caller: svc.peerName,
      ...(binding?.package ? { package: binding.package } : {}),
    });
  }

  return jsonReply({
    target: {
      peerName: target.peerName,
      name: target.name,
      dir: target.dir,
      port: target.port,
    },
    ...(args.method ? { method: args.method } : {}),
    callers,
    callerCount: callers.length,
    boundaries: {
      openToAll,
      allowedCallers: allowedCallers ?? null,
      existingViolations,
    },
    ...(addCallerVerdict ? { addCaller: addCallerVerdict } : {}),
    peerPackages,
    hint:
      'callers = blast radius. For each caller, look at `services/<caller>/src` for ' +
      'imports of the peer package (`peerPackages[].package`). To run a real codemod ' +
      'you still need the TS compiler — Phase 2 stops at identifying who is affected.',
  });
}
