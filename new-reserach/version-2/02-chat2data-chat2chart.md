# 02 — Chat2Data / Chat2Chart (Adhoc SQL)

**Version:** v2
**Depends on:** v1 contracts, recommender (shared validation)
**Enables:** answers to questions the setter never anticipated

## Idea

Split the pipeline instead of one-shotting it, modeled on DB-GPT's
`scene/chat_data`:

```
question -> data plan -> SQL -> validate/fix -> run -> chart spec -> render + explain
```

## Guardrails (hard requirements)

- Single SELECT/WITH, no semicolon — reuse `assertReadonly`.
- Tables must be line members — reuse the playground boundary check.
- Row cap and query timeout; on breach, return a truncated/aggregated result.
- Read-only connection only.

## Schema linking

Before generating SQL, retrieve the relevant tables/columns from the line
schema (`/playground/columns/:lineId`) rather than dumping everything. This is
DB-GPT's schema-linking idea and keeps prompts small and accurate.

## Self-correction loop

1. Generate SQL.
2. Parse + static-check (read-only, members, single statement).
3. Run.
4. On error, feed the error back once or twice and retry.
5. On persistent failure, fall back to the card SQL (v1 path) or a table.

Bounded retries; never loop unboundedly.

## Caching

Cache the resolved intent `(question shape, line) -> {sql|spec}` so repeated
questions do not re-invoke the model. Invalidate when card SQL or schema
changes.

## Chart selection

After a successful run, choose the chart in this order:

1. Stored spec that matches the result columns and question.
2. Model-proposed `{chart_type, x, y}` validated against the result columns.
3. Heuristic (v1).

## Files likely touched (chatbot plane)

- `chatbot/backend/src/rag/answer.ts` — data-plan + SQL path.
- `chatbot/backend/src/rag/llm.ts` — generation calls.
- `chatbot/backend/src/rag/ingestClient.ts` — schema + run helpers.

## Verify

- An unanticipated question ("compare shift 1 vs shift 2 output") returns a
  correct, validated result and a chart.
- A prompt-injection style question cannot produce a write, multi-statement, or
  non-member-table query.
- On a deliberate SQL error, the retry fixes it or falls back gracefully.

## Open items

- Which model writes SQL, and does it need a dedicated prompt budget?
- How strict is "question shape" for caching (risk of stale cache)?
- Do we expose adhoc SQL to the UI (show the generated query) for trust?
- Cost ceiling per question (number of LLM calls, row cap).
- Does adhoc SQL feed extraction (new facts) or stay read-only? (Recommend
  read-only; facts come only from vetted cards.)
