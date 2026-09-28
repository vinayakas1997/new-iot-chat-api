# Hindsight bank settings vs ingest-call payload

Source: Hindsight HTTP API reference + developer docs (`hindsight.vectorize.io`),
verified against our wiring (`ingestion/app/backend/src/routes/banks.ts`,
`ingestion/app/backend/src/extract.ts`).

Rule of thumb: **the setup call decides how the bank thinks; the ingest call
delivers what happened + labels.** Missions, vocab, and modes are bank config.
Content, time, tags, and metadata are per-call.

---

## 1. One-time bank setup (Push to Hindsight)

Set once per line-bank via `PUT /v1/default/banks/{id}` + `PATCH .../config`
(our `POST /api/ingest/banks/push`). Lives with the bank until re-pushed.
Adding a feature (new card) does NOT touch any of this — no hook exists.

| Setting | Endpoint field | What it does |
|---|---|---|
| Bank mission | `mission` | Identity line, e.g. `Plant line memory for {line} ({id})` |
| Retain mission | `retain_mission` | Steers extraction focus; injected into the extraction prompt alongside built-in rules. Steers, never replaces logic. Blank = general-purpose |
| Observations mission | `observations_mission` | Controls what gets synthesised into durable observations. REPLACES built-in consolidation rules entirely. Blank = server default |
| Reflect mission | `reflect_mission` | Shift-assistant identity; only affects `reflect` |
| Disposition | `disposition_skepticism / literalism / empathy` (1–5) | How memories are formed and interpreted; only affects `reflect` |
| Extraction mode | `retain_extraction_mode` (`concise` / `verbose` / `custom` / `chunks`) | We use `chunks`: Hindsight skips its own LLM extraction and stores our pre-extracted fact text as-is |
| Chunk sizes | `retain_chunk_size`, `retain_structured_chunk_size` | How content is cut before extraction |
| Custom instructions | `retain_custom_instructions` | Full custom extraction prompt (requires `mode=custom`) |
| Entity vocab | `entity_labels[]` (groups with `key/type/values/tag`) | Controlled vocabulary, e.g. `metric` values derived from line columns at push time |
| Free-form entities | `entities_allow_free_form` | Whether names outside the vocab are allowed |
| Observations toggle | `enable_observations` (+ server auto-consolidation flag) | `false` disables ALL consolidation for the bank, auto and manual |
| Directives | `POST .../directives` (`name/content/priority/is_active/tags`) | Hard rules injected into reflect (never invent readings, cite hour/window, units as stored) |
| Mental models | `POST .../mental-models` (`name/source_query/tags/trigger`) | Living docs (e.g. normal envelope), refreshed on cron or after consolidation |
| Retain strategies | `retain_strategies` + `retain_default_strategy` | Named extraction configs selectable per-call via `strategy` |

Notes:
- Config fields are managed via the **config API, not create/push body identity** —
  change operations independently of the bank's identity/disposition.
- `retain_mission` / `observations_mission` are **separate per-operation settings**;
  disposition + `reflect_mission` only affect `reflect`.
- Tightening `retain_mission` trades away retrieval, not just fact creation: content
  that yields zero facts stores the document but it can never be found by
  recall/reflect.

## 2. Per-ingest call (`POST /v1/default/banks/{id}/memories`)

One call per card result set per tick (our `extractAndRetain`). Each item:

| Field | Role | We send today |
|---|---|---|
| `content` | Fact sentence — the ONLY thing that becomes searchable memory | ✅ yes |
| `context` | Disambiguation shown alongside the fact | ❌ not yet (candidate upgrade, e.g. `"hourly rollup, {line}"`) |
| `timestamp` | Event time (window end) — powers temporal recall arm | ✅ yes (`w.to`) |
| `tags[]` | Filtering/scoping plane: recall filters, observation scopes, reflect + directive scoping | ✅ 8 tags: `line:`, `card:` (name), `cardVersion:`, `connection:`, `measure:`, `unit:`, `granularity:`, `breach:` |
| `metadata{}` (string values only) | Opaque bookkeeping — stored, returned on reads, NOT searched | ✅ `line/card/cardVersion/window/samples/sqlHash` |
| `document_id` | Upsert key — re-sending the same ID DELETES old doc + units first | ❌ intentionally omitted (every tick is new history) |
| `observation_scopes` | Which scope new facts consolidate under (`"shared"` = one global belief, else per-tag scopes) | ❌ defaults (`combined`) |
| `strategy` | Named retain strategy for this item | ❌ default strategy |
| `async` / `operation_id` | Background processing + idempotent retries (same id = no duplicate work, 409 on foreign id) | ✅ `async` flag |

What you CANNOT send per-call:
- ❌ `retain_mission` / `observations_mission` — bank config only (`PATCH .../config`).
  Per-call mission override exists ONLY on `POST .../memories/dry-run-extract`,
  which is a read-only A/B preview — nothing is stored.
- ❌ `entity_labels` vocab override — same story, dry-run only.
- ❌ Explicit `entities` on retain items — Hindsight resolves/links entities itself
  from fact text (fix-ups go through the curate endpoint `PATCH .../memories/{id}`).
- ✅ Per-call consolidation control DOES exist: `observation_scopes` on retain +
  manual `POST .../consolidate` with optional scopes; clearing a memory's
  observations via `DELETE .../memories/{id}/observations` triggers re-consolidation.

## 3. Consequences for our feature model

1. Extraction is per-card, never merged pre-send: one LLM call per card result set
   with that card's name/unit/threshold/extract-hint; facts stored tagged per card.
2. A 2nd feature (new metric) ingests fine with zero bank changes — missions don't
   gate storage (especially in `chunks` mode) and vocab gaps only cost tidy
   recall labels, never storage.
3. If a feature's memory looks wrong, fix OUR side first (extract hint, unit,
   threshold, tags, content wording) — re-push is the second lever, not the first.
4. Re-push policy: only needed when bank-wide behaviour must shift (new metric
   needs vocab entry, mission names specific features, directives change).
5. Recall/reflect scoping to validate later: `tags` + `tags_match`, `prefer_observations`,
   `observation_scopes: "shared"` vs per-tag, mental-model `refresh_after_consolidation`.
