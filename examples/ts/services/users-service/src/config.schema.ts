import { z } from 'zod';

export const UsersServiceConfigSchema = z.object({
  name: z.string().default('users-service'),
  env: z.enum(['development', 'staging', 'production']).default('development'),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  port: z.number().default(4001),

  allowedOrigins: z.array(z.string()).optional(),

  connectors: z.object({
    psqlMain: z.object({
      type: z.literal('postgres'),
      url: z.string(),
    }),
  }),

  schemas: z.object({
    mainDb: z.object({
      package: z.string(),
      connector: z.string(),
    }),
  }),
});

export type UsersServiceConfig = z.infer<typeof UsersServiceConfigSchema>;
export type Config = UsersServiceConfig;
