"""Part-1 envelope builder: fixture JSON -> filled context text (12 ingredients).

Usage: python3 build_envelope.py <fixture.json>
Prints the envelope to stdout (no file writes — results pasted, never saved).
"""
import json
import sys

ORDER_NOTE = "Analyze per the system rules and reply with the reading JSON only."


def series_line(s: dict) -> str:
    return f"{s['column']} ({s['label']}, unit {s.get('unit', '?')}, shown {s.get('shown', '?')})"


def thresholds_block(fx: dict) -> str:
    rows = fx.get("thresholds", [])
    if not rows:
        return "thresholds: none — describe-only mode. Do NOT invent thresholds, do NOT verdict breach (breach=null, level=null)."
    out = ["Thresholds (ground truth, obey exactly):"]
    for r in rows:
        out.append(
            f"- {r['name']}: column {r['column']}, breach when {r['direction']} {r['value']} {fx.get('unit', '')}."
            f" Comment: {r.get('comment', '—')}"
        )
    return "\n".join(out)


def build(fx: dict) -> str:
    w = fx.get("window", {})
    stats = fx.get("stats", {})
    series = "; ".join(series_line(s) for s in fx.get("series", []))
    qv = fx.get("quirkVerdicts", {})
    lines = [
        f"Read this {fx.get('chartType', 'line')} chart: \"{fx.get('title', '')}\".",
        f"Cadence: {fx.get('resolution', '')} (temporal sampling cadence — never image dimensions).",
        f"Description: {fx.get('description', '—')}",
        f"Window: {w.get('from', '?')} .. {w.get('to', '?')} ({fx.get('provenance', {}).get('rows', '?')} plotted points). {fx.get('timezone', '')}",
        f"X means \"{fx.get('xTitle', '')}\"; Y means \"{fx.get('yTitle', '')}\" (unit {fx.get('unit', '?')}). Series: {series}.",
        f"Stats on plotted data: {json.dumps(stats)}. Aggregation rule: {fx.get('aggregationRule', '')}",
        thresholds_block(fx),
        f"Bucket note: {fx.get('bucketNote', '')}",
        f"Extract hint: {fx.get('extractHint', '')}",
        f"Standing specifics: {fx.get('specifics', '')}",
        f"Quirk verdicts to obey: {json.dumps(qv)}",
        f"Prior readings (same stream): {' | '.join(fx.get('priorDigests', [])) or 'none'}",
        f"History pack: {json.dumps(fx.get('historyPack', {}))}",
        f"Open tickets to decide (keep-open with reason / closed with answering evidence, never drop): {json.dumps(fx.get('openTickets', []))}",
        ORDER_NOTE,
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    fx = json.load(open(sys.argv[1]))
    print(build(fx))
