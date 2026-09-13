# 09 — Stored Graphs (Visualization Specs)

Status: **built** (2026-09-13)

## What it is

Each card can have one or more **graph specs** — stored chart definitions
(chart type, X axis, Y series, title) that describe how the card's data
should be visualized. The AI chat layer later retrieves these specs instead of
inventing charts from scratch.

## Why store graphs

1. **Setter-approved visuals**: the chart is designed once by the human who
   knows the data, then reused every time the AI answers a question about
   this card's metric.
2. **No hallucinated charts**: the AI reads the spec and renders the
   pre-approved visualization, then writes the explanation around it.
3. **Versioned with the card**: when card SQL changes, graph specs version up
   (x-column/y-columns change = version bump).

## Data model

```
graph_specs (
  id TEXT PRIMARY KEY,
  card_id TEXT → cards(id) CASCADE,
  name TEXT,              -- optional label ("Temperature trend")
  chart_type TEXT,        -- table | line | bar | area
  x_column TEXT,          -- column name for X axis
  y_columns TEXT,         -- JSON array of column names for Y series
  title TEXT,             -- chart title
  config TEXT,            -- JSON object (extensible: colors, thresholds…)
  version INTEGER,
  created_at TEXT,
  updated_at TEXT
)
```

One graph per card is the v1 default. Schema allows many.

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ingest/cards/:cardId/graphs` | List graph specs for a card |
| POST | `/api/ingest/cards/:cardId/graphs` | Create graph spec |
| PATCH | `/api/ingest/graphs/:id` | Update graph spec (bumps version) |
| DELETE | `/api/ingest/graphs/:id` | Delete graph spec |

## Graph designer UI

Lives inside each card's "Graph" button on the Cards screen:

1. **Column discovery**: runs the card's test-run to get column names, or
   queries the line's member tables via `/playground/columns/:lineId`.
2. **Axis picker**: X axis (any column), Y series (numeric columns only,
   multi-select toggle).
3. **Chart type picker**: table / line / bar / area — with SVG preview.
4. **Save**: stores the spec, shown in the card's graph list.

The preview renders using inline SVG (no charting library) — lightweight,
dark-theme compatible, sufficient for axis validation. The real rendering
happens in the chat layer (later).

## Versioning

- Graph spec `version` starts at 1, bumps when x-column, y-columns, or
  chart-type change.
- Card SQL changes don't auto-bump graph specs (the spec is about visual
  mapping, not data). But if the setter changes the SQL and the column names
  shift, they'll manually update the graph spec — the designer shows the
  current test-run columns.

## Open items

- **Multi-graph per card**: schema supports it, UI currently creates one at a
  time. Easy to extend.
- **AI rendering**: the chat layer needs a chart-rendering component that
  reads the spec + data and produces the visual. The SVG preview in the
  designer is a proof of concept for this.
- **Config extensibility**: `config` JSON can hold colors, thresholds, axis
  labels, date formatting — fill as needed by the chat layer.
