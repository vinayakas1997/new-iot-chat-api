import { useState } from "react";
import { ArrowDownToLine, ChevronDown, Copy } from "lucide-react";
import { Btn } from "./ui";

const EXAMPLES: { key: string; title: string; sql: string }[] = [
  {
    key: "hourly-avg",
    title: "Hourly average (readings_temp)",
    sql: `SELECT date_trunc('hour', ts) AS hour, AVG(temp_c) AS avg_temp_c, COUNT(*) AS samples
FROM public.readings_temp
WHERE ts >= '{{from}}' AND ts < '{{to}}'
GROUP BY 1 ORDER BY 1`,
  },
  {
    key: "shift-sum",
    title: "Hourly sum (prod_count)",
    sql: `SELECT date_trunc('hour', ts) AS hour, SUM(pcs) AS total_pcs, COUNT(*) AS samples
FROM public.prod_count
WHERE ts >= '{{from}}' AND ts < '{{to}}'
GROUP BY 1 ORDER BY 1`,
  },
  {
    key: "downtime",
    title: "Downtime by reason (downtime_events)",
    sql: `SELECT reason, SUM(minutes) AS total_min, COUNT(*) AS events
FROM public.downtime_events
WHERE ts >= '{{from}}' AND ts < '{{to}}'
GROUP BY 1 ORDER BY 2 DESC`,
  },
];

/** Inline SQL examples for template/card editors: copy or insert into the box. */
export function SqlHint({ onInsert }: { onInsert: (sql: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(sql: string, key: string) {
    try {
      await navigator.clipboard.writeText(sql);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = sql;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  return (
    <div className="mb-1">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-xs text-accent-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
        >
          {open ? "hide examples" : "show examples"}
          <ChevronDown size={12} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-slate-200 p-2 dark:border-ink-700">
          <div className="text-xs text-slate-500 dark:text-ink-400">
            Quotes around <span className="font-mono">'{"{{from}}"}' / '{"{{to}}"}'</span> are mandatory ·
            keep the <span className="font-mono">ts</span> window filter or ticks full-scan ·
            SELECT-only, 50-row preview.
          </div>
          {EXAMPLES.map((e) => (
            <div key={e.key} className="rounded bg-slate-100 p-2 dark:bg-ink-800">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{e.title}</span>
                <span className="ml-auto flex gap-1">
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon={Copy}
                    type="button"
                    onClick={() => void copy(e.sql, e.key)}
                    className="glass-pill glass-pill--neutral"
                  >
                    {copied === e.key ? "copied ✓" : "copy"}
                  </Btn>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon={ArrowDownToLine}
                    type="button"
                    onClick={() => onInsert(e.sql)}
                    className="glass-pill glass-pill--neutral"
                  >
                    insert ↓
                  </Btn>
                </span>
              </div>
              <pre className="mt-1 overflow-auto font-mono text-xs">{e.sql}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
