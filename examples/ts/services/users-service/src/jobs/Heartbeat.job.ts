import type { ILogger } from '@xenosisorg/xenosis-core';

/**
 * Background job — picked up by autoload as `cradle.heartbeatJob`.
 *
 * Autoload only **registers** the class. It does not call any lifecycle
 * method on it. Decide how/when to start in service.ts (e.g. resolve
 * `cradle.heartbeatJob.start()` after `commands.start()`).
 *
 * This keeps autoload predictable: registration is implicit, side effects
 * are explicit.
 */
export default class HeartbeatJob {
  private logger: ILogger;
  private timer?: NodeJS.Timeout;

  constructor({ logger }: { logger: ILogger }) {
    this.logger = logger;
  }

  start(intervalMs = 60_000) {
    this.logger.info(`💓 Heartbeat job starting (every ${intervalMs}ms)`);
    this.timer = setInterval(() => {
      this.logger.info(`💓 ${new Date().toISOString()}`);
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.logger.info('💓 Heartbeat job stopped');
  }
}
