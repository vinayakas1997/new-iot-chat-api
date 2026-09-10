/**
 * Shift definitions (see new-plan/03-granularity-matrix.md §2).
 *
 * Single plant timezone (PLANT_TZ) — all shift windows and daily boundaries
 * derive from it. Default: 3×8h (S1 06–14, S2 14–22, S3 22–06).
 */

export interface ShiftDef {
  name: string;
  /** Inclusive start hour (0–23) in plant local time. */
  startHour: number;
  /** Exclusive end hour (0–23, may wrap past midnight). */
  endHour: number;
}

export const DEFAULT_SHIFTS: ShiftDef[] = [
  { name: 'S1', startHour: 6, endHour: 14 },
  { name: 'S2', startHour: 14, endHour: 22 },
  { name: 'S3', startHour: 22, endHour: 6 },
];

/** Which shift does this UTC instant fall in? (Fixture data is UTC-aligned.) */
export function shiftForTimestamp(tsIso: string, shifts: ShiftDef[] = DEFAULT_SHIFTS): ShiftDef {
  const hour = new Date(tsIso).getUTCHours();
  for (const s of shifts) {
    if (s.startHour <= s.endHour) {
      if (hour >= s.startHour && hour < s.endHour) return s;
    } else {
      if (hour >= s.startHour || hour < s.endHour) return s;
    }
  }
  return shifts[0]!;
}
