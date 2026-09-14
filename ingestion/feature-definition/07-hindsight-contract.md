# 07 — Hindsight API contract (read live from the compose service, v0.9.x)

Base: `http://hindsight:8888` in-compose, `http://localhost:8888` from host.
The old `old-things/.../http-hindsight.ts` PATHS map is **outdated** (guessed
`/v1/banks/{bank}/retain` → 404). Build the extraction slice against this.

## Paths (all under the `default` namespace)

- `GET /health` → `{"status":"healthy","database":...}` (no auth)
- `POST /v1/default/banks/{bank_id}/memories` — retain.
  `RetainRequest = { items: MemoryItem[], async?: boolean, document_tags?, operation_id? }`
  `MemoryItem = { content (required), timestamp?, context?, metadata?, entities?, tags?, ... }`
- `POST /v1/default/banks/{bank_id}/memories/recall` — recall.
  `RecallRequest = { query (required), budget?, max_tokens?, tags?, tags_match?, temporal_window?, ... }`
- `POST /v1/default/banks/{bank_id}/reflect` — reflect/answer.
  `ReflectRequest = { query (required), budget?, tags?, ... }`

## Proven live (2026-09-11, local qwen36-35B)

- Retain works: `POST …/banks/bank:line-1/memories` with
  `{items:[{content,timestamp,tags,metadata}],async:false}` →
  `{"success":true,"items_count":1,"usage":{…}}` (model did real work).
- Recall shape confirmed (`{"results":[...]}`) but returned empty in the
  smoke test — likely needs consolidation time or different params
  (`types`, `tags_match`). Tune in the extraction slice; do not assume
  write→immediate-recall.
- Boot requires a *reachable* LLM at startup (it verifies the connection):
  default cloud endpoint fails in offline sandboxes → the compose `.env`
  points at the local box. Never leave BASE_URL at a dead endpoint or the
  container crash-loops.

Full schema: `GET /openapi.json` on the running service — the server is
the truth; regenerate any snapshot from it.

## Banks

- Bank id convention stays `bank:line-<id>` — but URL-encode the colon
  (`bank%3Aline-1`) or confirm the server accepts raw colons per bank.
- Banks are created implicitly on first retain (verify in extraction slice).

## Bank provisioning (proven live 2026-09-14, `bank:line-line-smoke`)

Push-to-Hindsight flow (`backend/src/routes/banks.ts`) provisions each line bank
before ticks retain into it. All paths verified against `/openapi.json`:

- `PUT /v1/default/banks/{bank_id}` (`CreateBankRequest`) — create-or-update
  with missions + disposition + extraction mode in one call; missing fields
  auto-fill with defaults. Body: `{name, mission, retain_mission,
  observations_mission, reflect_mission, retain_extraction_mode,
  enable_observations, disposition_skepticism, disposition_literalism,
  disposition_empathy}`.
- `PATCH /v1/default/banks/{bank_id}/config` (`{updates: {...}}`) — overrides
  incl. `entity_labels` (controlled vocab, `tag:true` groups auto-tag memories
  for recall filtering), `enable_observations`, `enable_auto_consolidation`.
- `GET/POST /v1/default/banks/{bank_id}/directives` (`{name, content, tags?}`) —
  hard reflect rules; push is idempotent by name (existing names skipped).
- `POST /v1/default/banks/{bank_id}/mental-models` (`{name, source_query}`) —
  background op (returns `operation_id`); best-effort on empty banks.
- `GET /v1/default/banks/{bank_id}/config` returns `{config, overrides}` —
  resolved vs bank-level-only.
- Setter side: readiness marker `bankready:<lineId>` + draft JSON
  `bankdraft:<lineId>` live in the `settings` table (no migration); AI-drafted
  suggestions come from the active F6 LLM via `/api/ingest/banks/suggest`
  (text/JSON, never auto-saved).

## Service state (compose)

- Boots only with `HINDSIGHT_API_LLM_API_KEY` set → compose defaults to
  `local-dummy-key` so health + Control Plane UI (`:9999`) are live.
- Memory ops (retain/recall/reflect) need a real key or a local LLM:
  set `HINDSIGHT_API_LLM_PROVIDER=openai` +
  `HINDSIGHT_API_LLM_BASE_URL=http://host.docker.internal:<port>/v1` +
  `HINDSIGHT_API_LLM_MODEL=<name>` via `.env` (see `.env.example`).
- Our F5 status check fetches a full URL — point it at
  `http://hindsight:8888/health` in-compose (deep-link button → `:9999` UI).
