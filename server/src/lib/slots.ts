import { DateTime } from "luxon";

export interface Window {
  startMin: number;
  endMin: number;
}

export interface SlotInput {
  date: string; // YYYY-MM-DD, provider-local
  timezone: string;
  rules: (Window & { weekday: number })[];
  exception?: { startMin: number | null; endMin: number | null } | null;
  durationMin: number;
  busy: { start: Date; end: Date }[];
  now: Date;
  stepMin: number;
}

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && DateTime.fromISO(date).isValid;
}

/** Local date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toISODate() as string;
}

/**
 * Returns the start instants of every bookable slot on a provider-local date.
 * Slots start on a fixed grid (stepMin) inside the working windows, must fit
 * entirely inside a window, must be in the future, and must not overlap busy ranges.
 * Wall-clock times that do not exist (DST gap) are skipped.
 */
export function computeSlots(input: SlotInput): Date[] {
  const day = DateTime.fromISO(input.date, { zone: input.timezone });
  if (!day.isValid) return [];

  let windows: Window[];
  if (input.exception) {
    if (input.exception.startMin == null || input.exception.endMin == null) return [];
    windows = [{ startMin: input.exception.startMin, endMin: input.exception.endMin }];
  } else {
    windows = input.rules.filter((r) => r.weekday === day.weekday);
  }

  const slots: Date[] = [];
  for (const w of windows) {
    for (let m = w.startMin; m + input.durationMin <= w.endMin; m += input.stepMin) {
      const start = day.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 });
      if (start.hour * 60 + start.minute !== m) continue; // inside a DST gap
      const end = start.plus({ minutes: input.durationMin });
      if (start.toMillis() <= input.now.getTime()) continue;
      const s = start.toJSDate();
      const e = end.toJSDate();
      const clash = input.busy.some((b) => s < b.end && e > b.start);
      if (!clash) slots.push(s);
    }
  }
  const unique = new Map(slots.map((s) => [s.getTime(), s]));
  return [...unique.values()].sort((a, b) => a.getTime() - b.getTime());
}
