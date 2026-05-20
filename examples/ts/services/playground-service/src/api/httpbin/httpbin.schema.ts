import { z } from 'zod';

export const echoBodySchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  note: z.string().optional(),
});

export const statusParamSchema = z.object({
  code: z.coerce.number().int().min(100).max(599),
});
