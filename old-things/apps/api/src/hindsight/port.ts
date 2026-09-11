/**
 * ────────────────────────────────────────────────────────────────────────────
 *  HINDSIGHT PORT  —  the memory store boundary
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  Everything the app needs from Hindsight goes through this interface. Two
 *  implementations:
 *    - MockHindsight  (in-memory, keyword recall)      — RUNTIME_MODE=mock
 *    - HttpHindsight  (REST calls to a Hindsight server) — RUNTIME_MODE=live
 *
 *  The Vercel AI SDK packages (@vectorize-io/hindsight-*) are a thin wrapper
 *  over the same REST API; we call it directly to keep the dependency surface
 *  small. Swap in the SDK later behind this same port if desired.
 */
import type { Fact } from '@app/shared';

export interface RecalledFact {
  statement: string;
  score: number;
  tags: string[];
  timeScopeStart: string;
  granularity: string;
}

export interface RecallResult {
  facts: RecalledFact[];
  /** Optional synthesised answer from `reflect`. */
  synthesis?: string;
}

export interface RecallOptions {
  budget?: 'low' | 'mid' | 'high';
  maxTokens?: number;
  /** Restrict to a granularity, e.g. only "daily" facts. */
  granularity?: string;
}

export interface HindsightPort {
  /** Liveness. Never throws. */
  ping(): Promise<boolean>;
  /** Write facts into a bank. Resolves only when the store has accepted them. */
  retain(bankId: string, facts: Fact[]): Promise<{ retained: number }>;
  /** Multi-strategy search over a bank. */
  recall(bankId: string, query: string, opts?: RecallOptions): Promise<RecallResult>;
  /** Reason over recalled memories to synthesise an answer. */
  reflect(bankId: string, query: string, opts?: RecallOptions): Promise<RecallResult>;
}
