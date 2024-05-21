import z from 'zod';

export const registeredClientPayloadSchema = z.object({
  token: z.string(),
});
