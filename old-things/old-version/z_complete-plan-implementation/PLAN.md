# Complete Plan — Industrial RAG Chat UI Production Grade

> Created: 2026-09-08 | Folder: `z_complete-plan-implementation/` | Source of truth for this iteration. Companion: `plan.md` + `implementation-plan.md` define architecture; this file defines **what we will implement now** for the chat UI.

## 0. Intent (what this iteration is)

RAG chatbot for manufacturing line: `Postgres (mock) → ingest pipeline (stub) → Hindsight (mock file `.mock-hindsight.json`) → API (recall + live_sql tools, mock LLM) → Chat UI`. User never sees Postgres/cron/Hindsight.

This iteration **leaves ingestion/Hindsight/LLM wiring as-is** (Phase 10 deferred). Focus is **Chat UI + Scheduling UI + surrounding UX + awesome styling** to make the product look and feel production-grade, as if it were live. All “LLM connect” and chart-backend-image work is deferred after this.

Correct mental model: **RAG with two custom features** — per-user cron report scheduler (`schedules` per `user_id`, `cron_expr/next_run_at`) and `live_sql` fallback. Chat hides all machinery.

---

## 1. What was already built (status at entry)

* Monorepo `pnpm` 7 workspaces, `RUNTIME_MODE=mock` verified: `pnpm -r typecheck` clean, `3 rows → 9 facts`, streaming chat, schedule NL-parse, both UIs build.
* Backend `apps/api` — Fastify, `GET /health`, `/auth/*`, `POST /chat` streaming `apps/api/src/chat/route.ts:12` with `recall_memory`+`live_sql` tools `apps/api/src/chat/tools.ts`, `hindsight/port.ts:38` mock+http, `schedule/*`, `history/*`, `settings`, `ops`.
* Frontend `apps/web-user` — Vite+React+Tailwind, `App.tsx:35` shell + tabs `chat|schedule|history`, `Chat.tsx:15` raw bubbles, `Schedules.tsx:1` NL-only Preview/Save, `History.tsx:1` calendar, `Login.tsx:5` tilt card, `styles.css:4` elegant-depth tokens.
* Infra `docker-compose.yml:5` `app-postgres:5433`, `.env` mock defaults.
* Verified running: `http://localhost:3001/health` ok, `http://localhost:5173` login `demo/demo12345`, `POST /chat` streaming mock recall (see smoke log in STATUS.md).

**Gap found:** no time-picker/timezone/recurrence UI, no markdown/charts, no sources tray, no polish — chat looks demo, not production.

---

## 2. Decisions locked for this iteration

| # | Decision | Resolution |
|---|----------|------------|
| D1 | Markdown | YES — `react-markdown` + `remark-gfm` + `rehype-sanitize`, code copy button |
| D2 | Time settings | BOTH — keep NL `Preview` and add explicit `time` + `timezone` + `recurrence` picker (fallback/correction) |
| D3 | Charts auto-detect | DEFERRED — backend image generation deferred; frontend only detects `metric` `packages/shared/src/fact-schema.ts:49` and shows summary/table placeholder, with `TODO(chart)` hook |
| D4 | Scope | P0+P1(+11) now, A+B advanced now, C+D later (see §3). `apps/ingest/*` stubs untouched |
| D5 | Style direction | Hybrid Glassmorphism 2.0 — flat foundation + glass on AI output/header only, dark base `#0A0A1E→#1A1A2E`, `backdrop-filter blur 16px`, `rgba 0.08-0.6` |
| D6 | LLM connect | DEFERRED — stays `RUNTIME_MODE=mock`; port `apps/api/src/llm` + `hindsight/port` already abstracted, no change |

---

## 3. Scope — what will be implemented now

### P0 — Must for production

1. **Chat core** `apps/web-user/src/views/Chat.tsx:15`
   - Markdown render + gfm tables/checkbox + sanitize + code block copy
   - Streaming polish: typing `…` → cursor `▌` blink, Stop button (replaces Send while `streaming`), auto-scroll anchor, TTFT skeleton
   - Error retry: one-click resend on `⚠️ Could not get an answer` `Chat.tsx:38`, keep `lib/api.ts:64` `AsyncGenerator` append logic, preserve `chat/route.ts:25` `full += chunk` + `writeHistory`
   - Message state: optimistic user bubble, assistant append chunk-by-chunk

2. **RAG transparency** `apps/api/src/hindsight/port.ts:17` `RecalledFact`
   - Collapsible “Sources” tray per answer: `recall_memory` hits `statement/score/timeScopeStart/granularity` + `live_sql` query + row count
   - Citation chips `[hourly 2026-09-05 08:00]` linking to `History.tsx` day
   - Keep `chat/tools.ts` `buildChatTools(bankId)` `maxSteps:5` visible (announce→run→result)

3. **Schedule/time integration** `apps/web-user/src/views/Schedules.tsx:1` `packages/shared/src/types.ts` `Schedule`
   - Keep NL input + `api.previewSchedule(msg)` `lib/api.ts:37` → `schedule/parse.ts` `humanCron`
   - Add explicit form: `<input type="time">` `timeOfDay` + `timezone` select (`Intl.supportedValuesOf`) + `recurrence` `daily/weekdays/custom` + `queryText` textarea → unified `POST /schedules` `schedule/routes.ts:13` (extend `createSchedule` to accept structured body)
   - Inline “Schedule this answer” button in Chat → copies Q+A into `Schedules.tsx` `msg` + switches tab via `App.tsx:39`
   - Show `nextRunAt/timezone/recurrence` chips as `Schedules.tsx:89` already does for saved items

