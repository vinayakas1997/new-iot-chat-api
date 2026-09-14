# 04 — Contracts and Seams

**Version:** v1 (freeze now, implement v1 subset)
**Purpose:** define the interfaces so v2 (recommender, adhoc SQL, rollups,
analytics) is additive, not a rewrite.

Everything here is a design contract. v1 implements the deterministic subset;
v2 adds implementations behind the same shapes.

---

## 1. ChartDatum (answer payload)

Extended from what the chatbot already returns
(`chatbot/backend/src/rag/answer.ts`).

```ts
interface ChartDatum {
  chart_type: "table" | "line" | "bar" | "area";
  title: string;
  x_column: string;
  y_columns: string[];
  columns: string[];
  rows: Record<string, unknown>[];

  // new:
  supports?: string;        // the one sentence this chart backs
  source: "stored-spec" | "heuristic" | "dynamic" | "rollup" | "memory";
  spec_id?: string;         // graph_specs.id when source=stored-spec
  recipe?: Recipe;          // the reproducible definition
  provenance?: {
    kind: "memory" | "live";
    granularity?: "hourly" | "shift" | "daily";
    window?: { from: string; to: string };
  };
}
```

Why: the UI renders `source` / `supports` / `provenance` unchanged whether the
row came from a stored spec (v1) or a dynamic query (v2).

---

## 2. resolveChart (the seam v2 plugs into)

```ts
type ChartIntent = {
  lineId: string;
  cardId?: string;
  cardIds?: string[];       // multi-measure (v2)
  measures?: string[];
  chartType?: ChartDatum["chart_type"];
  x?: string;
  y?: string[];
  range?: { from: string; to: string };
  resolution?: "hourly" | "shift" | "daily" | "raw";
  reason?: string;
};

type ResolveResult = {
  chart: ChartDatum;
  provenance: NonNullable<ChartDatum["provenance"]>;
};

// v1 implementations:
//   storedSpec()  -> uses graph_specs + card SQL
//   heuristic()   -> charts a live card SQL result
// v2 implementations (same signature):
//   dynamicSql()  -> LLM-written SQL, validated
//   rollup()      -> daily rollup level
//   analytics()   -> anomaly / volatility
function resolveChart(intent: ChartIntent): Promise<ResolveResult>;
```

v1 ships `storedSpec` + `heuristic`. v2 registers more resolvers without
touching the chat or the UI.

---

## 3. Fact tags (extraction contract)

Stored once, at ingest, with every retained memory item:

```
tags:     line, card, cardVersion, connectionId, measure, unit, granularity, breach
metadata: { window: {from,to}, samples?, sqlHash? }
```

`measure`, `unit`, `breach`, `granularity` are the fields v2's planner and
recall filtering depend on. Retrofitting them later is costly, which is why they
are required in v1 even though v1 chat may not use all of them yet.

---

## 4. Recipe (stored in `graph_specs.config`)

```ts
interface Recipe {
  cardId: string;
  aggregation: "avg" | "sum" | "min" | "max" | "count" | "raw";
  groupBy: "hour" | "shift" | "day" | "none";
  window: { kind: "relative" | "fixed"; value: string };
  chart_type: ChartDatum["chart_type"];
  x: string;
  y: string[];
  title: string;
  rationale?: string;            // why this chart (AI or human)
  source: "manual" | "ai-recommended";
  // meaning / scaffolding:
  summary?: string;
  units?: string;
  threshold?: number | null;
  normalRange?: [number, number] | null;
}
```

`graph_specs.config` is already a JSON blob, so no migration. Storing a recipe
(not data, not a rendered image) is what keeps the dynamic approach cheap: the
definition is tiny; rows are produced on demand.

---

## 5. Granularity / coverage signal

A computed (not manual) capability descriptor per card:

```ts
interface Coverage {
  granularity: "hourly" | "shift" | "daily";
  windowCovered?: { from: string; to: string } | null;
  freshness?: string | null;         // last tick
  liveAvailable: boolean;            // connection reachable
  // derived states:
  //   memory  - requested resolution >= stored and within coverage
  //   live     - finer than stored, or beyond coverage
  //   none     - no data / missing columns
}
```

v1 uses it for a badge ("from hourly memories" vs "live source"). v2's planner
uses it to choose memory / rollup / live. Derived by rule, never a manual flag.

---

## 6. Why these seams matter

- The **answer contract** means the chat UI never changes when v2 adds sources.
- **resolveChart** means v2 adds resolvers, not branches in the chat handler.
- **Fact tags** mean the planner can route on `measure`/`breach`/`granularity`
  from day one.
- **Recipe** means "store what the user liked" saves a definition, not data.

## Open items

- Confirm `supports` ships in v1 or only "chart under summary".
- Confirm `resolveChart` lives in the ingestion backend, the chatbot backend, or
  both (it needs card SQL + graph specs, which live in ingestion).
- Version the contracts? If v2 changes `ChartDatum`, do we keep a `v` field.
- Where does the `Coverage` computation run (ingestion, since it owns ticks).
