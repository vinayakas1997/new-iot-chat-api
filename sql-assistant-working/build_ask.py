"""Envelope builder for the SQL-assistant demo harness.

Pulls LIVE context from the backend (read-only GETs only) and assembles the
prompt in the user's confirmed order:
  A. table information + column explanations + window (server-side facts)
  B. conversation so far (round summaries)
  C. this turn: editor SQL + user question
  D. retry block, attempts 2-3 only: failed SQL + classified error

Usage:
  python3 build_ask.py --line line-smoke --question "..." [--editor-sql "..."]
      [--failed-sql "..." --error-kind unknown_column --error-message "..."
       --error-hint "..." --attempt 2] [--rounds rounds.json] [--window-from ISO --window-to ISO]
Prints the envelope to stdout.
"""
import argparse
import json
import sys
import urllib.request

BACKEND = "http://localhost:3100"


def get(path: str):
    with urllib.request.urlopen(BACKEND + path, timeout=30) as r:
        return json.load(r)


def build(line: str, question: str, editor_sql: str = "",
          failed_sql: str = "", error_kind: str = "", error_message: str = "",
          error_hint: str = "", attempt: int = 1, rounds: list | None = None,
          window_from: str = "", window_to: str = "",
          scenario: dict | None = None) -> str:
    tables: dict[str, dict] = {}
    if scenario is not None:
        # Fixture-driven Section A — rule isolation without touching live metadata.
        for st in scenario.get("tables", []):
            tables[st["name"]] = {
                "columns": [{"columnName": c["name"], "datatype": c.get("type", "?"),
                             "meaning": c.get("meaning", "")} for c in st.get("columns", [])],
                "bounds": (st.get("start"), st.get("end"), st.get("timeColumn")),
                "rows": st.get("rows"),
            }
        w = scenario.get("window", {})
        w_from = window_from or w.get("from", "?")
        w_to = window_to or w.get("to", "?")
        if scenario.get("rounds") and not rounds:
            rounds = scenario["rounds"]
    else:
        meta = get(f"/api/ingest/lines/{line}/columns/meta").get("meta", [])
        ranges = get(f"/api/ingest/playground/ranges/{line}")
        for m in meta:
            t = tables.setdefault(m["tableName"], {"columns": [], "bounds": None, "rows": None})
            t["columns"].append(m)
        for rg in ranges.get("ranges", []):
            t = tables.setdefault(rg["table"], {"columns": [], "bounds": None, "rows": None})
            t["bounds"] = (rg.get("start"), rg.get("end"), rg.get("timeColumn"))
            t["rows"] = rg.get("rows")
        overall = ranges.get("overall", {})
        w_from = window_from or (overall.get("start") or "?")
        w_to = window_to or (overall.get("end") or "?")

    out: list[str] = []
    out.append(f"Line `{line}`, window {w_from} → {w_to} (preset: full).")
    out.append("")
    out.append("TABLES (exhaustive — query only these):")
    for tname, t in tables.items():
        b = t["bounds"]
        if b and b[0]:
            out.append(f"- {tname} — time column `{b[2]}`, {t['rows']} rows, recorded {b[0]} → {b[1]}")
        else:
            out.append(f"- {tname} — no recorded time bounds")
        for c in t["columns"]:
            meaning = c.get("meaning", "").strip() or "(no explanation stored)"
            out.append(f"    {c['columnName']} ({c.get('datatype', '?')}) — {meaning}")
    if not tables:
        out.append("(no tables with stored column info)")

    out.append("")
    out.append("CONVERSATION SO FAR (round summaries):")
    if rounds:
        for i, rd in enumerate(rounds, 1):
            out.append(f"  Round {i}: asked {rd.get('question')!r} → ran `{rd.get('sql', '')}` → {rd.get('outcome', '?')}")
    else:
        out.append("  (none — first question)")

    out.append("")
    out.append("THIS TURN:")
    out.append(f"  Editor SQL now: {editor_sql or '(empty)'}")
    out.append(f"  User asks: {question!r}")

    if attempt > 1 and failed_sql:
        out.append("")
        out.append(f"RETRY — attempt {attempt}/3. Previous SQL (verbatim):")
        out.append(f"  {failed_sql}")
        out.append(f"It failed with [{error_kind}]: {error_message}")
        if error_hint:
            out.append(f"Hint: {error_hint}")
        out.append("Fix ONLY the broken part; do not redesign the query.")

    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--line", required=True)
    ap.add_argument("--question", required=True)
    ap.add_argument("--editor-sql", default="")
    ap.add_argument("--failed-sql", default="")
    ap.add_argument("--error-kind", default="")
    ap.add_argument("--error-message", default="")
    ap.add_argument("--error-hint", default="")
    ap.add_argument("--attempt", type=int, default=1)
    ap.add_argument("--rounds", default="")
    ap.add_argument("--window-from", default="")
    ap.add_argument("--window-to", default="")
    ap.add_argument("--scenario", default="")
    a = ap.parse_args()
    rounds = json.load(open(a.rounds)) if a.rounds else None
    scen = json.load(open(a.scenario)) if a.scenario else None
    print(build(a.line, a.question, a.editor_sql, a.failed_sql, a.error_kind,
                a.error_message, a.error_hint, a.attempt, rounds,
                a.window_from, a.window_to, scen))


if __name__ == "__main__":
    main()
