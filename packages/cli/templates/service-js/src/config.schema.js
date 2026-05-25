import { defineConfigSchema } from '@xenosisorg/xenosis-core';

/**
 * Extend the base Xenosis config with THIS service's own typed keys. Xenosis
 * auto-loads this file at boot and validates `xenosis.config.json` against it —
 * fail-fast, with a precise error if a value is wrong or missing.
 *
 * The base keys (name, port, peers, boundaries, authentication, schemas, …) are
 * always validated; add your own below. Unknown keys still pass through.
 *
 * Example — require a typed `stripe` block:
 *
 *   import { defineConfigSchema, z } from '@xenosisorg/xenosis-core';
 *   export default defineConfigSchema({
 *     stripe: z.object({ secretKey: z.string() }),
 *   });
 */
export default defineConfigSchema({
  // add your service-specific config keys here
});
