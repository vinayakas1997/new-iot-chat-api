import { z } from "zod";

/**
 * Zod contracts for every LLM JSON shape the backend accepts.
 * `llmChatJson` validates against these; downstream sanitizers
 * (e.g. sanitizeCandidates) stay as a second, domain-aware layer.
 */

/* ---------------- chart recommendations ---------------- */

const chartCandidateSchema = z.object({
  chartType: z.enum(["table", "line", "bar", "area"]),
  xColumn: z.string().min(1),
  yColumns: z.array(z.string()).default([]),
  title: z.string().optional(),
  rationale: z.string().optional(),
  conditions: z.string().optional(),
  rank: z.number().optional(),
});

export type LlmCandidate = z.infer<typeof chartCandidateSchema>;

/** The model may return {"candidates":[...]} or a bare array. */
export const chartCandidatesSchema = z.union([
  z.object({ candidates: z.array(chartCandidateSchema) }),
  z.array(chartCandidateSchema),
]);

export type ChartCandidates = z.infer<typeof chartCandidatesSchema>;

export function toCandidateArray(parsed: ChartCandidates): LlmCandidate[] {
  return Array.isArray(parsed) ? parsed : parsed.candidates;
}

/* ---------------- merge optimizer ---------------- */

export const mergeProposalSchema = z.object({
  merge: z.boolean(),
  chartType: z.enum(["line", "bar", "area"]).optional(),
  title: z.string().optional(),
  rationale: z.string().optional(),
});

export type MergeProposalAnswer = z.infer<typeof mergeProposalSchema>;

/* ---------------- tick fact extraction (extract.ts) ---------------- */

const draftFactSchema = z.object({
  content: z.string().min(1),
  measure: z.string().optional(),
  value: z.number().nullable().optional(),
  unit: z.string().optional(),
  breach: z.boolean().optional(),
});

export type DraftFactAnswer = z.infer<typeof draftFactSchema>;

/** The model must return a bare array of facts. */
export const draftFactsSchema = z.array(draftFactSchema);

/* ---------------- Hindsight bank drafts ---------------- */

const bankKindSchemas = {
  entities: z
    .object({ groups: z.array(z.record(z.unknown())).optional() })
    .passthrough(),
  missions: z
    .object({ retain: z.string().optional(), observations: z.string().optional(), reflect: z.string().optional() })
    .passthrough(),
  "mental-model": z
    .object({ name: z.string().optional(), source_query: z.string().optional() })
    .passthrough(),
  directives: z
    .object({ directives: z.array(z.record(z.unknown())).optional() })
    .passthrough(),
} as const;

export type BankSuggestKind = keyof typeof bankKindSchemas;

export function bankSuggestSchema(kind: BankSuggestKind) {
  return bankKindSchemas[kind];
}
