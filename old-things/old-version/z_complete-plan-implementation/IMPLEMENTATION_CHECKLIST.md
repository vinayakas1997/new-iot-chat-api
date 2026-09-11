# Implementation Checklist — atomic steps

Copy into `TodoWrite` as you go.

- [x] 0. Plan docs created (`PLAN.md`, `STATUS.md`, `IMPLEMENTATION_CHECKLIST.md`)
- [ ] A1. Add deps `react-markdown remark-gfm rehype-sanitize remark-breaks`
- [ ] A2. `Chat.tsx` markdown render + code copy + memoized Markdown component
- [ ] A3. `Chat.tsx` streaming: cursor ▌, Stop button (replaces Send), auto-scroll, skeleton TTFT, retry resend
- [ ] A4. `lib/api.ts` expose abort signal for `chat()` generator + `apps/api/src/chat/route.ts` handle abort
- [ ] B1. Backend expose recall results in stream meta? For now mock: parse `(mock LLM answer)` tool lines in frontend as Sources tray; later real tool events
- [ ] B2. `Chat.tsx` Sources collapsible tray + citation chips → `History.tsx` day link
- [ ] B3. Feedback thumbs up/down per message → `apps/api/src/history/routes.ts` `POST /history/:id/feedback` + schema if needed
- [ ] C1. `Schedules.tsx` dual UI: keep NL `Preview` + add time `<input type="time">` + timezone select + recurrence radios + query textarea
- [ ] C2. `apps/api/src/schedule/parse.ts` + `routes.ts` accept structured body `{queryText,timeOfDay,timezone,recurrence}` and unify with NL path, `cronstrue` validate + `nextRunAt` preview
- [ ] C3. `packages/shared/src/types.ts` ensure `Schedule` contract covers picker fields (already has `timeOfDay/timezone/recurrence/nextRunAt/humanCron`)
- [ ] C4. Chat “Schedule this answer” button → prefill `Schedules.tsx` + `App.tsx` tab switch
- [ ] D1. `History.tsx` filters (source), search, pagination, skeletons
- [ ] D2. UX: follow-up prompt chips, clear/new, ↑ reuse, Shift+Enter multiline, Esc stop, rate-limit notice
- [ ] D3. Theme persisted `theme.ts` + `PUT /settings/theme`, `prefers-reduced-motion`, focus/ARIA
- [ ] D4. Onboarding empty state `Ask about OEE…` → richer card when `historyDays()` empty
- [ ] E1. `styles.css` tokens: `--glass-*`, dark base `#0A0A1E`, radius, blur
- [ ] E2. `App.tsx` sticky glass header, `Chat.tsx` glass bubbles, `Login.tsx` gradient mesh, input glass
- [ ] V1. `pnpm -r typecheck` clean
- [ ] V2. `pnpm --filter @app/web-user build` + `web-ops` build
- [ ] V3. Smoke: `curl /health`, `POST /auth/login`, `POST /chat` streaming, UI manual `demo/demo12345`
