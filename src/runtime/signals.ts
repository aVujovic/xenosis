import { parentPort } from 'node:worker_threads';
import type { ILogger } from '../types';

type TermHandler = () => Promise<void> | void;

/**
 * Centralised process-signal handling.
 *
 * Any provider or service can register a teardown callback via `onTerm()`.
 * On SIGTERM / SIGINT (or a `{ type: 'SIGTERM' }` message when running inside
 * a worker thread) every handler runs, then the process exits.
 *
 * This replaces ad-hoc `process.on('SIGTERM', ...)` calls scattered across
 * providers — one registry, one ordered teardown, one exit.
 */
export class Signals {
  private terminating = false;
  private handlers: TermHandler[] = [];
  private logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.logger = logger;

    if (this.isWorker) {
      parentPort!.on('message', ({ type }: { type?: string }) => {
        if (type === 'SIGTERM') {
          void this.terminate(0);
        }
      });
    } else {
      const shutdown = (signal: NodeJS.Signals) => () => {
        void this.terminate(0, signal);
      };
      process.once('SIGTERM', shutdown('SIGTERM'));
      process.once('SIGINT', shutdown('SIGINT'));
    }
  }

  /**
   * Register a teardown callback. Called once on termination, in
   * registration order, before the process exits. Throwing/ rejecting is
   * logged but does not block the remaining handlers.
   */
  onTerm(handler: TermHandler): void {
    if (typeof handler !== 'function') {
      throw new Error('Signals.onTerm: handler must be a function');
    }
    if (this.handlers.includes(handler)) return;
    this.handlers.push(handler);
  }

  /**
   * Run every registered handler, then exit. Idempotent — repeated signals
   * are ignored while a termination is already in progress.
   */
  async terminate(code = 0, signal?: NodeJS.Signals): Promise<void> {
    if (this.terminating) return;
    this.terminating = true;

    this.logger.info(
      `👋 Shutting down${signal ? ` (${signal})` : ''} — running ${this.handlers.length} teardown handler(s)`,
    );

    const results = await Promise.allSettled(this.handlers.map((h) => h()));
    let failures = 0;
    for (const r of results) {
      if (r.status === 'rejected') {
        failures++;
        this.logger.warn({ err: String(r.reason) }, 'Teardown handler failed');
      }
    }

    this.logger.info('✅ Shutdown complete');

    // Give logs a tick to flush, then exit unconditionally. NOT unref'd:
    // an explicit shutdown must terminate the process even if something
    // (a setInterval job, an undrained client) is still keeping the event
    // loop alive — otherwise the parent watcher waits, then force-kills.
    setTimeout(
      () => process.exit(code || (failures ? 1 : 0)),
      this.isWorker ? 100 : 300,
    );
  }

  private get isWorker(): boolean {
    return !!parentPort;
  }
}

export default Signals;
