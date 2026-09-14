import cron from "node-cron";
import type { Logger } from "./logger.js";
import { getSchedule, listSchedules, markScheduleRun, saveReport, type Report } from "./db/store.js";
import { answerQuestion } from "./rag/answer.js";
import { chatComplete, resolveLlm } from "./rag/llm.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function buildBriefing(lineId: string, questions: string[], format: string): Promise<Record<string, unknown>> {
  const sections: { question: string; answer: Awaited<ReturnType<typeof answerQuestion>> }[] = [];
  for (const q of questions) sections.push({ question: q, answer: await answerQuestion([lineId], q) });

  const combined = sections.map((s) => `Q: ${s.question}\nA: ${s.answer.summary}`).join("\n\n");
  const charts = sections.flatMap((s) => s.answer.charts);
  const sources = sections.flatMap((s) => s.answer.sources);

  let headline = `Morning briefing — ${lineId} — ${today()}`;
  try {
    const { llm } = await resolveLlm();
    if (llm) {
      headline = await chatComplete(
        llm,
        `Write a one-line morning-briefing headline + 3-5 KPI bullets. Format=${format}. Keep under 100 words. Never invent numbers.`,
        combined
      );
    }
  } catch {
    /* keep default headline */
  }
  return { headline, sections, charts, sources, format, lineId, date: today() };
}

export async function runScheduleNow(scheduleId: string): Promise<Report> {
  const s = getSchedule(scheduleId);
  if (!s) throw new Error("schedule not found");
  try {
    const answer = await buildBriefing(s.lineId, s.questions, s.format);
    const r = saveReport(scheduleId, s.questions, answer, true, null);
    markScheduleRun(scheduleId, true, null);
    return r;
  } catch (e) {
    const err = (e as Error).message;
    const r = saveReport(scheduleId, s.questions, { headline: "Briefing failed", error: err }, false, err);
    markScheduleRun(scheduleId, false, err);
    return r;
  }
}

/** Every minute: run schedules whose cron matches now (server tz). Manual /run also available. */
export function startScheduler(log: Logger): void {
  if (process.env.SCHEDULER_ENABLED === "false") {
    log.info("scheduler disabled");
    return;
  }
  cron.schedule("* * * * *", async () => {
    for (const s of listSchedules()) {
      if (!s.enabled) continue;
      try {
        if (cron.validate(s.cron)) {
          // node-cron has no isDue helper; run check via last_run minute guard:
          // simplest v1: attempt match by re-creating next-date check is overkill —
          // instead run only when current HH:MM matches daily "M H * * *" crons.
          const m = s.cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
          if (!m) continue;
          const now = new Date();
          if (Number(m[1]) === now.getMinutes() && Number(m[2]) === now.getHours()) {
            if (s.lastRun && Date.now() - new Date(s.lastRun).getTime() < 90_000) continue; // already ran this minute
            log.info({ schedule: s.id }, "scheduler: due, running");
            await runScheduleNow(s.id);
          }
        }
      } catch (e) {
        log.error({ schedule: s.id, error: (e as Error).message }, "scheduled run failed");
      }
    }
  });
  log.info("scheduler started (every minute)");
}
