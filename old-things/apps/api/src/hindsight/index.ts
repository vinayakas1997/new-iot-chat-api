import { config } from '../config.js';
import { logger } from '../logger.js';
import { HttpHindsight } from './http-hindsight.js';
import { MockHindsight } from './mock-hindsight.js';
import type { HindsightPort } from './port.js';

let singleton: HindsightPort | null = null;

export function getHindsight(): HindsightPort {
  if (singleton) return singleton;
  singleton = config.isMock ? new MockHindsight() : new HttpHindsight();
  logger.info({ mode: config.runtimeMode }, 'hindsight port initialised');
  return singleton;
}

/** Test/seed helper: force the mock instance (used by the dev seed script). */
export function _setHindsight(port: HindsightPort) {
  singleton = port;
}

export type { HindsightPort } from './port.js';
export * from './bank.js';
