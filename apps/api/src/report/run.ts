/**
 * The per-user daily report run (§5.7). Called by the scheduler process when a
 * schedule is due. Reads ONLY from Hindsight — never Postgres — so it degrades
 * gracefully when ingestion is late.
 */
import type { Schedule } from '@app/shared';
import { eq } from 'drizzle-orm';
import { getAppDb } from '../db/app/client.js';
import { schedules } from '../db/app/schema.js';
import { bankForUserQuery, getHindsight } from '../hindsight/index.js';
import { writeHistory } from '../history/store.js';
import { getLlm } from '../llm/index.js';
import { logger } from '../logger.js';
import { deliverExternal } from './deliver.js';
import { DEFAULT_THRESHOLDS, evaluateCondition } from './evaluate.js';
import { nextRunAt } from '../schedule/cron.js';

const DRAFT_SYSTEM = [
  'You write a short daily operations report for a plant manager.',
  '3–6 sentences. Lead with the headline (all clear / needs attention).',
  'Use the evaluation result and recalled facts given. Do not invent numbers.',
  'No jargon about databases or memory systems.',
].join('\n');

export async function runReportForSchedule(s: Schedule): Promise<Schedule['lastResult']> {
  const bankId = bankForUserQuery(s.userId, s.queryText);
  const hindsight = getHindsight();

  let recalled;
  try {
    recalled = await hindsight.recall(bankId, s.queryText, { budget: 'high' });
  } catch (err) {
    logger.error({ err, scheduleId: s.id }, 'report recall failed');
    recalled = { facts: [] };
  }

  const evalResult = evaluateCondition(recalled.facts, DEFAULT_THRESHOLDS);

  let answer: string;
  try {
    answer = await getLlm().complete({
      system: DRAFT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            request: s.queryText,
            evaluation: evalResult,
            facts: recalled.facts.map((f) => f.statement),
          }),
        },
      ],
    });
  } catch (err) {
    logger.error({ err }, 'report draft failed');
    answer =
      evalResult.status === 'condition_met'
        ? `Needs attention: ${evalResult.breaches.join('; ')}.`
        : 'All clear — no threshold breaches detected in the latest data.';
  }

  await writeHistory({
    userId: s.userId,
    source: 'report',
    question: s.queryText,
    answer,
    scheduleId: s.id,
    meta: { evaluation: evalResult },
  });

  void deliverExternal(`Daily report: ${s.queryText}`, answer);

  const result: Schedule['lastResult'] =
    recalled.facts.length === 0 ? 'error' : evalResult.status === 'condition_met' ? 'condition_met' : 'ok';

  await getAppDb()
    .update(schedules)
    .set({
      lastRunAt: new Date(),
      lastResult: result,
      nextRunAt: nextRunAt({
        queryText: s.queryText,
        timeOfDay: s.timeOfDay,
        recurrence: s.recurrence,
        weekday: s.weekday,
        onDate: s.onDate,
        timezone: s.timezone,
      }),
    })
    .where(eq(schedules.id, s.id));

  return result;
}
