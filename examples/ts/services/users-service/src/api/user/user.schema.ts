import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().uuid().optional(),
});

export const upgradeBodySchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3),
});

// Response shapes — used with Handler(...).returns(schema) so OpenAPI documents
// what each route returns.
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string(),
});

export const userListSchema = z.array(userSchema);
