# F7 Overview — Enhancement Plan

Source: discussion 2026-09-25. F7 = `ingestion/app/frontend/src/screens/Overview.tsx` (230 lines).
F7 shows *results* (logs, readings, tickets, health) but not the *cadence behind them*.
Goal: make the whole context-building process visible in F7 — nothing buried, nothing in Hindsight.

## Current F7 blocks (keep, untouched)

1. Line selection (search + pick) — fine.
2. Log table (`LogTable`, runs for date + readings all-time) — fine.
3. Status (FeedPill) — fine for now, fix later.
4. Health cards (`HealthTiles`) — fine.
5. Right column: `TicketSidebar` (open/closed). Modal: `ReadingDrawer` (per-reading detail).

## Item 1 — Template-card dropdown with granularity reflection (AGREED)

- Add a dropdown in F7 to **choose the template card**.
- On selection, the granularity options **reflect that template's own settings**:
  - Only resolutions present on the template stay selectable.
  - Missing ones (e.g. 5-min not set) render **inactive/disabled** with a reason.
- Data: cards/templates already carry `resolutions` + `granularity` (`Cards.tsx`).
- Pattern: same coverage-gating already used for Playground presets (disabled + tooltip).

## Item 2 — Granularity selector below the Log (AGREED)

- Below the Log table, an explicit **granularity dropdown** (5 min, 1 hour, shift, daily…).
- Setting it filters the log to **that granularity's runs only**.
- Mechanism already exists, currently implicit: every log row carries its resolution
  (`LogTable.tsx:9-10` parses `resolution` from `readingJson`; run rows via `run.resolution`;
  `mergeLog` + `LogTable` accept a `stream` filter, today driven by health-tile clicks with base hidden).
- This work = surface that filter as a visible, labeled control. No backend, no schema.
- Items 1+2 are one flow: pick template → allowed granularities light up → pick one → log filters.

## Item 3 — Per-log-row evidence buttons: the row becomes the evidence hub (AGREED)

Every log row gets five inspect actions. Everything the pipeline did for that run,
inspectable in place — no context-switching to folders or the Hindsight UI.

### Button 1 — Timing status (when the context got built)

- Shows the per-run timeline: tick ran → extract drafted → facts retained.
- Backing: run rows carry `at`/window; `llm_calls` carries `at` + `latency_ms` per call.
- Display-only: assembled from existing rows. No backend.

### Button 2 — AI output response (what the LLM returned)

- Shows the raw model output for that run: response text + parsed JSON.
- Backing: `llm_calls` stores `prompt`, `response_text`, `parsed_json` per call
  (`backend/src/db/store.ts:1779`), exposed via `backend/src/routes/llmcalls.ts`;
  readings also carry `responseText` + `readingJson`.
- Display-only. No backend.

### Button 3 — What was sent to the LLM (prompt + preprocessing)

- Shows the exact prompt/envelope as sent just before processing, plus a description
  of the preprocessing (envelope assembly is deterministic — re-describable from the stored prompt).
- Backing: `llm_calls.prompt` (per call) and readings' `prompt` field.
- Display-only. No backend.

### Button 4 — Charts on demand (dynamic render, never stored)

- Renders the chart for that row's card + window **when pressed** — dynamic, always fresh.
- Deliberately NOT stored: no image persistence, no storage growth.
- Backing: `backend/src/routes/charts.ts` already renders PNGs server-side on demand;
  the button re-invokes render for the row's card SQL + window.
- Frontend work only (invoke existing endpoint on press). No backend.

### Button 5 — Hindsight inserts for this input (points/vectors via tags)

- Shows what facts/vectors that run's input created in the vector DB.
- There is no direct row→memory link — the bridge is **tags**: every retained fact carries
  `line:`, `card:`, `cardVersion:`, `connection:`, `measure:`, `unit:`, `granularity:`,
  `resolution:`, `breach:` plus string metadata (window JSON, samples, sqlHash).
  The button recalls memories filtered by this row's tag set.
- ⚠️ The only one of the five that is NOT display-only: nothing reads back by tag today
  (only `extract.ts` retain-POST and `banks.ts` touch `/memories`).
  Needs one small backend addition: recall-by-tag-filter against Hindsight, then display.

### Item 3 build order

Buttons 1–4 first (pure display on stored data, zero risk), Button 5 after (one backend step).
Open design calls: drawer vs inline popover per button; chart render params per row type.

