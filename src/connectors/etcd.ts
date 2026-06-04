import { createRequire } from 'node:module';
import type { Etcd3 } from 'etcd3';
import { ILogger } from '../types';

// ESM-safe `require` so etcd3 is only loaded when this provider runs.
const require = createRequire(import.meta.url);

interface EtcdConnectorConfig {
  /** Etcd hosts. Either a single URL ('http://localhost:2379') or an array of
   *  member URLs for HA setups. */
  hosts: string | string[];
  /** Optional username/password — etcd3 sends them on every gRPC call. */
  auth?: {
    username: string;
    password: string;
  };
  /** TLS — etcd3 accepts these as { rootCertificate, certChain, privateKey }
   *  (Buffer or string). For dev clusters omit entirely; for prod read certs
   *  from disk in userland before assembling config. */
  credentials?: {
    rootCertificate?: Buffer | string;
    certChain?: Buffer | string;
    privateKey?: Buffer | string;
  };
}

const etcdProvider = ({
  logger,
  config,
}: {
  logger: ILogger;
  config: any;
}): Etcd3 => {
  const cfg = config?.connectors?.etcd as EtcdConnectorConfig | undefined;
  if (!cfg?.hosts) {
    throw new Error('connectors.etcd.hosts is required (URL or array of URLs)');
  }

  const { Etcd3 } = require('etcd3') as typeof import('etcd3');

  const client = new Etcd3({
    hosts: cfg.hosts,
    ...(cfg.auth ? { auth: cfg.auth } : {}),
    ...(cfg.credentials ? { credentials: cfg.credentials as never } : {}),
  });

  // etcd3 connects lazily on first call. We do a single round-trip on boot so
  // failures surface immediately rather than on the first user query.
  client
    .getRoles()
    .then(() => logger.info({ hosts: cfg.hosts }, 'etcd client connected'))
    .catch((err: Error) => {
      // Auth-denied is fine — means the cluster is up but our user can't list
      // roles. Anything else is a real connect error.
      const msg = err.message ?? '';
      if (msg.includes('permission denied') || msg.includes('etcdserver: permission denied')) {
        logger.info({ hosts: cfg.hosts }, 'etcd client connected (no role-read permission)');
        return;
      }
      logger.warn({ err: msg, hosts: cfg.hosts }, 'etcd initial probe failed');
    });

  return client;
};

export default etcdProvider;
