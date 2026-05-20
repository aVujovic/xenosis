import type { ILogger } from '@xenosisorg/xenosis-core';

interface QuoteLine {
  sku: string;
  qty: number;
  unitPrice: number;
}

const TAX_RATE = 0.2;

/**
 * Stateless pricing. Sums the line items and applies a flat tax rate. A real
 * pricing-service might apply discounts, currency conversion, or call catalog
 * for authoritative prices.
 */
export default class PricingService {
  private logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.logger = logger;
  }

  quote(lines: QuoteLine[]) {
    const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
    const total = subtotal + tax;
    this.logger.info(`Quoted ${lines.length} line(s): subtotal=${subtotal} total=${total}`);
    return { subtotal, tax, total, currency: 'USD' };
  }
}
