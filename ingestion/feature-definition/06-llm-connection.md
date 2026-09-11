# F6 — LLM Connection (lives on the F5 "AI Services" screen)

## Aim
Let the setter point the platform at an OpenAI-compatible LLM (base URL +
port), prove it works, auto-detect its models, and set the one active model
the extraction layer will use — all from the AI Services screen, with the
same health discipline as every other connection in this platform.

## Definition
An **LLM provider** record holds: label, base URL (host + port, e.g.
`http://192.168.1.10:11434`), optional API key, and the active model name.
Records live in the shared SQLite setter-plane store (with F1/F2/F3).

**Connect + auto-detect (locked flow).**
1. Setter enters label + base URL (+ key if the endpoint needs one) and hits
   **Connect**.
2. The backend calls `GET {base}/v1/models` (strict OpenAI shape; Ollama,
   vLLM, LocalAI and compatible servers all speak it) with the key as bearer
   when present.
3. Reachability is proven AND the model list returns in the same call.
   One model → auto-selected; several → setter picks from a dropdown.
4. Save activates it as **the single active LLM** for v1 (extraction uses
   it). Deactivating/changing is explicit, never silent.

**Status (same pattern as F5 Hindsight).** The screen shows: live/down,
active model, latency, last error. Connect/Test never saves; saving is a
separate explicit action.

**Poller.** The active LLM gets the same continuous treatment as DB
connections: health-checked every interval, loud in the logs on failure. An
extraction outage must never be discovered from missing facts.

## In scope
- Provider CRUD (v1 reality: one active; the model allows more later).
- Connect (test + model auto-detect), model picker, activate, status hero.
- Poller coverage for the active LLM.
- Placement: a section on the F5 screen; nav relabeled "AI Services".

## Out of scope
- Per-task model routing ("extraction uses A, chat uses B") — later.
- Non-OpenAI protocols (native Ollama `/api/*`, etc.) — later if needed.
- Usage/cost tracking — later.

## Open points (locked at build with defaults)
- Auth: key field included, optional (empty = open LAN endpoint).
- Protocol: strict OpenAI `/v1/models`; per-server quirks only if reality demands.
