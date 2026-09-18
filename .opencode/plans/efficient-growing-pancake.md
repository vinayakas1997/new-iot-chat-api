# Plan: Checkbox vs Analysed — keep Analysed on untick, no re-Analyse needed

## Context
User describes Register line → picks `reisher` line + `smoke` connection + tables → ticks `downtime_events` (or any) → `Analyse` → `Save to draft` → closes → shows green `Analyzed`. Now **unticks** the checkbox (or changes position) — still shows Analysed state, but on re-ticking it **requires same Analyse process again**. Asks why repeat — **checkbox should be independent, depend purely on isAnalysed, not wipe analysed**. Currently `Lines.tsx:143-158` wipes `draftMeanings` on every uncheck (even when analysed), so re-tick forces fresh `analyzeTableDraft`.

## Scope (this fix only)
- `frontend/src/screens/Lines.tsx` `toggleTable :143` + picker rendering `410-440` (`selected` vs `analyzed` conflated)
- `frontend/src/components/TableAnalyzeDialog.tsx` draft wiring (`initialMeanings` `:374`) — no change needed, just preserves map if kept
- No backend/DB change — `line_column_meta` for existing lines already persists orphan-free (`store.ts:80` `upsert`/`deleteLineTableMeta` never called, `updateLine :449` only patches `member_tables` JSON, so `refreshColumnMeta` would still return Analysed). This fix aligns draft pre-`createLine` behavior with persisted behavior.

## Investigation (read-only)

### Why re-tick loses Analysed (Register flow)
- `Lines.tsx:38` `draftMeanings: Record<string, Col[]>` in-memory only, flushed only on `createLine :169-172` `for([k,cols] of Object.entries(draftMeanings)) saveTableColumns`.
- `toggleTable :150-157` for `!editing`:
  ```ts
  const k=t.toLowerCase();
  setDraftMeanings(m=>{ if(!m[k]) return m; const {[k]:_omit,...rest}=m; return rest; });
  ```
  Unconditional delete on uncheck — regardless of `analyzed`. So `meta` at `418-420` recomputes `meta=editing?columnMeta[lower]: draftCols?{total,filled,analyzed}:undefined` → after wipe `draftCols===undefined` → `meta===undefined` → `hasAny` false → `not analyzed` + `Analyze` amber `429` (instead of green `Analyzed+Edit` `426-431`). Re-tick sets `memberTables` back but `draftMeanings` gone → dialog opens via `analyzeTableDraft + initialMeanings===undefined` `TableAnalyzeDialog.tsx:59-63`, blank requires full re-Analyse.

### Current render conflates checked vs analysed
- `416 selected=draft.memberTables.includes(key)` vs `420 analyzed=meta?.analyzed`
- `428 {selected && <span>{analyzed ? Analyzed green : Analyze amber} + Eye>}` — entire badge hidden when `!selected`. So unticked table shows nothing, re-tick looks like fresh.
- Expanded persisted row `296-311` via `openMeta :34` similarly hides Analysed chip when collapsed? Actually `290` drawer `memberTables.map` iterates `l.memberTables`, so unticked (removed from `memberTables`) not shown at all there — but draft picker is the issue.

### Backend persists Analysed for editing, not draft
- `store.ts:80` `line_column_meta PK (line_id,table_name,column_name)` `ON DELETE CASCADE` only on line delete; `deleteLineTableMeta :551` exists but 0 callers; `updateLine :449` `UPDATE lines SET member_tables=JSON...` never deletes meta rows — so editing re-tick would still have green via `refreshColumnMeta :65`. Draft (pre-create) is the inconsistent path.

## Desired
- **Checkbox = selection only** (is table in line’s `memberTables`?). **Analysed = whether that table’s `draftMeanings[column].every(m=>trim)` (or `columnMeta` for editing) is true — independent, survives untick/re-tick and position changes. No repeated Analyse just because box was unchecked.

## Plan

