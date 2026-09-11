/**
 * parse_schedule_request — turn a natural request like
 *   "run line-3 OEE at 8:15am on weekdays, before my morning meeting"
 * into a concrete ParsedSchedule. LLM-first with a strict JSON contract, then a
 * regex fallback so the feature still works offline / if the model misbehaves.
 *
 * Line scope: a single line mention is extracted against the lines registry
 * (clone-per-line model). Timezone always resolves to config.plant.tz.
 */
import { ParsedSchedule } from '@app/shared';
import { config } from '../config.js';
import { listLines } from '../lines/store.js';
import { getLlm } from '../llm/index.js';
import { logger } from '../logger.js';

const SYSTEM = [
  'You convert a scheduling request into JSON. Respond ONLY with JSON, no prose.',
  'This is a SCHEDULE parse.',
  'Shape: { "heading"?: string (short title), "queryText": string, "timeOfDay": "HH:MM" (24h), "recurrence": "hourly"|"daily"|"weekdays"|"weekly"|"once",',
  '         "weekday"?: 0-6 (Sun=0, only if weekly), "onDate"?: "YYYY-MM-DD" (only if once), "timezone": IANA tz, "lineId"?: string }',
  'queryText = the thing to report on, with scheduling words removed. Extract heading if present.',
  'lineId = the single production line mentioned (e.g. "line-2"); omit when no line is mentioned.',
  'If user says "hourly" or "every hour" use recurrence hourly.',
].join('\n');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Match a registry line name as a whole word (case-insensitive). */
export function extractLineMention(message: string, validLines: string[]): string | undefined {
  const lower = ` ${message.toLowerCase()} `;
  const hits = validLines.filter((l) => lower.includes(` ${l.toLowerCase()} `));
  return hits.length === 1 ? hits[0] : undefined;
}

export function regexParse(message: string, fallbackTz: string, lineId?: string): ParsedSchedule {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(message);
  let hh = 8;
  let mm = 0;
  if (m) {
    hh = Number(m[1]);
    mm = m[2] ? Number(m[2]) : 0;
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
  }
  let recurrence: ParsedSchedule['recurrence'] = 'daily';
  let weekday: number | undefined;
  if (/hourly|every hour/i.test(message)) recurrence = 'hourly';
  else if (/weekday|mon(day)?\s*(–|-|to)\s*fri/i.test(message)) recurrence = 'weekdays';
  const wd = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`, 'i').test(message));
  if (wd >= 0 && recurrence !== 'hourly') {
    recurrence = 'weekly';
    weekday = wd;
  }
  const queryText = message
    .replace(/\b(every|each|on|at|by|run|send|report|please|before .*$)\b/gi, ' ')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, ' ')
    .replace(/\bweekdays?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return ParsedSchedule.parse({
    queryText: queryText || message.trim(),
    timeOfDay: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    recurrence,
    weekday,
    timezone: fallbackTz,
    lineId,
  });
}

export async function parseScheduleRequest(
  message: string,
  fallbackTz?: string,
  lineIdOverride?: string,
): Promise<ParsedSchedule> {
  const tz = fallbackTz || config.plant.tz;
  const valid = (await listLines(true).catch(() => [] as { name: string }[])).map((l) => l.name);
  const mentioned = lineIdOverride ?? extractLineMention(message, valid);
  try {
    const raw = await getLlm().complete({
      system: SYSTEM,
      messages: [{ role: 'user', content: message }],
    });
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const candidate = typeof json.lineId === 'string' && valid.includes(json.lineId) ? json.lineId : mentioned;
    const parsed = ParsedSchedule.safeParse({ ...json, timezone: tz, lineId: candidate });
    if (parsed.success) return parsed.data;
    logger.warn({ issues: parsed.error.issues }, 'schedule parse: LLM JSON invalid, using regex');
  } catch (err) {
    logger.warn({ err }, 'schedule parse: LLM failed, using regex');
  }
  return regexParse(message, tz, mentioned);
}
