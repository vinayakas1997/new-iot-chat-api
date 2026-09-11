# F4 — Line History Viewer (read-only)

## Aim
Let the setter check, for any particular line and any date, what the ingestion
pipeline did — without any possibility of changing or hampering it.

## Definition
The history viewer is a **strictly read-only** screen with this layout:

- **Top: search box by line name.** Selecting a line loads its identity card:
  when registered, which DB connection (F1), member tables (F2) — then its
  history below.
- **Calendar.** Pressing any date shows **what context was built that day**:
  which cards (F3) ran, rows pulled → units built → facts stored, per-run
  status with tick timestamps and card versions.
- **"How the AI interpreted" button.** Beside the day view: per card-run, the
  context that went in vs the **facts that got stored** — the AI's reading of
  the data, not just pipeline counts.
- **Failures below.** Any errors that day listed underneath with the full
  trail (card, SQL, line/table, message) so the setter jumps straight to F3
  to fix.

Day cells carry a compact **tick strip** (e.g. 24 dots for hourly — green/red)
so a single failed tick is visible without drilling down. Each day's view
shows the **previous day alongside** (counts + status) so drops and spikes
read instantly.

A **quiet-line banner** sits on the line header when the line's
last-successful-tick (F2) is older than N hours — a dead sensor must not look
like a healthy idle line.

## Build rules (locked)
- F4 reads **only** the run log + stored banks — the same rows the pipeline
  wrote, never recomputed summaries. That log is the single source of truth;
  nothing on this screen is recalculated.
- No create / edit / delete / re-run action anywhere on this screen.

## In scope
- Line search + identity card + calendar day view + AI-interpretation view +
  failures section + tick strips + previous-day comparison + quiet-line
  banner.
- Read-only access to stored facts for spot-checking a day's output.

## Out of scope
- Any mutating action (use F1–F3 for changes).
- Live raw-database browsing (that belongs to F1).
- Cross-line day overview (line-first for v1; overview strip is a later
  extension).

## Open points
- Run-level drill-down within a day: deferred until day-level view proves
  sufficient.
- Quiet-threshold N (proposal: 6 hours for hourly cards) — locked at build
  time.
