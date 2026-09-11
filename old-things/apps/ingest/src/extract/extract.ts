/**
 * extract_facts + validate_extraction_output + retry_on_invalid_output (§5.4).
 *
 * LLM-first with a bounded strict-reprompt retry. In mock mode the MockLlm
 * returns `{ facts: [] }` for JSON callers, so this module also provides a
 * deterministic `heuristicFacts()` fallback that turns a ContextUnit into a
 * schema-valid fact without any LLM — that keeps the mock ingestion useful
 * (there is actually something to retain and later recall).
 */
import { Fact, FactExtractionOutput, type FactExtractionOutput as FEO } from '@app/shared';
import { getLlm } from '@app/api/llm';
import { logger } from '@app/api/logger';
import type { ContextUnit } from '../context/build.js';
import { factExtractionSystemPrompt } from './prompt.js';

const CHECKPOINT_TAG = 'ingest';

/** Deterministic, no-LLM extraction: one metric fact per context unit. */
export function heuristicFacts(unit: ContextUnit, checkpoint: string): Fact[] {
  const oee = /average OEE ([\d.]+)%/.exec(unit.text);
  const downtime = /downtime ([\d.]+) min/.exec(unit.text);
  const scrap = /scrap rate ([\d.]+)%/.exec(unit.text);

  const base = {
    schemaVersion: 1 as const,
    entities: [
      { type: 'line' as const, name: unit.lineId },
      { type: 'metric' as const, name: 'OEE' },
    ],
    timeScope: {
      granularity: unit.granularity,
      start: unit.windowStart,
      end: unit.windowEnd,
    },
    source: { queryName: 'fetchNewRowsSince', rowIds: unit.rowIds, checkpoint },
    confidence: 0.9,
    tags: [`line:${unit.lineId}`, `granularity:${unit.granularity}`, CHECKPOINT_TAG],
  };

  const facts: Fact[] = [
    Fact.parse({
      ...base,
      statement: unit.text,
      metric: oee
        ? { name: 'OEE', value: Number(oee[1]) / 100, unit: '%', aggregation: 'avg' }
        : undefined,
    }),
  ];
  if (downtime) {
    facts.push(
      Fact.parse({
        ...base,
        statement: `Line ${unit.lineId} ${unit.granularity} downtime was ${downtime[1]} min for the window starting ${unit.windowStart}.`,
        entities: [
          { type: 'line', name: unit.lineId },
          { type: 'metric', name: 'downtime' },
        ],
        metric: { name: 'downtime', value: Number(downtime[1]), unit: 'min', aggregation: 'sum' },
        event: Number(downtime[1]) > 30 ? { kind: 'downtime', severity: 'warning' } : undefined,
      }),
    );
  }
  if (scrap) {
    facts.push(
      Fact.parse({
        ...base,
        statement: `Line ${unit.lineId} ${unit.granularity} scrap rate was ${scrap[1]}% for the window starting ${unit.windowStart}.`,
        entities: [
          { type: 'line', name: unit.lineId },
          { type: 'metric', name: 'scrap rate' },
        ],
        metric: { name: 'scrap rate', value: Number(scrap[1]) / 100, unit: '%', aggregation: 'avg' },
      }),
    );
  }
  return facts;
}

async function callLlmOnce(unit: ContextUnit, strict: boolean): Promise<unknown> {
  const raw = await getLlm().complete({
    system:
      factExtractionSystemPrompt() +
      (strict ? '\n\nYour previous answer was not valid JSON. Return ONLY the JSON object.' : ''),
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          context: unit.text,
          metadata: {
            lineId: unit.lineId,
            granularity: unit.granularity,
            windowStart: unit.windowStart,
            windowEnd: unit.windowEnd,
            rowIds: unit.rowIds,
          },
        }),
      },
    ],
  });
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
}

export async function extractFacts(unit: ContextUnit, checkpoint: string): Promise<Fact[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const json = await callLlmOnce(unit, attempt > 0);
      const parsed: FEO = FactExtractionOutput.parse(json);
      if (parsed.facts.length > 0) return parsed.facts;
      break; // empty but valid -> fall through to heuristic
    } catch (err) {
      logger.warn({ err, attempt, unit: unit.granularity }, 'extraction attempt failed');
    }
  }
  logger.info({ line: unit.lineId, granularity: unit.granularity }, 'using heuristic facts');
  return heuristicFacts(unit, checkpoint);
}