## Item 4 — Right-hand ticket panel: open questions per granularity, auto-close (AGREED)

Open tickets ARE the open-ended questions. The right panel (`TicketSidebar`) reflects them
**grouped by granularity level** (5-min questions under 5-min, hourly under hourly…).

### Each open ticket shows four things, nothing else

1. **Title** (`TicketRow.title`).
2. **Meaning** (`TicketRow.aiReason` — why this question exists).
3. **When created** (`TicketRow.at`).
4. **Time elapsed unanswered** (`now − at`, ticking while status is open).

### Auto-close on answered (the loop's self-resolution)

- When a question is answered by new data, the ticket **closes automatically** — no human
  close button in the loop. Manual close stays only as a demoted escape hatch.
- On close, the elapsed timer freezes into "answered after X" with the close reason.
- ⚠️ Wiring needed: today `closeTicket` is only called from the manual close endpoint
  (`backend/src/routes/tickets.ts:30-34`, human note required). The *design* for auto-close
  already exists in the prompt — every reading must return `questionVerdicts` per open ticket
  (`keep-open` / `closed` / `escalated` + reason, `backend/src/routes/readings.ts:33`) —
  but nothing in code *acts* on a `closed` verdict today.
  Work: apply verdicts (reading returns `closed` + reason → ticket flips to closed with that
  reason as the note). Small backend step, big loop payoff.

### Granularity grouping without schema change

- `TicketRow` carries `readingId` / `runId` / `cardId` but no resolution.
  Grouping resolves via the linked reading (`readingJson.resolution`) or the card's
  granularity — a join at display time. No schema change.

### Panel sketch

```
Open questions                          ← grouped by granularity
  ▸ 5 min (2)
    • Title… — meaning… — opened 3h ago, unanswered 3h
    • Title… — meaning… — opened 26m ago, unanswered 26m
  ▸ hourly (1)
    • …
Closed (auto)                           ← collapsed, with close reason
```

## Item 5 — Shift full removal + granularity levels, one by one (AGREED: full removal)

Finding: shift is half-removed — dead in the engine (`rollup.ts:14` "No shift anchor (removed)";
`ticker.ts:11` "Wall-clock throughout (no shift anchor)") but alive in schema, types, and UI.
A user can pick `shift` today, the DB accepts it, the UI promises 3 ticks/day, and the engine
silently does something else. A setting that lies → remove from the scratch level.

### Removal steps

1. Schema: drop `'shift'` from both `CHECK` constraints (`backend/src/db/store.ts:101,117`);
   migrate existing `shift` cards/templates → `hourly` (or finest checked stream).
2. Types: `Granularity` → `"hourly" | "daily"` (`store.ts:789`); frontend `lib/api.ts:268,294` same.
3. Dead columns: `shift_start` / `shift_hours` — stop writing, ignore in reads
   (physical drop in a later migration; never read by the engine today).
4. UI: remove `shift` from granularity selects (`Cards.tsx:3497`, `Playground.tsx:299`),
   `TICKS_PER_DAY` (`Cards.tsx:42`), `granularityForStreams` (`Cards.tsx:2515`),
   and the `granularity === "shift" ? "hourly"` special-case (`Cards.tsx:3743`).

### The granularity levels, one by one — how each is built and how it reflects

| # | Level | How it's built (engine) | How it reflects (UI) |
|---|---|---|---|
| 1 | **5-min (base)** | Finest checked stream; base sampler runs plant query every heartbeat over `lastTick→now`; every attempt footprinted `resolution: base` | F7 Log (base rows) + Item 2 dropdown option; Playground presets only when covered |
| 2 | **Hourly** | Rollup of base (averages; sums for counts); 24 ticks/day | HealthTiles stream tile; Item 1 template reflection; Item 4 ticket group |
| 3 | **Daily** | Rollup; 1 tick/day; production-day bucketing (wall-clock, no anchor) | Same surfaces as hourly; skip-schedule aware ("skips set" marker) |

Rule: no level exists in UI without an engine behavior behind it, and none in the engine
without a surface showing it — enforced per level, one by one, before moving to the next.

## Item 6 — "+ New template" additions: table/chart toggles + analysis start (AGREED)

Shared shape: template-level switches, inherited by cards, honored by the pipeline —
the same inheritance pattern as extract hint and retain context (form fields 10–11).
Suggested build order: 6a → 6c → 6b.

### 6a. Table include tick (send this table raw in prompt building)

