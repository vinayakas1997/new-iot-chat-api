import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Brain, ChartLine, ClipboardCheck, Copy, Database, Eye, FlaskConical, History as HistoryIcon,
  LayoutTemplate, ListChecks, Pause, Pencil, Play, Plus, Rocket, Save, Search, SlidersHorizontal, Sparkles, Table2, Trash2, X,
} from "lucide-react";
import { Btn, Segmented, Spinner } from "../components/ui";
import { CardDetails } from "../components/CardDetails";
import { Chart, defaultChartType, isTemporalName, numericColumns } from "../components/Chart";
import { ChartPreviewModal } from "../components/ChartPreviewModal";
import { LinePreview } from "../components/LinePreview";
import { windowForResolution, type Resolution } from "../components/Chart";
import { isTradingEligible, TradingChart } from "../components/TradingChart";
import { cardApi, api, bankApi, chartApi, graphApi, playgroundApi, llmReasonText, type BankOverviewEntry, type Card, type CardTemplate, type ChartSuggestion, type Line, type ReapplyResult, type TestResult, type GraphSpec, type ChartType, type PlaygroundResult, type QueryHistoryEntry, type LineColumn } from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";
import { FormattedText } from "../components/FormattedText";
import { PushToHindsight } from "../components/PushToHindsight";
import { SqlHint } from "../components/SqlHint";

/** Insert text at the textarea cursor (falls back to append). */
export function insertAtCursor(
  ref: React.RefObject<HTMLTextAreaElement>,
  cur: string,
  set: (v: string) => void,
  text: string,
) {
  const el = ref.current;
  if (!el) {
    set(cur ? `${cur} ${text}` : text);
    return;
  }
  const s = el.selectionStart ?? cur.length;
  const e = el.selectionEnd ?? cur.length;
  set(`${cur.slice(0, s)}${text}${cur.slice(e)}`);
  requestAnimationFrame(() => {
    el.focus();
    el.selectionStart = el.selectionEnd = s + text.length;
  });
}
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

export interface RemapState {
  refs: string[];
  missing: string[];
  mapping: Record<string, string>;
  blocked: boolean;
  preview: string;
  tables: string[];
}

/** Shared mapping state: template refs → line member tables (explicit map wins, then match, then first member). */
export function remapState(sql: string, members: string[], map: Record<string, string>): RemapState {
  const refs = sqlTableRefs(sql);
  const missing = refs.filter((r) => !matchMember(r, members));
  const mapping: Record<string, string> = {};
  for (const r of refs) {
    mapping[r] = map[r.toLowerCase()] ?? matchMember(r, members) ?? members[0] ?? "";
  }
  const blocked = refs.length > 0 && Object.values(mapping).some((v) => !v);
  return { refs, missing, mapping, blocked, preview: remapSql(sql, mapping), tables: [...new Set(Object.values(mapping).filter(Boolean))] };
}

