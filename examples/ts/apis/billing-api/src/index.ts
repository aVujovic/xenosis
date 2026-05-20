import { defineServiceApi } from '@xenosisorg/xenosis-core';

/**
 * billing-service public API surface.
 *
 * Other services in the workspace can call these endpoints through
 * `this.api.billing.*` after declaring `peers.billing` in their config.
 *
 * Routes mirror the REST controllers under `services/billing-service/src/api/**`.
 * Keep them in sync by running `xenosis sync api billing` after adding or
 * changing a route.
 */

export interface ChargeRecord {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: string;
}

export interface CreateChargeInput {
  userId: string;
  amount: number;
  currency: string;
}

export interface RefundInput {
  chargeId: string;
  reason?: string;
}

export type BillingServiceApi = {
  createCharge(input: CreateChargeInput): Promise<{
    id: string;
    status: 'completed';
    amount: number;
    currency: string;
  }>;
  refund(input: RefundInput): Promise<void>;
  getCharge(params: { id: string }): Promise<ChargeRecord>;
};

export default defineServiceApi<BillingServiceApi>({
  name: 'billing',
  routes: {
    createCharge: { method: 'POST',  path: '/api/v1/charges' },
    getCharge   : { method: 'GET',   path: '/api/v1/charges/:id' },
    refund      : { method: 'POST',  path: '/api/v1/charges/refund' },
  },
});