4. **History polish** `apps/web-user/src/views/History.tsx:1` `apps/api/src/history/routes.ts:18`
   - Filter `source chat|report`, search `question/answer`, pagination, empty/error skeletons

### P1 — Expected for “looks production”

5. Scheduling enhancements: inline edit cron, duplicate, mute `active` toggle without delete (`schedule/store.ts`), cron validation `cronstrue` feedback `apps/api/package.json:32`
6. Conversational UX: follow-up prompt chips (`show OEE chart`, `last 7 days`), `clear (/new)`, `↑` to reuse last prompt, multiline `Shift+Enter` vs `Enter` send, rate-limit notice
7. Theming/a11y: persisted theme `PUT /settings/theme` `settings/routes.ts:17`, focus states, `prefers-reduced-motion` for `App.tsx:69` `motion`, keyboard `Esc` for Stop, ARIA for Sources tray

### P2 — Nice / proposed (kept in mind, not blocking this pass except 11)

8. Charts/table rendering: detect `metric` `fact-schema.ts:49` `OEE/downtime/scrap` → `Recharts` placeholder — **DEFERRED** (summary only now)
9. Report delivery status `Schedules.tsx:90` `lastRunAt/lastResult` badge + “Run now” dry-run — deferred
10. Model/behavior switch `CHAT_MODEL` `.env.example:36` `chat/prompt.ts` — deferred
11. Empty/onboarding state: first-run card `try: line-3 OEE yesterday / scrap rate last week` when `historyDays()` empty — **INCLUDED**

### Advanced additions (agreed “keep in mind”, now included as A+B)

- **A. Feedback loop:** thumbs up/down + “report wrong answer” per bubble → `POST /history/:id/feedback` (new `history.feedback` column if needed) — measures RAG quality
- **B. Freshness + ops transparency:** Chat footer `Data updated: 5 Sep 10:00 (pending 0)` from `GET /ops/jobs` `apps/api/src/ops/routes.ts:12` + `Hindsight recall: 8 facts` badge — user knows if answer is stale

Deferred C+D (export/share, search reuse, voice) kept for next pass.

### Not touched

`apps/ingest/src/{sql,row-types,context/build,extract/*}` stubs, `MockHindsight` `mock-hindsight.ts:57` file `.mock-hindsight.json`, `MockMachineDb`, `MockLlm`, `HindsightPort` `retain/recall/reflect` — no Phase 10.

---

## 4. Style plan — Awesome UI (Glassmorphism 2.0 Hybrid)

Current `styles.css:4` is elegant-depth flat (`--bg #f4f5f7`, `--shadow-lg`). 2026 prod chat (websearch) expects: dark-base AI panels + frosted glass + streaming cursor + skeleton + source chips + dark default.

Steps:
* Tokens: add `--glass-blur 16px`, `--glass-bg-light rgba(255,255,255,0.08)`, `--glass-bg-dark rgba(23,25,31,0.6)`, `--glass-border rgba(255,255,255,0.1)`, `--radius-xl 20px`, replace `--bg` dark to `#0A0A1E` gradient, `theme.ts:5` default to `dark`
* Header `App.tsx:35` → sticky glass `backdrop-filter blur 16px` + `shadow-sm`
* Chat AI bubbles `Chat.tsx:61` `max-w-[80%] rounded-2xl` → glass panel `backdrop-blur` for `assistant`, solid `accent` for `user`, `shadow-sm→shadow-lg` on hover
* Input `Chat.tsx:75` → auto-resize `textarea` glass, `Send` primary, `Stop` replaces Send while `streaming`
* Login `Login.tsx:32` `card-raise tilt` → gradient mesh dark `0A0A1E→1A1A2E` with limited text (good glass hygiene)
* Hybrid rule: glass only on AI output + header/modal, not on long body text (readability, per 2026 guide)

---

## 5. Implementation order

1. **Plan docs** this file + `STATUS.md` + `IMPLEMENTATION_CHECKLIST.md`
2. **Phase A** Chat core markdown+streaming (deps `react-markdown` `remark-gfm` `rehype-sanitize` `remark-breaks` `react-syntax-highlighter` optional)
3. **Phase B** RAG Sources + feedback
4. **Phase C** Schedule dual NL+picker + Schedule-this-answer
5. **Phase D** History + UX + theming + onboarding
6. **Phase E** Glassmorphism tokens + header/bubble/input polish
7. **Verify** `pnpm -r typecheck` + `pnpm --filter @app/web-user build` + API `curl /health` + `POST /chat` streaming + UI `http://localhost:5173` manual check `demo/demo12345`

---

## 6. Risks & mitigations

* `backdrop-filter` jank on low-end tablets → Hybrid (glass only short panels), test with `prefers-reduced-motion` fallback to solid `surface-2`
* Markdown XSS → `rehype-sanitize` mandatory, no `dangerouslySetInnerHTML` raw
* Picker vs NL cron drift → single server validator `schedule/parse.ts` + `cronstrue` + `nextRunAt` preview as source of truth
* Streaming error silenced after `200 OK` → frontend must render in-stream error event distinct from drop (per metacto guide), already handled via `Chat.tsx:35` catch

---

## 7. Out of scope (deferred)

* LLM live connect `ANTHROPIC_API_KEY` + `ai @ai-sdk/anthropic`, Hindsight live `HINDSIGHT_API_URL`, real `MACHINE_DATABASE_URL` queries, context builder enrichment, fact extraction prompt — all Phase 10
* Chart backend image generation, SMTP/webhook delivery, mobile offline queue, voice input — next passes