/** Reusable table-map editor: each SQL ref becomes a dropdown of line member tables. */
export function RemapTables({ sql, members, map, setMap }: {
  sql: string;
  members: string[];
  map: Record<string, string>;
  setMap: (m: Record<string, string>) => void;
}) {
  const { refs, missing, mapping } = remapState(sql, members, map);
  if (refs.length === 0) return null;
  return (
    <div className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-ink-900/50">
      <div className="tnum text-xs uppercase tracking-wider text-slate-400">
        tables in this query · {refs.length - missing.length} match, {missing.length} to map — click a table name to swap it
      </div>
      {missing.length === 0 && (
        <div className="mt-1 text-xs text-state-ok">all template tables exist on this line — one click, no edits.</div>
      )}
      <div className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 font-mono text-xs leading-relaxed dark:bg-ink-800">
        {tokenizeSqlTables(sql).map((tok, i) => {
          if (tok.kind === "text") return <span key={i}>{tok.text}</span>;
          const r = tok.ref;
          const matched = !!matchMember(r, members);
          const val = mapping[r];
          const guessed = !matched && val === members[0] && !(r.toLowerCase() in map);
          return (
            <span key={i} className="inline-flex items-baseline gap-1">
              <select
                value={val}
                onChange={(e) => setMap({ ...map, [r.toLowerCase()]: e.target.value })}
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
  );
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
  const [testPopup, setTestPopup] = useState<{ card: Card; result: TestResult | null; error: string | null } | null>(null);
  const [reapplyByTpl, setReapplyByTpl] = useState<Record<string, ReapplyResult>>({});
  const [appliedByTpl, setAppliedByTpl] = useState<Record<string, boolean>>({});
  const [showTplForm, setShowTplForm] = useState(false);
  const [editTpl, setEditTpl] = useState<CardTemplate | null>(null);
  const [tplDraft, setTplDraft] = useState({ name: "", description: "", sqlTemplate: "", granularity: "hourly", unit: "", extractHint: "", context: "" });
  const [instTpl, setInstTpl] = useState<CardTemplate | null>(null);
  const [instLine, setInstLine] = useState("");
  const [instMap, setInstMap] = useState<Record<string, string>>({});
  // Batch register: line-first multi-template attach (dormant copies).
  const [showAdd, setShowAdd] = useState(false);
  const [addLine, setAddLine] = useState("");
  const [addQ, setAddQ] = useState("");
  const [addMaps, setAddMaps] = useState<Record<string, Record<string, string>>>({});
  const [addChecked, setAddChecked] = useState<string[]>([]);
  const [addBusy, setAddBusy] = useState(false);
  const [addDone, setAddDone] = useState<{ ok: string[]; failed: { id: string; name: string; error: string }[] } | null>(null);
  // Guardrail landing: copy row to flash after jumping from the Add modal.
  const [flashCopy, setFlashCopy] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => () => { if (flashTimer.current != null) window.clearTimeout(flashTimer.current); }, []);
  function flashCopyRow(id: string) {
    setFlashCopy(id);
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashCopy(null), 2400);
  }
  function goToCopy(tplId: string, cardId: string) {
    setShowAdd(false);
    setAddMaps({});
    setAddChecked([]);
    setAddDone(null);
    setTab("templates");
    setOpenTpl(tplId);
    flashCopyRow(cardId);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(`copy-row-${cardId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    });
  }
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardDraft, setCardDraft] = useState({ lineId: "", name: "", tables: "", sql: "", granularity: "hourly", unit: "", extractHint: "", context: "", threshold: "", changeMode: "forward", reingestFrom: "" });
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [graphCard, setGraphCard] = useState<Card | null>(null);
  const [specificsCard, setSpecificsCard] = useState<Card | null>(null);
  const [cardGraphs, setCardGraphs] = useState<Record<string, GraphSpec[]>>({});
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [banks, setBanks] = useState<Record<string, BankOverviewEntry>>({});
  const [pushLine, setPushLine] = useState<{ id: string; name: string } | null>(null);
  const [detailCard, setDetailCard] = useState<Card | null>(null);
  const [previewCopy, setPreviewCopy] = useState<{ tpl: CardTemplate; line: Line } | null>(null);
  const [liveNudge, setLiveNudge] = useState<{ cardId: string; cardName: string; lineId: string } | null>(null);
  // Umbrella view: search + filters + group-by-line.
  const [cardQ, setCardQ] = useState("");
  const [cardLine, setCardLine] = useState("");
  const [cardStatus, setCardStatus] = useState<"all" | "live" | "dormant" | "green" | "untested">("all");
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showSuggest, setShowSuggest] = useState(false);
  const [copyQ, setCopyQ] = useState<Record<string, string>>({});
  const [copyStatus, setCopyStatus] = useState<Record<string, "all" | "live" | "dormant" | "failed" | "stale">>({});
  const [checkedByTpl, setCheckedByTpl] = useState<Record<string, string[]>>({});
  // Template registry: search + state filter + accordion (one open at a time).
  const [tplQ, setTplQ] = useState("");
  const [tplState, setTplState] = useState<"all" | "stale" | "no-ref" | "no-suggest">("all");
  const [openTpl, setOpenTpl] = useState<string | null>(null);
  const tplInit = useRef(false);
  useEffect(() => {
    if (!tplInit.current && templates.length > 0) {
      tplInit.current = true;
      setOpenTpl(templates[0].id);
    }
  }, [templates]);
  const [fixCard, setFixCard] = useState<{ tplId: string; cardId: string } | null>(null);
  const [fixMap, setFixMap] = useState<Record<string, string>>({});
  const [fixBusy, setFixBusy] = useState(false);
  const [dupTpl, setDupTpl] = useState<CardTemplate | null>(null);
  const [dupLine, setDupLine] = useState("");
  const [dupName, setDupName] = useState("");
  const [dupMap, setDupMap] = useState<Record<string, string>>({});
  const [dupSearch, setDupSearch] = useState("");
  const [dupSug, setDupSug] = useState(false);
  const [tplPickLine, setTplPickLine] = useState("");
  const [tplLineSearch, setTplLineSearch] = useState("");
  const [showLineSug, setShowLineSug] = useState(false);
  const tplSqlRef = useRef<HTMLTextAreaElement>(null);

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

  async function runTestPopup(c: Card) {
    setTestingId(c.id);
    setError(null);
    try {
      const r = await cardApi.testCard(c.id);
      setTestPopup({ card: c, result: r, error: null });
    } catch (e) {
      setTestPopup({ card: c, result: null, error: (e as Error).message });
    } finally {
      // Drop any cached Check result for this card so the row's Status shows the fresh run.
      setReapplyByTpl((m) => {
        const cur = m[c.templateId ?? ""];
        if (!cur) return m;
        const results = cur.results.filter((r) => r.cardId !== c.id);
        return { ...m, [c.templateId!]: { ...cur, results } };
      });
      setTestingId(null);
      await refresh();
    }
  }

  function openEditCard(c: Card) {
    setEditCard(c);
    setCardDraft({ lineId: c.lineId, name: c.name, tables: c.tables.join(", "), sql: c.sql, granularity: c.granularity, unit: c.unit, extractHint: c.extractHint, context: c.context ?? "", threshold: c.threshold != null ? String(c.threshold) : "", changeMode: "forward", reingestFrom: "" });
    setShowCardForm(true);
  }

  function openEditTemplate(t: CardTemplate) {
    const ref = t.referenceLineId ? lines.find((l) => l.id === t.referenceLineId) : undefined;
    setEditTpl(t);
    setTplDraft({ name: t.name, description: t.description, sqlTemplate: t.sqlTemplate, granularity: t.granularity, unit: t.unit, extractHint: t.extractHint, context: t.context ?? "" });
    setTplPickLine(t.referenceLineId ?? "");
    setTplLineSearch(ref ? `${ref.id} — ${ref.name}` : "");
    setShowTplForm(true);
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
          <Btn icon={SlidersHorizontal} onClick={() => setSpecificsCard(c)} title="Per-ingest tuning for this feature: extract hint, threshold, unit, context. Bank settings stay on the line.">
            Specifics
          </Btn>
          {c.status === "dormant" ? (
            <>
              <Btn variant="ok" icon={Rocket} onClick={() => void onActivate(c)} disabled={!canActivate(c)}>Go live</Btn>
              <Btn icon={Pencil} onClick={() => openEditCard(c)}>edit</Btn>
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
            ? <Btn variant="primary" icon={Plus} onClick={() => { setShowAdd(true); setAddLine(lines[0]?.id ?? ""); setAddQ(""); setAddMaps({}); setAddChecked([]); setAddDone(null); }} title="Register features onto a line: pick the line, see its tables, search templates, attach several at once as dormant copies. SQL and thresholds live in the template.">New card</Btn>
            : <Btn variant="primary" icon={Plus} onClick={() => { setEditTpl(null); setTplDraft({ name: "", description: "", sqlTemplate: "", granularity: "hourly", unit: "", extractHint: "", context: "" }); setTplPickLine(""); setTplLineSearch(""); setShowTplForm(true); }}>New template</Btn>}
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
        <div className="mt-4 flex flex-col gap-4">
          {(() => {
            const q = tplQ.trim().toLowerCase();
            const visibleTpls = templates.filter((t) => {
              const copies = cards.filter((c) => c.templateId === t.id);
              if (tplState === "stale" && !copies.some((c) => c.templateVersion != null && c.templateVersion < t.version)) return false;
              if (tplState === "no-ref" && t.referenceLineId) return false;
              if (tplState === "no-suggest" && (t.chartSuggestions ?? []).length > 0) return false;
              if (q) {
                const refName = lines.find((l) => l.id === t.referenceLineId)?.name ?? "";
                const hay = `${t.name} ${t.description ?? ""} ${t.referenceLineId ?? ""} ${refName} ${t.sqlTemplate ?? ""}`.toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });
            const openId = visibleTpls.some((t) => t.id === openTpl) ? openTpl : visibleTpls[0]?.id ?? null;
            return (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={tplQ}
                      onChange={(e) => setTplQ(e.target.value)}
                      placeholder="Search templates, lines, SQL…"
                      className="w-64 rounded-lg border border-slate-300 bg-transparent py-1.5 pl-8 pr-2 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
                    />
                  </div>
                  <select
                    value={tplState}
                    onChange={(e) => setTplState(e.target.value as "all" | "stale" | "no-ref" | "no-suggest")}
                    title="Filter templates by state"
                    className="rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
                  >
                    <option value="all">all states</option>
                    <option value="stale">with stale copies</option>
                    <option value="no-ref">missing reference line</option>
                    <option value="no-suggest">no chart suggestions</option>
                  </select>
                  {(tplQ || tplState !== "all") && (
                    <button onClick={() => { setTplQ(""); setTplState("all"); }} className="inline-flex items-center gap-1 text-xs text-accent-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"><X size={12} />clear</button>
                  )}
                  <span className="tnum ml-auto text-xs text-slate-400">{visibleTpls.length} of {templates.length}</span>
                </div>
                {visibleTpls.map((t) => {
            const copies = cards.filter((c) => c.templateId === t.id);
            const allIds = copies.map((c) => c.id);
            const checked = checkedByTpl[t.id] ?? allIds;
            const isOpen = openId === t.id;
            const staleCount = copies.filter((c) => c.templateVersion != null && c.templateVersion < t.version).length;
            const sugCount = (t.chartSuggestions ?? []).length;
            const refLine = t.referenceLineId ? lines.find((l) => l.id === t.referenceLineId) : undefined;
            return (
            <div key={t.id} className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
              <div onClick={() => setOpenTpl(isOpen ? null : t.id)} title={isOpen ? "Collapse — other templates stay closed" : "Expand — closes the open template"} className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="text-slate-400">{isOpen ? "▾" : "▸"}</span>
                <span className="font-semibold">{t.name}</span>
                <span className="tnum text-xs text-slate-400">v{t.version}</span>
                {t.referenceLineId && (
                  <span className="tnum inline-flex items-center gap-1 rounded-full bg-accent-500/10 px-2 py-0.5 text-xs text-accent-500 ring-1 ring-accent-500/30" title="The line this template was written against — its tables are the reference">
                    reference: {t.referenceLineId}{refLine ? ` · ${refLine.memberTables.length} tables` : " · line gone"}
                  </span>
                )}
                <span className="tnum text-xs text-slate-400">{copies.length} {copies.length === 1 ? "copy" : "copies"}</span>
                {staleCount > 0 && <StatusChip tone="warn">{staleCount} stale</StatusChip>}
                <span className="tnum text-xs text-slate-400">{sugCount} suggestions</span>
                <span className="ml-auto text-xs text-slate-400">{t.granularity}{t.unit ? ` · ${t.unit}` : ""}</span>
              </div>
              {isOpen && (<>
              {t.description && <div className="mt-1 text-sm text-slate-500">{t.description}</div>}
              <div className="tnum mt-1 text-xs text-slate-400">
                ≈{copies.reduce((s, c) => s + tickCost(c), 0)} queries/day across {copies.length} copies
              </div>
              <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-100 p-2 font-mono text-xs dark:bg-ink-900">{t.sqlTemplate || "(no SQL template)"}</pre>
              <TemplateCharts template={t} onChanged={() => void refresh()} />
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <Btn variant="primary" icon={ArrowRight} onClick={() => { setInstTpl(t); setInstLine(lines[0]?.id ?? ""); setInstMap({}); }} title="Stamp an independent copy of this template onto a line. The copy starts dormant and can differ freely afterwards.">instantiate → line</Btn>
                <Btn icon={Copy} onClick={() => { setDupTpl(t); setDupLine(t.referenceLineId ?? lines[0]?.id ?? ""); setDupName(`${t.name} copy`); setDupMap({}); setDupSearch(""); setDupSug(false); }} title="Pick a line, edit the tables, and stamp a copy there.">duplicate</Btn>
                <Btn icon={Pencil} onClick={() => openEditTemplate(t)} title="Edit this template — name, SQL, reference line, hints. Copies are untouched.">edit</Btn>
                <Btn
                  icon={ClipboardCheck}
                  disabled={copies.length > 0 && checked.length === 0}
                  onClick={() => void (async () => {
                    if (checked.length === 0) return;
                    setError(null);
                    setAppliedByTpl((m) => ({ ...m, [t.id]: false }));
                    try {
                      const r = await cardApi.reapply(t.id, { activate: false, cardIds: checked });
                      setReapplyByTpl((m) => ({ ...m, [t.id]: r }));
                    } catch (e) { setError((e as Error).message); }
                  })()}
                  title={checked.length === allIds.length ? "Try this template on every copy. Changes nothing — safe to press anytime." : `Try this template on the ${checked.length} checked copies only.`}
                >
                  {checked.length === allIds.length ? "Check all copies" : `Check selected (${checked.length})`}
                </Btn>
                <Btn variant="bad" icon={Trash2} onClick={() => { if (confirm(`Delete template "${t.name}"? Copies keep working.`)) void act(() => cardApi.deleteTemplate(t.id)); }}>delete</Btn>
              </div>
              {copies.length === 0 ? (
                <div className="mt-2 text-xs text-slate-400">not used yet — no copies on any line</div>
              ) : (() => {
                const q = (copyQ[t.id] ?? "").trim().toLowerCase();
                const stf = copyStatus[t.id] ?? "all";
                const resByCard = new Map((reapplyByTpl[t.id]?.results ?? []).map((r) => [r.cardId, r]));
                const failedOf = (c: Card) => {
                  const r = resByCard.get(c.id);
                  return r ? r.status === "red" : (c.lastTest != null && !c.lastTest.ok);
                };
                const staleOf = (c: Card) => c.templateVersion != null && c.templateVersion < t.version;
                const staleIds = copies.filter(staleOf).map((c) => c.id);
                const visible = copies.filter((c) => {
                  if (stf === "live" && c.status !== "live") return false;
                  if (stf === "dormant" && c.status !== "dormant") return false;
                  if (stf === "failed" && !failedOf(c)) return false;
                  if (stf === "stale" && !staleOf(c)) return false;
                  if (q && !`${c.lineId} ${lineNameOf(c.lineId)} ${c.name} ${c.tables.join(" ")}`.toLowerCase().includes(q)) return false;
                  return true;
                });
                return (
                  <div className="mt-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-500" title={checked.length === allIds.length ? "Uncheck all — Check/Apply will skip everything" : "Check all copies"}>
                        <input
                          type="checkbox"
                          checked={allIds.length > 0 && checked.length === allIds.length}
                          onChange={() => setCheckedByTpl((m) => ({ ...m, [t.id]: checked.length === allIds.length ? [] : allIds }))}
                          className="h-4 w-4 accent-teal-500"
                        />
                        {checked.length === allIds.length ? "all" : `${checked.length}/${allIds.length}`}
                      </label>
                      <div className="relative">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          value={copyQ[t.id] ?? ""}
                          onChange={(e) => setCopyQ((m) => ({ ...m, [t.id]: e.target.value }))}
                          placeholder="Filter lines, tables…"
                          className="w-48 rounded-lg border border-slate-300 bg-transparent py-1.5 pl-8 pr-2 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
                        />
                      </div>
                      <select
                        value={copyStatus[t.id] ?? "all"}
                        onChange={(e) => setCopyStatus((m) => ({ ...m, [t.id]: e.target.value as "all" | "live" | "dormant" | "failed" | "stale" }))}
                        title="Filter rows by state"
                        className="rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
                      >
                        <option value="all">all states</option>
                        <option value="live">live</option>
                        <option value="dormant">dormant</option>
                        <option value="failed">failed</option>
                        <option value="stale">stale (behind template)</option>
                      </select>
                      {staleIds.length > 0 && (
                        <button
                          onClick={() => setCheckedByTpl((m) => ({ ...m, [t.id]: staleIds }))}
                          title="Check every copy that is behind the template, ready to Check/Apply"
                          className="rounded-lg border border-state-warn/50 px-2 py-1 text-xs text-state-warn transition-colors hover:bg-state-warn/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                        >
                          select stale ({staleIds.length})
                        </button>
                      )}
                      {reapplyByTpl[t.id] && (
                        <>
                          <span className="tnum font-mono text-xs text-slate-400">{reapplyByTpl[t.id].sqlHash}</span>
                          <button
                            onClick={() => setReapplyByTpl((m) => { const n = { ...m }; delete n[t.id]; return n; })}
                            aria-label="dismiss results"
                            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800"
                          >
                            <X size={14} />
                          </button>
                        </>
                      )}
                    </div>
                    {visible.length === 0 ? (
                      <div className="text-xs text-slate-400">no copies match this filter</div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-ink-800">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-ink-800">
                              <th className="w-8 px-2 py-2 font-medium"> </th>
                              <th className="px-2 py-2 font-medium">Line</th>
                              <th className="w-12 px-1 py-2 text-center font-medium" title="Open this copy's charts — same preview screen">Details</th>
                              <th className="w-12 px-1 py-2 text-center font-medium" title="Edit card">Edit</th>
                              <th className="w-12 px-1 py-2 text-center font-medium" title="Run test">Run</th>
                              <th className="px-2 py-2 font-medium">Status</th>
                              <th className="w-14 px-1 py-2 text-center font-medium" title="Delete copy">Delete</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map((c) => {
                              const r = resByCard.get(c.id);
                              const failed = failedOf(c);
                              const fixing = fixCard?.tplId === t.id && fixCard?.cardId === c.id;
                              return (
                                <Fragment key={c.id}>
                                  <tr id={`copy-row-${c.id}`} className={`border-b border-slate-100 align-top transition-colors dark:border-ink-800 ${flashCopy === c.id ? "bg-accent-500/10 ring-1 ring-inset ring-accent-500/50" : failed ? "bg-state-bad/[0.06]" : c.status === "live" ? "bg-state-ok/[0.05]" : ""}`}>
                                    <td className="px-2 py-2.5">
                                      <input
                                        type="checkbox"
                                        checked={checked.includes(c.id)}
                                        onChange={() => setCheckedByTpl((m) => {
                                          const cur = m[t.id] ?? allIds;
                                          return { ...m, [t.id]: cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id] };
                                        })}
                                        title={checked.includes(c.id) ? "Uncheck — skip in Check/Apply" : "Check — include in Check/Apply"}
                                        className="h-4 w-4 accent-teal-500"
                                      />
                                    </td>
                                    <td className="px-2 py-2.5">
                                      <Link
                                        to={`/setter/lines?edit=${c.lineId}`}
                                        title="Open this line in Lines to add/remove its tables"
                                        className="font-medium text-accent-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                                      >
                                        {lineNameOf(c.lineId)}
                                      </Link>
                                      <div className="font-mono text-xs text-slate-400">{c.lineId}</div>
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {c.tables.length === 0 && <span className="text-xs text-slate-400">no tables</span>}
                                        {c.tables.map((tb) => (
                                          <code key={tb} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-ink-800 dark:text-ink-300">{tb}</code>
                                        ))}
                                        {c.sql !== t.sqlTemplate && (
                                          <span className="text-[11px] text-state-warn" title="This copy's SQL differs from the template — bulk apply skips it">per-line SQL</span>
                                        )}
                                        {staleOf(c) && (
                                          <StatusChip tone="warn"><span title={`Template is v${t.version}, this copy was taken at v${c.templateVersion}`}>stale v{c.templateVersion}</span></StatusChip>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-1 py-2.5 text-center">
                                      <button
                                        onClick={() => {
                                          const ln = lines.find((x) => x.id === c.lineId);
                                          if (ln) setPreviewCopy({ tpl: t, line: ln });
                                        }}
                                        title="Open this copy's charts on its line — same preview screen"
                                        aria-label="Copy details"
                                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800"
                                      >
                                        <ChartLine size={16} />
                                      </button>
                                    </td>
                                    <td className="px-1 py-2.5 text-center">
                                      <button
                                        onClick={() => openEditCard(c)}
                                        disabled={c.status === "live"}
                                        title={c.status === "live" ? "Live copy — take it dormant before editing" : "Edit this card's fields (SQL, tables, hints…)"}
                                        aria-label="Edit card"
                                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-ink-800"
                                      >
                                        <Pencil size={16} />
                                      </button>
                                    </td>
                                    <td className="px-1 py-2.5 text-center">
                                      <button
                                        onClick={() => void runTestPopup(c)}
                                        disabled={testingId === c.id}
                                        title="Run a test now — shows the result in a popup"
                                        aria-label="Run test"
                                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:opacity-50 dark:hover:bg-ink-800"
                                      >
                                        {testingId === c.id ? <Spinner size={16} /> : <Play size={16} />}
                                      </button>
                                    </td>
                                    <td className="px-2 py-2.5">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <StatusChip tone={c.status === "live" ? "ok" : "mute"}>{c.status}</StatusChip>
                                        {r
                                          ? r.status === "green"
                                            ? <span className="tnum text-xs text-state-ok">✓ {r.rowCount} rows</span>
                                            : r.status === "red"
                                              ? <span className="max-w-56 truncate text-xs text-state-bad" title={r.error}>✗ {r.error}</span>
                                              : <span className="text-xs text-slate-400">locked-live</span>
                                          : c.lastTest
                                            ? c.lastTest.ok
                                              ? <span className="text-xs text-state-ok">✓ passed · {new Date(c.lastTest.at).toLocaleTimeString()}</span>
                                              : <span className="max-w-56 truncate text-xs text-state-bad" title={c.lastTest.error ?? ""}>✗ {c.lastTest.error}</span>
                                            : <span className="text-xs text-slate-400">never tested</span>}
                                      </div>
                                      {failed && c.status === "dormant" && !fixing && (
                                        <button
                                          onClick={() => { setFixCard({ tplId: t.id, cardId: c.id }); setFixMap({}); }}
                                          className="anim-fade-in mt-1 rounded-lg border border-state-bad/50 px-2 py-0.5 text-xs text-state-bad transition-colors hover:bg-state-bad/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                                        >
                                          Fix tables
                                        </button>
                                      )}
                                      {failed && c.status === "live" && (
                                        <button
                                          onClick={() => void act(() => cardApi.dormantCard(c.id))}
                                          title="Live copies can't change tables — take it dormant first"
                                          className="anim-fade-in mt-1 rounded-lg border border-state-warn/50 px-2 py-0.5 text-xs text-state-warn transition-colors hover:bg-state-warn/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                                        >
                                          take dormant to fix
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-1 py-2.5 text-center">
                                      <button
                                        onClick={() => { if (confirm(`Delete copy "${c.name}" on ${c.lineId}? This cannot be undone.`)) void act(() => cardApi.deleteCard(c.id)); }}
                                        disabled={c.status === "live"}
                                        title={c.status === "live" ? "Live copy — take it dormant before deleting" : "Delete this copy"}
                                        aria-label="Delete copy"
                                        className="rounded p-1 text-slate-400 transition-colors hover:bg-state-bad/10 hover:text-state-bad focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-ink-800"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </td>
                                  </tr>
                                  {fixing && (() => {
                                    const ln = lines.find((x) => x.id === c.lineId);
                                    const members = ln?.memberTables ?? [];
                                    const fs = remapState(c.sql, members, fixMap);
                                    return (
                                      <tr className="border-b border-slate-100 bg-slate-50/60 dark:border-ink-800 dark:bg-ink-900/40">
                                        <td colSpan={8} className="px-3 py-2">
                                          <RemapTables sql={c.sql} members={members} map={fixMap} setMap={setFixMap} />
                                          <div className="mt-2 flex justify-end gap-2">
                                            <button
                                              onClick={() => { setFixCard(null); setFixMap({}); }}
                                              className="rounded-lg px-3 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800"
                                            >
                                              cancel
                                            </button>
                                            <Btn
                                              variant="primary"
                                              icon={Save}
                                              disabled={fs.blocked || fixBusy || members.length === 0}
                                              loading={fixBusy}
                                              title={members.length === 0 ? "This line has no member tables" : fs.blocked ? "Map every table first" : "Save tables, re-test, refresh the row"}
                                              onClick={() => void (async () => {
                                                if (fs.blocked) return;
                                                setFixBusy(true);
                                                setError(null);
                                                try {
                                                  await cardApi.updateCard(c.id, { sql: fs.preview, tables: fs.tables });
                                                  await cardApi.testCard(c.id);
                                                  setFixCard(null);
                                                  setFixMap({});
                                                  await refresh();
                                                } catch (e) { setError((e as Error).message); } finally { setFixBusy(false); }
                                              })()}
                                            >
                                              {fixBusy ? "saving…" : "Save & re-test"}
                                            </Btn>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })()}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}
              {reapplyByTpl[t.id] && (() => {
                const out = reapplyByTpl[t.id];
                const applied = appliedByTpl[t.id];
                const scoped = out.results.filter((r) => checked.includes(r.cardId));
                const nGreen = scoped.filter((r) => r.status === "green").length;
                const nRed = scoped.filter((r) => r.status === "red").length;
                const nLocked = scoped.filter((r) => r.status === "skipped-live").length;
                const divergentIds = new Set(copies.filter((c) => c.sql !== t.sqlTemplate).map((c) => c.id));
                const applyIds = scoped.filter((r) => r.status === "green" && !divergentIds.has(r.cardId)).map((r) => r.cardId);
                const nExcluded = scoped.filter((r) => r.status === "green" && divergentIds.has(r.cardId)).length;
                return (
                  <div className="anim-fade-in mt-3 rounded-lg border border-slate-200 p-3 dark:border-ink-700">
                    <div className="text-sm font-semibold">
                      {applied
                        ? `${applyIds.length} updated, ${nRed} failed, ${nLocked} locked-live`
                        : `Checked ${scoped.length} cop${scoped.length === 1 ? "y" : "ies"}${checked.length !== allIds.length ? " (checked only)" : ""}`}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">✓ works = safe to update together · ✗ fails = expand the row, fix tables · locked-live = live copies, never touched.{nExcluded > 0 && ` ${nExcluded} green ${nExcluded === 1 ? "copy keeps" : "copies keep"} per-line SQL — excluded from apply.`}</p>
                    {applied || applyIds.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">
                        {applyIds.length === 0 && !applied
                          ? "Nothing to apply — no passing checked copies. Fix failing rows first, or check more rows."
                          : applyIds.length === 0
                            ? "Nothing changed — every checked copy was already live, failing, or per-line."
                            : "Done — passing copies updated and live."}
                      </p>
                    ) : (
                      <Btn
                        variant="primary"
                        icon={ListChecks}
                        onClick={() => void (async () => {
                          if (!confirm(`Update ${applyIds.length} passing copies to this SQL and take them live? Failing, live, unchecked, and per-line copies stay untouched.`)) return;
                          setError(null);
                          try {
                            const r = await cardApi.reapply(t.id, { activate: true, cardIds: applyIds });
                            setReapplyByTpl((m) => ({ ...m, [t.id]: r }));
                            setAppliedByTpl((m) => ({ ...m, [t.id]: true }));
                            await refresh();
                          } catch (e) { setError((e as Error).message); }
                        })()}
                        title="Update only the ✓ checked copies and take them live. Everything else stays untouched."
                        className="mt-2"
                      >
                        Apply to passing copies ({applyIds.length})
                      </Btn>
                    )}
                  </div>
                );
              })()}
              </>)}
            </div>
            );
          })}
          {visibleTpls.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-ink-700">
              No templates match the filters. <button onClick={() => { setTplQ(""); setTplState("all"); }} className="inline-flex items-center gap-1 text-accent-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"><X size={12} />clear filters</button>
            </div>
          )}
          </>
          );
        })()}
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
        <Modal title={editTpl ? `Edit ${editTpl.name}` : "New template"} onClose={() => { setShowTplForm(false); setEditTpl(null); }}>
          <Field label="Name"><input value={tplDraft.name} onChange={(e) => setTplDraft({ ...tplDraft, name: e.target.value })} className={inp} /></Field>
          <Field label="Description"><input value={tplDraft.description} onChange={(e) => setTplDraft({ ...tplDraft, description: e.target.value })} className={inp} /></Field>
          <Field label="Line — the tables below come from here">
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={tplLineSearch}
                onChange={(e) => { setTplLineSearch(e.target.value); setShowLineSug(true); }}
                onFocus={() => setShowLineSug(true)}
                onBlur={() => setShowLineSug(false)}
                placeholder="Search lines by name or id…"
                className="w-full rounded-lg border border-slate-300 bg-transparent py-3 pl-10 pr-3 text-base focus:border-accent-500 focus:outline-none dark:border-ink-700"
              />
              {showLineSug && (() => {
                const q = tplLineSearch.trim().toLowerCase();
                const scored = lines.map((l) => {
                  if (!q) return { l, score: 0 };
                  const fields = [l.id, l.name, ...l.memberTables];
                  let best = -1;
                  for (const f of fields) {
                    const fl = f.toLowerCase();
                    if (fl.startsWith(q)) { best = Math.max(best, 2); break; }
                    if (fl.includes(q)) best = Math.max(best, 1);
                  }
                  return { l, score: best };
                }).filter((s) => (q ? s.score > 0 : true));
                scored.sort((a, b) => b.score - a.score);
                const hits = scored.slice(0, 8).map((s) => s.l);
                if (hits.length === 0) return null;
                return (
                  <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-900">
                    {hits.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onMouseDown={() => { setTplPickLine(l.id); setTplLineSearch(`${l.id} — ${l.name}`); setShowLineSug(false); }}
                        className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-100 focus:outline-none dark:hover:bg-ink-800 ${l.id === tplPickLine ? "bg-slate-50 dark:bg-ink-800/60" : ""}`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${l.active ? "bg-state-ok" : "bg-slate-300 dark:bg-ink-600"}`} title={l.active ? "ingesting" : "deregistered"} />
                        <span className="font-medium">{l.name}</span>
                        <span className="font-mono text-xs text-slate-400">{l.id}</span>
                        <span className="tnum ml-auto text-xs text-slate-400">{l.memberTables.length} tables</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            {(() => {
              const pick = lines.find((l) => l.id === tplPickLine) ?? lines[0];
              if (!pick) return null;
              return (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="tnum text-sm text-slate-500">
                    <span className="font-mono">{pick.id}</span> · {pick.memberTables.length} tables — click to insert:
                  </span>
                  {pick.memberTables.length === 0 && <span className="text-sm text-slate-400">no tables on this line — add some in Lines first</span>}
                  {pick.memberTables.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => insertAtCursor(tplSqlRef, tplDraft.sqlTemplate, (v) => setTplDraft({ ...tplDraft, sqlTemplate: v }), m)}
                      title={`Insert ${m} at cursor`}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 font-mono text-sm transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:border-ink-700 dark:hover:bg-ink-800"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              );
            })()}
          </Field>
          <Field label="SQL template ({{from}} / {{to}} for windowed test-runs)">
            <SqlHint
              onInsert={(sql) => {
                if (tplDraft.sqlTemplate.trim() && !confirm("Replace the current SQL template with this example?")) return;
                setTplDraft({ ...tplDraft, sqlTemplate: sql });
              }}
            />
            {(() => {
              const pick = lines.find((l) => l.id === tplPickLine) ?? lines[0];
              const members = pick?.memberTables ?? [];
              return (
                <div className="relative rounded-lg border border-slate-300 transition-colors focus-within:border-accent-500 dark:border-ink-700">
                  <pre
                    aria-hidden
                    className="m-0 min-h-[10rem] whitespace-pre-wrap break-words p-3 font-mono text-sm leading-relaxed text-slate-800 dark:text-ink-100"
                  >
                    {tokenizeSqlTables(tplDraft.sqlTemplate).map((tok, i) => (
                      tok.kind === "text"
                        ? <span key={i}>{tok.text}</span>
                        : matchMember(tok.ref, members)
                          ? <code key={i} className="rounded bg-accent-500/15 px-1 text-accent-500 ring-1 ring-accent-500/40">{tok.ref}</code>
                          : <code key={i} className="rounded bg-state-warn/15 px-1 text-state-warn ring-1 ring-state-warn/40" title="not on the picked line">{tok.ref}</code>
                    ))}
                    {"\n"}
                  </pre>
                  <textarea
                    ref={tplSqlRef}
                    value={tplDraft.sqlTemplate}
                    onChange={(e) => setTplDraft({ ...tplDraft, sqlTemplate: e.target.value })}
                    placeholder="SELECT avg(temp_c) FROM readings_temp WHERE ts >= '{{from}}' AND ts < '{{to}}'"
                    spellCheck={false}
                    className="absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent p-3 font-mono text-sm leading-relaxed text-transparent caret-slate-800 selection:bg-accent-500/30 focus:outline-none dark:caret-slate-100 dark:selection:bg-accent-500/40 placeholder:text-slate-400"
                  />
                </div>
              );
            })()}
            <div className="mt-1 text-[11px] text-slate-400">table names light up inside the box — teal = on the picked line, amber = missing there. Swap per line at Instantiate → line.</div>
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
          <Field label="Retain context (shown alongside each stored fact — copies inherit this)"><input value={tplDraft.context} onChange={(e) => setTplDraft({ ...tplDraft, context: e.target.value })} placeholder="e.g. hourly temperature rollup" className={inp} /></Field>
          {editTpl && tplDraft.sqlTemplate !== editTpl.sqlTemplate && (
            <div className="rounded-lg border border-state-warn/40 px-3 py-2 text-xs text-slate-500">
              Saving this SQL bumps the template to <b>v{editTpl.version + 1}</b>. Copies keep their current SQL and show as <b>stale</b> until you Check / Apply.
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => { setShowTplForm(false); setEditTpl(null); }} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel</button>
            <Btn variant="primary" icon={Save} onClick={() => void act(() => {
              const ref = lines.find((l) => l.id === tplPickLine) ?? lines[0];
              const body = { ...tplDraft, referenceLineId: ref?.id ?? null };
              return (editTpl ? cardApi.updateTemplate(editTpl.id, body) : cardApi.createTemplate(body)).then(() => { setShowTplForm(false); setEditTpl(null); });
            })}>{editTpl ? "Save changes" : "Save template"}</Btn>
          </div>
        </Modal>
      )}

      {instTpl && (() => {
        const line = lines.find((l) => l.id === instLine);
        const members = line?.memberTables ?? [];
        const { refs, mapping, blocked, preview, tables } = remapState(instTpl.sqlTemplate, members, instMap);
        return (
        <Modal title={`Instantiate "${instTpl.name}"`} onClose={() => setInstTpl(null)}>
          <Field label="Target line">
            <select value={instLine} onChange={(e) => { setInstLine(e.target.value); setInstMap({}); }} className={inp}>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
            </select>
            {(() => {
              const tl = lines.find((l) => l.id === instLine);
              if (!tl) return null;
              return (
                <div className="mt-1 text-xs text-slate-500">
                  attached tables:{" "}
                  {tl.memberTables.length === 0
                    ? <span className="text-slate-400">none — add some in Lines first</span>
                    : tl.memberTables.map((m) => (
                      <span key={m} className="mr-1 font-mono text-slate-500 dark:text-ink-300">{m}</span>
                    ))}
                </div>
              );
            })()}
          </Field>
          <RemapTables sql={instTpl.sqlTemplate} members={members} map={instMap} setMap={setInstMap} />
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

      {showAdd && (() => {
        const line = lines.find((l) => l.id === addLine);
        const members = line?.memberTables ?? [];
        const q = addQ.trim().toLowerCase();
        const rows = templates
          .filter((t) => {
            if (!q) return true;
            return `${t.name} ${t.description ?? ""} ${t.sqlTemplate ?? ""}`.toLowerCase().includes(q);
          })
          .map((t) => {
            const existing = cards.find((c) => c.templateId === t.id && c.lineId === addLine);
            const already = !!existing;
            const rs = remapState(t.sqlTemplate, members, addMaps[t.id] ?? {});
            return { t, already, existingId: existing?.id ?? null, ...rs };
          });
        const addable = rows.filter((r) => !r.already && !r.blocked && members.length > 0 && addChecked.includes(r.t.id));
        function closeAdd() {
          setShowAdd(false);
          setAddMaps({});
          setAddChecked([]);
          setAddDone(null);
        }
        return (
        <Modal title="Add features to a line" onClose={closeAdd}>
          <Field label="Line — copies live here">
            <select value={addLine} onChange={(e) => { setAddLine(e.target.value); setAddMaps({}); setAddChecked([]); setAddDone(null); }} className={inp}>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
            </select>
            {line && (
              <div className="mt-2 rounded-lg bg-slate-100 p-2.5 dark:bg-ink-800">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-accent-500/15 p-1.5 text-accent-500"><Database size={15} /></span>
                  <span className="text-sm font-semibold text-accent-500">{line.connectionLabel}</span>
                  <span className="font-mono text-xs text-slate-400">{line.connectionId}</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-slate-400">
                  <Table2 size={13} />Tables on this line · <span className="tnum">{members.length}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {members.length === 0
                    ? <span className="text-xs text-slate-400">no tables — add some in Lines first</span>
                    : members.map((m) => (
                      <span key={m} className="inline-flex items-center gap-1 rounded-full bg-accent-500/10 px-2 py-0.5 font-mono text-xs text-accent-400 ring-1 ring-accent-500/30"><Table2 size={11} />{m}</span>
                    ))}
                </div>
              </div>
            )}
            {lines.length === 0 && <div className="mt-1 text-xs text-slate-400">no lines yet — register one in Lines first</div>}
          </Field>
          <Field label="Templates — SQL, granularity and thresholds stay in the template">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-500" />
              <input
                value={addQ}
                onChange={(e) => setAddQ(e.target.value)}
                placeholder="Search features…"
                className="w-full rounded-xl border border-slate-200 bg-slate-100 py-2 pl-9 pr-3 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-ink-700 dark:bg-ink-800"
              />
            </div>
          </Field>
          {rows.length === 0 && <div className="text-sm text-slate-400">no templates match — create one in the Templates tab first</div>}
          <div className="flex max-h-80 flex-col gap-2 overflow-auto">
            {rows.map((r) => {
              const selected = addChecked.includes(r.t.id);
              return (
              <div key={r.t.id} className={`rounded-xl border p-3 text-sm transition-colors ${r.already ? "border-slate-200 opacity-60 dark:border-ink-800" : selected ? "border-accent-500/50 bg-accent-500/5" : "border-slate-200 hover:border-accent-500/40 dark:border-ink-800"}`}>
                <label className={`flex cursor-pointer items-center gap-2.5 ${r.already ? "cursor-default" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={r.already || r.blocked || members.length === 0}
                    onChange={() => setAddChecked((s) => s.includes(r.t.id) ? s.filter((x) => x !== r.t.id) : [...s, r.t.id])}
                    className="h-4 w-4 shrink-0 accent-teal-500"
                  />
                  <span className={`rounded-md p-1.5 ${selected && !r.already ? "bg-accent-500/15 text-accent-500" : "bg-slate-100 text-slate-400 dark:bg-ink-800"}`}><LayoutTemplate size={16} /></span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.t.name}</span>
                    <span className="tnum block text-xs text-slate-400">{r.t.granularity}{r.t.unit ? ` · ${r.t.unit}` : ""}{r.t.description ? ` · ${r.t.description}` : ""}</span>
                  </span>
                  <span className="ml-auto shrink-0">
                    {r.already && r.existingId
                      ? <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); goToCopy(r.t.id, r.existingId as string); }} title="Already on this line — open the existing copy instead of adding again" className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"><StatusChip tone="mute">added ✓ view →</StatusChip></button>
                      : r.already
                        ? <StatusChip tone="mute">added ✓</StatusChip>
                        : members.length === 0
                          ? <StatusChip tone="mute">no tables</StatusChip>
                          : r.blocked
                            ? <StatusChip tone="warn">needs mapping</StatusChip>
                            : <StatusChip tone="ok">ready</StatusChip>}
                  </span>
                </label>
                {!r.already && r.refs.length > 0 && (
                  <div className="mt-2">
                    <RemapTables
                      sql={r.t.sqlTemplate}
                      members={members}
                      map={addMaps[r.t.id] ?? {}}
                      setMap={(m) => setAddMaps((all) => ({ ...all, [r.t.id]: m }))}
                    />
                  </div>
                )}
              </div>
              );
            })}
          </div>
          {addDone && (
            <div className="anim-fade-in mt-2 rounded-lg border border-slate-200 p-2.5 text-sm dark:border-ink-800">
              <span className="font-medium text-state-ok">{addDone.ok.length} added dormant</span>
              {addDone.failed.map((f) => (
                <div key={f.id} className="mt-1 text-xs text-state-bad">{f.name}: {f.error}</div>
              ))}
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={closeAdd} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">close</button>
            <Btn
              variant="primary"
              icon={ArrowRight}
              disabled={addable.length === 0 || addBusy}
              loading={addBusy}
              title={members.length === 0 ? "This line has no member tables yet" : addable.length === 0 ? "Check ready templates above" : `Create ${addable.length} dormant ${addable.length === 1 ? "copy" : "copies"} with mapped tables`}
              onClick={() => void (async () => {
                setAddBusy(true);
                setError(null);
                const ok: string[] = [];
                const failed: { id: string; name: string; error: string }[] = [];
                for (const r of addable) {
                  try {
                    await cardApi.instantiate(
                      r.t.id,
                      r.refs.length > 0 ? { lineId: addLine, sql: r.preview, tables: r.tables } : { lineId: addLine },
                    );
                    ok.push(r.t.id);
                  } catch (e) {
                    failed.push({ id: r.t.id, name: r.t.name, error: (e as Error).message });
                  }
                }
                setAddDone({ ok, failed });
                setAddChecked([]);
                setAddBusy(false);
                await refresh();
              })()}
            >
              {addBusy ? "adding…" : `Add ${addable.length} dormant`}
            </Btn>
          </div>
        </Modal>
        );
      })()}

      {dupTpl && (() => {
        const line = lines.find((l) => l.id === dupLine);
        const members = line?.memberTables ?? [];
        const ds = remapState(dupTpl.sqlTemplate, members, dupMap);
        return (
        <Modal title={`Duplicate "${dupTpl.name}" onto a line`} onClose={() => setDupTpl(null)}>
          <Field label="Line — the new copy lives here">
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={dupSearch}
                onChange={(e) => { setDupSearch(e.target.value); setDupSug(true); }}
                onFocus={() => setDupSug(true)}
                onBlur={() => setDupSug(false)}
                placeholder={line ? `${line.id} — ${line.name}` : "Search lines by name or id…"}
                className="w-full rounded-lg border border-slate-300 bg-transparent py-3 pl-10 pr-3 text-base focus:border-accent-500 focus:outline-none dark:border-ink-700"
              />
              {dupSug && (() => {
                const q = dupSearch.trim().toLowerCase();
                const scored = lines.map((l) => {
                  if (!q) return { l, score: 0 };
                  const fields = [l.id, l.name, ...l.memberTables];
                  let best = -1;
                  for (const f of fields) {
                    const fl = f.toLowerCase();
                    if (fl.startsWith(q)) { best = Math.max(best, 2); break; }
                    if (fl.includes(q)) best = Math.max(best, 1);
                  }
                  return { l, score: best };
                }).filter((s) => (q ? s.score > 0 : true));
                scored.sort((a, b) => b.score - a.score);
                const hits = scored.slice(0, 8).map((s) => s.l);
                if (hits.length === 0) return null;
                return (
                  <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-900">
                    {hits.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onMouseDown={() => { setDupLine(l.id); setDupMap({}); setDupSearch(""); setDupSug(false); }}
                        className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-100 focus:outline-none dark:hover:bg-ink-800 ${l.id === dupLine ? "bg-slate-50 dark:bg-ink-800/60" : ""}`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${l.active ? "bg-state-ok" : "bg-slate-300 dark:bg-ink-600"}`} />
                        <span className="font-medium">{l.name}</span>
                        <span className="font-mono text-xs text-slate-400">{l.id}</span>
                        <span className="tnum ml-auto text-xs text-slate-400">{l.memberTables.length} tables</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            {line && (
              <div className="mt-1 text-xs text-slate-500">
                attached tables:{" "}
                {members.length === 0
                  ? <span className="text-slate-400">none — add some in Lines first</span>
                  : members.map((m) => (
                    <span key={m} className="mr-1 font-mono text-slate-500 dark:text-ink-300">{m}</span>
                  ))}
              </div>
            )}
          </Field>
          <Field label="Copy name"><input value={dupName} onChange={(e) => setDupName(e.target.value)} className={inp} /></Field>
          <RemapTables sql={dupTpl.sqlTemplate} members={members} map={dupMap} setMap={setDupMap} />
          <p className="mt-2 text-sm text-slate-500">Creates an independent dormant copy on {dupLine || "…"} — edit its tables above, test it, then go live.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setDupTpl(null)} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel</button>
            <Btn
              variant="primary"
              icon={Copy}
              disabled={ds.blocked || members.length === 0 || !dupLine || !dupName.trim()}
              title={members.length === 0 ? "This line has no member tables yet" : ds.blocked ? "Map every table above first" : "Create the dormant copy on this line"}
              onClick={() => void act(() => cardApi.instantiate(
                dupTpl.id,
                ds.refs.length > 0 ? { lineId: dupLine, name: dupName.trim(), sql: ds.preview, tables: ds.tables } : { lineId: dupLine, name: dupName.trim() },
              ).then(() => { setDupTpl(null); setDupMap({}); setTab("cards"); }))}
            >
              Create dormant copy
            </Btn>
          </div>
        </Modal>
        );
      })()}

      {showCardForm && editCard && (
        <Modal title={`Edit ${editCard.name} (dormant)`} onClose={() => setShowCardForm(false)}>
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
          <Field label="Retain context (shown alongside each stored fact)"><input value={cardDraft.context} onChange={(e) => setCardDraft({ ...cardDraft, context: e.target.value })} placeholder="e.g. hourly temperature rollup" className={inp} /></Field>
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
                if (!editCard) return Promise.resolve();
                const body = {
                  name: cardDraft.name,
                  tables: cardDraft.tables.split(",").map((s) => s.trim()).filter(Boolean),
                  sql: cardDraft.sql, granularity: cardDraft.granularity,
                  unit: cardDraft.unit, extractHint: cardDraft.extractHint,
                  context: cardDraft.context,
                  threshold: cardDraft.threshold === "" ? null : Number(cardDraft.threshold),
                  changeMode: cardDraft.changeMode, reingestFrom: cardDraft.reingestFrom || undefined,
                };
                return cardApi.updateCard(editCard.id, body).then(() => setShowCardForm(false));
              })}
            >
              Save dormant
            </Btn>
          </div>
        </Modal>
      )}

      {graphCard && (
        <GraphDesigner card={graphCard} template={templates.find((t) => t.id === graphCard.templateId) ?? null} onClose={() => { setGraphCard(null); refresh(); }} />
      )}

      {specificsCard && (
        <SpecificsModal
          card={specificsCard}
          templateName={specificsCard.templateId ? (templates.find((t) => t.id === specificsCard.templateId)?.name ?? specificsCard.templateId) : null}
          line={lines.find((l) => l.id === specificsCard.lineId)}
          onClose={() => setSpecificsCard(null)}
          onSaved={() => { setSpecificsCard(null); void refresh(); }}
        />
      )}

      {previewCopy && (
        <LinePreview
          line={previewCopy.line}
          initialTemplateId={previewCopy.tpl.id}
          onClose={() => setPreviewCopy(null)}
        />
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

      {testPopup && (
        <Modal title={`Test result — ${testPopup.card.name}`} onClose={() => setTestPopup(null)}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>line <span className="font-mono">{testPopup.card.lineId}</span></span>
            <span className="tnum">v{testPopup.card.version}</span>
            <StatusChip tone={testPopup.card.status === "live" ? "ok" : "mute"}>{testPopup.card.status}</StatusChip>
            <span>last 24h window · preview 50</span>
          </div>
          {testPopup.error ? (
            <AlertBanner tone="bad" title="Test failed" detail={testPopup.error} />
          ) : testPopup.result ? (
            <>
              <div className="tnum text-sm font-semibold">{testPopup.result.rowCount} rows</div>
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-ink-800">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-ink-800">
                      {testPopup.result.columns.map((x) => <th key={x} className="px-2 py-1 font-semibold">{x}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {testPopup.result.rows.map((row, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-ink-800">
                        {testPopup.result!.columns.map((x) => <td key={x} className="px-2 py-1">{String(row[x] ?? "")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {testPopup.result.rowCount === 0 && <div className="text-xs text-slate-400">0 rows in the last 24h — try a different window or check the line's data.</div>}
            </>
          ) : null}
          <div className="flex justify-end">
            <button onClick={() => setTestPopup(null)} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">close</button>
          </div>
        </Modal>
      )}

      {detailCard && (
        <CardDetails
          card={detailCard}
          template={templates.find((t) => t.id === detailCard.templateId) ?? null}
          line={lines.find((l) => l.id === detailCard.lineId) ?? null}
          graphs={cardGraphs[detailCard.id] ?? []}
          bankReady={!!banks[detailCard.lineId]?.ready}
          onClose={() => setDetailCard(null)}
          onGraphsChanged={(gs) => setCardGraphs((m) => ({ ...m, [detailCard.id]: gs }))}
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

/**
 * Specifics — per-feature ingest tuning (per-call side of the Hindsight
 * split). Extract hint, threshold, unit, and retain context ride on every
 * tick's retain items; the 8 auto tags preview shows how Hindsight will
 * file each fact. Bank settings (missions, vocab, directives) stay on the
 * line — this panel never touches them. Dormant cards editable, live read-only.
 */
function SpecificsModal({ card, templateName, line, onClose, onSaved }: {
  card: Card;
  templateName: string | null;
  line: Line | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const live = card.status === "live";
  const [draft, setDraft] = useState({
    extractHint: card.extractHint ?? "",
    context: card.context ?? "",
    unit: card.unit ?? "",
    threshold: card.threshold != null ? String(card.threshold) : "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tags = [
    `line:${card.lineId}`,
    `card:${card.name}`,
    `cardVersion:${card.version}`,
    `connection:${line?.connectionId ?? "…"}`,
    "measure: per-tick",
    `unit:${draft.unit || "none"}`,
    `granularity:${card.granularity}`,
    "breach: per-tick",
  ];
  async function onSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await cardApi.updateCard(card.id, {
        extractHint: draft.extractHint,
        context: draft.context,
        unit: draft.unit,
        threshold: draft.threshold === "" ? null : Number(draft.threshold),
      });
      onSaved();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const ro = "mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-ink-800 dark:bg-ink-800/50 dark:text-ink-200";
  return (
    <Modal title={`Specifics — ${card.name}`} onClose={onClose}>
      <div className="text-xs text-slate-500">
        per-ingest tuning for this feature · applies to every tick's retained facts
        {templateName && <span> · inherited from template <b>{templateName}</b> at registration (frozen — re-register to pick up template changes)</span>}
      </div>
      {live && (
        <div className="rounded-lg border border-state-warn/40 bg-state-warn/10 px-3 py-2 text-xs text-state-warn">
          Live card — read-only. Take it dormant to tune.
        </div>
      )}
      {saveError && <div className="rounded-lg border border-state-bad/40 bg-state-bad/10 px-3 py-2 text-xs text-state-bad">{saveError}</div>}
      <Field label="Extraction hint (guides the per-tick fact extractor)">
        {live
          ? <div className={ro}>{draft.extractHint || "—"}</div>
          : <textarea rows={2} value={draft.extractHint} onChange={(e) => setDraft({ ...draft, extractHint: e.target.value })} className={inp} />}
      </Field>
      <Field label="Retain context (shown alongside each stored fact)">
        {live
          ? <div className={ro}>{draft.context || "—"}</div>
          : <input value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} placeholder="e.g. hourly temperature rollup" className={inp} />}
      </Field>
      <div className="flex gap-3">
        <Field label="Unit">
          {live
            ? <div className={ro}>{draft.unit || "—"}</div>
            : <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="°C, pcs…" className={inp} />}
        </Field>
        <Field label="Threshold (breach flag)">
          {live
            ? <div className={ro}>{draft.threshold || "—"}</div>
            : <input value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: e.target.value })} placeholder="warn above…" className={inp} />}
        </Field>
      </div>
      <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-ink-800">
        <div className="font-medium">Auto tags on every retained fact</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-full bg-accent-500/10 px-2 py-0.5 font-mono text-[11px] text-accent-500 ring-1 ring-accent-500/30">{t}</span>
          ))}
        </div>
        <div className="mt-1 text-[11px] text-slate-400">measure + breach resolve per tick from the result rows — the rest are fixed per card.</div>
      </div>
      <div className="mt-1 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">close</button>
        {!live && <Btn variant="primary" icon={Save} onClick={() => void onSave()} loading={saving} disabled={saving}>Save specifics</Btn>}
      </div>
    </Modal>
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
  const [tblPick, setTblPick] = useState("");
  const sqlRef = useRef<HTMLTextAreaElement>(null);
  const pgLine = lines.find((l) => l.id === lineId);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="block text-sm">
          Line
          <select value={lineId} onChange={(e) => setLineId(e.target.value)} className="ml-2 w-64 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700">
            <option value="">— select line —</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
          </select>
        </label>
        {pgLine && pgLine.memberTables.length > 0 && (
          <label className="block text-sm">
            Tables <span className="tnum text-xs text-slate-400">({pgLine.memberTables.length} attached)</span>
            <select
              value={tblPick}
              onChange={(e) => {
                if (e.target.value) insertAtCursor(sqlRef, sql, setSql, e.target.value);
                setTblPick("");
              }}
              title="Pick a table to insert its name into the query"
              className="ml-2 w-64 rounded-lg border border-slate-300 bg-transparent px-3 py-2 font-mono text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
            >
              <option value="">— insert table… —</option>
              {pgLine.memberTables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
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
        <textarea ref={sqlRef} rows={6} value={sql} onChange={(e) => setSql(e.target.value)} placeholder="SELECT * FROM readings_temp LIMIT 50" className="w-full rounded-lg border border-slate-300 bg-transparent p-3 font-mono text-sm dark:border-ink-700" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onRun(); }} />
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

/** Template chart suggestions: one-time LLM recommendation per feature.
 *  Runs against the reference line; stored on the template; enabled ones are
 *  inherited by cards at instantiate time (top-2 enabled feed RAG). */
function TemplateCharts({ template, onChanged }: { template: CardTemplate; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ model: string | null; heuristic: boolean; reason: string | null } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [sample, setSample] = useState<TestResult | null>(null);
  const [sampledAt, setSampledAt] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution>("hourly");

  async function onRecommend() {
    setBusy(true);
    setError(null);
    try {
      const r = await chartApi.recommendTemplate(template.id);
      setMeta({ model: r.model, heuristic: r.heuristic, reason: r.reason });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(i: number, on: boolean) {
    const next = (template.chartSuggestions ?? []).map((s, j) => (j === i ? on : s.enabled !== false));
    try {
      await chartApi.setSuggestions(template.id, next);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadSample(res: Resolution = resolution) {
    setPreviewLoading(true);
    setSampleError(null);
    try {
      const w = windowForResolution(res);
      setSample(await chartApi.sampleTemplate(template.id, w.from, w.to));
      setSampledAt(new Date().toISOString());
    } catch (e) {
      setSampleError((e as Error).message);
      setSample(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  function openPreview() {
    setModalOpen(true);
    void loadSample("hourly");
  }

  function changeResolution(res: Resolution) {
    setResolution(res);
    void loadSample(res);
  }

  const sug = template.chartSuggestions ?? [];
  // Rank among enabled only — top-2 enabled feed RAG on new cards.
  const enabledRank = new Map<number, number>();
  sug.forEach((s, i) => {
    if (s.enabled !== false) enabledRank.set(i, enabledRank.size);
  });
  const enabledCount = enabledRank.size;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-ink-800">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">Chart suggestions</div>
        {meta && (
          <span
            className="rounded-full bg-accent-500/10 px-2 py-0.5 text-xs text-accent-500 ring-1 ring-accent-500/30"
            title={meta.heuristic ? `Heuristic fallback — ${llmReasonText(meta.reason)}` : `Recommended by ${meta.model ?? "LLM"}`}
          >
            {meta.heuristic ? "heuristic" : `LLM · ${meta.model}`}
          </span>
        )}
        {sug.length > 0 && <span className="text-xs text-slate-400">{sug.length} ranked · checked ones inherit to new cards</span>}
        <div className="ml-auto flex gap-2">
          {sug.length > 0 && (
            <Btn size="sm" icon={Eye} onClick={openPreview} title="Open the separate preview screen: big charts, explanations, refreshable data.">
              Preview charts
            </Btn>
          )}
          <Btn size="sm" icon={Sparkles} onClick={() => void onRecommend()} loading={busy} disabled={busy} title={template.referenceLineId ? "Recommend once from the reference line's data. Stores ranked candidates on this feature." : "Set a reference line first — recommendations run on its data."}>
            {sug.length > 0 ? "Re-recommend" : "Recommend charts"}
          </Btn>
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-state-bad">{error}</div>}
      {!template.referenceLineId && sug.length === 0 && (
        <div className="mt-1 text-xs text-slate-400">Set a reference line on this feature first — recommendations run once on its sample rows.</div>
      )}
      {sug.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {sug.map((s, i) => {
            const on = s.enabled !== false;
            const rank = enabledRank.get(i);
            return (
              <label key={i} className={`anim-pop-in flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition-colors ${on ? "border-accent-500/50 bg-accent-500/5" : "border-slate-200 opacity-60 dark:border-ink-800"}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => void onToggle(i, !on)}
                  title="Inherit this suggestion on new cards"
                  className="mt-1 h-4 w-4 shrink-0 accent-teal-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip tone="accent">{s.chartType}</StatusChip>
                    {rank != null && rank < 2 && <span className="rounded-full bg-state-ok/10 px-1.5 py-px text-[10px] text-state-ok ring-1 ring-state-ok/30">auto top-{rank + 1}</span>}
                    <span className="font-medium">{s.title}</span>
                    <span className="text-xs text-slate-400">x:{s.xColumn} y:{s.yColumns.join(",") || "—"}</span>
                  </div>
                  {s.rationale && <div className="mt-0.5 text-xs text-slate-500">{s.rationale}</div>}
                  {s.conditions && <div className="mt-0.5 text-xs text-accent-500/90">◷ {s.conditions}</div>}
                </div>
              </label>
            );
          })}
        </div>
      )}
      {modalOpen && (
        <ChartPreviewModal
          title={`Preview — ${template.name}`}
          subtitle={`Feature charts on reference line ${template.referenceLineId ?? "—"} · same specs inherit to cards`}
          items={sug.map((s, i) => {
            const on = s.enabled !== false;
            const rank = enabledRank.get(i);
            return {
              key: `${i}`,
              chartType: s.chartType,
              xColumn: s.xColumn,
              yColumns: s.yColumns,
              title: s.title,
              rationale: s.rationale,
              conditions: s.conditions,
              badges: rank != null && rank < 2 ? [{ text: `auto top-${rank + 1}`, tone: "ok" as const }] : [],
              checked: on,
              onToggle: (v: boolean) => void onToggle(i, v),
              xLabel: s.xColumn,
              yLabel: s.yColumns.length > 0 ? `${s.yColumns.join(", ")}${template.unit ? ` (${template.unit})` : ""}` : undefined,
              units: template.unit || undefined,
            };
          })}
          sample={sample}
          sampledAt={sampledAt}
          loadingSample={previewLoading}
          sampleError={sampleError}
          summary={`${enabledCount} of ${sug.length} checked`}
          resolution={resolution}
          onResolutionChange={changeResolution}
          onRefresh={() => void loadSample()}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

/** Graph designer: pick chart type + axes from a card's test-run results, save spec. */
function GraphDesigner({ card, template, onClose }: { card: Card; template: CardTemplate | null; onClose: () => void }) {
  const [graphs, setGraphs] = useState<GraphSpec[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "", chartType: "table" as ChartType, xColumn: "", yColumns: [] as string[], title: "",
  });
  const [editing, setEditing] = useState<string | null>(null);
  // One-time LLM suggestion state: candidates from the card's own test-run.
  const [suggesting, setSuggesting] = useState(false);
  const [candidates, setCandidates] = useState<{ list: ChartSuggestion[]; model: string | null; heuristic: boolean; reason: string | null } | null>(null);
  const [checkedCand, setCheckedCand] = useState<number[]>([]);
  // Template-chart preview (viewer mode): big charts rendered on this card's sample.
  const [chartModal, setChartModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
        // Render by default: temporal X -> line, else bar; first numeric Y.
        const nums = numericColumns(t.rows, t.columns);
        setDraft((d) => {
          if (d.xColumn || d.yColumns.length > 0) return d;
          const x = t.columns.find(isTemporalName) ?? t.columns[0];
          const y = nums.slice(0, 1);
          return { ...d, xColumn: x, yColumns: y, chartType: defaultChartType(x, y.length > 0) };
        });
      }
    });
  }, [card.id]);

  const cols = testResult?.columns ?? [];
  const numCols = testResult ? numericColumns(testResult.rows, cols) : [];
  // Template-stamped cards are viewers: the template owns chart settings, so
  // no manual draft and no card-level recommend here. Scratch (template-less)
  // cards keep the full designer — nothing exists to contradict.
  const isTemplated = template != null;
  // Enabled-rank among the template's suggestions (mirrors TemplateCharts:
  // rank < 2 feeds RAG on new cards).
  const tplSug = template?.chartSuggestions ?? [];
  const tplRank = new Map<number, number>();
  tplSug.forEach((s, i) => { if (s.enabled !== false) tplRank.set(i, tplRank.size); });

  async function refreshTest() {
    setRefreshing(true);
    try {
      setTestResult(await cardApi.testCard(card.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function onRecommend() {
    setSuggesting(true);
    setError(null);
    try {
      const r = await chartApi.recommendCard(card.id);
      setCandidates({ list: r.suggestions, model: r.model, heuristic: r.heuristic, reason: r.reason });
      // Top-2 pre-selected for RAG; user adjusts freely.
      setCheckedCand(r.suggestions.map((_, i) => i).filter((i) => i < 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  async function onSaveCandidates() {
    try {
      for (const i of checkedCand) {
        const c = candidates?.list[i];
        if (!c) continue;
        await graphApi.create(card.id, {
          name: c.title || `Suggested ${c.chartType}`,
          chartType: c.chartType,
          xColumn: c.xColumn,
          yColumns: c.yColumns,
          title: c.title,
          config: {
            source: "ai-recommended",
            selected_for_rag: true,
            rationale: c.rationale,
            conditions: c.conditions,
            units: card.unit || undefined,
            threshold: card.threshold,
          },
        });
      }
      setGraphs(await graphApi.listForCard(card.id));
      setCandidates(null);
      setCheckedCand([]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onToggleRag(g: GraphSpec, on: boolean) {
    try {
      const updated = await graphApi.update(g.id, { config: { ...g.config, selected_for_rag: on } });
      setGraphs((gs) => gs.map((x) => (x.id === g.id ? updated : x)));
    } catch (e) {
      setError((e as Error).message);
    }
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
      // Scaffolding travels with the spec so the prompt builder later gets
      // rows + spec + meaning without new plumbing.
      const config = { units: card.unit || undefined, threshold: card.threshold };
      if (editing) {
        const cur = graphs.find((g) => g.id === editing);
        await graphApi.update(editing, { ...draft, config: { ...cur?.config, ...config } });
      } else {
        await graphApi.create(card.id, { ...draft, config: { source: "manual", selected_for_rag: true, ...config } });
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
          <h2 className="text-lg font-bold">{isTemplated ? "Graphs" : "Graph Designer"} — {card.name}</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-400 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">close</button>
        </div>
        {isTemplated && template && (
          <div className="mt-1 text-xs text-slate-500">charts live in the template <b>{template.name}</b> — shown here read-only, managed there.</div>
        )}

        {error && <div className="mt-3"><AlertBanner tone="bad" title="Error" detail={error} /></div>}

        {!testResult && !loading && (
          <div className="mt-4 rounded-lg border border-state-warn/40 bg-state-warn/10 p-3 text-sm text-state-warn">
            No test-run data yet — test the card first so column names appear below.
          </div>
        )}

        {testResult && !isTemplated && (
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
                  {numCols.map((c) => (
                    <button
                      key={c}
                      onClick={() => toggleY(c)}
                      className={`rounded px-2 py-0.5 text-xs ${draft.yColumns.includes(c) ? "bg-accent-500/20 text-accent-400 ring-1 ring-accent-500/30" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800"}`}
                    >
                      {c}
                    </button>
                  ))}
                  {numCols.length === 0 && <span className="text-xs text-slate-400">no numeric columns</span>}
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
                {isTradingEligible(testResult.rows, draft.xColumn, draft.yColumns, draft.chartType) ? (
                  <TradingChart rows={testResult.rows} x={draft.xColumn} yCols={draft.yColumns} type={draft.chartType as "line" | "area"} title={draft.title} threshold={card.threshold} height={220} units={card.unit || undefined} />
                ) : (
                  <Chart rows={testResult.rows} x={draft.xColumn} yCols={draft.yColumns} type={draft.chartType} title={draft.title} threshold={card.threshold} />
                )}
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

        {testResult && (
          <div className="mt-4 rounded-lg border border-accent-500/30 bg-accent-500/5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold">{isTemplated ? "Template charts" : "Chart suggestions"}</div>
              {candidates && (
                <span
                  className="rounded-full bg-accent-500/10 px-2 py-0.5 text-xs text-accent-500 ring-1 ring-accent-500/30"
                  title={candidates.heuristic ? `Heuristic fallback — ${llmReasonText(candidates.reason)}` : `Recommended by ${candidates.model ?? "LLM"}`}
                >
                  {candidates.heuristic ? "heuristic" : `LLM · ${candidates.model}`}
                </span>
              )}
              <div className="ml-auto flex gap-2">
                {isTemplated && tplSug.length > 0 && (
                  <Btn size="sm" icon={Eye} onClick={() => setChartModal(true)} title="Open the big charts screen: template charts rendered on this copy's data.">
                    Preview charts
                  </Btn>
                )}
                {!isTemplated && (
                  <Btn size="sm" icon={Sparkles} onClick={() => void onRecommend()} loading={suggesting} disabled={suggesting} title="One-time LLM recommendation for this card's data shape. Never auto-stores.">
                    {candidates ? "Re-recommend" : "Recommend charts"}
                  </Btn>
                )}
              </div>
            </div>
            {!candidates && !isTemplated && (
              <div className="mt-1 text-xs text-slate-500">Ranked candidates with reasoning appear here — check the ones RAG should use (top-2 pre-checked).</div>
            )}
            {isTemplated && (
              <div className="mt-1 text-xs text-slate-500">These charts live in the template — recommend and design happen there.</div>
            )}
            {candidates && !isTemplated && (
              <div className="mt-3 flex flex-col gap-2">
                {candidates.list.map((c, i) => (
                  <label key={i} className={`anim-pop-in flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm transition-colors ${checkedCand.includes(i) ? "border-accent-500/50 bg-accent-500/5" : "border-slate-200 dark:border-ink-800"}`}>
                    <input
                      type="checkbox"
                      checked={checkedCand.includes(i)}
                      onChange={() => setCheckedCand((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))}
                      className="mt-1 h-4 w-4 accent-teal-500"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusChip tone="accent">{c.chartType}</StatusChip>
                        {i < 2 && <span className="rounded-full bg-state-ok/10 px-1.5 py-px text-[10px] text-state-ok ring-1 ring-state-ok/30">auto top-{i + 1}</span>}
                        <span className="font-medium">{c.title}</span>
                        <span className="text-xs text-slate-400">x:{c.xColumn} y:{c.yColumns.join(",") || "—"}</span>
                      </div>
                      {c.rationale && <div className="mt-0.5 text-xs text-slate-500">{c.rationale}</div>}
                      {c.conditions && <div className="mt-0.5 text-xs text-accent-500/90">◷ {c.conditions}</div>}
                    </div>
                  </label>
                ))}
                <div className="flex justify-end">
                  <Btn variant="primary" size="sm" icon={Save} onClick={() => void onSaveCandidates()} disabled={checkedCand.length === 0}>
                    Save {checkedCand.length} selected as specs
                  </Btn>
                </div>
              </div>
            )}
            {isTemplated && template && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="text-xs text-slate-400">{tplSug.length} ranked · managed in the template</div>
                {tplSug.map((s, i) => {
                  const on = s.enabled !== false;
                  const rank = tplRank.get(i);
                  return (
                    <div key={i} className={`anim-pop-in rounded-lg border p-2 text-sm ${on ? "border-accent-500/50 bg-accent-500/5" : "border-slate-200 opacity-60 dark:border-ink-800"}`}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusChip tone="accent">{s.chartType}</StatusChip>
                        {rank != null && rank < 2 && <span className="rounded-full bg-state-ok/10 px-1.5 py-px text-[10px] text-state-ok ring-1 ring-state-ok/30">auto top-{rank + 1}</span>}
                        <span className="font-medium">{s.title}</span>
                        <span className="text-xs text-slate-400">x:{s.xColumn} y:{s.yColumns.join(",") || "—"}</span>
                        <span className="ml-auto rounded-full bg-accent-500/10 px-1.5 py-px text-[10px] text-accent-500 ring-1 ring-accent-500/30">from template</span>
                      </div>
                      {s.rationale && <div className="mt-0.5 text-xs text-slate-500">{s.rationale}</div>}
                      {s.conditions && <div className="mt-0.5 text-xs text-accent-500/90">◷ {s.conditions}</div>}
                      {testResult && s.chartType !== "table" && s.yColumns.length > 0 && (
                        <div className="ml-6 mt-1 max-w-md"><Chart rows={testResult.rows} x={s.xColumn} yCols={s.yColumns} type={s.chartType} height={90} compact /></div>
                      )}
                    </div>
                  );
                })}
                {tplSug.length === 0 && <div className="text-xs text-slate-400">This template has no chart suggestions yet — recommend them on its template first.</div>}
              </div>
            )}
            {chartModal && (
              <ChartPreviewModal
                title={`Charts — ${card.name}`}
                subtitle={`Template charts on ${card.lineId} · read-only, managed in the template`}
                items={tplSug.map((s, i) => {
                  const rank = tplRank.get(i);
                  return {
                    key: `${i}`,
                    chartType: s.chartType,
                    xColumn: s.xColumn,
                    yColumns: s.yColumns,
                    title: s.title,
                    rationale: s.rationale,
                    conditions: s.conditions,
                    badges: rank != null && rank < 2 ? [{ text: `auto top-${rank + 1}`, tone: "ok" as const }] : [],
                    checked: s.enabled !== false,
                    xLabel: s.xColumn,
                    yLabel: s.yColumns.length > 0 ? `${s.yColumns.join(", ")}${card.unit ? ` (${card.unit})` : ""}` : undefined,
                    units: card.unit || undefined,
                  };
                })}
                sample={testResult}
                sampledAt={card.lastTest?.at ?? null}
                loadingSample={refreshing}
                sampleError={null}
                summary={`${tplRank.size} of ${tplSug.length} enabled in template`}
                resolution={card.granularity === "shift" ? "hourly" : card.granularity}
                onResolutionChange={() => void refreshTest()}
                onRefresh={() => void refreshTest()}
                onClose={() => setChartModal(false)}
              />
            )}
          </div>
        )}
        {graphs.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-semibold">Saved graphs ({graphs.length}) <span className="font-normal text-xs text-slate-400">— checked feeds RAG prompts</span></div>
            {graphs.map((g) => {
              const cfg = (g.config ?? {}) as Record<string, unknown>;
              const rag = cfg.selected_for_rag !== false;
              const merged = cfg.merged === true;
              return (
                <div key={g.id} className="mt-2 rounded-lg border border-slate-100 p-2 text-sm dark:border-ink-800">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rag}
                      onChange={() => void onToggleRag(g, !rag)}
                      title="Feed this chart to RAG prompts"
                      className="h-4 w-4 accent-teal-500"
                    />
                    <StatusChip tone="accent">{g.chartType}</StatusChip>
                    {merged && <span className="rounded-full bg-violet-500/10 px-1.5 py-px text-[10px] text-violet-400 ring-1 ring-violet-500/30">merged</span>}
                    {(cfg.source as string) === "ai-recommended" && <span className="rounded-full bg-accent-500/10 px-1.5 py-px text-[10px] text-accent-500 ring-1 ring-accent-500/30">AI</span>}
                    <span className="font-medium">{g.name || g.title || "Untitled"}</span>
                    <span className="text-xs text-slate-400">x:{g.xColumn} y:{g.yColumns.join(",")}</span>
                    <span className="tnum text-xs text-slate-400">v{g.version}</span>
                    <div className="ml-auto flex gap-1">
                      <Btn size="sm" icon={Pencil} onClick={() => startEdit(g)}>edit</Btn>
                      <Btn size="sm" variant="bad" icon={Trash2} onClick={() => void onDelete(g.id)}>del</Btn>
                    </div>
                  </div>
                  {typeof cfg.rationale === "string" && cfg.rationale && <div className="ml-6 mt-0.5 text-xs text-slate-500">{cfg.rationale}</div>}
                  {testResult && !merged && (
                    <div className="ml-6 mt-1 max-w-md"><Chart rows={testResult.rows} x={g.xColumn} yCols={g.yColumns} type={g.chartType} height={90} compact /></div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {loading && <div className="mt-4 flex items-center gap-2 text-sm text-slate-400"><Spinner /> Loading test data…</div>}
      </div>
    </div>
  );
}
