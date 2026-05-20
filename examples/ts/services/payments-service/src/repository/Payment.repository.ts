import { randomUUID } from 'node:crypto';

export interface PaymentRecord {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'captured';
}

/** In-memory payment store for the demo. */
export default class PaymentRepository {
  private store = new Map<string, PaymentRecord>();

  capture(input: { orderId: string; userId: string; amount: number; currency: string }): PaymentRecord {
    const record: PaymentRecord = {
      id: randomUUID(),
      orderId: input.orderId,
      userId: input.userId,
      amount: input.amount,
      currency: input.currency,
      status: 'captured',
    };
    this.store.set(record.id, record);
    return record;
  }
}
