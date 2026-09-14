import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Brain, ChartLine, ClipboardCheck, Copy, Eye, FlaskConical, History as HistoryIcon,
  ListChecks, Pause, Pencil, Play, Plus, Rocket, Save, Search, Trash2, X,
} from "lucide-react";
import { Btn, Segmented, Spinner } from "../components/ui";
import { CardDetails } from "../components/CardDetails";
import { cardApi, api, bankApi, graphApi, playgroundApi, type BankOverviewEntry, type Card, type CardTemplate, type Line, type ReapplyResult, type TestResult, type GraphSpec, type ChartType, type PlaygroundResult, type QueryHistoryEntry, type LineColumn } from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";
import { FormattedText } from "../components/FormattedText";
import { PushToHindsight } from "../components/PushToHindsight";
import { SqlHint } from "../components/SqlHint";

/** Ticks per day by granularity — one source query per tick per card copy. */
export const TICKS_PER_DAY: Record<Card["granularity"], number> = { hourly: 24, shift: 3, daily: 1 };
export function tickCost(c: Pick<Card, "granularity">): number {
  return TICKS_PER_DAY[c.granularity];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Table references in FROM/JOIN positions (deduped, CTE names excluded). */
export function sqlTableRefs(sql: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenizeSqlTables(sql)) {
    if (t.kind !== "ref") continue;
    const k = t.ref.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t.ref); }
  }
  return out;
}

export type SqlToken = { kind: "text"; text: string } | { kind: "ref"; ref: string };

