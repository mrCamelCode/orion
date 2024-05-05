import { stub } from 'mock';
import { logger } from '../logging/Logger.ts';

export function stubLogger() {
  stub(logger, 'info', () => {});
  stub(logger, 'warn', () => {});
  stub(logger, 'error', () => {});
}