### 1) Keep `draftMeanings` on untick (stop wiping)
*File: `Lines.tsx:143-158`*
```ts
function toggleTable(t:string){
  setDraft(d=>({...d, memberTables: d.memberTables.includes(t) ? d.memberTables.filter(x=>x!==t) : [...d.memberTables,t]}));
  // REMOVE the if(!editing){ setDraftMeanings delete } block 150-157
  // Optionally add explicit “Discard analysis” action if user truly wants to clear:
  // function clearAnalysis(t:string){ setDraftMeanings(m=>{const{[t.toLowerCase()]:_omit,...rest}=m; return rest;}); }
}
```
- No other state touched. `draftMeanings[lower]` remains in memory while `memberTables` toggles. Re-tick restores `selected` true; `418-420` recomputes `draftCols` still present → `analyzed` stays true → green `Analyzed+Edit` shown immediately, dialog `initialMeanings` (`374`) hydrates previous meanings, no LLM re-run.

### 2) Show Analysed badge even when unchecked (so user sees it’s still Analysed, not lost)
*File: `410-440` picker + `290-312` expanded row decisions*

**Option A (preferred, minimal): keep current `{selected && …}` but since `draftMeanings` survives, re-tick instantly shows `Analyzed` without flicker — unticked table shows nothing (clean picker), but re-tick restores green without re-Analyse. Simplest, no extra UI.**

**Option B (if you want Analysed visible even while unchecked):**
```tsx
// 418-440 change render outer condition
const draftCols=draftMeanings[lower];
const meta=editing? columnMeta[lower] : draftCols?{...}:undefined; // as now 419
const analyzed=meta?.analyzed??false;
// show badge even when !selected if analyzed
<span className="ml-auto inline-flex gap-1">
  {analyzed ? <><Check/>Analyzed (green)</> : !selected ? null : hasAny ? … }
  {selected ? (analyzed ? <Btn Edit/> : <Btn Analyze/>) : analyzed ? <Btn Edit muted?/> : null}
  <Btn Eye/>
</span>
// OR keep picker row always rendered, checkbox controls `selected` tick only
```
- This makes checkbox vs Analysed visually independent: greyed `Analyzed` pill stays while box is off, so user knows no repeat needed. Choose A for now (least UI churn) unless you want B’s always-visible pill.

### 3) Optional explicit discard
- If user truly wants to discard analysis for a table (e.g., schema changed), provide small `×`/`Clear` next to `Edit` that calls `clearAnalysis(t)` — instead of overloading checkbox. Not required for this fix, but mention to avoid confusion.

### 4) Persisted (editing) already correct — no change
- Keep `updateLine` `:449` not deleting `line_column_meta`; `refreshColumnMeta` survives toggle. No edit.

## Alternatives / Ask
- **Keep vs hide Analysed when unchecked?** Plan defaults to **Option A** (hide until re-checked, but re-check shows green immediately without re-Analyse). If you prefer **Option B** (Analysed green stays visible even while unchecked, checkbox is purely membership), say so and `selected` check removed from badge condition.
- **Threshold for “discard”:** Keep `draftMeanings` forever until line `Save`/`cancel` (`80-83` resets on `showForm` close) vs add `Clear analysis` button? Default keep forever per line session.
- **Re-tick position change:** “position still” — if table order changes but still selected, keep same logic (key is `schema.table` lower, not index) — already handled.

## Verification (after exit plan mode)
- `npx tsc --noEmit` frontend (remove 7 lines, no types).
- Manual draft: Register line → pick connection → tick `downtime_events` → Analyse → fill → `Save to draft` → green `Analyzed+Edit` → **untick** `downtime_events` → re-tick same → still **green `Analyzed+Edit`** + reopen `Edit` shows previous meanings (no re-Analyse needed). Expanded row same.

## Risks
- Keeping `draftMeanings` for unchecked tables means `onSave :169` loop saves all `draftMeanings` keys even if table not in `memberTables` — currently `for([k,cols] of Object.entries(draftMeanings)) saveTableColumns` would save orphans not in line. Mitigate: in `onSave` draft flush `169-172`, filter `if(!draft.memberTables.map(x=>x.toLowerCase()).includes(k)) continue;` — add guard so only selected tables persist, but analysed kept in memory for re-tick.
- Memory: small (`Record<string, 3-15 cols>`).
