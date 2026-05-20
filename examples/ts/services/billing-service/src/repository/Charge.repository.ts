import { randomUUID } from 'node:crypto';

export interface ChargeRecord {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'refunded';
  reason?: string;
  createdAt: string;
}

/**
 * In-memory store for the demo. Real billing would persist to its own DB
 * (e.g. @example/mysql-billing schema package).
 */
export default class ChargeRepository {
  private store = new Map<string, ChargeRecord>();

  create(input: { userId: string; amount: number; currency: string }): ChargeRecord {
    const id = randomUUID();
    const record: ChargeRecord = {
      id,
      userId: input.userId,
      amount: input.amount,
      currency: input.currency,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.store.set(id, record);
    return record;
  }

  find(id: string): ChargeRecord | undefined {
    return this.store.get(id);
  }

  markRefunded(id: string, reason?: string): ChargeRecord | undefined {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const updated: ChargeRecord = reason
      ? { ...existing, status: 'refunded', reason }
      : { ...existing, status: 'refunded' };
    this.store.set(id, updated);
    return updated;
  }
}
