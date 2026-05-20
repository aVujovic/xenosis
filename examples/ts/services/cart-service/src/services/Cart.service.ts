import type { ILogger } from '@xenosisorg/xenosis-core';
import type { CartLine } from '@example/cart-api';

/**
 * In-memory demo cart. A real cart-service would persist line items per user
 * and likely call catalog/inventory to enrich + validate them. Here we return
 * a fixed basket so the checkout flow has something to price and charge.
 */
export default class CartService {
  private logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.logger = logger;
  }

  getCart(userId: string): { userId: string; lines: CartLine[] } {
    this.logger.info(`Loading cart for user=${userId}`);
    const lines: CartLine[] = [
      { sku: 'SKU-TEE', name: 'Xenosis T-shirt', qty: 2, unitPrice: 25 },
      { sku: 'SKU-MUG', name: 'Xenosis Mug', qty: 1, unitPrice: 12 },
    ];
    return { userId, lines };
  }
}
