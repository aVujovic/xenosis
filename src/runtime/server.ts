/**
 * Server provider — builds the HTTP adapter and exposes its `XServer` to the
 * awilix container under the `server` cradle key. The adapter itself is an
 * implementation detail; user code only sees the framework-agnostic `XServer`.
 *
 * Today the only adapter is Express. Phase 3 will switch this provider on
 * `config.http?.framework` to also offer a Hono adapter; same `server` cradle
 * key, same XServer contract, no user-code change.
 */
import { createExpressAdapter, OPENAPI_REGISTRY } from './httpAdapter.js';
import { HTTP_SERVER, type XServer } from '../rest/http.js';

export { HTTP_SERVER, OPENAPI_REGISTRY };

type ProviderDeps = Pick<any, 'config'>;

const serverProvider = ({ config }: ProviderDeps): XServer => {
  const adapter = createExpressAdapter(config);
  return adapter.app;
};

export default serverProvider;
