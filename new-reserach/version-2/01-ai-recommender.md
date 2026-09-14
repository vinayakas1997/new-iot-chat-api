# 01 — AI Recommender

**Version:** v2
**Depends on:** v1 contracts (`resolveChart`, `ChartDatum`, `Recipe`), facts
**Enables:** open-ended chart suggestions without pre-building everything

## Idea

Invert the authoring flow: instead of the setter hand-building every chart, the
model proposes candidates from the structure; the setter previews them live,
keeps the meaningful ones, and the system stores the **recipe**, not the data.

```
structure in -> AI recommends -> system renders -> user curates -> store recipe
```

This matches the existing rule "AI drafts, human signs" (the bank flow) and
doc 09's "setter-approved visuals".

## Structure given to the model

- Line member tables and column names + types (`/playground/columns/:lineId`).
- The card's SQL, `unit`, `threshold`, `granularity`, `extractHint`.
- Existing saved specs (avoid recommending duplicates).
- A small **data profile**: distinct count, null ratio, min/max, variance per
  column — enough to reject useless charts before the user sees them.

## Model output (strict JSON)

```
[{ chart_type, x, y_columns, title, rationale }]
```

The model does **not** write SQL. It selects from a safe vocabulary
(chart types, columns, aggregations), modeled on DB-GPT's `vis_chart.py` usage
prompts.

## Deterministic validation (before display)

- Y must be numeric (`isNumericColumn` from v1 workstream 02).
- X must be temporal or low-cardinality categorical.
- Reject near-constant / all-null series (no signal).
- Cap candidates (e.g. 6) and de-duplicate against existing specs.

## Efficiency: one query, many views

Fetch the card result **once** for the window, then reshape the same rows per
candidate. N charts, one query — this is what makes a gallery cheap enough.

## Approval -> storage

Saving writes a `Recipe` into `graph_specs.config` (see
`version-1/04-contracts-and-seams.md`) with `source: "ai-recommended"` and the
`rationale`. No chart image, no duplicated aggregate is stored.

## Granularity honesty

Each candidate carries its coverage state (memory / live / none, from the v1
coverage signal). A candidate that needs a finer resolution than stored shows a
"live" badge and is fetched on demand; an unrenderable one is never offered.

## Verify

- On a card with real data, the gallery shows plausible charts, each live.
- Approving one stores a recipe and it appears among saved graphs.
- A non-numeric Y candidate never appears.
- Saving does not increase stored data volume beyond the recipe row.

## Open items

- How many suggestions, and is there a "more" button / shuffle?
- Can the user edit a candidate inline (x/y/type) before saving?
- Where does the gallery live: inside the card's Graph Designer, or a per-line
  "Insights" gallery across that line's cards?
- Recommendation cost: one LLM call per card, cached? On open, or on demand?
- Should recommendations refresh as new data arrives, or stay manual?
