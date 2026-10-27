// Calendar arithmetic in a time zone: period boundaries and labels for
// group_by and statistics, span start/end, and the server time zone offset.
// Days, weeks, months, quarters and years follow DST changes and month
// lengths. Time zone rules come from the browser (Intl), so the card ships no
// time zone database and never runs out of rules.
import type { HomeAssistant } from 'custom-card-helpers';
import { t } from './localize';
import type { CalendarPeriod, ChartCardStartEnd, StatisticsPeriod } from './types-config';
import { isUsingServerTimezone } from './utils';

type Period = CalendarPeriod | StatisticsPeriod;

// Units a time can be rounded to or moved by. `week` starts on Sunday,
// `isoWeek` on Monday.
type CalendarUnit = ChartCardStartEnd | 'quarter';

// Time zone the card displays in: the server's when the user profile asks for
// it, otherwise the browser's (undefined).
export function displayTimeZone(hass: HomeAssistant | undefined): string | undefined {
  return isUsingServerTimezone(hass) ? hass?.config.time_zone : undefined;
}

// Wall-clock fields of an instant in a time zone (month 1-12)
interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

function wallTime(ts: number, timeZone: string | undefined): WallTime {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(ts)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    hour: fields.hour,
    minute: fields.minute,
    second: fields.second,
    millisecond: ((ts % 1000) + 1000) % 1000,
  };
}

function wallAsUtc(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, wall.millisecond);
}

// Offset of the time zone from UTC at `ts`, in ms (positive east of UTC)
function zoneOffset(ts: number, timeZone: string | undefined): number {
  return wallAsUtc(wallTime(ts, timeZone)) - ts;
}

// Instant of a wall-clock time in the time zone. Out-of-range fields roll
// over (day 0 is the last day of the previous month). A wall time that occurs
// twice (clocks going back) resolves with `preferredOffset` when it fits,
// otherwise to its first occurrence; one skipped by clocks going forward
// resolves to the same moment just after the change.
function fromWallTime(wall: WallTime, timeZone: string | undefined, preferredOffset?: number): number {
  const asUtc = wallAsUtc(wall);
  // Offsets the zone uses a day before, at and a day after that time
  const around = [asUtc - DAY_MS, asUtc, asUtc + DAY_MS].map((ts) => zoneOffset(ts, timeZone));
  // Largest offset first: the earliest of two occurrences
  const candidates = [...new Set(around)].sort((a, b) => b - a);
  if (preferredOffset !== undefined) candidates.unshift(preferredOffset);
  for (const offset of candidates) {
    if (zoneOffset(asUtc - offset, timeZone) === offset) return asUtc - offset;
  }
  // Skipped wall time: read it with the offset in force before the change
  return asUtc - around[0];
}

const DAY_MS = 24 * 3600 * 1000;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Start of the `unit` holding `ts`
export function startOf(ts: number, unit: CalendarUnit, timeZone: string | undefined): number {
  const wall = { ...wallTime(ts, timeZone), millisecond: 0 };
  // Within the hour that repeats when clocks go back, stay in the same occurrence
  if (unit === 'minute') return fromWallTime({ ...wall, second: 0 }, timeZone, zoneOffset(ts, timeZone));
  const day = { ...wall, hour: 0, minute: 0, second: 0 };
  switch (unit) {
    case 'hour':
      return fromWallTime({ ...wall, minute: 0, second: 0 }, timeZone, zoneOffset(ts, timeZone));
    case 'day':
      return fromWallTime(day, timeZone);
    case 'week':
    case 'isoWeek': {
      const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay(); // 0 = Sunday
      const back = unit === 'week' ? weekday : (weekday + 6) % 7;
      return fromWallTime({ ...day, day: wall.day - back }, timeZone);
    }
    case 'month':
      return fromWallTime({ ...day, day: 1 }, timeZone);
    case 'quarter':
      return fromWallTime({ ...day, month: Math.floor((wall.month - 1) / 3) * 3 + 1, day: 1 }, timeZone);
    case 'year':
      return fromWallTime({ ...day, month: 1, day: 1 }, timeZone);
  }
}

