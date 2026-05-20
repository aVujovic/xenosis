import { z } from 'zod';

export const loginBodySchema = z.object({
  email: z.string().email(),
});