- Missing: `tplDraft` has no per-table include list; tables flow into the envelope wholesale
  from SQL/membership. (Per-*chart* on/off exists via `chartSuggestions[].enabled` — chart-level, not table-level.)
- Build: per-member-table checkbox row in the template form → stored include-list on template →
  inherited by cards → envelope builder honors it (included tables raw, excluded skipped).
- Smallest of the three. No pipeline breakage.

### 6b. Chart tick — "don't need the chart at all" (chartMode off)

- Missing: form field "9. Charts creation" only suggests charts; there is no off switch.
- ⚠️ Pipeline consequence: readings mandate a chart image today
  (`backend/src/routes/readings.ts:94` rejects non-`data:image/` payloads).
  Chart-off needs a **table-only reading path** (envelope without image, prompt variant citing
  rows instead of axes) or chart-off templates silently produce nothing.
- Build: template-level `chartMode: auto | off` → off skips Suggest/render AND routes readings
  down the table-only path. Largest of the three (new reading path).

### 6c. Analysis start date (pre-fill from where)

- Missing at template level: tables hold past data but no template setting says where analysis
  begins; default today = wherever the tick window/backfill starts, not a user choice.
- Cousin exists: card copies have `reingestFrom` (changeMode forward vs re-ingest) — per-*card*,
  set at copy time, not a template default.
- Build: template field `analysisStart: <date> | "from-start"` (default `from-start` = earliest
  data), inherited by cards as their `reingestFrom` default, overridable per card.

## Item 7 — Close the question↔ticket loop both directions + orphan Playground (AGREED)

Design principle across all items: nothing decorative — every setting wired to an engine
behavior, every engine output with a surface, both directions of every loop closed.

### 7a. Auto-open tickets from `newQuestions` (birth direction)

- Missing: the prompt births up to 3 `newQuestions` per reading, but `openTicket` is called
  only from the manual ticket endpoint (`backend/src/routes/tickets.ts:26`). Readings birth
  questions into JSON; nobody files them as tickets.
- Item 4 wires verdicts→close (death direction); this wires questions→open (birth direction).
- Build: reading returns questions → tickets open automatically with evidence + reading link,
  capped, deduped against open tickets. Small backend step, mirrors Item 4's verdict wiring.

### 7b. Live birth gate (filler guard)

- Missing: research mandates a birth check (has evidence? already asked? worth a ticket?),
  but live `backend/src/routes/readings.ts` has no `birthCheck` — only the "never open filler"
  instruction holds the line.
- Build: enforce the birth checklist per candidate question before 7a files it
  (evidence present, not duplicating an open ticket, meets the worth-it bar).

### 7c. Delete orphan `Playground.tsx`

- `ingestion/app/frontend/src/screens/Playground.tsx` (393 lines) is unrouted dead code —
  the real Playground lives as a tab in `Cards.tsx`. Delete or route. (Cleanup-pending.)

### Checked and clear (verified 2026-09-25, no action)

- `graph_specs` backend IS used (`Cards.tsx`, `CardDetails.tsx`) — alive, not a gap.
- `LLM_CALLS_CAP = 2000` (`store.ts:1721`) — ample for Item 3's evidence buttons (≈200+ days
  at current tick volume). No action unless volume grows 10×.
- Dormant cards do NOT tick (`ticker.ts:50` filters `status === "live"`). No silent compute. No action.

## Item 8 — Retention doctrine: bank feeding is questions-first (AGREED)

> **The bank remembers what was asked, what answered it, and what the numbers were —
> in that priority order.** Questions first, verdicts second, facts third.

### Why questions-first (the stronger concept)

1. **Questions are pre-compressed signal.** A tick fact says "22.4 °C at 14:00" (data).
   A question says "the 02:00-dip pattern broke at 14:00 and it's unexplained"
   (data + pattern + epistemic state, one object). Every bank memory arrives already
   carrying *why it matters*.
2. **Their lifecycle is the temporal story for free.** Born → keep-open → closed-with-reason
   is a complete change record with timestamps at each transition. Raw facts need
   consolidation to become a story; questions *are* the story, self-assembling.
3. **Recall becomes question-shaped.** The queries actually asked
   ("what's unexplained on line-12?", "when did the dip pattern break?") match stored
   questions 1:1. Storing answers-to-be-asked beats storing values-to-be-searched.

### Why Hindsight fits (temporal spine)

