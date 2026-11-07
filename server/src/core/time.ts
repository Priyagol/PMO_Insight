import { env } from '../config/env';

/**
 * All instants are stored in UTC. "Calendar day" logic (work-log dates, overdue checks,
 * timesheet weeks) uses the organisation timezone so a log made at 00:30 IST counts
 * for the IST day, not the previous UTC day.
 */
export const ORG_TZ = env.ORG_TIMEZONE;

/** Returns the calendar date (YYYY-MM-DD) of an instant in the given timezone. */
export function toOrgDate(instant: Date, timeZone: string = ORG_TZ): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Offset in minutes of `timeZone` from UTC at the given instant (e.g. +330 for IST). */
export function tzOffsetMinutes(instant: Date, timeZone: string = ORG_TZ): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** UTC instant at which the given org calendar date (YYYY-MM-DD) starts. */
export function startOfOrgDay(date: string, timeZone: string = ORG_TZ): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, m - 1, d);
  // Two passes handle DST transitions correctly for zones that have them.
  let guess = utcMidnight - tzOffsetMinutes(new Date(utcMidnight), timeZone) * 60_000;
  guess = utcMidnight - tzOffsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** Organisation calendar date for today (optionally offset by whole days), YYYY-MM-DD. */
export function orgToday(offsetDays = 0, now: Date = new Date()): string {
  return toOrgDate(new Date(now.getTime() + offsetDays * 24 * 3600_000));
}

/* ---------- Calendar-date arithmetic on YYYY-MM-DD strings (timezone-free) ---------- */

const toUtcNoon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
};
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDaysIso(date: string, days: number): string {
  const d = toUtcNoon(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeekIso(date: string): number {
  return toUtcNoon(date).getUTCDay();
}

/** Monday of the week containing `date`. */
export function weekStartIso(date: string): string {
  const dow = dayOfWeekIso(date);
  return addDaysIso(date, dow === 0 ? -6 : 1 - dow);
}

export function daysBetweenIso(from: string, to: string): number {
  return Math.round((toUtcNoon(to).getTime() - toUtcNoon(from).getTime()) / 86_400_000);
}

/** UTC instant of `HH:MM` on an organisation calendar date. */
export function orgDateTime(date: string, time: string, timeZone: string = ORG_TZ): Date {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return new Date(startOfOrgDay(date, timeZone).getTime() + (h * 60 + m) * 60_000);
}

/** `HH:MM` of an instant in the organisation timezone. */
export function orgTimeOf(instant: Date, timeZone: string = ORG_TZ): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}
