import { config } from '../config.js';
import { logger } from '../logger.js';
import { AnthropicLlm } from './anthropic-llm.js';
import { MockLlm } from './mock-llm.js';
import type { LlmPort } from './port.js';

let singleton: LlmPort | null = null;

export function getLlm(): LlmPort {
  if (singleton) return singleton;
  singleton = config.isMock ? new MockLlm() : new AnthropicLlm();
  logger.info({ mode: config.runtimeMode }, 'llm port initialised');
  return singleton;
}

export type { LlmPort, LlmTool, LlmMessage, GenerateOptions } from './port.js';
