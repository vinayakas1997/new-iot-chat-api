/**
 * Live Hindsight adapter — talks to a self-hosted Hindsight server over REST
 * (default http://localhost:8888). Endpoint paths follow the documented memory
 * operations API; adjust the PATHS map to match your Hindsight version if it
 * differs. Auth (if your deployment enables it) goes in `authHeaders()`.
 */
import type { Fact } from '@app/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { HindsightPort, RecallOptions, RecallResult } from './port.js';

const PATHS = {
  health: '/health',
  retain: (bank: string) => `/v1/banks/${encodeURIComponent(bank)}/retain`,
  recall: (bank: string) => `/v1/banks/${encodeURIComponent(bank)}/recall`,
  reflect: (bank: string) => `/v1/banks/${encodeURIComponent(bank)}/reflect`,
};

export class HttpHindsight implements HindsightPort {
  private base = config.hindsight.apiUrl.replace(/\/$/, '');

  private authHeaders(): Record<string, string> {
    // Most self-host setups are unauthenticated on localhost. If yours needs a
    // key, wire it here (e.g. from a new env var) — kept out of the port on
    // purpose so the mock stays dependency-free.
    return {};
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`hindsight ${path} -> ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async ping(): Promise<boolean> {
    try {
      await this.call(PATHS.health);
      return true;
    } catch (err) {
      logger.warn({ err }, 'hindsight ping failed');
      return false;
    }
  }

  async retain(bankId: string, facts: Fact[]): Promise<{ retained: number }> {
    // One retain call per fact: `content` is the statement, structured metadata
    // rides along as `metadata` + `tags` so recall filters can use it.
    let retained = 0;
    for (const f of facts) {
      await this.call(PATHS.retain(bankId), {
        content: f.statement,
        timestamp: f.timeScope.start,
        tags: [...f.tags, `granularity:${f.timeScope.granularity}`, `schema:v${f.schemaVersion}`],
        metadata: {
          entities: f.entities,
          metric: f.metric ?? null,
          event: f.event ?? null,
          source: f.source,
          confidence: f.confidence,
        },
        async: false,
      });
      retained++;
    }
    return { retained };
  }

  async recall(bankId: string, query: string, opts: RecallOptions = {}): Promise<RecallResult> {
    const raw = await this.call<{ facts?: unknown[]; results?: unknown[] }>(PATHS.recall(bankId), {
      query,
      budget: opts.budget ?? 'mid',
      maxTokens: opts.maxTokens ?? 2048,
      includeEntities: true,
    });
    return { facts: normaliseFacts(raw.facts ?? raw.results ?? [], opts.granularity) };
  }

  async reflect(bankId: string, query: string, opts: RecallOptions = {}): Promise<RecallResult> {
    const raw = await this.call<{ answer?: string; synthesis?: string; facts?: unknown[] }>(
      PATHS.reflect(bankId),
      { query, budget: opts.budget ?? 'mid' },
    );
    return {
      facts: normaliseFacts(raw.facts ?? [], opts.granularity),
      synthesis: raw.answer ?? raw.synthesis,
    };
  }
}

function normaliseFacts(items: unknown[], granularity?: string) {
  return items
    .map((it) => {
      const o = it as Record<string, unknown>;
      const tags = Array.isArray(o.tags) ? (o.tags as string[]) : [];
      const g =
        tags.find((t) => t.startsWith('granularity:'))?.slice('granularity:'.length) ?? 'unknown';
      return {
        statement: String(o.content ?? o.statement ?? o.text ?? ''),
        score: typeof o.score === 'number' ? o.score : 0,
        tags,
        timeScopeStart: String(o.timestamp ?? o.timeScopeStart ?? ''),
        granularity: g,
      };
    })
    .filter((f) => f.statement && (!granularity || f.granularity === granularity));
}
