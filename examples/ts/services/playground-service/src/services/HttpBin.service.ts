import type { ILogger, PeerClient } from '@xenosisorg/xenosis-core';
import type { HttpBinApi } from '@example/httpbin-api';

export interface EchoInput {
  amount: number;
  currency: string;
  note?: string;
}

/**
 * Thin service that wraps the external httpbin.org peer.
 *
 * Demonstrates everything an external peer integration needs:
 *   - form-urlencoded body encoding (declared on the PeerApi)
 *   - custom Bearer header (declared in xenosis.config.json → peers.httpbin.headers)
 *   - errorMapper translating vendor status codes into Xenosis Exceptions
 */
export default class HttpBinService {
  private logger: ILogger;
  private httpbin: PeerClient<HttpBinApi>;

  constructor({
    logger,
    httpbin,
  }: {
    logger: ILogger;
    httpbin: PeerClient<HttpBinApi>;
  }) {
    this.logger = logger;
    this.httpbin = httpbin;
  }

  /** Echoes a form-encoded request to httpbin /post. */
  echo(input: EchoInput) {
    this.logger.info(`Echoing to httpbin: ${input.amount} ${input.currency}`);
    return this.httpbin.echoPost(input);
  }

  /**
   * Forces httpbin to return a specific status — `errorMapper` translates
   * non-2xx into a Xenosis Exception that the global error middleware sends back
   * to the caller.
   */
  forceStatus(code: number) {
    return this.httpbin.echoStatus({ code });
  }
}