Every memory carries `timestamp: window.to` plus tag axes (`line:`, `card:`, `measure:`,
`resolution:`, `breach:`…) — recall is always "what was true *when*." Consolidation
(`observations` mission, chunks mode) folds repeats into durable behaviors, so the tape
compresses itself; anything with a new timestamp + new value stands out against the held
pattern. Less noise, changes recorded — natively, no extra indexing.

### The two layers (priority order)

| Layer | Content | Cadence | Role |
|---|---|---|---|
| **Story (primary)** | Open questions + verdicts + close reasons (Items 4, 7a/7b) | Always retained, each with evidence + window + tags | The signal — what was unknown when, and when it resolved |
| **Substrate (supporting)** | Change/breach facts + heartbeat liveness | Lean (hybrid gate below) | The evidence the story points at |

Recall joins them: *"what was open at 14:00?"* → the question + that window's facts.
Neither layer alone answers it; together they do.

### Substrate gate (hybrid: skip duplicates + heartbeat)

Per tick: run query → draft values deterministically → **compare vs last retained** →
unchanged? footprint `unchanged — value X held`, skip LLM + retain (no cost) →
changed? full LLM draft + retain → every Nth skipped window, one heartbeat fact
("still nominal, X holding since HH:MM") so recall proves liveness and silence stays
unambiguous (steady process vs dead sensor). Footprints keep Item 3's evidence story
complete (`unchanged`, never absence).

### Grain note (seconds-scale manufacturing at 5-min ticks)

5-min ticks store **window aggregates** (count, min/max/avg, breach) — never raw samples;
raw seconds stay in the plant DB. A 40-second product cycle reads at 5-min grain as
"7 units, 21.8–23.1 °C, nominal": stops, drifts, and spikes survive aggregation, noise
doesn't. Rule: **tick grain stores what changed about the window, not what happened
inside it.**

### Cross-resolution rule (never embed, never compare here)

- **Separate facts, shared clocks:** each resolution retains as its own facts (distinguished
  by the `resolution:` tag + `samples` in metadata). An hourly fact stays a compression,
  never a container — no 5-min payloads embedded inside hourly/daily facts.
- **Resolutions compress upward, recall drills downward, time is the join.** One hourly
  window covers twelve 5-min windows; drill-down is a time-range + tag query
  (`line:X + card:Y + measure:Z`, timestamps inside the hour). Full ladder 5-min → hourly →
  daily traversable both directions with zero duplication.
- **Lineage key (with the substrate build):** add `derivedFrom: "<N>×base windows <from>..<to>"`
  to rollup-fact metadata alongside existing `samples` — parent declares children, rollup
  stays auditable, Item 3's evidence story extends across resolutions.
- **No comparison on the producer side.** Cross-resolution comparing, merging, and
  presentation live in the recall application (consumer side), never here. We store
  well-formed separate facts; they join across time.

### Guardrails (non-negotiable)

- **Every question memory carries evidence + window + tags.** A question without evidence
  is a rumor — Item 7a files evidence + reading link with each one. Questions point;
  substrate proves.
- **Substrate keeps flowing (lean).** A quiet-but-broken sensor must leave a trace —
  the hybrid gate is the alibi layer: cheap, quiet, there when questions need grounding.

### Consequence for the plan

Item 7a stops being a UI convenience and becomes **the primary bank feed** (questions filed
as memories, or linked to them, with evidence + window + tags). Tick facts are explicitly
substrate. Bank starvation diagnosis (suspects A/B/C) stays the unblocker: nothing feeds
until ticks retain again.

## Item 9 — Question validator (Gate 2) + birth-per-cycle guarantee (AGREED)

Gate 1 (birth) proposes; Gate 2 (validator) disposes. If bank feeding runs on questions,
the validator decides what the bank *becomes* — unfiltered questions = noisy bank =
doctrine collapses. This gate is load-bearing.

### Birth-per-cycle (stability + completeness)

- "Up to 3 questions" = **per reading** = per card, per resolution, per tick. Every cycle,
  every stream gets its own asking chance; empty array is valid and expected on normal days.
- **Stability (bounded):** worst case per tick = 3 × cards × resolutions candidates, then Gate 2
  trims to file/merge/drop. Ticket growth capped twice (birth cap, then validator) — no
  explosion ever. Merge absorbs recurrence: persistent unknowns grow *deeper*, not wider.
