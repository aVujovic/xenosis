import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  circuitBreaker,
  handleAll,
  retry,
  timeout,
  TimeoutStrategy,
  wrap,
  type IPolicy,
} from 'cockatiel';
import type { ReliabilityConfig } from './types';

/**
 * HTTP error wrapper carrying status code so the retry policy can decide
 * whether to retry. Thrown by the HTTP transport on non-2xx responses.
 */
export class PeerHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly peer: string,
    public readonly method: string,
    public readonly url: string,
    public readonly body: unknown,
  ) {
    super(`${peer} ${method} ${url} → HTTP ${status}`);
    this.name = 'PeerHttpError';
  }
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_BACKOFF_MS = 200;
const DEFAULT_RETRY_STATUS = [502, 503, 504];
const DEFAULT_CB_RESET_MS = 30_000;

/**
 * Build a cockatiel policy stack from a ReliabilityConfig.
 * The returned `IPolicy` wraps any async fn:
 *
 *   const result = await policy.execute(() => transport.execute(req));
 *
 * Stack order (outermost first):
 *   circuitBreaker → retry → timeout → fn
 *
 * Timeout is innermost so each retry attempt has its own timer.
 */
export function buildReliabilityPolicy(config: ReliabilityConfig): IPolicy {
  const policies: IPolicy[] = [];

  if (config.circuitBreaker) {
    policies.push(
      circuitBreaker(handleAll, {
        halfOpenAfter: config.circuitBreaker.resetMs ?? DEFAULT_CB_RESET_MS,
        breaker: new ConsecutiveBreaker(
          config.circuitBreaker.failureThreshold,
        ),
      }),
    );
  }

  if (config.retry && config.retry.attempts > 0) {
    const retryOn = config.retry.retryOnStatus ?? DEFAULT_RETRY_STATUS;
    policies.push(
      retry(
        handleAll.orWhen(
          (err) => err instanceof PeerHttpError && retryOn.includes(err.status),
        ),
        {
          maxAttempts: config.retry.attempts,
          backoff: new ExponentialBackoff({
            initialDelay: config.retry.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
            maxDelay: 10_000,
          }),
        },
      ),
    );
  }

  policies.push(
    timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, TimeoutStrategy.Aggressive),
  );

  // `wrap` composes left-to-right: wrap(a, b, c).execute(fn) → a(b(c(fn)))
  return policies.length === 1 ? policies[0]! : wrap(...(policies as [IPolicy, ...IPolicy[]]));
}
