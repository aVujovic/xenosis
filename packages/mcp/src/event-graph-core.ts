import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';

/**
 * Local copy of packages/cli/src/lib/event-graph-core.ts. Kept verbatim by
 * convention so the MCP server can expose event-graph data without taking a
 * runtime dep on the CLI. If you edit one, edit both.
 */

export interface EventBinding {
  /** Binding name in config.events (= cradle key suffix). */
  binding: string;
  /** npm package name that default-exports the EventApi. */
  package: string;
  /** Transport name as declared in config. */
  transport: string;
  /** producer | consumer | both. */
  mode: 'producer' | 'consumer' | 'both';
  /** Resolved consumer groupId. */
  groupId: string;
}

export interface EventServiceNode {
  /** Service identity (peerName ?? name ?? dir basename). */
  name: string;
  /** All event bindings declared by this service. */
  bindings: EventBinding[];
  /**
   * Per-binding consumer handlers — the topic keys the service has a
   * `src/events/<Name>.event.ts` for. Producer-only bindings have an empty
   * list.
   */
  handlersByBinding: Record<string, string[]>;
}

export interface EventTopicSpec {
  /** JS topic key on the api spec — e.g. `chargeSucceeded`. */
  topicKey: string;
  /** Wire-level topic / subject / stream key. */
  topic: string;
  /** Producer description if the api package supplies one. */
  description?: string;
}

export interface EventApiNode {
  /** Binding-friendly name = api.name from defineEventApi. */
  name: string;
  /** npm package coordinates. */
  package: string;
  /** Default transport hint from the API spec (may differ from per-binding transport). */
  defaultTransport: string | undefined;
  /** Topics declared by this api. */
  topics: EventTopicSpec[];
  /** Services that publish to any topic in this api. */
  producers: string[];
  /** Per-topic consumers: { topicKey: [serviceName, ...] }. */
  consumersByTopic: Record<string, string[]>;
  /** Per-topic producers: { topicKey: [serviceName, ...] }. */
  producersByTopic: Record<string, string[]>;
}

export interface EventGraph {
  services: EventServiceNode[];
  apis: EventApiNode[];
  /** Producer-without-consumer warnings (a topic is published but nobody listens). */
  orphans: Array<{ apiName: string; topicKey: string; topic: string }>;
  /** Consumers without a producer (a handler exists but no service publishes). */
  unservedConsumers: Array<{ apiName: string; topicKey: string; topic: string; service: string }>;
}

/**
 * Pure graph builder: given service nodes (with their bindings + handlers) and
 * the parsed event api specs, compute producer/consumer maps per topic and
 * surface orphan topics.
 */
export function buildEventGraph(
  services: EventServiceNode[],
  apiSpecs: Map<string, RawEventApi>,
): EventGraph {
  const apis = new Map<string, EventApiNode>();

  // Seed api nodes from every api package referenced by any binding.
  for (const svc of services) {
    for (const b of svc.bindings) {
      const raw = apiSpecs.get(b.package);
      if (!raw) continue;
      if (!apis.has(raw.name)) {
        apis.set(raw.name, {
          name: raw.name,
          package: b.package,
          defaultTransport: raw.transport,
          topics: Object.entries(raw.topics).map(([k, v]) => ({
            topicKey: k,
            topic: v.topic,
            ...(v.description ? { description: v.description } : {}),
          })),
          producers: [],
          consumersByTopic: {},
          producersByTopic: {},
        });
      }
    }
  }

  for (const svc of services) {
    for (const b of svc.bindings) {
      const raw = apiSpecs.get(b.package);
      if (!raw) continue;
      const apiNode = apis.get(raw.name)!;

      const isProducer = b.mode === 'producer' || b.mode === 'both';
      const isConsumer = b.mode === 'consumer' || b.mode === 'both';

      if (isProducer && !apiNode.producers.includes(svc.name)) {
        apiNode.producers.push(svc.name);
        // Every topic in this api can be produced by this service in principle —
        // we mark all of them, callers can refine to actually-emitted via
        // static analysis (Phase 11 follow-up).
        for (const t of apiNode.topics) {
          const list = apiNode.producersByTopic[t.topicKey] ?? [];
          if (!list.includes(svc.name)) list.push(svc.name);
          apiNode.producersByTopic[t.topicKey] = list;
        }
      }

      if (isConsumer) {
        const handlerTopicKeys = svc.handlersByBinding[b.binding] ?? [];
        for (const tk of handlerTopicKeys) {
          const list = apiNode.consumersByTopic[tk] ?? [];
          if (!list.includes(svc.name)) list.push(svc.name);
          apiNode.consumersByTopic[tk] = list;
        }
      }
    }
  }

  const apiList = Array.from(apis.values()).sort((a, b) => a.name.localeCompare(b.name));

  const orphans: EventGraph['orphans'] = [];
  const unservedConsumers: EventGraph['unservedConsumers'] = [];

  for (const api of apiList) {
    for (const t of api.topics) {
      const producers = api.producersByTopic[t.topicKey] ?? [];
      const consumers = api.consumersByTopic[t.topicKey] ?? [];
      if (producers.length > 0 && consumers.length === 0) {
        orphans.push({ apiName: api.name, topicKey: t.topicKey, topic: t.topic });
      }
      if (consumers.length > 0 && producers.length === 0) {
        for (const svc of consumers) {
          unservedConsumers.push({
            apiName: api.name,
            topicKey: t.topicKey,
            topic: t.topic,
            service: svc,
          });
        }
      }
    }
  }

  return {
    services,
    apis: apiList,
    orphans,
    unservedConsumers,
  };
}

