import type { ILogger } from '@xenosisorg/xenosis-core';

/**
 * Demo notifier. A real notifications-service would push to email/SMS/web
 * push; here we just log that the confirmation was "sent".
 */
export default class NotificationService {
  private logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.logger = logger;
  }

  orderConfirmed(input: { orderId: string; userId: string; total: number; currency: string }) {
    this.logger.info(
      `📣 Order ${input.orderId} confirmed for user=${input.userId} — ` +
        `${input.total} ${input.currency}. Sending confirmation email.`,
    );
    return { notified: true, channel: 'email' };
  }
}
