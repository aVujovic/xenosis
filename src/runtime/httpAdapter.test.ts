import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import {
  createExpressAdapter,
  createHonoAdapter,
  createRawBodyMatcher,
  type HttpAdapter,
  type ServerOptions,
} from './httpAdapter';
import type { XReq, XRes } from '../rest/http';

// ─── createRawBodyMatcher (pure) ─────────────────────────────────────────────

describe('createRawBodyMatcher', () => {
  const none = () => false;

  it('returns undefined when the option is absent or names nothing', () => {
    expect(createRawBodyMatcher(undefined)).toBeUndefined();
    expect(createRawBodyMatcher({})).toBeUndefined();
    expect(createRawBodyMatcher({ paths: [], headers: [] })).toBeUndefined();
  });

  it('matches a path exactly, not by prefix', () => {
    const m = createRawBodyMatcher({ paths: ['/webhook'] })!;
    expect(m('/webhook', none)).toBe(true);
    expect(m('/webhook/sub', none)).toBe(false);
    expect(m('/webhookx', none)).toBe(false);
    expect(m('/', none)).toBe(false);
  });

  it('matches header presence by lowercased name, ignoring the value', () => {
    const m = createRawBodyMatcher({ headers: ['Stripe-Signature'] })!;
    const present = new Set(['stripe-signature']);
    expect(m('/anything', (n) => present.has(n))).toBe(true);
    expect(m('/anything', none)).toBe(false);
  });

  it("ORs paths and headers — either match captures", () => {
    const m = createRawBodyMatcher({ paths: ['/webhook'], headers: ['x-hub-signature-256'] })!;
    const present = new Set(['x-hub-signature-256']);
    expect(m('/webhook', none)).toBe(true);
    expect(m('/other', (n) => present.has(n))).toBe(true);
    expect(m('/other', none)).toBe(false);
  });
});

// ─── Live adapters ───────────────────────────────────────────────────────────

interface Seen {
  rawBody: Buffer | undefined;
  /** `'rawBody' in req` — stronger than `undefined`: the key is never set. */
  hasRawBodyKey: boolean;
  body: unknown;
}

const running: HttpAdapter[] = [];

afterEach(async () => {
  await Promise.all(
    running.splice(0).map(
      (a) => new Promise<void>((resolve) => a.httpServer.close(() => resolve())),
    ),
  );
});

/**
 * Boot an adapter with `serverOptions`, mount POST capture routes on a few
 * paths, listen on a random port, and return a `send()` that posts exact
 * bytes plus `last()` for what the handler saw.
 */
async function boot(
  make: (config: { serverOptions?: ServerOptions }) => HttpAdapter | Promise<HttpAdapter>,
  serverOptions?: ServerOptions,
) {
  const adapter = await make(serverOptions ? { serverOptions } : {});
  running.push(adapter);

  const seen: Seen[] = [];
  const capture = (req: XReq, res: XRes) => {
    seen.push({ rawBody: req.rawBody, hasRawBodyKey: 'rawBody' in req, body: req.body });
    res.status(200).json({ ok: true });
  };
  for (const path of ['/webhook', '/webhook/sub', '/other']) {
    adapter.app.post(path, capture);
  }
  adapter.mountErrorHandler((err, _req, res) => {
    const e = err as { status?: number; type?: string };
    res.status(e.status ?? 500).json({ error: e.type ?? 'error' });
  });

  await adapter.listen(0);
  const { port } = adapter.httpServer.address() as AddressInfo;

  // `new Uint8Array(buf)` copies into a plain ArrayBuffer-backed view, which is
  // what fetch's BodyInit typing accepts; the bytes on the wire are unchanged.
  const send = (path: string, body: Buffer, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body: new Uint8Array(body) });
  const last = () => seen[seen.length - 1]!;

  return { send, last, seen };
}

// Key order (b before a) and whitespace differ from what JSON.stringify would
// produce, and the string carries multi-byte UTF-8 — a re-serialisation of the
// parsed object cannot reproduce these bytes.
const JSON_BYTES = Buffer.from('{ "b": "žćš 🚀",  "a": 1 }', 'utf8');
const JSON_PARSED = { b: 'žćš 🚀', a: 1 };
const JSON_CT = { 'content-type': 'application/json' };

const FORM_BYTES = Buffer.from('a=1&b=%C5%BE', 'utf8');
const FORM_PARSED = { a: '1', b: 'ž' };
const FORM_CT = { 'content-type': 'application/x-www-form-urlencoded' };

const TEXT_BYTES = Buffer.from('plain žćš 🚀', 'utf8');
const TEXT_CT = { 'content-type': 'text/plain; charset=utf-8' };

const STRIPE = { 'stripe-signature': 't=1,v1=abc' };