/** Parsed defineEventApi spec — what readEventApiPackage returns. */
export interface RawEventApi {
  name: string;
  transport?: string;
  topics: Record<string, { topic: string; description?: string }>;
}

/** Read + parse one service's xenosis.config.json into an EventServiceNode. */
export async function readEventServiceNode(
  configPath: string,
): Promise<EventServiceNode> {
  const raw = await readFile(configPath, 'utf-8');
  const cfg = JSON.parse(raw) as {
    name?: string;
    peerName?: string;
    events?: Record<string, RawBindingConfig>;
  };
  const name = cfg.peerName ?? cfg.name ?? basename(dirname(configPath));

  const bindings: EventBinding[] = Object.entries(cfg.events ?? {}).map(
    ([bindingName, b]) => ({
      binding: bindingName,
      package: b.package,
      transport: b.transport,
      mode: b.mode ?? 'both',
      groupId: b.groupId ?? `${name}-${bindingName}`,
    }),
  );

  // Scan src/events/*.event.{ts,js} for default-exported handlers. We don't
  // execute the file — we look for `defineEventHandler(<importedApi>.topics.<topicKey>, ...)`
  // patterns via a regex. Static analysis is fine here; it matches what the
  // runtime loader does at boot (which uses object identity).
  const serviceRoot = dirname(configPath);
  const handlersByBinding: Record<string, string[]> = {};

  for (const b of bindings) {
    handlersByBinding[b.binding] = await scanHandlerTopicKeys(serviceRoot, b.package);
  }

  return { name, bindings, handlersByBinding };
}

interface RawBindingConfig {
  package: string;
  transport: string;
  mode?: 'producer' | 'consumer' | 'both';
  groupId?: string;
}

async function scanHandlerTopicKeys(
  serviceRoot: string,
  apiPackage: string,
): Promise<string[]> {
  const eventsDir = join(serviceRoot, 'src', 'events');
  const files = await collectFiles(eventsDir, /\.event\.(ts|js)$/);
  const out = new Set<string>();

  // Match either form:
  //   defineEventHandler(billingEvents.topics.chargeSucceeded, ...)
  //   defineEventHandler(billingEvents.chargeSucceeded, ...) when the user
  //     destructures topics in the import.
  // We need to know which import binding maps to the api package; that's the
  // import statement.
  for (const file of files) {
    const src = await readFile(file, 'utf-8').catch(() => '');
    if (!src) continue;

    // Find the local binding name for this api package: e.g.
    //   import billingEvents from '@example/billing-events';
    const importRe = new RegExp(
      `import\\s+(\\w+)\\s+from\\s+['"]${escapeForRegex(apiPackage)}['"]`,
      'm',
    );
    const importMatch = importRe.exec(src);
    if (!importMatch) continue;
    const local = importMatch[1]!;

    const dehRe = new RegExp(
      `defineEventHandler\\s*\\(\\s*${escapeForRegex(local)}(?:\\.topics)?\\.(\\w+)\\s*,`,
      'g',
    );
    let m: RegExpExecArray | null;
    while ((m = dehRe.exec(src)) !== null) {
      out.add(m[1]!);
    }
  }

  return Array.from(out);
}