// `ts` moved by `amount` units. Minutes and hours are exact durations; days
// and longer keep the wall-clock time, and a month step keeps the day of the
// month where it exists (31 Jan + 1 month = 28/29 Feb).
export function add(ts: number, amount: number, unit: CalendarUnit, timeZone: string | undefined): number {
  if (unit === 'minute') return ts + amount * 60 * 1000;
  if (unit === 'hour') return ts + amount * 3600 * 1000;
  const wall = wallTime(ts, timeZone);
  if (unit === 'day' || unit === 'week' || unit === 'isoWeek') {
    return fromWallTime({ ...wall, day: wall.day + amount * (unit === 'day' ? 1 : 7) }, timeZone);
  }
  const months = wall.year * 12 + (wall.month - 1) + amount * (unit === 'month' ? 1 : unit === 'quarter' ? 3 : 12);
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  return fromWallTime({ ...wall, year, month, day: Math.min(wall.day, daysInMonth(year, month)) }, timeZone);
}

// Last millisecond of the `unit` holding `ts`: just before the next unit
// starts, which also counts an hour repeated at its end
export function endOf(ts: number, unit: CalendarUnit, timeZone: string | undefined): number {
  return startOf(add(startOf(ts, unit, timeZone), 1, unit, timeZone), unit, timeZone) - 1;
}

// Offset of the server time zone from the browser's at `ts`, in ms: added to a
// timestamp, it shows the server's wall-clock time on a chart drawn in the
// browser's time zone.
export function computeTimezoneDiffWithLocal(timeZone: string | undefined, ts = Date.now()): number {
  if (!timeZone) return 0;
  const diff = zoneOffset(ts, undefined) - zoneOffset(ts, timeZone);
  return diff === 0 ? 0 : diff;
}

// [amount, unit] of one period. Weeks start on Monday (ISO), as in Home
// Assistant's statistics.
const PERIOD_STEPS: Record<Period, [number, CalendarUnit]> = {
  '5minute': [5, 'minute'],
  hour: [1, 'hour'],
  day: [1, 'day'],
  week: [1, 'isoWeek'],
  month: [1, 'month'],
  quarter: [1, 'quarter'],
  year: [1, 'year'],
};

// `ts` moved by `count` periods (negative: backwards)
export function addPeriods(ts: number, period: Period, count: number, timeZone: string | undefined): number {
  const [amount, unit] = PERIOD_STEPS[period];
  return add(ts, amount * count, unit, timeZone);
}

// Start of the calendar period holding `ts`
export function startOfPeriod(ts: number, period: CalendarPeriod, timeZone: string | undefined): number {
  return startOf(ts, PERIOD_STEPS[period][1], timeZone);
}

// Start of the period after the one starting at `start`. Rounding again keeps
// boundaries on the calendar when a period started late, e.g. a day whose
// midnight was skipped by clocks going forward.
function nextPeriodStart(start: number, period: CalendarPeriod, timeZone: string | undefined): number {
  return startOfPeriod(addPeriods(start, period, 1, timeZone), period, timeZone);
}

// Boundaries of every period overlapping [start, end): from the start of the
// period holding `start` up to the first boundary after `end`.
export function periodBoundaries(
  start: number,
  end: number,
  period: CalendarPeriod,
  timeZone: string | undefined,
): number[] {
  const boundaries = [startOfPeriod(start, period, timeZone)];
  while (boundaries[boundaries.length - 1] < end) {
    boundaries.push(nextPeriodStart(boundaries[boundaries.length - 1], period, timeZone));
  }
  return boundaries;
}

// The period boundary closest to `ts`. Chart axis ticks for period buckets
// can sit slightly before the boundary they stand for (e.g. 31 Dec 19:00 for
// a year starting 1 Jan): snapping keeps their label on the right period.
export function nearestPeriodStart(ts: number, period: CalendarPeriod, timeZone: string | undefined): number {
  const start = startOfPeriod(ts, period, timeZone);
  const next = nextPeriodStart(start, period, timeZone);
  return ts - start <= next - ts ? start : next;
}

// Short label of the period starting at `ts`, in the user's language
export function formatPeriod(ts: number, period: CalendarPeriod, lang: string, timeZone: string | undefined): string {
  const options: Intl.DateTimeFormatOptions = { timeZone };
  switch (period) {
    case 'hour':
      return new Intl.DateTimeFormat(lang, { ...options, hour: 'numeric', minute: '2-digit' }).format(ts);
    case 'day':
    case 'week':
      return new Intl.DateTimeFormat(lang, { ...options, day: 'numeric', month: 'short' }).format(ts);
    case 'month':
      return new Intl.DateTimeFormat(lang, { ...options, month: 'short', year: 'numeric' }).format(ts);
    case 'quarter': {
      const wall = wallTime(ts, timeZone);
      return t('period.quarter', { quarter: Math.floor((wall.month - 1) / 3) + 1, year: wall.year }, lang);
    }
    case 'year':
      return String(wallTime(ts, timeZone).year);
  }
}