- **Completeness (nothing missed):** coverage is per-cycle — a transient one-window unknown gets
  asked in its own window even if later windows look normal. `newQuestions: []` is a positive
  "examined, nothing unclear" signal, footprinted like everything else: silence in the bank
  means *examined-and-clear*, never *unexamined*.
- Accepted nuance: a chaotic window's 4th+ unknown waits for the next cycle (windows recur;
  siblings' evidence usually carries it). Negligible delay for guaranteed boundedness.

### Gate 2's three-way verdict: file / merge / drop (all auditable)

1. **Similarity → merge, don't duplicate.** Candidate vs open tickets: exact/near match
   (deterministic normalized-text, cheap) → paraphrase match (small LLM judge,
   "are these the same unknown?"). On match: attach new evidence + reading link to the
   existing ticket. Five readings circling one unknown = one ticket with five evidence
   links, not five twins. This is where the bank's compression really happens.
2. **Waste → drop with reason (logged, never silent).** Filler patterns: no cited evidence,
   already answered by data in the same window, generic-curiosity, unresolvable-by-future-data.
   Drops are footprinted ("question dropped: no evidence, reading #412") and shown in the
   Process panel (Item 3 evidence story). An unaudited filter is censorship with extra steps.
3. **Worth-it bar → file.** Survivors must be specific, evidence-bound, and resolvable by
   future observations. Only these become tickets → question-memories → bank feed (Item 8).

### Cost shape

- Gate 2 runs **only when Gate 1 produced candidates** (normal readings: zero questions →
  zero validator cost). Deterministic-first; LLM judge only on ambiguous similarity.
- Funded by Item 8's substrate savings (an LLM call saved per quiet tick; spend a slice here,
  where judgment actually matters).

## Item 10 — Scope boundary: coverage map, recall contract, connections walkthrough (AGREED)

### End-to-end coverage map (audited 2026-09-25)

| # | Stage | Status | Where |
|---|---|---|---|
| 1 | Plant DB → connections | Walkthrough only (see below) | Assumed working; foundation to verify, not redesign |
| 2 | Lines register / deregister (F2) | Touched | Freeze semantics, deregister-as-freeze |
| 3 | Templates → cards (F3, incl. Item 6) | Touched | Toggles, analysis start, inheritance |
| 4 | Ticks (cadence, granularity, shift removal) | Touched | Item 5, tick doctrine |
| 5 | Extraction + retain (preparation chain) | Touched | Verified item-by-item; starvation diagnosed-to-plan |
| 6 | Hindsight banks (push, missions, config) | Touched | Verified live; feeding doctrine Items 8–9 |
| 7 | Readings (charts, Step-1, table-only path) | Touched | Items 3, 6b; research frozen |
| 8 | Questions ↔ tickets loop | Touched | Items 4, 7a/7b, 9 |
| 9 | Recall — who reads the bank, and how | Out of scope (separate application, see contract) | — |
| 10 | F7 display of the whole process | Touched | Items 1–4 |
| 11 | Playground (scratchpad SQL) | Touched | Shipped + Item 3 evidence links |
| 12 | Loop observability (is the loop healthy?) | Half — queued, not urgent | Footprints exist; loop-level view (bank growth, question velocity, validator ratios, skip reasons) is displayable from existing data later |

### Recall is a separate application (out of scope)

No recall UX, no "ask the line" path, no answer-grounding feature will be designed here.
This system's obligation ends at **recall-ready memories**: every memory self-describing
(content + timestamp + context + tags + evidence links), needing zero tribal knowledge to
read. Items 7a/8/9 already produce that shape. If the recall application ever needs a field
we didn't store, that's our bug, caught at integration — not a redesign.

### Connections walkthrough (verify, don't redesign)

Trace one line's full foundation path read-only: plant DB → connection health →
line membership → member tables → sample query → tick footprint `rowsPulled`.
Either clears the foundation or locates the starvation cause (Suspect A: silent zero-row
ticks may live here, not in our code). No changes — understanding only.

### Deliberately out of scope (confirmed)

Auth/multi-user, deployment/backup, LLM failover (single local model today — an ops
decision, not a design gap).

## Parked for later (discussed, not yet scoped one-by-one)

