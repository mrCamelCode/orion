import { JsonResponse } from 'potami';

/**
 * A JsonResponse that sends back a string of errors on the response object,
 * with a default status of 400.
 */
export class ErrorResponse extends JsonResponse<{ errors: string[] }> {
  constructor({
    status = 400,
    errors,
  }: {
    /**
     * Defaults to 400.
     */
    status?: number;
    errors: string[];
  }) {
    super({ errors }, { status });
  }
}
