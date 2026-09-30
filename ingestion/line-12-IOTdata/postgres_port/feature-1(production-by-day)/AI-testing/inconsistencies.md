# Inconsistencies — feature-1 Ask/Template prompts & loop

Compiled 2026-09-30, verified read-only against code + run bundles.
Each item: what breaks, where, status (OPEN / FIXED + where).

## A. Template SQL vs solver SQL (core break)
1. Ask loop never reads the registered template SQL — zero template references
   in `backend/src/routes/playground.ts`. Solver re-derives from scratch what
   gold already knows. Status: OPEN (fix planned: inject template SQL as reference).
2. Template `extractHint`/steer never reaches the ask prompt — steers affect
   card-path suggestions only, not Q&A answers. Status: OPEN (same fix).
3. Template version doesn't bump on hint PATCH (stayed v2) — version tracks SQL
   only, so prompt-content changes are invisible to eval comparisons.
   Status: OPEN.

## B. Prompt build bloat
4. All columns of all 3 member tables sent every attempt, but meanings exist
   only for `stg_ryohin` — `stg_seisan_jisseki`/`stg_ijo` ride along as
   "(no explanation stored)" dead weight. Status: OPEN (fix: name-only for
   meaning-less columns, or template-used-columns filter after A1).
5. No column filtering by template usage — filtering columns "from the SQL"
   has nowhere to hook in while A1 stands. Status: OPEN (blocked by A1).

## C. Trace gaps
6. Raw LLM JSON discarded (`LlmResult.text` unused in ask loop) — bundles save
   parsed fields but not the actual JSON produced. Status: OPEN (fix: save
   `responseJson` per attempt in trace).
7. System prompt not saved in bundles — only `systemRef: "ASK_SYSTEM"`, so
   future runs can't diff what the model was told (OUTPUT CONTRACT, Rule 14).
   Status: OPEN (fix: save `02a-system-prompt.md` per run).

## D. Validator coverage gaps
8. Rule 4 unenforced — Q3 round 2 (2026-09-30T085412Z) passed the gate with
   literal timestamps on TEXT `hiduke` instead of `{{from}}/{{to}}`.
   Status: OPEN (candidate: gate warnings for literals on time columns).
9. No shift-filter requirement — same Q3 run passed without `chuyakin` on a
   shift-partitioned table (22 mixed rows vs 10 gold day slots).
   Status: OPEN (candidate: gate warning for missing shift filter on ryohin).
10. No grain/shape check — Q2's collapsed 1-row summary passes a validator
    that can't tell summary from hourly. Status: OPEN (candidate: shape check
    for trend/peak questions).

## E. Loop bugs (found live, fixed, recorded)
11. Handoff (`ok=false`) misfiled as resolved — ticket #1 closed with a
    handoff note ("3 tries used..."). No reopen API exists; correct record is
    `05-open-questions/rounds/ROUNDS.md`. Fixed in runner v2 (HANDOFF verdict,
    ticket stays open). Status: FIXED (record corrected in ROUNDS.md).
12. Coverage re-proposed forever — ask rounds don't create readings, so the
    same card re-filed every round. Fixed: closed `[loop]` tickets claim their
    sourceRef; verified 0 proposals at steady state. Status: FIXED
    (`backend/src/loop/propose.ts` + runner dedupe).

## F. Registration friction
13. Gold SQL's trailing `;` + comment header broke registration (readonly gate).
    App now strips leading comments (`stripLeadingComments` in
    `drivers/types.ts`); repo `gold.sql` keeps `;` (psql-friendly, app-hostile).
    Registration must strip trailing `;` before storing. Status: FIXED in app,
    convention documented here.
