// Calendar periods for group_by and statistics: period steps, boundaries and
// labels in the dashboard's time zone. Time zone rules come from the browser
// (see zone.ts), so the card ships no time zone database.
import type { HomeAssistant } from 'custom-card-helpers';
import { t } from './localize';
import type { CalendarPeriod, StatisticsPeriod } from './types-config';
import { isUsingServerTimezone } from './utils';
import { add, startOf, wallTime, type CalendarUnit } from './zone';

type Period = CalendarPeriod | StatisticsPeriod;

// Time zone the card displays in: the server's when the user profile asks for
// it, otherwise the browser's (undefined).
export function displayTimeZone(hass: HomeAssistant | undefined): string | undefined {
  return isUsingServerTimezone(hass) ? hass?.config.time_zone : undefined;
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
