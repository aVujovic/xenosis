import { parentPort } from 'worker_threads';
import { type Server } from 'node:http';
import type { Context, ILogger } from '../types';
import type { XenosisConfig } from '../config.schema';
import type { Signals } from './signals';
import type { HttpAdapter } from './httpAdapter';

type Disconnect = () => Promise<void> | void;

export class Commands {
  private httpAdapter: HttpAdapter;
  private config: XenosisConfig;
  private logger: ILogger;
  private errorHandlerMiddleware: any;
  private schemaDisconnects: Disconnect[];
  private peerDisconnects: Disconnect[];
  private socketDisconnects: Disconnect[];
  private eventDisconnects: Disconnect[];
  private signals: Signals;

  private listener?: Server;

  constructor({
    httpAdapter,
    config,
    logger,
    errorHandlerMiddleware,
    schemaDisconnects,
    peerDisconnects,
    socketDisconnects,
    eventDisconnects,
    signals,
  }: Pick<Context, 'config' | 'logger' | 'errorHandlerMiddleware'> & {
    httpAdapter: HttpAdapter;
    schemaDisconnects?: Disconnect[];
    peerDisconnects?: Disconnect[];
    socketDisconnects?: Disconnect[];
    eventDisconnects?: Disconnect[];
    signals: Signals;
  }) {
    this.httpAdapter = httpAdapter;
    this.config = config;
    this.logger = logger;
    this.errorHandlerMiddleware = errorHandlerMiddleware;
    this.schemaDisconnects = schemaDisconnects ?? [];
    this.peerDisconnects = peerDisconnects ?? [];
    this.socketDisconnects = socketDisconnects ?? [];
    this.eventDisconnects = eventDisconnects ?? [];
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
    const { httpAdapter, config } = this;

    // Mount the error handler through the adapter — Express uses the 4-arg
    // middleware convention, Hono uses `app.onError`. The adapter knows which.
    httpAdapter.mountErrorHandler(this.errorHandlerMiddleware);

    // Reuse the http.Server attached by the adapter so the sockets loader has
    // a stable handle to listen on `upgrade` for.
    const httpServer = httpAdapter.httpServer;
    this.listener = httpServer;

    const port = config.port ?? 4000;
    const maxRetries = 10;
    const retryDelayMs = 300;

    // Register teardown with the central Signals registry (order matters):
    // 1. stop accepting connections + force keep-alive sockets shut
    // 2. close WebSocket connections (transport-level: terminate sockets,
    //    drop the ws server) — done before peers so any in-flight broadcast
    //    can't try to write to torn-down transports
    // 3. drain peer transports
    // 4. drain schema clients
    this.signals.onTerm(() => this.closeListener());
    this.signals.onTerm(() => this.runDisconnects(this.socketDisconnects, 'socket'));
    this.signals.onTerm(() => this.runDisconnects(this.eventDisconnects, 'event'));
    this.signals.onTerm(() => this.runDisconnects(this.peerDisconnects, 'peer'));
    this.signals.onTerm(() => this.runDisconnects(this.schemaDisconnects, 'schema'));

    return new Promise<void>((resolve, reject) => {
      let attempt = 0;

      const tryListen = () => {
        httpAdapter
          .listen(port)
          .then(() => {
            this.logger.info(`🚀 Service is running on http://127.0.0.1:${port}`);
            if (parentPort) {
              parentPort.postMessage({ type: 'STARTED' });
            }
            resolve();
          })
          .catch((err: NodeJS.ErrnoException) => {
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
          });
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
    kind: 'peer' | 'schema' | 'socket' | 'event',
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
