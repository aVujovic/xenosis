import { randomUUID } from 'node:crypto';
import type { OrderRecord } from '@example/orders-api';

/** In-memory order store for the demo. */
export default class OrderRepository {
  private store = new Map<string, OrderRecord>();

  create(input: { userId: string; total: number; currency: string }): OrderRecord {
    const record: OrderRecord = {
      id: randomUUID(),
      userId: input.userId,
      status: 'pending',
      total: input.total,
      currency: input.currency,
    };
    this.store.set(record.id, record);
    return record;
  }

  markPaid(orderId: string, paymentId: string): OrderRecord | undefined {
    const existing = this.store.get(orderId);
    if (!existing) return undefined;
    const updated: OrderRecord = { ...existing, status: 'paid', paymentId };
    this.store.set(orderId, updated);
    return updated;
  }

  find(orderId: string): OrderRecord | undefined {
    return this.store.get(orderId);
  }
}