/** Split SQL into plain segments + table tokens (with CTE names excluded). */
export function tokenizeSqlTables(sql: string): SqlToken[] {
  const ctes = new Set<string>();
  const cteRe = /(?:\bWITH\b|,)\s*([A-Za-z_]\w*)\s+AS\s*\(/gi;
  let cm;
  while ((cm = cteRe.exec(sql))) ctes.add(cm[1].toLowerCase());
  const toks: SqlToken[] = [];
  const re = /\b(?:FROM|JOIN)\s+([A-Za-z_][\w$#]*(?:\.[A-Za-z_][\w$#]*)?)/gi;
  let m;
  let pos = 0;
  while ((m = re.exec(sql))) {
    const t = m[1];
    if (ctes.has(t.toLowerCase())) continue;
    const start = m.index + m[0].length - t.length;
    toks.push({ kind: "text", text: sql.slice(pos, start) });
    toks.push({ kind: "ref", ref: t });
    pos = start + t.length;
  }
  toks.push({ kind: "text", text: sql.slice(pos) });
  return toks;
}

/** Best member-table match for a template ref: exact, then bare-name, else null. */
export function matchMember(ref: string, members: string[]): string | null {
  const rl = ref.toLowerCase();
  const exact = members.find((x) => x.toLowerCase() === rl);
  if (exact) return exact;
  const bare = rl.includes(".") ? rl.split(".").pop()! : rl;
  return members.find((x) => {
    const parts = x.toLowerCase().split(".");
    return parts[parts.length - 1] === bare;
  }) ?? null;
}

/** Substitute remapped table refs (whole tokens only — aliases untouched). */
export function remapSql(sql: string, map: Record<string, string>): string {
  let out = sql;
  for (const [ref, tgt] of Object.entries(map)) {
    if (!tgt || tgt.toLowerCase() === ref.toLowerCase()) continue;
    out = out.replace(new RegExp(`(?<![\\w.])${escapeRegExp(ref)}(?![\\w.])`, "gi"), tgt);
  }
  return out;
}

/** F3: template library + per-line card copies. Verdict: which cards are live, and on what? */
export function Cards() {
  const [tab, setTab] = useState<"cards" | "templates" | "playground">("cards");
  const [cards, setCards] = useState<Card[]>([]);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<Record<string, TestResult>>({});
  const [reapplyByTpl, setReapplyByTpl] = useState<Record<string, ReapplyResult>>({});
  const [appliedByTpl, setAppliedByTpl] = useState<Record<string, boolean>>({});
  const [showTplForm, setShowTplForm] = useState(false);
  const [tplDraft, setTplDraft] = useState({ name: "", description: "", sqlTemplate: "", granularity: "hourly", unit: "", extractHint: "" });
  const [instTpl, setInstTpl] = useState<CardTemplate | null>(null);
  const [instLine, setInstLine] = useState("");
  const [instMap, setInstMap] = useState<Record<string, string>>({});
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardDraft, setCardDraft] = useState({ lineId: "", name: "", tables: "", sql: "", granularity: "hourly", unit: "", extractHint: "", threshold: "", changeMode: "forward", reingestFrom: "" });
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [graphCard, setGraphCard] = useState<Card | null>(null);
  const [cardGraphs, setCardGraphs] = useState<Record<string, GraphSpec[]>>({});
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [banks, setBanks] = useState<Record<string, BankOverviewEntry>>({});
  const [pushLine, setPushLine] = useState<{ id: string; name: string } | null>(null);
  const [detailCard, setDetailCard] = useState<Card | null>(null);
  const [liveNudge, setLiveNudge] = useState<{ cardId: string; cardName: string; lineId: string } | null>(null);
  // Umbrella view: search + filters + group-by-line.
  const [cardQ, setCardQ] = useState("");
  const [cardLine, setCardLine] = useState("");
  const [cardStatus, setCardStatus] = useState<"all" | "live" | "dormant" | "green" | "untested">("all");
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showSuggest, setShowSuggest] = useState(false);

  // Playground state
  const [pgLineId, setPgLineId] = useState("");
  const [pgSql, setPgSql] = useState("");
  const [pgResult, setPgResult] = useState<PlaygroundResult | null>(null);
  const [pgError, setPgError] = useState<string | null>(null);
  const [pgRunning, setPgRunning] = useState(false);
  const [pgHistory, setPgHistory] = useState<QueryHistoryEntry[]>([]);
  const [pgShowHistory, setPgShowHistory] = useState(false);
  const [pgCols, setPgCols] = useState<LineColumn[]>([]);
  const [pgShowSave, setPgShowSave] = useState(false);
  const [pgSaveDraft, setPgSaveDraft] = useState({ name: "", tables: "", granularity: "hourly", unit: "", extractHint: "" });

  async function refresh() {
    try {
      const [c, t, l] = await Promise.all([cardApi.listCards(), cardApi.listTemplates(), api.listLines()]);
      setCards(c);
      setTemplates(t);
      setLines(l.filter((x) => x.active));
      try {
        const a = await fetch("/api/ingest/llm/active").then((r) => r.json() as Promise<{ active: { activeModel: string } | null }>);
        setActiveModel(a.active?.activeModel ?? null);
      } catch {
        setActiveModel(null);
      }
      bankApi.overview().then((o) => {
        const m: Record<string, BankOverviewEntry> = {};
        for (const b of o.banks) m[b.lineId] = b;
        setBanks(m);
      }).catch(() => {});
      const gMap: Record<string, GraphSpec[]> = {};
      await Promise.all(c.map(async (card) => {
        try { gMap[card.id] = await graphApi.listForCard(card.id); } catch { gMap[card.id] = []; }
      }));
      setCardGraphs(gMap);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => void refresh(), []);

  // Load playground history + columns when line changes
  useEffect(() => {
    if (tab === "playground" && pgLineId) {
      playgroundApi.history(pgLineId).then(setPgHistory).catch(() => {});
      playgroundApi.columns(pgLineId).then((r) => setPgCols(r.columns)).catch(() => setPgCols([]));
    }
  }, [tab, pgLineId]);

  const liveCount = cards.filter((c) => c.status === "live").length;

  const lineNameOf = (id: string) => lines.find((l) => l.id === id)?.name ?? id;

  const filteredCards = cards.filter((c) => {
    if (cardLine && c.lineId !== cardLine) return false;
    if (cardStatus === "live" && c.status !== "live") return false;
    if (cardStatus === "dormant" && c.status !== "dormant") return false;
    if (cardStatus === "green" && !c.lastTest?.ok) return false;
    if (cardStatus === "untested" && c.lastTest) return false;
    if (cardQ) {
      const hay = `${c.name} ${c.lineId} ${lineNameOf(c.lineId)} ${c.tables.join(" ")}`.toLowerCase();
      if (!hay.includes(cardQ.toLowerCase())) return false;
    }
    return true;
  });

  // Autocomplete: prefix hits rank above contains-hits; empty query shows first few.
  const suggestCards = (() => {
    const q = cardQ.trim().toLowerCase();
    const scored = cards.map((c) => {
      if (!q) return { c, score: 0 };
      const fields = [c.name, c.lineId, lineNameOf(c.lineId), ...c.tables];
      let best = -1;
      for (const f of fields) {
        const fl = f.toLowerCase();
        if (fl.startsWith(q)) { best = Math.max(best, 2); break; }
        if (fl.includes(q)) best = Math.max(best, 1);
      }
      return { c, score: best };
    }).filter((s) => (q ? s.score > 0 : true));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, q ? 8 : 6).map((s) => s.c);
  })();
  const cardGroups: { lineId: string; cards: Card[] }[] = (() => {
    const byLine = new Map<string, Card[]>();
    for (const c of filteredCards) {
      const arr = byLine.get(c.lineId) ?? [];
      arr.push(c);
      byLine.set(c.lineId, arr);
    }
    const ordered: { lineId: string; cards: Card[] }[] = [];
    for (const l of lines) {
      const arr = byLine.get(l.id);
      if (arr) { ordered.push({ lineId: l.id, cards: arr }); byLine.delete(l.id); }
    }
    for (const [lineId, arr] of byLine) ordered.push({ lineId, cards: arr });
    return ordered;
  })();

  function bankChipFor(lineId: string, anyGreen: boolean, small = true) {
    const b = banks[lineId];
    const cls = small ? "rounded-lg border px-3 py-1 text-sm" : "rounded-lg border px-3 py-1 text-sm";
    if (b?.ready) {
      return <button onClick={() => openBankDrawer(lineId)} title={`bank:line-${lineId} ready — review or re-push`} className={`${cls} inline-flex items-center gap-1.5 border-state-ok/50 text-state-ok transition-all duration-150 hover:bg-state-ok/10 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60`}><Brain size={13} />bank ✓</button>;
    }
    return (
      <button
        onClick={() => openBankDrawer(lineId)}
        disabled={!anyGreen}
        title={anyGreen ? `Preview bank:line-${lineId} and push to Hindsight` : "Needs a tested-green card before pushing to Hindsight"}
        className={`${cls} inline-flex items-center gap-1.5 border-slate-300 text-accent-500 transition-all duration-150 hover:bg-slate-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:border-ink-700 dark:hover:bg-ink-800`}
      >
        <Brain size={13} />{b?.draftSaved ? "bank draft" : "→ hindsight"}
      </button>
    );
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onTest(c: Card) {
    setTestingId(c.id);
    setError(null);
    try {
      const r = await cardApi.testCard(c.id);
      setTestOut((m) => ({ ...m, [c.id]: r }));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setTestingId(null);
    }
  }

  function canActivate(c: Card) {
    return c.status === "dormant" && c.sql.trim().length > 0;
  }

  function openBankDrawer(lineId: string) {
    const l = lines.find((x) => x.id === lineId);
    setPushLine({ id: lineId, name: l?.name ?? lineId });
  }

  async function onActivate(c: Card) {
    setLiveNudge(null);
    await act(() => cardApi.activateCard(c.id));
    try {
      const o = await bankApi.overview();
      const m: Record<string, BankOverviewEntry> = {};
      for (const b of o.banks) m[b.lineId] = b;
      setBanks(m);
      if (!m[c.lineId]?.ready) {
        setLiveNudge({ cardId: c.id, cardName: c.name, lineId: c.lineId });
      }
    } catch { /* banks overview is best-effort; activation already succeeded */ }
  }

  function cardTile(c: Card, showLine = false) {
    return (
      <div key={c.id} className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        {showLine && (
          <div className="mb-1 text-xs text-slate-400">
            <FormattedText text={lineNameOf(c.lineId)} lineName={lineNameOf(c.lineId)} /> <span className="font-mono">{c.lineId}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="font-semibold">{c.name}</span>
          <span className="tnum text-xs text-slate-400">v{c.version}</span>
          <span className="ml-auto"><StatusChip tone={c.status === "live" ? "ok" : "mute"}>{c.status.toUpperCase()}</StatusChip></span>
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {c.granularity}{c.unit ? ` · ${c.unit}` : ""}{c.threshold != null ? ` · warn > ${c.threshold}` : ""} · tables: <FormattedText text={c.tables.join(", ") || "—"} highlightTables />
          <span className="tnum ml-2">≈{tickCost(c)} queries/day</span>
        </div>
        <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-100 p-2 font-mono text-xs dark:bg-ink-900">{c.sql || "(no SQL yet)"}</pre>
        <div className="mt-1 text-xs">
          {c.lastTest
            ? <span className={c.lastTest.ok ? "text-state-ok" : "text-state-bad"}>last test {c.lastTest.ok ? "passed" : `failed: ${c.lastTest.error}`} · {new Date(c.lastTest.at).toLocaleTimeString()}</span>
            : <span className="text-slate-400">never tested — cannot go live</span>}
        </div>
        {testOut[c.id] && (
          <div className="mt-2 overflow-auto rounded border border-slate-200 text-xs dark:border-ink-800">
            <div className="border-b border-slate-200 px-2 py-1 text-slate-400 dark:border-ink-800">
              <span className="tnum">{testOut[c.id].rowCount}</span> rows · last 24h window · preview 50
            </div>
            <table className="w-full text-left font-mono">
              <thead><tr>{testOut[c.id].columns.map((x) => <th key={x} className="px-2 py-1">{x}</th>)}</tr></thead>
              <tbody>
                {testOut[c.id].rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-ink-800">
                    {testOut[c.id].columns.map((x) => <td key={x} className="px-2 py-1">{String(r[x] ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Btn icon={Eye} onClick={() => setDetailCard(c)}>Details</Btn>
          <Btn icon={FlaskConical} onClick={() => void onTest(c)} loading={testingId === c.id}>
            {testingId === c.id ? "testing…" : "Test-run"}
          </Btn>
          <Btn icon={ChartLine} onClick={() => setGraphCard(c)}>
            Graph {(cardGraphs[c.id]?.length ?? 0) > 0 && <span className="tnum">({cardGraphs[c.id].length})</span>}
          </Btn>
          {bankChipFor(c.lineId, c.lastTest?.ok === true)}
          {c.status === "dormant" ? (
            <>
              <Btn variant="ok" icon={Rocket} onClick={() => void onActivate(c)} disabled={!canActivate(c)}>Go live</Btn>
              <Btn icon={Pencil} onClick={() => { setEditCard(c); setCardDraft({ lineId: c.lineId, name: c.name, tables: c.tables.join(", "), sql: c.sql, granularity: c.granularity, unit: c.unit, extractHint: c.extractHint, threshold: c.threshold != null ? String(c.threshold) : "", changeMode: "forward", reingestFrom: "" }); setShowCardForm(true); }}>edit</Btn>
              <Btn variant="bad" icon={Trash2} onClick={() => { if (confirm(`Delete card "${c.name}" on ${c.lineId}?`)) void act(() => cardApi.deleteCard(c.id)); }}>delete</Btn>
            </>
          ) : (
            <Btn variant="warn" icon={Pause} onClick={() => void act(() => cardApi.dormantCard(c.id))}>take dormant</Btn>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">
        <span className="tnum">{liveCount}</span> card{liveCount === 1 ? "" : "s"} live
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">
        one context per card · live cards untouchable · dormant cards free to change
      </p>

      {error && <div className="mt-4"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}

      {liveNudge && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-state-ok/50 px-4 py-3 text-sm">
          <span><b>{liveNudge.cardName}</b> is live ✓ — <FormattedText text={`line bank bank:line-${liveNudge.lineId} is not configured yet.`} bankId={`bank:line-${liveNudge.lineId}`} /> Ticks will retain with Hindsight defaults until you push.</span>
          <button onClick={() => openBankDrawer(liveNudge.lineId)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1 font-semibold text-white transition-all duration-150 hover:bg-accent-400 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60">Review &amp; push <ArrowRight size={13} /></button>
          <button onClick={() => setLiveNudge(null)} className="rounded px-1 text-slate-400 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">dismiss</button>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        {(["cards", "templates", "playground"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${tab === t ? "bg-accent-500/15 text-accent-500" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800"}`}
          >
            {t === "cards" ? `Cards (${cards.length})` : t === "templates" ? `Templates (${templates.length})` : "Playground"}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/setter/hindsight"
            title={activeModel ? `Active LLM: ${activeModel}` : "No LLM active — connect one"}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-ink-700"
          >
            <span className={activeModel ? "text-state-ok" : "text-slate-400"}>●</span> AI settings{activeModel ? ` · ${activeModel}` : ""}
          </Link>
            {tab === "cards"
            ? <Btn variant="primary" icon={Plus} onClick={() => { setEditCard(null); setCardDraft({ lineId: lines[0]?.id ?? "", name: "", tables: "", sql: "", granularity: "hourly", unit: "", extractHint: "", threshold: "", changeMode: "forward", reingestFrom: "" }); setShowCardForm(true); }}>New card</Btn>
            : <Btn variant="primary" icon={Plus} onClick={() => { setTplDraft({ name: "", description: "", sqlTemplate: "", granularity: "hourly", unit: "", extractHint: "" }); setShowTplForm(true); }}>New template</Btn>}
        </div>
      </div>

      {tab === "cards" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={cardQ}
              onChange={(e) => { setCardQ(e.target.value); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
              onKeyDown={(e) => { if (e.key === "Escape") setShowSuggest(false); }}
              placeholder="Search cards, lines, tables…"
              className="w-64 rounded-lg border border-slate-300 bg-transparent py-2 pl-9 pr-3 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
            />
            {showSuggest && suggestCards.length > 0 && (
              <div className="anim-pop-in absolute z-10 mt-1 max-h-72 w-80 overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-ink-700 dark:bg-ink-900">
                {suggestCards.map((c) => (
                  <button
                    key={c.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setCardQ(c.name); setShowSuggest(false); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${c.status === "live" ? "bg-state-ok" : "bg-slate-300 dark:bg-ink-600"}`} />
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-slate-400">{c.lineId}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <select value={cardLine} onChange={(e) => setCardLine(e.target.value)} className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700">
            <option value="">all lines</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
          </select>
          <select value={cardStatus} onChange={(e) => setCardStatus(e.target.value as typeof cardStatus)} className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700">
            <option value="all">all statuses</option>
            <option value="live">live</option>
            <option value="dormant">dormant</option>
            <option value="green">tested-green</option>
            <option value="untested">untested</option>
          </select>
          <div className="ml-auto">
            <Segmented
              value={grouped ? "grouped" : "flat"}
              onChange={(v) => setGrouped(v === "grouped")}
              options={[
                { value: "grouped", label: "Grouped" },
                { value: "flat", label: "Flat" },
              ]}
            />
          </div>
        </div>
      )}

      {tab === "cards" && !grouped && (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filteredCards.map((c) => cardTile(c, true))}
        </div>
      )}

      {tab === "cards" && grouped && (
        <div className="mt-4 flex flex-col gap-4">
          {cardGroups.map((g) => {
            const line = lines.find((l) => l.id === g.lineId);
            const live = g.cards.filter((c) => c.status === "live").length;
            const failing = g.cards.filter((c) => c.lastTest && !c.lastTest.ok).length;
            const anyGreen = g.cards.some((c) => c.lastTest?.ok);
            const shut = collapsed[g.lineId];
            return (
              <div key={g.lineId} className="rounded-xl border border-slate-200 dark:border-ink-800">
                <div onClick={() => setCollapsed((m) => ({ ...m, [g.lineId]: !m[g.lineId] }))} className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
                  <span className="text-slate-400">{shut ? "▸" : "▾"}</span>
                  <FormattedText text={line?.name ?? g.lineId} lineName={line?.name ?? g.lineId} />
                  <span className="font-mono text-xs text-slate-400">{g.lineId}</span>
                  <span className="tnum text-xs text-slate-400">{live} live / {g.cards.length - live} dormant</span>
                  {failing > 0 && <StatusChip tone="bad">{failing} failing</StatusChip>}
                  <span className="tnum text-xs text-slate-400">last tick: {line?.lastTick ? new Date(line.lastTick).toLocaleString() : "—"}</span>
                  <span className="ml-auto" onClick={(e) => e.stopPropagation()}>{bankChipFor(g.lineId, anyGreen)}</span>
                </div>
                {!shut && (
                  <div className="grid grid-cols-1 gap-4 border-t border-slate-100 p-4 dark:border-ink-800 xl:grid-cols-2">
                    {g.cards.map((c) => cardTile(c))}
                  </div>
                )}
              </div>
            );
          })}
          {cardGroups.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-ink-700">
              No cards match the filters. <button onClick={() => { setCardQ(""); setCardLine(""); setCardStatus("all"); }} className="inline-flex items-center gap-1 text-accent-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"><X size={12} />clear filters</button>
            </div>
          )}
        </div>
      )}
      {tab === "cards" && cards.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-ink-700">
          <div className="font-semibold">No cards yet</div>
          <p className="mt-1 text-sm text-slate-500">Create a template first, then instantiate it onto a line — or craft a card from scratch.</p>
        </div>
      )}

      {tab === "templates" && (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{t.name}</span>
                <span className="tnum text-xs text-slate-400">v{t.version}</span>
                <span className="ml-auto text-xs text-slate-400">{t.granularity}{t.unit ? ` · ${t.unit}` : ""}</span>
              </div>
              {t.description && <div className="mt-1 text-sm text-slate-500">{t.description}</div>}
              <div className="tnum mt-1 text-xs text-slate-400">
                ≈{cards.filter((c) => c.templateId === t.id).reduce((s, c) => s + tickCost(c), 0)} queries/day across {cards.filter((c) => c.templateId === t.id).length} copies
              </div>
              <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-100 p-2 font-mono text-xs dark:bg-ink-900">{t.sqlTemplate || "(no SQL template)"}</pre>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <Btn variant="primary" icon={ArrowRight} onClick={() => { setInstTpl(t); setInstLine(lines[0]?.id ?? ""); setInstMap({}); }} title="Stamp an independent copy of this template onto a line. The copy starts dormant and can differ freely afterwards.">instantiate → line</Btn>
                <Btn icon={Copy} onClick={() => { setTplDraft({ name: t.name, description: t.description, sqlTemplate: t.sqlTemplate, granularity: t.granularity, unit: t.unit, extractHint: t.extractHint }); setShowTplForm(true); }} title="Copy this template as a starting point for a new, separate template.">duplicate</Btn>
                <Btn
                  icon={ClipboardCheck}
                  onClick={() => void (async () => {
                    setError(null);
                    setAppliedByTpl((m) => ({ ...m, [t.id]: false }));
                    try {
                      const r = await cardApi.reapply(t.id, { activate: false });
                      setReapplyByTpl((m) => ({ ...m, [t.id]: r }));
                    } catch (e) { setError((e as Error).message); }
                  })()}
                  title="Try this template on every copy. Changes nothing — safe to press anytime."
                >
                  Check all copies
                </Btn>
                <Btn variant="bad" icon={Trash2} onClick={() => { if (confirm(`Delete template "${t.name}"? Copies keep working.`)) void act(() => cardApi.deleteTemplate(t.id)); }}>delete</Btn>
              </div>
              {(() => {
                const copies = cards.filter((c) => c.templateId === t.id);
                if (copies.length === 0) {
                  return <div className="mt-2 text-xs text-slate-400">not used yet — no copies on any line</div>;
                }
                const seen = new Map<string, Card[]>();
                for (const c of copies) {
                  const arr = seen.get(c.lineId) ?? [];
                  arr.push(c);
                  seen.set(c.lineId, arr);
                }
                return (
                  <div className="mt-2 rounded-lg bg-slate-50 p-2 dark:bg-ink-900/50">
                    <div className="tnum text-xs uppercase tracking-wider text-slate-400">
                      copies on {seen.size} line{seen.size === 1 ? "" : "s"}
                    </div>
                    {[...seen].map(([lineId, arr]) => {
                      const l = lines.find((x) => x.id === lineId);
                      const live = arr.filter((c) => c.status === "live").length;
                      return (
                        <div key={lineId} className="mt-1 flex items-center gap-2 text-xs">
                          <FormattedText text={l?.name ?? lineId} lineName={l?.name ?? lineId} />
                          <span className="font-mono text-slate-400">{lineId}</span>
                          <span className="tnum text-slate-400">{l ? `${l.memberTables.length} tables` : "line gone"}</span>
                          <StatusChip tone={live === arr.length ? "ok" : "mute"}>{live}/{arr.length} live</StatusChip>
                          <Link
                            to={`/setter/lines?edit=${lineId}`}
                            title="Open this line in Lines to add/remove its tables"
                            className="ml-auto inline-flex items-center gap-1 text-accent-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                          >
                            <Pencil size={12} />edit tables
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {reapplyByTpl[t.id] && (() => {
                const out = reapplyByTpl[t.id];
                const applied = appliedByTpl[t.id];
                const nGreen = out.results.filter((r) => r.status === "green").length;
                const nRed = out.results.filter((r) => r.status === "red").length;
                const nLocked = out.results.filter((r) => r.status === "skipped-live").length;
                return (
                  <div className="anim-fade-in mt-3 rounded-lg border border-slate-200 p-3 dark:border-ink-700">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {applied
                          ? `${nGreen} updated, ${nRed} failed, ${nLocked} locked-live`
                          : `Checked ${out.results.length} cop${out.results.length === 1 ? "y" : "ies"}`}
                      </span>
                      <span className="tnum font-mono text-xs text-slate-400">{out.sqlHash}</span>
                      <button
                        onClick={() => setReapplyByTpl((m) => { const n = { ...m }; delete n[t.id]; return n; })}
                        aria-label="dismiss results"
                        className="ml-auto rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">✓ works = safe to update together · ✗ fails = fix that line first · locked-live = live copies, never touched. Note: apply pushes identical SQL — copies with per-line table renames get overwritten; remap them after applying.</p>
                    {out.results.map((r) => (
                      <div key={r.cardId} className="mt-1 flex items-center gap-2 text-sm">
                        <span className="font-mono">{r.lineId}</span>
                        <StatusChip tone={r.status === "green" ? "ok" : r.status === "red" ? "bad" : "mute"}>
                          {r.status === "green" ? "✓ works" : r.status === "red" ? "✗ fails" : "locked-live"}
                        </StatusChip>
                        {r.rowCount != null && <span className="tnum text-slate-400">{r.rowCount} rows</span>}
                        {r.error && <span className="text-state-bad">{r.error}</span>}
                      </div>
                    ))}
                    {applied || nGreen === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">
                        {nGreen === 0 && !applied
                          ? "Nothing to apply — no passing dormant copies. Take a copy dormant to update it, or fix failing lines first."
                          : nGreen === 0
                            ? "Nothing changed — every copy was already live or failing."
                            : "Done — passing copies updated and live."}
                      </p>
                    ) : (
                      <Btn
                        variant="primary"
                        icon={ListChecks}
                        onClick={() => void (async () => {
                          if (!confirm("Update all passing copies to this SQL and take them live? Failing and live copies stay untouched.")) return;
                          setError(null);
                          try {
                            const r = await cardApi.reapply(t.id, { activate: true });
                            setReapplyByTpl((m) => ({ ...m, [t.id]: r }));
                            setAppliedByTpl((m) => ({ ...m, [t.id]: true }));
                            await refresh();
                          } catch (e) { setError((e as Error).message); }
                        })()}
                        title="Update only the ✓ copies and take them live. Failing and live copies stay untouched."
                        className="mt-2"
                      >
                        Apply to passing copies ({nGreen})
                      </Btn>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {tab === "playground" && (
        <PlaygroundTab
          lines={lines}
          lineId={pgLineId}
          setLineId={setPgLineId}
          sql={pgSql}
          setSql={setPgSql}
          result={pgResult}
          error={pgError}
          running={pgRunning}
          history={pgHistory}
          showHistory={pgShowHistory}
          cols={pgCols}
          showSave={pgShowSave}
          saveDraft={pgSaveDraft}
          onRun={async () => {
            if (!pgLineId || !pgSql.trim()) return;
            setPgRunning(true); setPgError(null); setPgResult(null);
            try {
              const r = await playgroundApi.run(pgLineId, pgSql);
              setPgResult(r);
              const h = await playgroundApi.history(pgLineId);
              setPgHistory(h);
            } catch (e) { setPgError((e as Error).message); }
            finally { setPgRunning(false); }
          }}
          onHistoryToggle={() => setPgShowHistory(!pgShowHistory)}
          onRerun={(sql) => setPgSql(sql)}
          onSaveCard={async (name, tables, gran, unit, hint) => {
            await cardApi.createCard({ lineId: pgLineId, name, tables: tables.split(",").map((s) => s.trim()).filter(Boolean), sql: pgSql, granularity: gran, unit, extractHint: hint });
            setPgShowSave(false); setPgSql(""); setPgResult(null);
          }}
          setShowSave={setPgShowSave}
          setSaveDraft={setPgSaveDraft}
        />
      )}

      {showTplForm && (
        <Modal title="New template" onClose={() => setShowTplForm(false)}>
          <Field label="Name"><input value={tplDraft.name} onChange={(e) => setTplDraft({ ...tplDraft, name: e.target.value })} className={inp} /></Field>
          <Field label="Description"><input value={tplDraft.description} onChange={(e) => setTplDraft({ ...tplDraft, description: e.target.value })} className={inp} /></Field>
          <Field label="SQL template ({{from}} / {{to}} for windowed test-runs)">
            <SqlHint
              onInsert={(sql) => {
                if (tplDraft.sqlTemplate.trim() && !confirm("Replace the current SQL template with this example?")) return;
                setTplDraft({ ...tplDraft, sqlTemplate: sql });
              }}
            />
            <textarea rows={5} value={tplDraft.sqlTemplate} onChange={(e) => setTplDraft({ ...tplDraft, sqlTemplate: e.target.value })} className={`${inp} font-mono`} />
          </Field>
          <div className="flex gap-3">
            <Field label="Granularity">
              <select value={tplDraft.granularity} onChange={(e) => setTplDraft({ ...tplDraft, granularity: e.target.value })} className={inp}>
                <option value="hourly">hourly</option><option value="shift">shift</option><option value="daily">daily</option>
              </select>
            </Field>
            <Field label="Unit"><input value={tplDraft.unit} onChange={(e) => setTplDraft({ ...tplDraft, unit: e.target.value })} placeholder="°C, pcs…" className={inp} /></Field>
          </div>
          <Field label="Extraction hint (for the AI extractor)"><textarea rows={2} value={tplDraft.extractHint} onChange={(e) => setTplDraft({ ...tplDraft, extractHint: e.target.value })} className={inp} /></Field>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setShowTplForm(false)} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel</button>
            <Btn variant="primary" icon={Save} onClick={() => void act(() => cardApi.createTemplate(tplDraft).then(() => setShowTplForm(false)))}>Save template</Btn>
          </div>
        </Modal>
      )}

      {instTpl && (() => {
        const line = lines.find((l) => l.id === instLine);
        const members = line?.memberTables ?? [];
        const refs = sqlTableRefs(instTpl.sqlTemplate);
        const missing = refs.filter((r) => !matchMember(r, members));
        const mapping: Record<string, string> = {};
        for (const r of refs) {
          mapping[r] = instMap[r.toLowerCase()] ?? matchMember(r, members) ?? members[0] ?? "";
        }
        const blocked = refs.length > 0 && Object.values(mapping).some((v) => !v);
        const preview = remapSql(instTpl.sqlTemplate, mapping);
        const tables = [...new Set(Object.values(mapping).filter(Boolean))];
        return (
        <Modal title={`Instantiate "${instTpl.name}"`} onClose={() => setInstTpl(null)}>
          <Field label="Target line">
            <select value={instLine} onChange={(e) => { setInstLine(e.target.value); setInstMap({}); }} className={inp}>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
            </select>
          </Field>
          {refs.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-ink-900/50">
              <div className="tnum text-xs uppercase tracking-wider text-slate-400">
                tables in this query · {refs.length - missing.length} match, {missing.length} to map — click a table name to swap it
              </div>
              {missing.length === 0 && (
                <div className="mt-1 text-xs text-state-ok">all template tables exist on this line — one click, no edits.</div>
              )}
              <div className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 font-mono text-xs leading-relaxed dark:bg-ink-800">
                {tokenizeSqlTables(instTpl.sqlTemplate).map((tok, i) => {
                  if (tok.kind === "text") return <span key={i}>{tok.text}</span>;
                  const r = tok.ref;
                  const matched = !!matchMember(r, members);
                  const val = mapping[r];
                  const guessed = !matched && val === members[0] && !(r.toLowerCase() in instMap);
                  return (
                    <span key={i} className="inline-flex items-baseline gap-1">
                      <select
                        value={val}
                        onChange={(e) => setInstMap((m) => ({ ...m, [r.toLowerCase()]: e.target.value }))}
                        title={matched ? `${r} exists on this line — change to remap` : `${r} is missing on this line — pick its replacement`}
                        className={`inline rounded px-1 font-mono text-xs focus:border-accent-500 focus:outline-none ${
                          matched
                            ? "bg-accent-500/10 text-accent-500 ring-1 ring-accent-500/30"
                            : "bg-state-warn/10 text-state-warn ring-1 ring-state-warn/40"
                        }`}
                      >
                        {!members.includes(val) && val && <option value={val}>{val}</option>}
                        {members.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      {guessed && <span className="font-sans text-[10px] text-state-warn" title={`Template says ${r} — guessed, please confirm`}>was:{r}?</span>}
                      {!matched && !guessed && <span className="font-sans text-[10px] text-slate-400">was:{r}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          <p className="text-sm text-slate-500">Creates an independent dormant copy on the line{tables.length > 0 ? ` over ${tables.join(", ")}` : ""}. Test it, then go live.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setInstTpl(null)} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel</button>
            <Btn
              variant="primary"
              icon={ArrowRight}
              disabled={blocked || members.length === 0}
              title={members.length === 0 ? "This line has no member tables yet" : blocked ? "Map every table above first" : "Create the dormant copy with mapped tables"}
              onClick={() => void act(() => cardApi.instantiate(
                instTpl.id,
                refs.length > 0 ? { lineId: instLine, sql: preview, tables } : { lineId: instLine },
              ).then(() => { setInstTpl(null); setInstMap({}); setTab("cards"); }))}
            >
              Instantiate dormant
            </Btn>
          </div>
        </Modal>
        );
      })()}

      {showCardForm && (
        <Modal title={editCard ? `Edit ${editCard.name} (dormant)` : "New card (dormant)"} onClose={() => setShowCardForm(false)}>
          {!editCard && (
            <Field label="Line">
              <select value={cardDraft.lineId} onChange={(e) => setCardDraft({ ...cardDraft, lineId: e.target.value })} className={inp}>
                {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Name"><input value={cardDraft.name} onChange={(e) => setCardDraft({ ...cardDraft, name: e.target.value })} className={inp} /></Field>
          <Field label="Tables (comma-separated schema.table, must be line members)"><input value={cardDraft.tables} onChange={(e) => setCardDraft({ ...cardDraft, tables: e.target.value })} className={`${inp} font-mono`} /></Field>
          <Field label="SQL">
            <SqlHint
              onInsert={(sql) => {
                if (cardDraft.sql.trim() && !confirm("Replace the current SQL with this example?")) return;
                setCardDraft({ ...cardDraft, sql });
              }}
            />
            <textarea rows={5} value={cardDraft.sql} onChange={(e) => setCardDraft({ ...cardDraft, sql: e.target.value })} className={`${inp} font-mono`} />
          </Field>
          <div className="flex gap-3">
            <Field label="Granularity">
              <select value={cardDraft.granularity} onChange={(e) => setCardDraft({ ...cardDraft, granularity: e.target.value })} className={inp}>
                <option value="hourly">hourly</option><option value="shift">shift</option><option value="daily">daily</option>
              </select>
            </Field>
            <Field label="Unit"><input value={cardDraft.unit} onChange={(e) => setCardDraft({ ...cardDraft, unit: e.target.value })} placeholder="°C, pcs…" className={inp} /></Field>
            <Field label="Threshold (optional)"><input value={cardDraft.threshold} onChange={(e) => setCardDraft({ ...cardDraft, threshold: e.target.value })} placeholder="warn above…" className={inp} /></Field>
          </div>
          <Field label="Extraction hint"><textarea rows={2} value={cardDraft.extractHint} onChange={(e) => setCardDraft({ ...cardDraft, extractHint: e.target.value })} className={inp} /></Field>
          {editCard && (
            <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-ink-800">
              <div className="font-medium">On save, this SQL change applies…</div>
              <label className="mt-2 flex items-center gap-2">
                <input type="radio" checked={cardDraft.changeMode === "forward"} onChange={() => setCardDraft({ ...cardDraft, changeMode: "forward" })} className="accent-teal-500" />
                Forward-only — from now on (light)
              </label>
              <label className="mt-1 flex items-center gap-2">
                <input type="radio" checked={cardDraft.changeMode === "reingest"} onChange={() => setCardDraft({ ...cardDraft, changeMode: "reingest" })} className="accent-teal-500" />
                Re-ingest from
                <input type="date" value={cardDraft.reingestFrom} onChange={(e) => setCardDraft({ ...cardDraft, reingestFrom: e.target.value })} className="rounded border border-slate-300 bg-transparent px-2 py-0.5 dark:border-ink-700" />
              </label>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setShowCardForm(false)} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel</button>
            <Btn
              variant="primary"
              icon={Save}
              onClick={() => void act(() => {
                const body = {
                  name: cardDraft.name,
                  tables: cardDraft.tables.split(",").map((s) => s.trim()).filter(Boolean),
                  sql: cardDraft.sql, granularity: cardDraft.granularity,
                  unit: cardDraft.unit, extractHint: cardDraft.extractHint,
                  threshold: cardDraft.threshold === "" ? null : Number(cardDraft.threshold),
                  ...(editCard ? { changeMode: cardDraft.changeMode, reingestFrom: cardDraft.reingestFrom || undefined } : {}),
                };
                return (editCard
                  ? cardApi.updateCard(editCard.id, body)
                  : cardApi.createCard({ lineId: cardDraft.lineId, ...body })
                ).then(() => setShowCardForm(false));
              })}
            >
              Save dormant
            </Btn>
          </div>
        </Modal>
      )}

      {graphCard && (
        <GraphDesigner card={graphCard} onClose={() => { setGraphCard(null); refresh(); }} />
      )}

      {pushLine && (
        <PushToHindsight
          lineId={pushLine.id}
          lineName={pushLine.name}
          onClose={() => setPushLine(null)}
          onPushed={() => {
            void refresh();
            if (liveNudge && liveNudge.lineId === pushLine.id) setLiveNudge(null);
          }}
        />
      )}

      {detailCard && (
        <CardDetails
          card={detailCard}
          template={templates.find((t) => t.id === detailCard.templateId) ?? null}
          line={lines.find((l) => l.id === detailCard.lineId) ?? null}
          graphs={cardGraphs[detailCard.id] ?? []}
          bankReady={!!banks[detailCard.lineId]?.ready}
          onClose={() => setDetailCard(null)}
        />
      )}
    </div>
  );
}

const inp = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm">{label}<span className="block">{children}</span></label>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="anim-fade-in fixed inset-0 z-10 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="anim-pop-in max-h-[90vh] w-[36rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="mt-4 flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}

/** SQL Playground tab — inline in Cards, not a separate route. */
function PlaygroundTab({ lines, lineId, setLineId, sql, setSql, result, error, running, history, showHistory, cols, showSave, saveDraft, onRun, onHistoryToggle, onRerun, onSaveCard, setShowSave, setSaveDraft }: {
  lines: Line[];
  lineId: string;
  setLineId: (v: string) => void;
  sql: string;
  setSql: (v: string) => void;
  result: PlaygroundResult | null;
  error: string | null;
  running: boolean;
  history: QueryHistoryEntry[];
  showHistory: boolean;
  cols: LineColumn[];
  showSave: boolean;
  saveDraft: { name: string; tables: string; granularity: string; unit: string; extractHint: string };
  onRun: () => void;
  onHistoryToggle: () => void;
  onRerun: (sql: string) => void;
  onSaveCard: (name: string, tables: string, gran: string, unit: string, hint: string) => Promise<void>;
  setShowSave: (v: boolean) => void;
  setSaveDraft: (f: (d: typeof saveDraft) => typeof saveDraft) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <label className="block text-sm">
          Line
          <select value={lineId} onChange={(e) => setLineId(e.target.value)} className="ml-2 w-64 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700">
            <option value="">— select line —</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
          </select>
        </label>
        {cols.length > 0 && (
          <div className="flex flex-wrap items-end gap-1 text-xs text-slate-400 dark:text-ink-500">
            {cols.slice(0, 12).map((c) => (
              <button key={`${c.table}.${c.name}`} onClick={() => setSql(sql ? `${sql} ${c.name}` : c.name)} className="rounded border border-slate-200 px-1.5 py-0.5 hover:bg-slate-100 dark:border-ink-700 dark:hover:bg-ink-800" title={`${c.table} · ${c.type}`}>{c.name}</button>
            ))}
            {cols.length > 12 && <span>+{cols.length - 12} more</span>}
          </div>
        )}
      </div>
      <div className="mt-3">
        <textarea rows={6} value={sql} onChange={(e) => setSql(e.target.value)} placeholder="SELECT * FROM readings_temp LIMIT 50" className="w-full rounded-lg border border-slate-300 bg-transparent p-3 font-mono text-sm dark:border-ink-700" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onRun(); }} />
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400 dark:text-ink-500">
          <span>Ctrl+Enter to run</span><span>·</span><span>SELECT/WITH/SHOW/EXPLAIN only</span><span>·</span><span>no multi-statement</span>
        </div>
      </div>
      {error && <div className="mt-3"><AlertBanner tone="bad" title="Query failed" detail={error} /></div>}
      <div className="mt-3 flex gap-2">
        <Btn variant="primary" icon={Play} onClick={onRun} disabled={running || !lineId || !sql.trim()} loading={running}>{running ? "running…" : "Run query"}</Btn>
        {result && <Btn icon={Save} onClick={() => { setSaveDraft((d) => ({ ...d, name: "", tables: lines.find((l) => l.id === lineId)?.memberTables.join(", ") ?? "", granularity: "hourly", unit: "", extractHint: "" })); setShowSave(true); }}>Save as card</Btn>}
        <Btn icon={HistoryIcon} onClick={onHistoryToggle} className="ml-auto">History ({history.length})</Btn>
      </div>
      {result && (
        <div className="mt-4 overflow-auto rounded-xl border border-slate-200 dark:border-ink-800">
          <div className="border-b border-slate-200 px-4 py-2 text-sm dark:border-ink-800">
            <span className="tnum font-semibold">{result.rowCount}</span> rows
            {result.capped && <span className="ml-2 text-state-warn">capped to 100</span>}
            <span className="ml-2 text-slate-400">{result.durationMs}ms</span>
          </div>
          <table className="w-full text-left font-mono text-xs">
            <thead><tr className="border-b border-slate-200 dark:border-ink-800">{result.columns.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}</tr></thead>
            <tbody>{result.rows.map((r, i) => <tr key={i} className="border-t border-slate-100 dark:border-ink-800">{result.columns.map((c) => <td key={c} className="px-3 py-1.5">{String(r[c] ?? "")}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {result && result.rows.length === 0 && <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-ink-700"><div className="text-sm text-slate-500">Query returned 0 rows</div></div>}
      {showHistory && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-ink-800">
          <div className="text-sm font-semibold">Recent queries</div>
          {history.length === 0 && <div className="mt-2 text-sm text-slate-400">No history yet</div>}
          {history.map((h) => (
            <div key={h.id} className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 p-2 text-xs hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-800/50" onClick={() => onRerun(h.sql)}>
              <StatusChip tone={h.ok ? "ok" : "bad"}>{h.ok ? "ok" : "fail"}</StatusChip>
              <span className="tnum text-slate-400">{h.rowCount != null ? `${h.rowCount} rows` : "—"}</span>
              <span className="tnum text-slate-400">{h.durationMs != null ? `${h.durationMs}ms` : "—"}</span>
              <span className="truncate font-mono text-slate-500">{h.sql.slice(0, 80)}</span>
              <span className="ml-auto text-slate-400">{new Date(h.createdAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
      {showSave && (
        <Modal title="Save as card (dormant)" onClose={() => setShowSave(false)}>
          <Field label="Card name"><input value={saveDraft.name} onChange={(e) => setSaveDraft((d) => ({ ...d, name: e.target.value }))} className={inp} /></Field>
          <Field label="Tables (comma-separated)"><input value={saveDraft.tables} onChange={(e) => setSaveDraft((d) => ({ ...d, tables: e.target.value }))} className={`${inp} font-mono`} /></Field>
          <div className="flex gap-3">
            <Field label="Granularity"><select value={saveDraft.granularity} onChange={(e) => setSaveDraft((d) => ({ ...d, granularity: e.target.value }))} className={inp}><option value="hourly">hourly</option><option value="shift">shift</option><option value="daily">daily</option></select></Field>
            <Field label="Unit"><input value={saveDraft.unit} onChange={(e) => setSaveDraft((d) => ({ ...d, unit: e.target.value }))} placeholder="°C, pcs…" className={inp} /></Field>
          </div>
          <Field label="Extraction hint"><textarea rows={2} value={saveDraft.extractHint} onChange={(e) => setSaveDraft((d) => ({ ...d, extractHint: e.target.value }))} className={inp} /></Field>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setShowSave(false)} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel</button>
            <Btn variant="primary" icon={Save} onClick={() => void onSaveCard(saveDraft.name, saveDraft.tables, saveDraft.granularity, saveDraft.unit, saveDraft.extractHint)} disabled={!saveDraft.name.trim()}>Save dormant card</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Graph designer: pick chart type + axes from a card's test-run results, save spec. */
function GraphDesigner({ card, onClose }: { card: Card; onClose: () => void }) {
  const [graphs, setGraphs] = useState<GraphSpec[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "", chartType: "table" as ChartType, xColumn: "", yColumns: [] as string[], title: "",
  });
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      graphApi.listForCard(card.id).catch(() => []),
      card.status === "live" || card.lastTest?.ok
        ? cardApi.testCard(card.id).catch(() => null)
        : Promise.resolve(null),
    ]).then(([g, t]) => {
      setGraphs(g);
      setTestResult(t);
      setLoading(false);
      if (t && t.columns.length > 0) {
        setDraft((d) => ({ ...d, xColumn: d.xColumn || t.columns[0] }));
      }
    });
  }, [card.id]);

  const cols = testResult?.columns ?? [];

  function numericCols(): string[] {
    if (!testResult) return [];
    return cols.filter((c) => {
      const v = testResult.rows[0]?.[c];
      return typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)));
    });
  }

  function startEdit(g: GraphSpec) {
    setEditing(g.id);
    setDraft({ name: g.name, chartType: g.chartType, xColumn: g.xColumn, yColumns: g.yColumns, title: g.title });
  }

  function toggleY(col: string) {
    setDraft((d) => ({
      ...d,
      yColumns: d.yColumns.includes(col) ? d.yColumns.filter((c) => c !== col) : [...d.yColumns, col],
    }));
  }

  async function onSave() {
    try {
      if (editing) {
        await graphApi.update(editing, draft);
      } else {
        await graphApi.create(card.id, draft);
      }
      const g = await graphApi.listForCard(card.id);
      setGraphs(g);
      setEditing(null);
      setDraft({ name: "", chartType: "table", xColumn: cols[0] ?? "", yColumns: [], title: "" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this graph spec?")) return;
    await graphApi.delete(id);
    setGraphs((g) => g.filter((x) => x.id !== id));
  }

  return (
    <div className="anim-fade-in fixed inset-0 z-10 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="anim-pop-in max-h-[90vh] w-[48rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Graph Designer — {card.name}</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-400 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">close</button>
        </div>

        {error && <div className="mt-3"><AlertBanner tone="bad" title="Error" detail={error} /></div>}

        {!testResult && !loading && (
          <div className="mt-4 rounded-lg border border-state-warn/40 bg-state-warn/10 p-3 text-sm text-state-warn">
            No test-run data yet — test the card first so column names appear below.
          </div>
        )}

        {testResult && (
          <div className="mt-4 rounded-lg border border-slate-200 p-4 dark:border-ink-800">
            <div className="text-sm font-semibold">{editing ? "Edit graph spec" : "New graph spec"}</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Name">
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Temperature over time" className={inp} />
              </Field>
              <Field label="Chart type">
                <div className="mt-1">
                  <Segmented
                    value={draft.chartType}
                    onChange={(v) => setDraft({ ...draft, chartType: v })}
                    options={(["table", "line", "bar", "area"] as const).map((t) => ({ value: t, label: t }))}
                  />
                </div>
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="X axis (column)">
                <select value={draft.xColumn} onChange={(e) => setDraft({ ...draft, xColumn: e.target.value })} className={inp}>
                  <option value="">— select —</option>
                  {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Y axis (series, click to toggle)">
                <div className="mt-1 flex flex-wrap gap-1">
                  {numericCols().map((c) => (
                    <button
                      key={c}
                      onClick={() => toggleY(c)}
                      className={`rounded px-2 py-0.5 text-xs ${draft.yColumns.includes(c) ? "bg-accent-500/20 text-accent-400 ring-1 ring-accent-500/30" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800"}`}
                    >
                      {c}
                    </button>
                  ))}
                  {numericCols().length === 0 && <span className="text-xs text-slate-400">no numeric columns</span>}
                </div>
              </Field>
            </div>
            <Field label="Title (optional)">
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Chart title" className={inp} />
            </Field>

            {/* Live preview */}
            {draft.chartType !== "table" && draft.xColumn && draft.yColumns.length > 0 && (
              <div className="mt-4 rounded-lg border border-slate-200 p-4 dark:border-ink-800">
                <div className="text-xs font-semibold text-slate-400">Preview</div>
                <ChartPreview rows={testResult.rows} x={draft.xColumn} yCols={draft.yColumns} type={draft.chartType} title={draft.title} />
              </div>
            )}
            {draft.chartType === "table" && (
              <div className="mt-4 text-xs text-slate-400">Table chart: the AI will render the data rows as a formatted table in the chat.</div>
            )}

            <div className="mt-3 flex justify-end gap-2">
              {editing && <button onClick={() => { setEditing(null); setDraft({ name: "", chartType: "table", xColumn: cols[0] ?? "", yColumns: [], title: "" }); }} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel edit</button>}
              <Btn variant="primary" icon={Save} onClick={() => void onSave()} disabled={!draft.xColumn}>
                {editing ? "Update" : "Save graph"}
              </Btn>
            </div>
          </div>
        )}

        {graphs.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-semibold">Saved graphs ({graphs.length})</div>
            {graphs.map((g) => (
              <div key={g.id} className="mt-2 flex items-center gap-2 rounded-lg border border-slate-100 p-2 text-sm dark:border-ink-800">
                <StatusChip tone="accent">{g.chartType}</StatusChip>
                <span className="font-medium">{g.name || g.title || "Untitled"}</span>
                <span className="text-xs text-slate-400">x:{g.xColumn} y:{g.yColumns.join(",")}</span>
                <span className="tnum text-xs text-slate-400">v{g.version}</span>
                <div className="ml-auto flex gap-1">
                  <Btn size="sm" icon={Pencil} onClick={() => startEdit(g)}>edit</Btn>
                  <Btn size="sm" variant="bad" icon={Trash2} onClick={() => void onDelete(g.id)}>del</Btn>
                </div>
              </div>
            ))}
          </div>
        )}
        {loading && <div className="mt-4 flex items-center gap-2 text-sm text-slate-400"><Spinner /> Loading test data…</div>}
      </div>
    </div>
  );
}

/** Minimal SVG chart preview — line, bar, area. No library needed. */
function ChartPreview({ rows, x, yCols, type, title }: { rows: Record<string, unknown>[]; x: string; yCols: string[]; type: string; title: string }) {
  if (rows.length === 0) return <div className="text-xs text-slate-400">No data to preview</div>;

  const W = 400, H = 160, PAD = 30;
  const xVals = rows.map((r) => String(r[x] ?? ""));
  const numCols = yCols.filter((c) => rows.some((r) => typeof r[c] === "number" || !isNaN(Number(r[c]))));
  if (numCols.length === 0) return <div className="text-xs text-slate-400">No numeric Y columns</div>;

  const allNums = rows.map((r) => numCols.map((c) => Number(r[c] ?? 0))).flat();
  const yMin = Math.min(...allNums);
  const yMax = Math.max(...allNums) || 1;
  const yRange = yMax - yMin || 1;

  function xi(i: number) { return PAD + (i / Math.max(xVals.length - 1, 1)) * (W - 2 * PAD); }
  function yi(v: number) { return H - PAD - ((v - yMin) / yRange) * (H - 2 * PAD); }

  const COLORS = ["#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-2">
      {title && <text x={W / 2} y={14} textAnchor="middle" className="fill-slate-500 text-xs">{title}</text>}
      {/* grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={PAD} x2={W - PAD} y1={yi(yMin + f * yRange)} y2={yi(yMin + f * yRange)} className="stroke-slate-200 dark:stroke-ink-800" strokeWidth={0.5} />
          <text x={PAD - 4} y={yi(yMin + f * yRange) + 3} textAnchor="end" className="fill-slate-400 text-[8px]">{(yMin + f * yRange).toFixed(1)}</text>
        </g>
      ))}
      {/* x labels */}
      {xVals.filter((_, i) => i % Math.max(1, Math.floor(xVals.length / 6)) === 0).map((v, _, arr) => {
        const i = xVals.indexOf(v);
        return <text key={i} x={xi(i)} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[8px]">{v.length > 8 ? v.slice(0, 8) + "…" : v}</text>;
      })}
      {type === "line" && numCols.map((col, ci) => {
        const pts = rows.map((r, i) => `${xi(i)},${yi(Number(r[col] ?? 0))}`).join(" ");
        return <polyline key={col} points={pts} fill="none" stroke={COLORS[ci % COLORS.length]} strokeWidth={1.5} />;
      })}
      {type === "area" && numCols.map((col, ci) => {
        const pts = rows.map((r, i) => `${xi(i)},${yi(Number(r[col] ?? 0))}`);
        const d = `M${pts.join(" L")} L${xi(rows.length - 1)},${yi(yMin)} L${xi(0)},${yi(yMin)} Z`;
        return <path key={col} d={d} fill={COLORS[ci % COLORS.length]} fillOpacity={0.15} />;
      })}
      {type === "bar" && rows.map((r, i) => {
        const bw = (W - 2 * PAD) / Math.max(rows.length * numCols.length, 1) * 0.7;
        return numCols.map((col, ci) => {
          const v = Number(r[col] ?? 0);
          const barH = ((v - yMin) / yRange) * (H - 2 * PAD);
          return <rect key={`${i}-${ci}`} x={xi(i) - bw / 2 + ci * (bw + 1)} y={yi(v)} width={bw} height={barH} fill={COLORS[ci % COLORS.length]} rx={1} />;
        });
      })}
      {/* legend */}
      {numCols.map((col, ci) => (
        <g key={col} transform={`translate(${PAD + ci * 80}, ${H - 2})`}>
          <rect width={8} height={8} fill={COLORS[ci % COLORS.length]} rx={1} />
          <text x={12} y={8} className="fill-slate-400 text-[8px]">{col}</text>
        </g>
      ))}
    </svg>
  );
}
