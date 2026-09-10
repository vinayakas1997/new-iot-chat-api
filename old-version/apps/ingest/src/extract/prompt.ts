/**
 * §5.4 FACT-EXTRACTION PROMPT — STUB shape (build-later).
 *
 * The schema is already LOCKED (packages/shared/fact-schema.ts); this prompt is
 * what will be tuned once the context builder's real output exists. The output
 * contract must always equal FactExtractionOutput.
 */
import { factJsonSchemaForPrompt } from '@app/shared';

export function factExtractionSystemPrompt(): string {
  return [
    'You extract discrete FACTS from a block of manufacturing-line context.',
    'Respond ONLY with JSON matching this schema — no prose, no markdown fences:',
    '',
    factJsonSchemaForPrompt(),
    '',
    'Rules:',
    '- One fact per distinct claim (a metric value, an event, a threshold breach).',
    '- entities: include the line ("line"), any machine ("machine"), and the metric',
    '  name ("metric"). Add "threshold"/"event" entities when relevant.',
    '- timeScope.granularity MUST equal the granularity stated in the context block.',
    '- Copy source.queryName / source.rowIds / source.checkpoint from the context metadata.',
    '- Never invent numbers not present in the context.',
  ].join('\n');
}
