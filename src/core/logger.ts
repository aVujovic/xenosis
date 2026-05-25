import pino, { type Logger as PinoLogger } from 'pino';
import type { ILogger } from '../types';

interface LoggerConfig {
  /** Log level (default 'info'). One of: fatal, error, warn, info, debug, trace, silent. */
  logLevel?: string;
  /** Optional service name added to every log line. */
  name?: string;
  /** 'production' / 'development' / 'staging'. Drives pretty vs JSON output. */
  env?: string;
}

interface ProviderDeps {
  config: LoggerConfig;
}

/**
 * Builds the root logger for the service.
 *
 * - Production (`env: 'production'`): JSON, one log per line, no pretty printing.
 * - Anything else: human-readable via `pino-pretty` with colour + timestamp.
 *
 * Returns the pino instance directly — pino implements the ILogger contract
 * (info / error / warn / debug / trace / fatal / child).
 */
const loggerProvider = ({ config }: ProviderDeps): ILogger => {
  const isProd = config?.env === 'production';
  const level = config?.logLevel ?? 'info';

  const base: PinoLogger = pino(
    {
      level,
      base: config?.name ? { service: config.name } : null,
      // Pino default uses Unix epoch ms; keep ISO timestamps so dev logs are
      // readable without external tooling.
      timestamp: isProd ? pino.stdTimeFunctions.epochTime : pino.stdTimeFunctions.isoTime,
    },
    isProd
      ? pino.destination(1) // stdout, async
      : pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }),
  );

  return base as unknown as ILogger;
};

export default loggerProvider;
