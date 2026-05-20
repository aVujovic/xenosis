import { describe, it, expect, vi } from 'vitest';
import { Router, getRouterRoutes } from './openapi';
import { Handler, ROUTE_META } from './Handler';
import { Request } from './Request';
import { Response } from './Response';
import { z } from 'zod';

const noop = vi.fn();

describe('recording Router', () => {
  it('records routes declared via router.route(path).verb()', () => {
    const r = Router();
    r.route('/users').get(Handler(async () => Response.OK([])));
    r.route('/users').post(Handler(async () => Response.Created({})));
    r.route('/users/:id').get(Handler(async () => Response.OK({})));

    const routes = getRouterRoutes(r);
    expect(routes).toEqual([
      expect.objectContaining({ method: 'get', path: '/users' }),
      expect.objectContaining({ method: 'post', path: '/users' }),
      expect.objectContaining({ method: 'get', path: '/users/:id' }),
    ]);
  });

  it('records routes declared via router.verb(path, handler)', () => {
    const r = Router();
    r.get('/health', noop as never);
    const routes = getRouterRoutes(r);
    expect(routes).toEqual([
      expect.objectContaining({ method: 'get', path: '/health' }),
    ]);
  });

  it('attaches the handler ROUTE_META to the record', () => {
    const r = Router();
    const built = Handler(
      Request.Body(z.object({ name: z.string() })),
      async () => Response.OK({}),
    ).returns(z.object({ id: z.string() }));
    r.route('/x').post(built);

    const [rec] = getRouterRoutes(r);
    expect(rec.meta).toBe((built as any)[ROUTE_META]);
    expect(rec.meta?.request).toHaveLength(1);
    expect(rec.meta?.response).toBeDefined();
  });

  it('still delegates to a real express router (routes are mounted)', () => {
    const r = Router();
    r.get('/works', noop as never);
    // express routers expose a `stack` of mounted layers
    expect((r as any).stack.length).toBeGreaterThan(0);
  });

  it('getRouterRoutes returns [] for a plain (non-recording) value', () => {
    expect(getRouterRoutes({})).toEqual([]);
    expect(getRouterRoutes(undefined)).toEqual([]);
  });
});
