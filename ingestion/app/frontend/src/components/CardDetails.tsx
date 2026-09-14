import { useState } from "react";
import { Copy, X } from "lucide-react";
import type { Card, CardTemplate, GraphSpec, Line } from "../lib/api";
import { StatusChip } from "./chips";
import { FormattedText } from "./FormattedText";
import { Btn } from "./ui";

/** Read-only card dossier: full SQL, lineage (+drift), test state, graphs, bank. Changes nothing. */
export function CardDetails({ card, template, line, graphs, bankReady, onClose }: {
  card: Card;
  template: CardTemplate | null;
  line: Line | null;
  graphs: GraphSpec[];
  bankReady: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copySql() {
    try {
      await navigator.clipboard.writeText(card.sql);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = card.sql;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const drift = template && card.templateVersion != null && template.version !== card.templateVersion;

  return (
    <div className="anim-fade-in fixed inset-0 z-20 flex justify-end bg-black/60" onClick={onClose}>
      <div className="anim-slide-in-right max-h-screen w-full max-w-2xl overflow-auto bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">{card.name}</h2>
          <StatusChip tone={card.status === "live" ? "ok" : "mute"}>{card.status.toUpperCase()}</StatusChip>
          <span className="tnum text-xs text-slate-400">v{card.version}</span>
          <button onClick={onClose} aria-label="close details" className="ml-auto rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800"><X size={16} /></button>
        </div>

        <div className="mt-4 flex flex-col gap-4 text-sm">
          <section>
            <div className="text-xs uppercase tracking-widest text-slate-400">line &amp; source</div>
            <div className="mt-1">
              <FormattedText text={line?.name ?? card.lineId} lineName={line?.name ?? card.lineId} />{" "}
              <span className="font-mono text-xs text-slate-400">{card.lineId}</span>
            </div>
            <div className="mt-1 text-slate-500">
              {card.granularity}{card.unit ? ` · ${card.unit}` : ""}{card.threshold != null ? ` · warn > ${card.threshold}` : ""}
            </div>
            <div className="mt-1">tables: <FormattedText text={card.tables.join(", ") || "—"} highlightTables /></div>
            <div className="mt-1 text-xs text-slate-400">
              created {new Date(card.createdAt).toLocaleString()} · updated {new Date(card.updatedAt).toLocaleString()}
            </div>
          </section>

          <section>
            <div className="mb-1 flex items-center">
              <span className="text-xs uppercase tracking-widest text-slate-400">sql (full)</span>
              <Btn variant="ghost" size="sm" icon={Copy} onClick={() => void copySql()} className="ml-auto">
                {copied ? "copied ✓" : "copy → playground"}
              </Btn>
            </div>
            <pre className="overflow-auto rounded bg-slate-100 p-3 font-mono text-xs dark:bg-ink-800">{card.sql || "(no SQL yet)"}</pre>
            {card.extractHint && <div className="mt-1 text-xs text-slate-500">extract hint: {card.extractHint}</div>}
          </section>

          <section>
            <div className="text-xs uppercase tracking-widest text-slate-400">lineage</div>
            {template ? (
              <div className="mt-1">
                stamped from <span className="font-medium">{template.name}</span>{" "}
                <span className="tnum text-xs text-slate-400">template v{template.version} · copy taken at v{card.templateVersion ?? "?"}</span>
                {drift && (
                  <div className="mt-1 text-xs text-state-warn">
                    drift: template is now v{template.version}, this copy was taken at v{card.templateVersion} — Check all copies on the template to preview an update.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-1 text-slate-500">crafted from scratch — no parent template.</div>
            )}
          </section>

          <section>
            <div className="text-xs uppercase tracking-widest text-slate-400">test state (what Go-live checks)</div>
            <div className="mt-1 text-xs">
              {card.lastTest
                ? <span className={card.lastTest.ok ? "text-state-ok" : "text-state-bad"}>
                    last test {card.lastTest.ok ? "passed" : `failed: ${card.lastTest.error}`} · {new Date(card.lastTest.at).toLocaleTimeString()} · hash <span className="font-mono">{card.lastTest.sqlHash}</span>
                  </span>
                : <span className="text-slate-400">never tested — cannot go live</span>}
            </div>
          </section>

          <section>
            <div className="text-xs uppercase tracking-widest text-slate-400">attached</div>
            <div className="mt-1 text-xs text-slate-500">
              {graphs.length === 0
                ? "no graphs yet"
                : graphs.map((g) => `${g.name || g.title || "Untitled"} (${g.chartType} v${g.version})`).join(" · ")}
              {" · "}bank <span className={bankReady ? "text-state-ok" : "text-slate-400"}>{bankReady ? "ready ✓" : "not pushed"}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
