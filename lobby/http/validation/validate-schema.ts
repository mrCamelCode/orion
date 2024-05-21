import { BadRequestError, getRequestPath } from 'potami';
import { ZodSchema } from 'zod';
import { logger } from '../../../logging/Logger.ts';

export function validateAgainstSchema(req: Request, body: any, schema: { body: ZodSchema }): void {
  const { success } = schema.body.safeParse(body);

  if (!success) {
    logger.warn(`Request to "${req.method} ${getRequestPath(req)}" failed schema validation.`);

    throw new BadRequestError('Failed schema validation.');
  }
}
