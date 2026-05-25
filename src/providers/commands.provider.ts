import { parentPort } from 'worker_threads';
import { createServer, type Server } from 'node:http';
import type { Context, ILogger } from '../types';
import type { XenosisConfig } from '../config.schema';
import type { Signals } from './signals.provider';

type Disconnect = () => Promise<void> | void;

export class Commands {
  private server: any;
  private config: XenosisConfig;
  private logger: ILogger;
  private errorHandlerMiddleware: any;
  private schemaDisconnects: Disconnect[];
  private peerDisconnects: Disconnect[];
  private signals: Signals;

  private listener?: Server;

  constructor({
    server,
    config,
    logger,
    errorHandlerMiddleware,
    schemaDisconnects,
    peerDisconnects,
    signals,
  }: Pick<
    Context,
    'server' | 'config' | 'logger' | 'errorHandlerMiddleware'
  > & {
    schemaDisconnects?: Disconnect[];
    peerDisconnects?: Disconnect[];
    signals: Signals;
  }) {
    this.server = server;
    this.config = config;
    this.logger = logger;
    this.errorHandlerMiddleware = errorHandlerMiddleware;
    this.schemaDisconnects = schemaDisconnects ?? [];
    this.peerDisconnects = peerDisconnects ?? [];
    this.signals = signals;
  }

  /**
   * Starts the HTTP server and registers teardown callbacks with the central
   * `Signals` provider. On SIGTERM / SIGINT the Signals provider runs every
   * registered handler (close listener → drain peers → drain schemas) then
   * exits.
   *
   * The Express app is wrapped in an explicit `http.Server` so we control the
   * listen options and can retry on EADDRINUSE — Node sets SO_REUSEADDR by
   * default (avoids TIME_WAIT rebind); the retry covers the brief window
   * during dev restarts where the previous child is still releasing the port.
   */
  start(): Promise<void> {
    const { server, config } = this;
    server.use(this.errorHandlerMiddleware);

    const httpServer = createServer(server);
    this.listener = httpServer;

    const port = config.port;
    const maxRetries = 10;
    const retryDelayMs = 300;

    // Register teardown with the central Signals registry (order matters):
    // 1. stop accepting connections + force keep-alive sockets shut
    // 2. drain peer transports
    // 3. drain schema clients
    this.signals.onTerm(() => this.closeListener());
    this.signals.onTerm(() => this.runDisconnects(this.peerDisconnects, 'peer'));
    this.signals.onTerm(() => this.runDisconnects(this.schemaDisconnects, 'schema'));

    return new Promise<void>((resolve, reject) => {
      let attempt = 0;

      const onListening = () => {
        httpServer.removeListener('error', onError);
        this.logger.info(`🚀 Service is running on http://127.0.0.1:${port}`);
        if (parentPort) {
          parentPort.postMessage({ type: 'STARTED' });
        }
        resolve();
      };

      const onError = (err: NodeJS.ErrnoException) => {
        // Always detach the one-shot listeners before retrying so we never
        // accumulate handlers on the same server instance across attempts.
        httpServer.removeListener('listening', onListening);

        if (err.code === 'EADDRINUSE' && attempt < maxRetries) {
          attempt++;
          this.logger.warn(
            `Port ${port} busy (likely a restarting dev process) — retry ${attempt}/${maxRetries} in ${retryDelayMs}ms`,
          );
          setTimeout(tryListen, retryDelayMs);
          return;
        }
        if (err.code === 'EADDRINUSE') {
          this.logger.error(
            `Port ${port} is still in use after ${maxRetries} retries. ` +
              `Kill the stale process:  lsof -ti :${port} | xargs kill -9`,
          );
        }
        reject(err);
      };

      const tryListen = () => {
        // Re-arm both one-shot listeners for this attempt. Using `once`
        // guarantees each fires at most once; whichever wins removes the
        // other, so no handler ever leaks onto the server instance.
        httpServer.once('listening', onListening);
        httpServer.once('error', onError);
        httpServer.listen(port);
      };

      tryListen();
    });
  }

  private async closeListener(): Promise<void> {
    if (!this.listener) return;
    const listener = this.listener;
    await new Promise<void>((resolve) => {
      listener.close((err) => {
        if (err) {
          this.logger.warn({ err: String(err) }, 'HTTP listener close error');
        } else {
          this.logger.info('🔌 HTTP listener closed');
        }
        resolve();
      });

      // `close()` only stops accepting new connections — it waits for
      // existing (keep-alive) sockets to go idle, which may never happen for
      // a long-lived client. Force them shut so the port is released promptly
      // and the close() callback fires. Node 18.2+.
      listener.closeAllConnections?.();
    });
  }

  private async runDisconnects(
    list: Disconnect[],
    kind: 'peer' | 'schema',
  ): Promise<void> {
    if (list.length === 0) return;
    this.logger.info(`Draining ${list.length} ${kind} connection(s)…`);
    const results = await Promise.allSettled(list.map((fn) => fn()));
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn({ err: String(r.reason) }, `${kind} disconnect failed`);
      }
    }
  }
}
