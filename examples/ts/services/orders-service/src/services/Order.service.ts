import { Exception, type ILogger } from '@xenosisorg/xenosis-core';
import type { CartApi } from '@example/cart-api';
import type { PricingApi } from '@example/pricing-api';
import type { PaymentsApi } from '@example/payments-api';
import type { NotificationsApi } from '@example/notifications-api';
import type OrderRepository from '../repository/Order.repository';

/**
 * The checkout orchestrator. `createOrder` fans out across four peers over the
 * typed `this.api.*` proxy — every hop carries the active trace context, so the
 * whole chain shows up as one trace:
 *
 *   cart.getCart      → what the user is buying
 *   pricing.quote     → subtotal + tax + total
 *   payments.charge   → capture the money (payments calls orders.markPaid back)
 *   notifications.orderConfirmed → tell the user
 *
 * payments.charge succeeds only because orders is in payments'
 * boundaries.allowedCallers; the reverse markPaid call lands back here.
 */
export default class OrderService {
  private logger: ILogger;
  private orderRepository: OrderRepository;
  private api: {
    cart: CartApi;
    pricing: PricingApi;
    payments: PaymentsApi;
    notifications: NotificationsApi;
  };

  constructor({
    logger,
    orderRepository,
    api,
  }: {
    logger: ILogger;
    orderRepository: OrderRepository;
    api: {
      cart: CartApi;
      pricing: PricingApi;
      payments: PaymentsApi;
      notifications: NotificationsApi;
    };
  }) {
    this.logger = logger;
    this.orderRepository = orderRepository;
    this.api = api;
  }

  async createOrder(userId: string) {
    this.logger.info(`Checkout started for user=${userId}`);

    // 1. What's in the cart?
    const cart = await this.api.cart.getCart({ userId });

    // 2. Price it.
    const quote = await this.api.pricing.quote({
      lines: cart.lines.map((l) => ({ sku: l.sku, qty: l.qty, unitPrice: l.unitPrice })),
    });

    // 3. Persist the pending order so payments can flip it to paid.
    const order = this.orderRepository.create({
      userId,
      total: quote.total,
      currency: quote.currency,
    });

    // 4. Charge. payments-service captures the money and calls markPaid() back.
    await this.api.payments.charge({
      orderId: order.id,
      userId,
      amount: quote.total,
      currency: quote.currency,
    });

    // 5. Notify. Re-read so we return the post-callback (paid) state.
    const finalOrder = this.orderRepository.find(order.id) ?? order;
    await this.api.notifications.orderConfirmed({
      orderId: finalOrder.id,
      userId,
      total: finalOrder.total,
      currency: finalOrder.currency,
    });

    this.logger.info(`Checkout complete for order=${finalOrder.id} status=${finalOrder.status}`);
    return finalOrder;
  }

  markPaid(orderId: string, paymentId: string) {
    const updated = this.orderRepository.markPaid(orderId, paymentId);
    if (!updated) {
      throw Exception.NotFound({ orderId, reason: 'order not found' });
    }
    this.logger.info(`Order ${orderId} marked paid (payment=${paymentId})`);
    return updated;
  }
}