/** Shared matrix — the contract is identical on both adapters. */
function describeAdapter(
  name: string,
  make: (config: { serverOptions?: ServerOptions }) => HttpAdapter | Promise<HttpAdapter>,
) {
  describe(`${name} adapter — serverOptions.rawBody`, () => {
    it('option absent: req.rawBody is never set and JSON still parses into req.body', async () => {
      const { send, last } = await boot(make);
      const res = await send('/webhook', JSON_BYTES, { ...JSON_CT, ...STRIPE });
      expect(res.status).toBe(200);
      expect(last().hasRawBodyKey).toBe(false);
      expect(last().rawBody).toBeUndefined();
      expect(last().body).toEqual(JSON_PARSED);
    });

    it('option {} (or empty lists) captures nothing', async () => {
      for (const rawBody of [{}, { paths: [], headers: [] }]) {
        const { send, last } = await boot(make, { rawBody });
        await send('/webhook', JSON_BYTES, { ...JSON_CT, ...STRIPE });
        expect(last().hasRawBodyKey).toBe(false);
        expect(last().body).toEqual(JSON_PARSED);
      }
    });

    it('headers: ["stripe-signature"] — with the header gets the exact bytes, without it gets nothing', async () => {
      const { send, last } = await boot(make, { rawBody: { headers: ['stripe-signature'] } });

      await send('/other', JSON_BYTES, { ...JSON_CT, ...STRIPE });
      expect(last().rawBody).toBeInstanceOf(Buffer);
      expect(last().rawBody!.equals(JSON_BYTES)).toBe(true);
      expect(last().body).toEqual(JSON_PARSED);

      await send('/other', JSON_BYTES, JSON_CT);
      expect(last().hasRawBodyKey).toBe(false);
      expect(last().body).toEqual(JSON_PARSED);
    });

    it('header names are matched case-insensitively', async () => {
      const { send, last } = await boot(make, { rawBody: { headers: ['Stripe-Signature'] } });
      await send('/other', JSON_BYTES, { ...JSON_CT, 'STRIPE-SIGNATURE': 'x' });
      expect(last().rawBody!.equals(JSON_BYTES)).toBe(true);
    });

    it('paths: ["/webhook"] — exact match captures, sub-path does not, query string is stripped', async () => {
      const { send, last } = await boot(make, { rawBody: { paths: ['/webhook'] } });

      await send('/webhook', JSON_BYTES, JSON_CT);
      expect(last().rawBody!.equals(JSON_BYTES)).toBe(true);

      await send('/webhook/sub', JSON_BYTES, JSON_CT);
      expect(last().hasRawBodyKey).toBe(false);
      expect(last().body).toEqual(JSON_PARSED);

      await send('/webhook?x=1', JSON_BYTES, JSON_CT);
      expect(last().rawBody!.equals(JSON_BYTES)).toBe(true);

      await send('/other', JSON_BYTES, JSON_CT);
      expect(last().hasRawBodyKey).toBe(false);
    });

    it('paths and headers are ORed', async () => {
      const { send, last } = await boot(make, {
        rawBody: { paths: ['/webhook'], headers: ['x-hub-signature-256'] },
      });
      await send('/webhook', JSON_BYTES, JSON_CT);
      expect(last().rawBody!.equals(JSON_BYTES)).toBe(true);
      await send('/other', JSON_BYTES, { ...JSON_CT, 'x-hub-signature-256': 'sha256=abc' });
      expect(last().rawBody!.equals(JSON_BYTES)).toBe(true);
      await send('/other', JSON_BYTES, JSON_CT);
      expect(last().hasRawBodyKey).toBe(false);
    });

    it('bytes are identical to what was sent — multi-byte UTF-8, non-canonical key order and whitespace', async () => {
      const { send, last } = await boot(make, { rawBody: { paths: ['/webhook'] } });
      await send('/webhook', JSON_BYTES, JSON_CT);
      const { rawBody, body } = last();
      expect(Buffer.compare(rawBody!, JSON_BYTES)).toBe(0);
      expect(body).toEqual(JSON_PARSED);
      // The point of the feature: a re-serialisation would not have matched.
      expect(JSON.stringify(body)).not.toBe(JSON_BYTES.toString('utf8'));
      expect(Buffer.from(JSON.stringify(body)).equals(JSON_BYTES)).toBe(false);
    });

    it('urlencoded and text content types capture too, and req.body still parses', async () => {
      const { send, last } = await boot(make, { rawBody: { paths: ['/webhook'] } });

      await send('/webhook', FORM_BYTES, FORM_CT);
      expect(last().rawBody!.equals(FORM_BYTES)).toBe(true);
      expect(last().body).toEqual(FORM_PARSED);

      await send('/webhook', TEXT_BYTES, TEXT_CT);
      expect(last().rawBody!.equals(TEXT_BYTES)).toBe(true);
      expect(last().body).toBe(TEXT_BYTES.toString('utf8'));
    });

    it('req.body is unaffected by the option for non-matching requests of every content type', async () => {
      const { send, last } = await boot(make, { rawBody: { headers: ['stripe-signature'] } });
      await send('/webhook', JSON_BYTES, JSON_CT);
      expect(last().body).toEqual(JSON_PARSED);
      await send('/webhook', FORM_BYTES, FORM_CT);
      expect(last().body).toEqual(FORM_PARSED);
      await send('/webhook', TEXT_BYTES, TEXT_CT);
      expect(last().body).toBe(TEXT_BYTES.toString('utf8'));
    });
  });
}

describeAdapter('Express', createExpressAdapter);
describeAdapter('Hono', createHonoAdapter);

// ─── Express-only: bodySizeLimit still applies with the option on ───────────
// (The Hono adapter does not enforce bodySizeLimit today — pre-existing.)

describe('Express adapter — bodySizeLimit with rawBody on', () => {
  it('refuses a body over bodySizeLimit with 413 and never reaches the handler', async () => {
    const { send, seen } = await boot(createExpressAdapter, {
      bodySizeLimit: 32,
      rawBody: { paths: ['/webhook'] },
    });
    const big = Buffer.from(JSON.stringify({ pad: 'x'.repeat(64) }));
    expect(big.length).toBeGreaterThan(32);

    const res = await send('/webhook', big, JSON_CT);
    expect(res.status).toBe(413);
    expect(seen).toHaveLength(0);

    // A body under the limit still captures.
    await send('/webhook', Buffer.from('{"a":1}'), JSON_CT);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.rawBody!.equals(Buffer.from('{"a":1}'))).toBe(true);
  });
});
