/**
 * Business-date helpers. Business dates are plain `YYYY-MM-DD` strings interpreted in the
 * company timezone (default Asia/Kolkata). Date arithmetic is done in UTC on those strings
 * so it never depends on the server or browser timezone.
 */

export type DateStr = string; // YYYY-MM-DD
export type TimeStr = string; // HH:mm (24h)

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

export function isDateStr(value: unknown): value is DateStr {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  return fromUtcDate(toUtcDate(value)) === value;
}

export function isTimeStr(value: unknown): value is TimeStr {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function toUtcDate(date: DateStr): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUtcDate(dt: Date): DateStr {
  return dt.toISOString().slice(0, 10);
}

export function addDays(date: DateStr, days: number): DateStr {
  return fromUtcDate(new Date(toUtcDate(date).getTime() + days * DAY_MS));
}

/** Number of days from `a` to `b` (b - a). */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: DateStr): number {
  return toUtcDate(date).getUTCDay();
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Inclusive list of dates. Throws above `max` to protect against unbounded ranges. */
export function dateRange(from: DateStr, to: DateStr, max = 400): DateStr[] {
  const n = diffDays(from, to);
  if (n < 0) return [];
  if (n + 1 > max) throw new RangeError(`Date range too large (${n + 1} days, max ${max})`);
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

export function weekStartFor(date: DateStr, weekStartDay: number): DateStr {
  const offset = (weekday(date) - weekStartDay + 7) % 7;
  return addDays(date, -offset);
}

export function monthBounds(month: string): { from: DateStr; to: DateStr } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = fromUtcDate(new Date(Date.UTC(y, m - 1, 1)));
  const to = fromUtcDate(new Date(Date.UTC(y, m, 0)));
  return { from, to };
}

export function minDate(a: DateStr, b: DateStr): DateStr {
  return a < b ? a : b;
}

export function maxDate(a: DateStr, b: DateStr): DateStr {
  return a > b ? a : b;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  date: DateStr;
  time: TimeStr;
  hour: number;
  minute: number;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    hour,
    minute,
  };
}

export function todayIn(timeZone: string, now: Date): DateStr {
  return zonedParts(now, timeZone).date;
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = Object.fromEntries(partsFormatter(timeZone).formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the wall-clock `date time` occurs in `timeZone`. */
export function zonedDateTimeToInstant(date: DateStr, time: TimeStr, timeZone: string): Date {
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = toUtcDate(date).getTime() + (h * 60 + mi) * 60_000;
  let instant = guess - tzOffsetMs(new Date(guess), timeZone);
  // Second pass corrects for DST transitions between the guess and the result.
  instant = guess - tzOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export function timeToMinutes(time: TimeStr): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Duration in minutes; overnight intervals wrap past midnight when allowed. */
export function intervalMinutes(start: TimeStr, end: TimeStr, overnight: boolean): number | null {
  const s = timeToMinutes(start);
  let e = timeToMinutes(end);
  if (e <= s) {
    if (!overnight) return null;
    e += 24 * 60;
  }
  return e - s;
}

export type Greeting = 'Good Morning' | 'Good Afternoon' | 'Good Evening';

export function greetingForHour(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return 'Good Morning';
  if (hour >= 12 && hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}
