/**
 * ParsedSchedule -> 5-field cron expression (minute hour dom month dow), plus a
 * timezone-aware "next run" computation. The cron string is stored so the
 * scheduler process can match it without re-deriving; the timezone is stored
 * alongside because a bare cron string has no tz.
 */
import type { ParsedSchedule } from '@app/shared';

export function toCronExpr(s: ParsedSchedule): string {
  const [h, m] = s.timeOfDay.split(':').map(Number);
  const hh = h ?? 0;
  const mm = m ?? 0;
  switch (s.recurrence) {
    case 'weekdays':
      return `${mm} ${hh} * * 1-5`;
    case 'weekly':
      return `${mm} ${hh} * * ${s.weekday ?? 1}`;
    case 'once':
      // day/month pinned; the scheduler also checks onDate to fire exactly once.
      if (s.onDate) {
        const [, mo, d] = s.onDate.split('-').map(Number);
        return `${mm} ${hh} ${d} ${mo} *`;
      }
      return `${mm} ${hh} * * *`;
    case 'daily':
    default:
      return `${mm} ${hh} * * *`;
  }
}

/** Wall-clock parts of `date` in an IANA timezone. */
export function zonedParts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour === '24' ? '0' : p.hour),
    minute: Number(p.minute),
    dow: dowMap[p.weekday as string] ?? 0,
  };
}

/** Next time (UTC Date) the schedule should fire, scanning minute-by-minute up to 8 days out. */
export function nextRunAt(s: ParsedSchedule, from: Date = new Date()): Date | null {
  const [h, m] = s.timeOfDay.split(':').map(Number);
  const start = new Date(Math.ceil(from.getTime() / 60000) * 60000);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    const t = new Date(start.getTime() + i * 60000);
    const p = zonedParts(t, s.timezone);
    if (p.hour !== h || p.minute !== m) continue;
    if (s.recurrence === 'weekdays' && (p.dow === 0 || p.dow === 6)) continue;
    if (s.recurrence === 'weekly' && p.dow !== (s.weekday ?? 1)) continue;
    if (s.recurrence === 'once' && s.onDate) {
      const iso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
      if (iso !== s.onDate) continue;
    }
    return t;
  }
  return null;
}
