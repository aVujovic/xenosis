import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildOpenapiDocument, swaggerUiHtml } from './openapi.loader';
import { OPENAPI_REGISTRY } from '../runtime/server';

/** Build a stub Express app carrying a route registry under the symbol. */
function appWith(routes: unknown[]) {
  return { [OPENAPI_REGISTRY]: routes } as never;
}

describe('buildOpenapiDocument', () => {
  it('emits an OpenAPI 3.1 document with info from config', () => {
    const doc = buildOpenapiDocument(appWith([]), {
      name: 'users-service',
      version: '2.1.0',
    });
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toMatchObject({ title: 'users-service', version: '2.1.0' });
  });

  it('falls back to defaults for title/version', () => {
    const doc = buildOpenapiDocument(appWith([]), {}) as any;
    expect(doc.info.title).toBe('Xenosis service');
    expect(doc.info.version).toBe('1.0.0');
  });

  it('converts :id path segments to {id}', () => {
    const doc = buildOpenapiDocument(
      appWith([{ method: 'GET', fullPath: '/api/v1/users/:id' }]),
      {},
    ) as any;
    expect(Object.keys(doc.paths)).toContain('/api/v1/users/{id}');
  });

  it('adds an undeclared path param as a required string', () => {
    const doc = buildOpenapiDocument(
      appWith([{ method: 'GET', fullPath: '/users/:id' }]),
      {},
    ) as any;
    const params = doc.paths['/users/{id}'].get.parameters;
    expect(params).toContainEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  });

  it('derives requestBody from a Request.Body schema', () => {
    const doc = buildOpenapiDocument(
      appWith([
        {
          method: 'POST',
          fullPath: '/users',
          meta: { request: [{ in: 'body', schema: z.object({ name: z.string() }) }] },
        },
      ]),
      {},
    ) as any;
    const body = doc.paths['/users'].post.requestBody;
    expect(body.required).toBe(true);
    expect(body.content['application/json'].schema.type).toBe('object');
    expect(body.content['application/json'].schema.required).toContain('name');
  });

  it('derives query parameters with required flag from a Query schema', () => {
    const doc = buildOpenapiDocument(
      appWith([
        {
          method: 'GET',
          fullPath: '/users',
          meta: {
            request: [
              {
                in: 'query',
                schema: z.object({ limit: z.number(), cursor: z.string().optional() }),
              },
            ],
          },
        },
      ]),
      {},
    ) as any;
    const params = doc.paths['/users'].get.parameters;
    const limit = params.find((p: any) => p.name === 'limit');
    const cursor = params.find((p: any) => p.name === 'cursor');
    expect(limit).toMatchObject({ in: 'query', required: true });
    expect(cursor).toMatchObject({ in: 'query', required: false });
  });

  it('uses .returns() schema for the 200 response, generic 200 otherwise', () => {
    const doc = buildOpenapiDocument(
      appWith([
        {
          method: 'GET',
          fullPath: '/a',
          meta: { request: [], response: z.object({ id: z.string() }) },
        },
        { method: 'GET', fullPath: '/b' },
      ]),
      {},
    ) as any;
    expect(doc.paths['/a'].get.responses['200'].content).toBeDefined();
    expect(doc.paths['/b'].get.responses['200']).toEqual({ description: 'OK' });
  });

  it('merges multiple methods on the same path', () => {
    const doc = buildOpenapiDocument(
      appWith([
        { method: 'GET', fullPath: '/users' },
        { method: 'POST', fullPath: '/users' },
      ]),
      {},
    ) as any;
    expect(Object.keys(doc.paths['/users'])).toEqual(['get', 'post']);
  });
});

describe('swaggerUiHtml', () => {
  it('returns a handler that serves HTML pointing at the spec path', () => {
    const handler = swaggerUiHtml('/openapi.json', 'Users');
    let sent = '';
    let contentType = '';
    const res = {
      setHeader: (name: string, value: string) => {
        if (name.toLowerCase() === 'content-type') contentType = value;
        return res;
      },
      send: (html: string) => {
        sent = html;
        return res;
      },
    };
    handler({} as never, res as never, (() => {}) as never);
    expect(sent).toContain('swagger-ui');
    expect(sent).toContain('/openapi.json');
    expect(sent).toContain('Users');
    expect(contentType).toContain('text/html');
  });
});
