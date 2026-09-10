/**
 * ────────────────────────────────────────────────────────────────────────────
 *  THE LOCKED FACT SCHEMA — v1 (see new-plan/02-part1-ingestion.md §4,
 *  new-plan/03-granularity-matrix.md, new-plan/08-open-decisions.md #1)
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  Single contract between extraction prompt → validation → Hindsight retain
 *  → recall → report evaluate. Carried over unchanged from the archived trail
 *  (old-version/packages/shared/src/fact-schema.ts).
 *
 *  Changing a field here means re-ingesting everything. Add optional fields
 *  freely; never rename or repurpose an existing one.
 */
import { z } from 'zod';

export const FACT_SCHEMA_VERSION = 1 as const;

/** The five entity kinds the graph reasons over. */
export const EntityType = z.enum(['machine', 'line', 'metric', 'threshold', 'event']);
export type EntityType = z.infer<typeof EntityType>;

export const Entity = z.object({
  type: EntityType,
  /** Canonical name/id, e.g. "line-3", "press-04", "oee". Stable across runs. */
  name: z.string().min(1),
  /** Optional human label if different from `name`. */
  label: z.string().min(1).optional(),
});
export type Entity = z.infer<typeof Entity>;

/** Time granularity — MUST survive from the context builder into the stored fact. */
export const Granularity = z.enum(['instant', 'hourly', 'shift', 'daily']);
export type Granularity = z.infer<typeof Granularity>;

export const TimeScope = z.object({
  granularity: Granularity,
  /** ISO 8601. For non-instant scopes this is the window start. */
  start: z.string().datetime(),
  /** ISO 8601 window end; omitted for `instant`. */
  end: z.string().datetime().optional(),
});
export type TimeScope = z.infer<typeof TimeScope>;

export const Aggregation = z.enum(['raw', 'sum', 'avg', 'min', 'max', 'count', 'last']);

export const METRIC_NAMES = ['oee', 'downtime_min', 'scrap_rate', 'units_produced', 'units_scrapped', 'runtime_min'] as const;
export const MetricName = z.enum(METRIC_NAMES);
export type MetricName = z.infer<typeof MetricName>;

/** Optional structured numeric observation attached to a fact. */
export const MetricObservation = z.object({
  name: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1).optional(),
  aggregation: Aggregation.default('raw'),
});
export type MetricObservation = z.infer<typeof MetricObservation>;

export const EventKind = z.enum(['downtime', 'alarm', 'maintenance', 'changeover', 'quality', 'other']);
export const Severity = z.enum(['info', 'warning', 'critical']);

export const EventDetail = z.object({
  kind: EventKind,
  severity: Severity.default('info'),
  /** Minutes of impact where applicable (e.g. downtime duration). */
  durationMin: z.number().nonnegative().optional(),
});
export type EventDetail = z.infer<typeof EventDetail>;

/** Provenance — lets ops trace a stored fact back to source rows. */
export const FactSource = z.object({
  queryName: z.string().min(1),
  rowIds: z.array(z.union([z.string(), z.number()])).default([]),
  checkpoint: z.string().optional(),
});
export type FactSource = z.infer<typeof FactSource>;

/**
 * A single fact. `statement` is the natural-language sentence that gets
 * embedded/retained; everything else is structured metadata for filtering,
 * graph traversal, and traceability.
 */
export const Fact = z.object({
  schemaVersion: z.literal(FACT_SCHEMA_VERSION).default(FACT_SCHEMA_VERSION),
  statement: z.string().min(1),
  entities: z.array(Entity).min(1),
  timeScope: TimeScope,
  metric: MetricObservation.optional(),
  event: EventDetail.optional(),
  source: FactSource,
  confidence: z.number().min(0).max(1).default(0.8),
  tags: z.array(z.string()).default([]),
});
export type Fact = z.infer<typeof Fact>;

/** What the extraction LLM must return: a bare list of facts. */
export const FactExtractionOutput = z.object({
  facts: z.array(Fact),
});
export type FactExtractionOutput = z.infer<typeof FactExtractionOutput>;

/** JSON Schema string handy for embedding in the extraction prompt. */
export const factJsonSchemaForPrompt = (): string =>
  JSON.stringify(
    {
      type: 'object',
      required: ['facts'],
      properties: {
        facts: {
          type: 'array',
          items: {
            type: 'object',
            required: ['statement', 'entities', 'timeScope', 'source'],
            properties: {
              statement: { type: 'string' },
              entities: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  required: ['type', 'name'],
                  properties: {
                    type: { enum: ['machine', 'line', 'metric', 'threshold', 'event'] },
                    name: { type: 'string' },
                    label: { type: 'string' },
                  },
                },
              },
              timeScope: {
                type: 'object',
                required: ['granularity', 'start'],
                properties: {
                  granularity: { enum: ['instant', 'hourly', 'shift', 'daily'] },
                  start: { type: 'string', format: 'date-time' },
                  end: { type: 'string', format: 'date-time' },
                },
              },
              metric: {
                type: 'object',
                required: ['name', 'value'],
                properties: {
                  name: { type: 'string' },
                  value: { type: 'number' },
                  unit: { type: 'string' },
                  aggregation: { enum: ['raw', 'sum', 'avg', 'min', 'max', 'count', 'last'] },
                },
              },
              event: {
                type: 'object',
                required: ['kind'],
                properties: {
                  kind: {
                    enum: ['downtime', 'alarm', 'maintenance', 'changeover', 'quality', 'other'],
                  },
                  severity: { enum: ['info', 'warning', 'critical'] },
                  durationMin: { type: 'number' },
                },
              },
              source: {
                type: 'object',
                required: ['queryName'],
                properties: {
                  queryName: { type: 'string' },
                  rowIds: { type: 'array', items: { type: ['string', 'number'] } },
                  checkpoint: { type: 'string' },
                },
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    null,
    2,
  );
