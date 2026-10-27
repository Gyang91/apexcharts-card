// Calendar arithmetic for group_by periods and statistics periods: period
// steps, boundaries and labels in the dashboard's time zone, so days, weeks,
// months, quarters and years follow DST changes and month lengths.
import type { HomeAssistant } from 'custom-card-helpers';
import type { Moment, unitOfTime } from 'moment-timezone';
import { moment } from './const';
import { t } from './localize';
import type { CalendarPeriod, StatisticsPeriod } from './types-config';
import { isUsingServerTimezone } from './utils';

type Period = CalendarPeriod | StatisticsPeriod;

const PERIOD_STEPS: Record<Period, [number, unitOfTime.DurationConstructor]> = {
  '5minute': [5, 'minute'],
  hour: [1, 'hour'],
  day: [1, 'day'],
  week: [1, 'week'],
  month: [1, 'month'],
  quarter: [1, 'quarter'],
  year: [1, 'year'],
};

// [amount, unit] of one period, for moment add/subtract
export function periodStep(period: Period): [number, unitOfTime.DurationConstructor] {
  return PERIOD_STEPS[period];
}

// Time zone the card displays in: the server's when the user profile asks for
// it, otherwise the browser's (undefined).
export function displayTimeZone(hass: HomeAssistant | undefined): string | undefined {
  return isUsingServerTimezone(hass) ? hass?.config.time_zone : undefined;
}

function at(ts: number, timeZone: string | undefined): Moment {
  return timeZone ? moment(ts).tz(timeZone) : moment(ts);
}

// Start of the calendar period holding `ts`. Weeks start on Monday (ISO), as
// in Home Assistant's statistics.
export function startOfPeriod(ts: number, period: CalendarPeriod, timeZone: string | undefined): number {
  return at(ts, timeZone)
    .startOf(period === 'week' ? 'isoWeek' : period)
    .valueOf();
}

// Boundaries of every period overlapping [start, end): from the start of the
// period holding `start` up to the first boundary after `end`.
export function periodBoundaries(
  start: number,
  end: number,
  period: CalendarPeriod,
  timeZone: string | undefined,
): number[] {
  const [amount, unit] = periodStep(period);
  const cursor = at(startOfPeriod(start, period, timeZone), timeZone);
  const boundaries = [cursor.valueOf()];
  while (cursor.valueOf() < end) {
    boundaries.push(cursor.add(amount, unit).valueOf());
  }
  return boundaries;
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
      const m = at(ts, timeZone);
      return t('period.quarter', { quarter: m.quarter(), year: m.year() }, lang);
    }
    case 'year':
      return String(at(ts, timeZone).year());
  }
}
