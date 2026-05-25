import { defineConfigSchema } from '@xenosisorg/xenosis-core';

/**
 * Extend the base Xenosis config with THIS service's own typed keys. Xenosis
 * auto-loads this file at boot and validates `xenosis.config.json` against it —
 * fail-fast, with a precise error if a value is wrong or missing.
 *
 * The base keys (name, port, peers, boundaries, authentication, schemas, …) are
 * always validated; add your own below. Unknown keys still pass through, so this
 * is purely additive.
 *
 * Example — require a typed `stripe` block in xenosis.config.json:
 *
 *   import { defineConfigSchema, z } from '@xenosisorg/xenosis-core';
 *
 *   export default defineConfigSchema({
 *     stripe: z.object({
 *       secretKey: z.string(),
 *       webhookSecret: z.string(),
 *     }),
 *   });
 *
 * Then `config.stripe.secretKey` is typed everywhere (cradle, services), and a
 * missing/wrong value aborts startup instead of surfacing as `undefined`.
 */
export default defineConfigSchema({
  // add your service-specific config keys here
});
