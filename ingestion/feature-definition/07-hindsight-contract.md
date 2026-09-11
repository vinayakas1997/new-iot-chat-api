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

Full schema: `GET /openapi.json` on the running service (saved snapshot:
ask the setter; regenerate any time — the server is the truth).

## Banks

- Bank id convention stays `bank:line-<id>` — but URL-encode the colon
  (`bank%3Aline-1`) or confirm the server accepts raw colons per bank.
- Banks are created implicitly on first retain (verify in extraction slice).

## Service state (compose)

- Boots only with `HINDSIGHT_API_LLM_API_KEY` set → compose defaults to
  `local-dummy-key` so health + Control Plane UI (`:9999`) are live.
- Memory ops (retain/recall/reflect) need a real key or a local LLM:
  set `HINDSIGHT_API_LLM_PROVIDER=openai` +
  `HINDSIGHT_API_LLM_BASE_URL=http://host.docker.internal:<port>/v1` +
  `HINDSIGHT_API_LLM_MODEL=<name>` via `.env` (see `.env.example`).
- Our F5 status check fetches a full URL — point it at
  `http://hindsight:8888/health` in-compose (deep-link button → `:9999` UI).