async function collectFiles(dir: string, pattern: RegExp): Promise<string[]> {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      out.push(...(await collectFiles(full, pattern)));
    } else if (pattern.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read the defineEventApi spec from an event API package. Looks at the
 * workspace's node_modules first, falls back to the workspace package path
 * when possible. Reads the package's `src/index.ts` (or `dist/index.js`)
 * statically — no execution — to extract topic names and wire topics.
 */
export async function readEventApiPackage(
  workspaceRoot: string,
  packageName: string,
): Promise<RawEventApi | undefined> {
  const candidates = [
    join(workspaceRoot, 'node_modules', packageName, 'src', 'index.ts'),
    join(workspaceRoot, 'node_modules', packageName, 'dist', 'index.js'),
  ];

  // Also try unscoped workspace paths: apis/<bare-name>-events/src/index.ts
  const bare = packageName.replace(/^@[^/]+\//, '').replace(/-events$/, '');
  candidates.push(
    join(workspaceRoot, 'apis', `${bare}-events`, 'src', 'index.ts'),
    join(workspaceRoot, 'examples', 'ts', 'apis', `${bare}-events`, 'src', 'index.ts'),
  );

  for (const path of candidates) {
    const src = await readFile(path, 'utf-8').catch(() => '');
    if (!src) continue;
    const parsed = parseEventApiSource(src);
    if (parsed) return parsed;
  }
  return undefined;
}

/**
 * Static parse of a defineEventApi(...) source file. We do not eval anything —
 * we extract `name:` and each `topic: '...'` per topic key. Schema bodies are
 * skipped because they're zod expressions; for the graph we only need names
 * and wire topics.
 */
function parseEventApiSource(src: string): RawEventApi | undefined {
  // Find the defineEventApi(...) call body.
  const callIdx = src.indexOf('defineEventApi');
  if (callIdx < 0) return undefined;
  const openParen = src.indexOf('(', callIdx);
  if (openParen < 0) return undefined;
  const body = sliceBalanced(src, openParen);
  if (!body) return undefined;

  const nameMatch = /\bname\s*:\s*['"`]([^'"`]+)['"`]/.exec(body);
  if (!nameMatch) return undefined;

  const transportMatch = /\btransport\s*:\s*['"`]([^'"`]+)['"`]/.exec(body);

  // Find each `topicKey: { ... topic: '...' ... }` entry. The simplest reliable
  // approach: locate the `topics:` block, then scan top-level keys inside it.
  const topicsBlockMatch = /\btopics\s*:\s*\{/.exec(body);
  if (!topicsBlockMatch) return undefined;
  const topicsBlock = sliceBalancedFromBrace(body, topicsBlockMatch.index + topicsBlockMatch[0].length - 1);
  if (!topicsBlock) return undefined;

  const topics: Record<string, { topic: string; description?: string }> = {};
  const keyValueRe = /(\w+)\s*:\s*\{/g;
  let km: RegExpExecArray | null;
  while ((km = keyValueRe.exec(topicsBlock)) !== null) {
    const topicKey = km[1]!;
    const entryStart = km.index + km[0].length - 1;
    const entryBody = sliceBalancedFromBrace(topicsBlock, entryStart);
    if (!entryBody) continue;
    const wireMatch = /\btopic\s*:\s*['"`]([^'"`]+)['"`]/.exec(entryBody);
    if (!wireMatch) continue;
    const descMatch = /\bdescription\s*:\s*['"`]([^'"`]+)['"`]/.exec(entryBody);
    topics[topicKey] = {
      topic: wireMatch[1]!,
      ...(descMatch ? { description: descMatch[1]! } : {}),
    };
  }

  if (Object.keys(topics).length === 0) return undefined;

  return {
    name: nameMatch[1]!,
    ...(transportMatch ? { transport: transportMatch[1]! } : {}),
    topics,
  };
}

/** Given an open-paren index, return the inside of the matched parens. */
function sliceBalanced(src: string, openIdx: number): string | undefined {
  if (src[openIdx] !== '(') return undefined;
  let depth = 0;
  let i = openIdx;
  let inStr: string | undefined;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === inStr) inStr = undefined;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return undefined;
}

/** Given an open-brace index, return the inside of the matched braces. */
function sliceBalancedFromBrace(src: string, openIdx: number): string | undefined {
  if (src[openIdx] !== '{') return undefined;
  let depth = 0;
  let i = openIdx;
  let inStr: string | undefined;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === inStr) inStr = undefined;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return undefined;
}

export function resolve_(...args: string[]): string {
  return resolve(...args);
}
