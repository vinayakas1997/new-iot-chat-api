# F3 — Context Component Cards

## Aim
Let the setter define *what* gets summarized from raw data — production count
for this hour, hourly average temperature, and any future summary — as cards
that are cheap to create once and reuse across many lines, even when tables
and column names differ per line.

## Definition
A **context component card** (= one context setting) holds: target line,
selected tables (from that line's F2 member tables), the summary definition,
its SQL query, granularity (hourly / shift / daily), and status
(**LIVE** vs **DORMANT**). Cards are **data, not code**: adding, editing, or
deleting a card changes what the next pipeline tick ingests, with no redeploy.

**Template library + duplicate-and-adjust (locked model).** Frequently needed
summaries are saved as templates in a library ("hourly production count",
"hourly avg temperature", …). The setter instantiates a template onto any
line and adjusts table/column/SQL settings per line — each line holds its own
independent copy, free to diverge (extra WHERE, odd column names, extra
tables). Each copy remembers its source template + version.

**Card lifecycle: LIVE vs DORMANT (locked).**
- **LIVE** = the card is in the pipeline. A live card **cannot be edited or
  deleted** — the UI blocks it and shows where it is live (which lines), so
  the setter sees the blast radius first.
- **DORMANT** = pulled out of the pipeline (ticks skip it from the next run;
  already-stored facts stay untouched). A dormant card can be edited or
  deleted freely.
- **Re-apply** = push the changed card back live onto all lines it was set
  on (see bulk re-apply below).
- **Or create new** = leave the live card running, duplicate it as a new
  card, adjust, activate separately (useful for A/B-ing a query version).

**Bulk re-apply with per-line SQL testing (locked).**
1. Setter edits the dormant card and hits re-apply to all lines.
2. The platform resolves + test-runs the SQL for **each assigned line
   individually** (against its own tables/columns) before anything goes live.
3. Result per line: green or red with the exact error.
4. Green lines apply immediately; red lines block **only themselves** — the
   setter fixes that line's mapping/SQL, re-tests just it, and when all lines
   are green, one action sets everything live.
5. A line goes live only with tested SQL. Nothing half-applied, ever.

**Assignment guard.** A line cannot be assigned (or re-applied) unless all of
the card's required table/column settings resolve for that line — missing
mappings fail loudly at assignment time, never at 2am tick time.

**Test-run.** Every card offers a test-run that executes once and previews
the resulting context units plus extracted facts *without* writing to any
bank.

**Change modes.** Every card edit offers two modes, chosen per change:
- **Forward-only** — the new definition applies from now on (light).
- **Re-ingest from a date** — past windows are rewritten with the new
  definition (heavy but consistent). The business decides each time.

Every stored fact is stamped with `cardName + cardVersion + lineId +
connectionId`, so mixed-version banks stay traceable.

## In scope
- Card CRUD (add new, edit, delete unneeded when dormant), template library,
  duplicate-and-adjust per line, live/dormant lifecycle, bulk re-apply with
  per-line test gate, resolved-SQL preview per line, test-run, activate /
  deactivate, both change modes.
- Tick-cost estimate (queries + units per day) shown before activation, so
  granularity × line fan-out never explodes silently.

## Out of scope
- Database connectivity itself (F1) and line membership itself (F2).
- Read-only verification views (F4, F5).

## Open points — resolved at F3 build time
- Card extras: **included** — unit label, per-card extraction hint, optional
  numeric threshold.
- Test-run scope: **windowed** — `{{from}}`/`{{to}}` placeholders substituted
  (default = last 24h), executed read-only, capped at 50 preview rows.
- Re-ingest style: **overwrite** within the window; version stamps keep the
  seam visible.
- Activation guard: a card goes live only with a passing test whose hash
  matches the current SQL. Multi-statement SQL rejected.
