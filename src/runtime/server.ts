/**
 * Server provider — builds the HTTP adapter based on `config.http.framework`
 * and exposes its `XServer` to the awilix container under the `server` cradle
 * key. The adapter itself is registered under `httpAdapter` (internal use) so
 * `commands.start()` can call `adapter.mountErrorHandler` / `adapter.listen`
 * without knowing which framework runs underneath.
 *
 * Adapters shipped today:
 *   - express (default)
 *   - hono    (opt-in: `config.http.framework = "hono"`; requires the
 *              `hono` + `@hono/node-server` peer deps in the service)
 *
 * Adapter construction is async (Hono is loaded via dynamic import) so the
 * boot path awaits `createHttpAdapter(config)` once and registers the result
 * as a value.
 */
import {
  createExpressAdapter,
  createHonoAdapter,
  OPENAPI_REGISTRY,
  type HttpAdapter,
} from './httpAdapter.js';
import { HTTP_SERVER } from '../rest/http.js';

export { HTTP_SERVER, OPENAPI_REGISTRY };

/**
 * Async factory used by xenosisBootstrap. Returns the framework-specific
 * adapter. Callers register `adapter.app` as `server` and `adapter` as
 * `httpAdapter` in the container.
 */
export async function createHttpAdapter(config: any): Promise<HttpAdapter> {
  const framework = config?.http?.framework ?? 'express';
  if (framework === 'hono') {
    return createHonoAdapter(config);
  }
  return createExpressAdapter(config);
}

/**
 * Back-compat default export — synchronous Express-only provider for callers
 * (e.g. older testing-kit setups) that haven't migrated to `createHttpAdapter`.
 * The main bootstrap path no longer goes through this.
 */
const serverProvider = ({ config }: { config: any }) => {
  return createExpressAdapter(config).app;
};

export default serverProvider;
