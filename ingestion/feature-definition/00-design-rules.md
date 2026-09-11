# 00 — UI Design Rules (locked)

All setter-plane screens (F1–F5) must obey these rules. They are binding:
a screen that breaks a rule is not done.

## Theme
- **R1. Dark-first industrial console.** Dark theme is the default; light mode
  is a toggle. Long monitoring sessions + status colors that must pop at a
  glance (Airflow 3, Grafana walls follow the same logic).
- **Accent: industrial teal.** Teal lives only in the chrome (sidebar, active
  nav, primary buttons). Status keeps pure green / amber / red — never teal,
  never decorative color on data.

## Layout
- **R2. One verdict per screen.** Each screen answers exactly one question at
  a glance, top-left, largest type:
  - F1: "are all connections healthy?"
  - F2: "which lines are in the pipeline?"
  - F3: "which cards are live, and on what?"
  - F4: "did this line ingest clean on this date?"
  - F5: "is Hindsight live?"
  Everything else on the screen supports that verdict.
- **R4. Layout follows screen type, not one grid everywhere:**
  - F1 connections + F2 lines → **table-first** (Stripe pattern): dense rows,
    status chips, search/filter on top, click a row to drill into detail.
  - F3 cards → **card grid**: template library + per-line copies, LIVE /
    DORMANT badges, bulk-action bar for re-apply.
  - F4 history → **calendar + day story** with tick-strip dots per day cell
    (closest reference: Airflow Grid view status heatmap).
  - F5 → **single status hero** + deep-link button. Simplest screen, biggest
    type.

## Visual language
- **R3. Color = state, never decoration.** Green / amber / red are reserved
  strictly for health and status. Brand teal belongs in the chrome, never in
  the data.
- **R5. Hierarchy from type + space, not boxes.** Few borders (Linear-style):
  font weight, size, and whitespace do the grouping. If a border feels needed,
  add spacing first.
- **Numerals rule.** Tabular figures everywhere, consistent precision, units
  set lighter than values (`33` bold + `facts` muted). This is what separates
  credible industrial UI from amateur.
- **R6. Progressive disclosure everywhere.** Summary → click → detail, on all
  five screens identically:
  - F1: connection row → tables → columns → sample rows.
  - F2: line row → connection + member tables.
  - F3: card → per-line resolved SQL → per-line test results.
  - F4: day → "how the AI interpreted" → fact trail → failures.
  - F5: status hero → Hindsight's own UI (deep link).

## States & robustness
- **R7. Empty / loading / error states are designed, not defaulted.**
  First-run (no connections yet) is an onboarding surface with a guided "add
  your first connection" — never a blank table. Poller failures raise one
  shared alert-banner pattern used identically in F1, F4, and F5.
- **R8. Plant reality.** Touch targets big enough for shop-floor tablet use;
  compact table-density toggle for desktop power use.

## Stack (locked)
- Tailwind CSS + shadcn/ui components. Dark/light tokens from the theme
  setup; no ad-hoc hex colors in screens.
- Reference patterns to lift: Airflow 3 Grid view (F4 tick strips), Stripe
  table-first (F1/F2 registries), Linear chrome (sidebar, spacing discipline).

## Open points
- None. Accent shade of teal finalized at first-screen build time.
