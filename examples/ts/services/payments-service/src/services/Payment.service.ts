import type { ILogger } from '@xenosisorg/xenosis-core';
import type { OrdersApi } from '@example/orders-api';
import type PaymentRepository from '../repository/Payment.repository';

/**
 * Captures a charge, then calls back into orders-service to flip the order to
 * `paid`. The callback (`this.api.orders.markPaid`) is the reverse leg of the
 * checkout flow — payments → orders — and is what `boundaries.allowedCallers`
 * on payments is about: only orders may charge here, and payments in turn calls
 * orders back over the same typed proxy machinery, carrying the trace context.
 */
export default class PaymentService {
  private logger: ILogger;
  private paymentRepository: PaymentRepository;
  private api: { orders: OrdersApi };

  constructor({
    logger,
    paymentRepository,
    api,
  }: {
    logger: ILogger;
    paymentRepository: PaymentRepository;
    api: { orders: OrdersApi };
  }) {
    this.logger = logger;
    this.paymentRepository = paymentRepository;
    this.api = api;
  }

  async charge(input: { orderId: string; userId: string; amount: number; currency: string }) {
    this.logger.info(`Capturing ${input.amount} ${input.currency} for order=${input.orderId}`);
    const payment = this.paymentRepository.capture(input);

    // Reverse leg: tell orders the charge is captured.
    await this.api.orders.markPaid({ orderId: input.orderId, paymentId: payment.id });

    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      status: 'captured' as const,
      amount: payment.amount,
      currency: payment.currency,
    };
  }
}
