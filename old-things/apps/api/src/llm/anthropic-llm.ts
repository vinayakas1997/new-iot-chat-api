/**
 * Claude via the Vercel AI SDK. The `ai` and `@ai-sdk/anthropic` packages are
 * optionalDependencies and are imported lazily so mock-mode installs/builds
 * never require them. If they're missing in live mode we fail loudly at first
 * use with an actionable message.
 */
import { config } from '../config.js';
import type { GenerateOptions, LlmPort, LlmTool } from './port.js';

type AiModule = typeof import('ai');
type AnthropicModule = typeof import('@ai-sdk/anthropic');

let aiMod: AiModule | null = null;
let anthropicMod: AnthropicModule | null = null;

async function load() {
  if (aiMod && anthropicMod) return { ai: aiMod, anthropic: anthropicMod };
  try {
    aiMod = await import('ai');
    anthropicMod = await import('@ai-sdk/anthropic');
  } catch {
    throw new Error(
      "live mode needs the 'ai' and '@ai-sdk/anthropic' packages. Run: pnpm --filter @app/api add ai @ai-sdk/anthropic",
    );
  }
  return { ai: aiMod, anthropic: anthropicMod };
}

function toAiTools(ai: AiModule, tools: LlmTool[] | undefined) {
  if (!tools?.length) return undefined;
  const entries = tools.map((t) => [
    t.name,
    ai.tool({
      description: t.description,
      // The AI SDK accepts a JSON schema via jsonSchema(); parameters are authored as JSON schema in our port.
      parameters: ai.jsonSchema(t.parameters as never),
      execute: (args: unknown) => t.execute((args ?? {}) as Record<string, unknown>),
    }),
  ]);
  return Object.fromEntries(entries) as Record<string, ReturnType<AiModule['tool']>>;
}

export class AnthropicLlm implements LlmPort {
  async complete(opts: GenerateOptions): Promise<string> {
    const { ai, anthropic } = await load();
    const model = anthropic.createAnthropic({ apiKey: config.chat.anthropicApiKey })(config.chat.model);
    const { text } = await ai.generateText({
      model,
      system: opts.system,
      messages: opts.messages,
      tools: toAiTools(ai, opts.tools),
      maxSteps: opts.maxSteps ?? 5,
    });
    return text;
  }

  async *stream(opts: GenerateOptions): AsyncIterable<string> {
    const { ai, anthropic } = await load();
    const model = anthropic.createAnthropic({ apiKey: config.chat.anthropicApiKey })(config.chat.model);
    const result = ai.streamText({
      model,
      system: opts.system,
      messages: opts.messages,
      tools: toAiTools(ai, opts.tools),
      maxSteps: opts.maxSteps ?? 5,
    });
    for await (const chunk of result.textStream) yield chunk;
  }
}