- **Questions pane**: open questions across readings (question → evidence → kind/conf → status),
  expandable birth trail (born in reading #N → verdicts across cycles → ticket link / closed-with-reason).
  Placement decision pending (leading option: right column stacked with tickets).
- **Process panel** ("how decided"): per-reading prompt version (hash stored `prompt` → version map),
  envelope sections, validator status shown honestly as *research-only, not yet live*.
  Leading option: start inside `ReadingDrawer` + line-level strip (prompt version + readings/questions/tickets counts).
- Research trials stay in folders (methodology, not operations).
- Validators must never show a fake pass before they are wired live.

## Constraints

- No backend changes, no schema changes, no new endpoints for Items 1–2 and Item 3 Buttons 1–4.
- Item 3 Button 5 needs one backend addition: recall-by-tag-filter against Hindsight.
- Item 4 needs one backend addition: apply `questionVerdicts` (auto-close on `closed` verdict).
- Item 7a/7b need one backend addition: file `newQuestions` as tickets (capped, deduped) + live birth gate.
- Item 8 needs: question-memories feed (7a output → bank, evidence + window + tags) + substrate hybrid gate.
- Item 9 needs one backend addition: Gate 2 validator (file/merge/drop + drop-reason footprints).
- No prompt changes. No Hindsight changes.
- Every datum needed already flows through existing endpoints
  (`readingApi`, cards/templates API, `overviewApi.health`).

## Item 11 — Hindsight effective-use register (AGREED)

Source: official Hindsight docs (`hindsight.vectorize.io` — Retain, Recall, Memories,
Retrieval, CLI, Python client). Feeding core (Item 8 field doctrine) is settled; these are
the operate-and-consume features, adopted per status. Use according as builds reach them.

### Field doctrine (recap — the time-tags decision)

- The WHEN → `timestamp` (+ `occurred_start/end = window from/to` at retain: range semantics
  for the temporal arm). Already sending `timestamp: w.to`; extend to the range.
- Window bounds as strings → `metadata` (extraction context + client-side filtering; recall
  never filters on metadata, so nothing breaks).
- Stream meaning → `context` (steers the extractor; keep time out; one label, one job).
- Scope axes → `tags` (`line:`, `card:`, `resolution:`, `breach:` — low-cardinality, exact-match,
  recall-filterable). Time-as-tags (`hour:14`, `date:…`) → never (cardinality explosion,
  temporal recall already answers time better via dates).

### ADOPT — fills gaps already named in this plan

1. **Operations polling → reconciliation loop.** `list_operations` / `get_operation` polls our
   `async:true` retain operations to confirmed/failed. Periodic job: tick footprints vs
   operation states. Turns fire-and-forget into confirmed-write. Closes residual risk #4
   (async loss). Highest value, smallest work.
2. **Curate API → supervision instrument.** PATCH correct (re-embeds + re-consolidates
   downstream), invalidate-with-audit, restore, per-unit history. Human spot-checks validator
   output → invalidates bad facts → bank heals via re-consolidation. This is the tooling for
   the post-process checks section.
3. **Knowledge pages → automatic shift handover.** `create-page` generates markdown from
   observations (`--fact-types`, `--mode full`, stale-tracking built in). Scheduled per-line
   "shift handover / recent incidents" pages, generated by Hindsight from our
   question-memories — near-free reporting on the bank we already feed.

### DESIGN WITH — recall-app contract + F7 (Item 10)

4. **`list_tags` with counts → live F7 dropdowns.** Items 1–2 read live tag scopes + counts
   instead of hardcoded options. Dropdowns reflect what's *actually stored* — the
   reflects-properly rule enforced by the bank itself.
5. **`include_chunks` + `temporal_window` → recall contract details.** `include_chunks`
   returns source chunks per memory (evidence display free); `temporal_window` takes explicit
   `{start, end}` (F7 date picker maps 1:1 — no date-parsing needed). File into the Item 10
   recall contract when the consumer is built.

### LATER — powerful, premature today

6. **`entity_labels` with `tag: true`.** `measure:`/`card:` groups become graph entities
   (auto-linking memories) *and* recall tags. Do when the bank has volume worth linking.
7. **Mental models + tag-scoped directives.** Per-line reflect identity, breach-scoped hard
   rules — consumer-side seasoning for the recall app, not feeding work.

## Post-process checks (LESS IMPORTANT until the full system is ready)

Design debts: none open. Operational debts (after build, in order): validator accuracy
spot-checks on live traffic; Hindsight async-vs-footprint reconciliation; model liveness +
fallback drills; per-line template audits (thresholds/SQL/retain-context); bank growth +
recall quality reviews; multi-line scale rehearsal. Design makes failure loud; operations
answers it — but only once there is a running system to watch.
