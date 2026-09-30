import { getCard, getLine, listCards, listReadings, listTickets } from "../db/store.js";

/**
 * Autonomous loop — Step 1: question generator (deterministic, no LLM).
 *
 * The user never asks. The loop proposes its own questions from the bank state:
 *   1. open tickets first (unresolved unknowns deserve answers),
 *   2. breach readings with no ticket (diagnose the flag),
 *   3. cards with no readings yet (coverage).
 * Each proposal carries its source + reason so the round log shows WHY it was
 * asked. The solver (playground ask) and validator (Gate-2) run downstream.
 */
export interface Proposal {
  question: string;
  source: "open-ticket" | "breach-reading" | "unread-card";
  sourceRef: string;
  reason: string;
  cardId: string | null;
  readingId: number | null;
  ticketId: number | null;
}

export function proposeQuestions(
  lineId: string,
  opts: { max?: number } = {},
): { lineId: string; proposals: Proposal[] } {
  const max = Math.max(1, Math.min(20, opts.max ?? 5));
  const line = getLine(lineId);
  if (!line) throw new Error("line not found");
  const proposals: Proposal[] = [];
  const push = (p: Proposal): boolean => {
    if (proposals.length >= max) return false;
    proposals.push(p);
    return true;
  };

  // 1. Open tickets — oldest first. Their sourceRefs are claimed so later
  // rules don't re-propose what's already being tracked. Closed loop tickets
  // also claim their sourceRef: a resolved coverage question must not be
  // re-asked every round (the loop would never terminate).
  const open = listTickets({ lineId, status: "open", limit: 50 }).rows;
  const claimed = new Set<string>();
  for (const t of open) {
    const m = /\[loop\] (\S+):/.exec(t.title);
    if (m) claimed.add(m[1]);
  }
  const closed = listTickets({ lineId, status: "closed", limit: 200 }).rows;
  for (const t of closed) {
    const m = /\[loop\] (\S+):/.exec(t.title);
    if (m) claimed.add(m[1]);
  }
  for (const t of open) {
    if (!push({
      question: `Resolve ticket #${t.id} "${t.title}": query the underlying rows for the ticket window and report grounded numbers at the natural grain. ${t.aiReason ? `Context: ${t.aiReason.slice(0, 400)}` : ""}`.trim(),
      source: "open-ticket",
      sourceRef: `ticket:${t.id}`,
      reason: "open ticket awaiting a grounded answer",
      cardId: t.cardId,
      readingId: t.readingId,
      ticketId: t.id,
    })) return { lineId, proposals };
  }

  // 2. Breach readings with no open ticket on the same reading.
  const ticketedReadings = new Set(open.map((t) => t.readingId).filter((v): v is number => v != null));
  const readings = listReadings({ lineId, limit: 50 }).rows;
  for (const r of readings) {
    if (!r.breach || ticketedReadings.has(r.id)) continue;
    if (claimed.has(`reading:${r.id}`)) continue;
    const card = getCard(r.cardId);
    if (!push({
      question: `Reading #${r.id} on card "${r.cardId}" flagged a breach (${r.summary.slice(0, 300)}). Query the underlying rows for the reading window, hourly, and report what actually happened — grounded numbers only.`,
      source: "breach-reading",
      sourceRef: `reading:${r.id}`,
      reason: `breach reading with no ticket${card ? ` (card "${card.name}")` : ""}`,
      cardId: r.cardId,
      readingId: r.id,
      ticketId: null,
    })) return { lineId, proposals };
  }

  // 3. Cards with no readings yet — coverage (live or dormant; a first
  // reading is what informs activation).
  const readCards = new Set(readings.map((r) => r.cardId));
  for (const c of listCards(lineId)) {
    if (readCards.has(c.id)) continue;
    if (claimed.has(`card:${c.id}`)) continue;
    if (!push({
      question: `What does card "${c.name}" show for the window? Summarize per bucket at the card's ${c.granularity} grain with grounded numbers.`,
      source: "unread-card",
      sourceRef: `card:${c.id}`,
      reason: "card has no readings yet — first coverage",
      cardId: c.id,
      readingId: null,
      ticketId: null,
    })) return { lineId, proposals };
  }
  return { lineId, proposals };
}
