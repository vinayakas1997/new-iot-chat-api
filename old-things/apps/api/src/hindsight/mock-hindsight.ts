/**
 * In-memory Hindsight for mock mode, with a JSON-file backing so the separate
 * ingest / scheduler / api processes share one memory store during local dev.
 * Keyword-overlap recall over retained statements, partitioned by bankId.
 * File: $MOCK_HINDSIGHT_FILE or <repo>/.mock-hindsight.json (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fact } from '@app/shared';
import { logger } from '../logger.js';
import type { HindsightPort, RecallOptions, RecallResult, RecalledFact } from './port.js';

const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'on', 'in', 'at', 'to', 'and', 'or', 'is', 'was',
  'what', 'how', 'many', 'much', 'did', 'do', 'me', 'my', 'show', 'give', 'tell',
]);

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

const FILE =
  process.env.MOCK_HINDSIGHT_FILE ??
  fileURLToPath(new URL('../../../../.mock-hindsight.json', import.meta.url));

interface Persisted {
  banks: Record<string, Fact[]>;
}

export class MockHindsight implements HindsightPort {
  private load(): Persisted {
    try {
      if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as Persisted;
    } catch (err) {
      logger.warn({ err }, 'mock hindsight: could not read file, starting empty');
    }
    return { banks: {} };
  }

  private save(data: Persisted) {
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(data), 'utf8');
    } catch (err) {
      logger.warn({ err }, 'mock hindsight: could not persist file');
    }
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async retain(bankId: string, facts: Fact[]): Promise<{ retained: number }> {
    const data = this.load();
    data.banks[bankId] = [...(data.banks[bankId] ?? []), ...facts];
    this.save(data);
    logger.debug({ bankId, retained: facts.length }, 'mock hindsight retain');
    return { retained: facts.length };
  }

  async recall(bankId: string, query: string, opts: RecallOptions = {}): Promise<RecallResult> {
    const bank = this.load().banks[bankId] ?? [];
    const qt = tokenize(query);
    const limit = opts.budget === 'high' ? 8 : opts.budget === 'low' ? 3 : 5;

    const scored = bank
      .filter((f) => !opts.granularity || f.timeScope.granularity === opts.granularity)
      .map((fact) => {
        const tokens = new Set([...tokenize(fact.statement), ...fact.tags.flatMap(tokenize)]);
        const hits = qt.filter((t) => tokens.has(t)).length;
        return { fact, score: qt.length ? hits / qt.length : 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const facts: RecalledFact[] = scored.map(({ fact, score }) => ({
      statement: fact.statement,
      score: Number(score.toFixed(3)),
      tags: fact.tags,
      timeScopeStart: fact.timeScope.start,
      granularity: fact.timeScope.granularity,
    }));
    return { facts };
  }

  async reflect(bankId: string, query: string, opts?: RecallOptions): Promise<RecallResult> {
    const r = await this.recall(bankId, query, { ...opts, budget: 'high' });
    const synthesis = r.facts.length
      ? `Based on ${r.facts.length} recalled fact(s): ` + r.facts.map((f) => f.statement).join(' ')
      : 'No relevant memories were found for that question.';
    return { ...r, synthesis };
  }
}
