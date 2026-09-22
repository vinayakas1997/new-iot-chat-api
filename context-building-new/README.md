# Context Building — Research Track

> **Status:** research only. No app code changes until the prompts graduate and a build is explicitly approved.

## What we're doing in this folder

Designing the **prompt engineering** for the plant-chart vision loop — HOW each prompt is built and WHAT output format it must return — before touching any application code.

Background: the app backend already has transport + storage + manual triggers (`chart_readings`/`tickets` tables, image-capable LLM client, `snapshot-read`, ticket + health endpoints, F7 Overview UI). What's missing is **proven prompts**: the frozen dry-run in `../context-step-1/` proved the contract on synthetic matplotlib charts (5 trials, PASS), but never on our real renderers, never for the `below` direction, never end-to-end for tickets.

## The loop being researched

```
Snapshot (1 chart) → Reading call (single image) → Row: verdict + summary + prompt + image
                                                        ├──→ prior digests (tomorrow's memory)
                                                        ├──→ newQuestions → ticket birth (spec pending)
                                                        └──→ questionVerdicts → close / escalate / keep
Reading rows (N charts) + their PNGs → Summary call (Step-2V) → conclusion + conflicts + questions
Exact rows → Step-2 grounding → confirm / correct numbers
```

Laws: **read separately, summarize together** · **no verdict without ground truth, no ticket without evidence** · **one image per reading call.**

## Workstreams

| # | Name | Question | Output |
|---|---|---|---|
| R1 | Step-1 prompt audit | Does `system.txt` survive our renderer overlays, `below` direction, 2 threshold rows, small thumbs? | Gap list + v2 wording, rule by rule |
| R2 | Output format design | Exact JSON schema per call (fields, types, required/optional, enums, constraints)? | Schema specs: reading / summary / verdict |
| R3 | Envelope field specs | The 9 ingredients: source, format, length caps, fallback when missing? | Field-by-field build spec + examples |
| R4 | Trial program | Which trials, which images, grading rubric, variance rule? | Trial list + pass criteria |
| R5 | Edge prompts | Refusal text, unreadable verdict, escalate wording? | Exact strings + triggers |

Suggested order: **R1 → R2 → R4**, with R3/R5 folding in as parent decisions land.

## Source material (read-only inputs)

- `../context-step-1/` — frozen contract: `system.txt` (7 rules), `user_template.txt` (envelope), `meta_*.json`, `truth.json` / `expected.json` (grading oracle), `runbook.md`, `grades.md` (5 PASS trials), `step2_prompt.txt`.
- App code (reference only, do not modify during research): `app/backend/src/routes/readings.ts` (`STEP1_SYSTEM`, `buildUserEnvelope`), `app/backend/src/llm/client.ts` (image transport), F7 Overview UI.

## Known gaps to close

1. Dry run never saw our renderers (warn bands/dots/docked legend untested as visual input).
2. `below` direction: claimed, zero trials.
3. Ticket paths: `keep-open` proven once; `closed`/`escalated`/raising never exercised end to end.
4. `n=5`, one model, one temperature — no variance data.
5. `unreadable` path never tested; Step-2 slice hand-pasted; grades human-judged.

## Rules of this folder

1. No application code changes — research artifacts only.
2. Prompt drafts + trial results reported in chat; nothing committed without approval.
3. Live LLM probes only on explicit per-probe approval (direct `:8009`, results pasted, never saved).
4. Every prompt change re-graded against `truth.json` before acceptance.
