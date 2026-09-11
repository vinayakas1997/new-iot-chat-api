# new-plan — Fresh-Start System Plan (read in order)

Trail rebuild: user never touches the datasource. Internally SQL → context → AI extract →
Hindsight. User asks → summary + calculated graph. DB-GPT concepts ported to TypeScript
(no Python runtime).

| File | What it answers |
|---|---|
| `00-overview.md` | What/why, fresh-start rationale, DB-GPT concept table |
| `01-architecture.md` | Boxes, arrows, trust boundary, per-box what/why/where/how |
| `02-part1-ingestion.md` | Part 1 flow: SQL → context → extract → retain, crash-safety rule |
| `03-granularity-matrix.md` | Full granularity × hierarchy table — single source of truth |
| `04-part2-chat-graphs.md` | Part 2: envelope contract, 3-tool loop, scheduler reuse |
| `05-ui-design.md` | DB-GPT layout adopted into shadcn + Recharts, screen by screen |
| `06-dbgpt-reference.md` | Clone-on-demand instructions + exact file reading map |
| `07-build-order.md` | Phases 0–6 + per-phase verification |
| `08-open-decisions.md` | 14 locked/recommended decisions + change rule |

Conventions: every section is **What → Why needed → Where in repo → How it works →
Concept reference (DB-GPT path + explanation) → Verify**.
