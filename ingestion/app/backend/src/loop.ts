import {
  appendTicketNote,
  closeTicket,
  getReading,
  getTicket,
  listTickets,
  openTicket,
  type Ticket,
} from "./db/store.js";
import { retainQuestionMemory } from "./extract.js";

/** Era rule: readings over windows older than an hour are history (pre-fill). */
function readingDataMode(readingId: number): "live" | "prefill" {
  try {
    const r = getReading(readingId);
    if (!r) return "live";
    return Date.now() - new Date(r.at).getTime() > 3600_000 ? "prefill" : "live";
  } catch {
    return "live";
  }
}
import type { Logger } from "./logger.js";

/**
 * Items 4 + 7a/7b + 9: the question↔ticket loop, closed both directions.
 *
 * Birth direction (7a): a reading's `newQuestions` pass Gate 2 (7b/9) —
 * waste filter → similarity merge → worth-it file — and become tickets.
 * Death direction (4): a reading's `questionVerdicts` close (or escalate)
 * the tickets they answer. Every decision is returned in the loop report
 * (stored on the reading row, shown in F7) — drops are footprints, never
 * silence.
 */

export interface LoopQuestion {
  question?: unknown;
  evidence?: unknown;
}

export interface LoopVerdict {
  ticketId?: unknown;
  verdict?: unknown;
  reason?: unknown;
}

export interface LoopReport {
  readingId: number;
  filed: { ticketId: number; question: string }[];
  merged: { ticketId: number; question: string }[];
  dropped: { question: string; reason: string }[];
  closed: { ticketId: number; reason: string }[];
  escalated: { ticketId: number; reason: string }[];
}

/** Plant-domain aliases so "temp" and "temperature" count as the same token. */
const ALIASES: Record<string, string> = {
  temp: "temperature",
  temps: "temperature",
  avg: "average",
  max: "maximum",
  min: "minimum",
};

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => ALIASES[w] ?? w)
    .join(" ");
}

function tokens(s: string): Set<string> {
  return new Set(s.split(" ").filter((w) => w.length > 2));
}

/** Token-overlap similarity 0..1 (deterministic-first; LLM judge later). */
function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit++;
  return hit / Math.max(ta.size, tb.size);
}

const MERGE_THRESHOLD = 0.5;

function ticketText(t: Ticket): string {
  return `${t.title} ${t.aiReason}`;
}

/**
 * Gate 2 verdict for one candidate: file (new ticket), merge (into an open
 * ticket), or drop (with reason). Deterministic v1 — no extra LLM call.
 */
export function gateQuestion(
  question: string,
  evidence: string,
  open: Ticket[]
): { action: "file" } | { action: "merge"; ticket: Ticket } | { action: "drop"; reason: string } {
  if (!question) return { action: "drop", reason: "empty question" };
  if (!evidence) return { action: "drop", reason: "no cited evidence" };
  let best: Ticket | null = null;
  let bestSim = 0;
  const nq = norm(question);
  for (const t of open) {
    const sim = similarity(nq, norm(ticketText(t)));
    if (sim > bestSim) {
      bestSim = sim;
      best = t;
    }
  }
  if (best && (bestSim >= MERGE_THRESHOLD || norm(best.title) === nq)) {
    return { action: "merge", ticket: best };
  }
  return { action: "file" };
}

export async function applyReadingLoop(
  log: Logger,
  readingId: number,
  lineId: string,
  cardId: string,
  questions: LoopQuestion[],
  verdicts: LoopVerdict[]
): Promise<LoopReport> {
  const report: LoopReport = { readingId, filed: [], merged: [], dropped: [], closed: [], escalated: [] };
  const dataMode = readingDataMode(readingId);
  let open = listTickets({ lineId, status: "open", limit: 200 }).rows;

  // Death direction: verdicts first (a question answered in this same reading
  // should not be re-filed below — but verdicts reference ticketIds, questions
  // are new text, so order is safe either way).
  for (const v of verdicts ?? []) {
    const ticketId = Number(v.ticketId);
    if (!Number.isInteger(ticketId)) continue;
    const t = getTicket(ticketId);
    if (!t || t.status !== "open") continue;
    if (t.lineId !== lineId) continue;
    const reason = String(v.reason ?? "").slice(0, 500);
    if (v.verdict === "closed") {
      if (closeTicket(ticketId, `auto @ reading #${readingId}: ${reason || "answered by new data"}`)) {
        report.closed.push({ ticketId, reason });
        // Item 8: the resolution is a memory — the lifecycle story brackets here.
        await retainQuestionMemory(log, {
          lineId, cardId, readingId, ticketId, kind: "question-resolved",
          title: t.title, evidence: t.aiReason, reason, dataMode,
        });
      }
    } else if (v.verdict === "escalated") {
      // Escalation keeps the ticket open but marks urgency on its note.
      appendTicketNote(ticketId, `escalated @ reading #${readingId}: ${reason || "urgent, still open"}`);
      report.escalated.push({ ticketId, reason });
      log.warn({ lineId, ticketId, readingId, reason }, "ticket escalated by reading");
    }
    // keep-open (or unknown): silence is correct — still unclear is not news.
  }

  // Re-fetch: verdicts above may have closed tickets — newborn questions must
  // not merge into (or duplicate) the just-closed.
  open = listTickets({ lineId, status: "open", limit: 200 }).rows;

  // Birth direction: Gate 2 per candidate (cap 3 enforced — prompt promises it).
  for (const q of (questions ?? []).slice(0, 3)) {
    const question = String(q.question ?? "").trim().slice(0, 300);
    const evidence = String(q.evidence ?? "").trim().slice(0, 800);
    const gate = gateQuestion(question, evidence, open);
    if (gate.action === "drop") {
      report.dropped.push({ question: question || "(empty)", reason: gate.reason });
      log.warn({ lineId, readingId, reason: gate.reason }, "question dropped by Gate 2");
      continue;
    }
    if (gate.action === "merge") {
      appendTicketNote(gate.ticket.id, `supporting evidence @ reading #${readingId}: ${evidence}`);
      // Refresh the open set view: merged ticket stays open, evidence accretes.
      report.merged.push({ ticketId: gate.ticket.id, question });
      log.info({ lineId, readingId, ticketId: gate.ticket.id }, "question merged into open ticket");
      continue;
    }
    try {
      const r = openTicket({ lineId, cardId, readingId, title: question, aiReason: evidence, allowMultiple: true });
      if (r.deduped) {
        report.merged.push({ ticketId: r.id, question });
      } else {
        report.filed.push({ ticketId: r.id, question });
        // Item 8 primary feed: the birth is a memory (evidence + window + tags).
        await retainQuestionMemory(log, {
          lineId, cardId, readingId, ticketId: r.id, kind: "question",
          title: question, evidence, dataMode,
        });
        // Later candidates in this same run must see the just-filed ticket.
        const fresh = getTicket(r.id);
        if (fresh) open.push(fresh);
      }
    } catch (e) {
      report.dropped.push({ question, reason: `file failed: ${(e as Error).message}` });
    }
  }
  return report;
}
