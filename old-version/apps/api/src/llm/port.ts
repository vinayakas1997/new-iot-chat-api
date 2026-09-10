/**
 * LLM PORT — the chat/generation boundary.
 *
 *   - MockLLM       deterministic, offline; echoes context back usefully   (mock)
 *   - AnthropicLLM  Claude via the Vercel AI SDK, lazy-loaded              (live)
 *
 * Tool-calling is modelled explicitly: the caller passes `tools`, the port runs
 * the tool loop internally and returns the final text. Streaming is exposed as
 * an async iterable of text chunks.
 */
export interface LlmTool {
  name: string;
  description: string;
  /** JSON-schema of the tool input. */
  parameters: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  system: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxSteps?: number;
}

export interface LlmPort {
  /** Full completion (used by extraction / schedule parsing / reports). */
  complete(opts: GenerateOptions): Promise<string>;
  /** Streaming completion (used by the chat endpoint). */
  stream(opts: GenerateOptions): AsyncIterable<string>;
}
