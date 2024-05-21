import { ZodSchema } from 'zod';

export type RequestSchema = {
  body?: ZodSchema;
  params?: ZodSchema;
};
