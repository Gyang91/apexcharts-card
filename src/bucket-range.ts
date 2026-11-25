// The time range an aggregated point stands for (its bucket), from the series'
// group_by or statistics settings, and its label: "Tue, Nov 24, 21:00 – 22:00".
import parse from 'parse-duration';
import { addPeriods, startOfPeriod } from './calendar';
import type { ChartCardConfig, ChartCardSeriesConfig } from './types';
import type { CalendarPeriod } from './types-config';

type Align = 'start' | 'middle' | 'end';

/** How a series' points are bucketed: calendar periods or fixed durations. */
export type BucketSpec = { period: CalendarPeriod; align: Align } | { duration: number; align: Align };

function serieBuckets(serie: ChartCardSeriesConfig): BucketSpec | undefined {
  if (serie.statistics) {
    const align = serie.statistics.align ?? 'middle';
    const period = serie.statistics.period ?? 'hour';
    return period === '5minute' ? { duration: 5 * 60 * 1000, align } : { period, align };
  }
  const group = serie.group_by;
  if (!group?.func || group.func === 'raw') return undefined;
  // as GraphEntry places points: columns in the middle of their bucket, others at the start
  const align = group.align ?? (serie.type === 'column' ? 'middle' : 'start');
  if (group.period) return { period: group.period, align };
  const duration = parse(group.duration ?? '1h');
  return duration ? { duration, align } : undefined;
}

/** The buckets every series of the chart shares, if they all share the same. */
export function chartBuckets(config: ChartCardConfig): BucketSpec | undefined {
  const specs = (config.series_in_graph ?? []).map(serieBuckets);
  const first = specs[0];
  if (!first || specs.some((spec) => !spec || JSON.stringify(spec) !== JSON.stringify(first))) return undefined;
  return first;
}

/**
 * [start, end) of the bucket a point at `ts` stands for. Display timestamps are
 * already shifted to the displayed time zone, so periods use the browser's.
 */
export function bucketRange(ts: number, spec: BucketSpec): { start: number; end: number } {
  if ('duration' in spec) {
    const start = spec.align === 'start' ? ts : spec.align === 'end' ? ts - spec.duration : ts - spec.duration / 2;
    return { start, end: start + spec.duration };
  }
  // A point at the end of its period belongs to the period before
  const start = startOfPeriod(spec.align === 'end' ? ts - 1 : ts, spec.period, undefined);
  return { start, end: addPeriods(start, spec.period, 1, undefined) };
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Label of a bucket: date and time range for buckets shorter than a day
 * ("Tue, Nov 24, 21:00 – 22:00"), the dates it covers for longer ones
 * ("Nov 23 – 29"), month or year for those periods.
 */
export function formatBucketRange(
  range: { start: number; end: number },
  spec: BucketSpec,
  lang: string,
  hours12: boolean,
): string {
  const clock: Intl.DateTimeFormatOptions = hours12 ? { hour12: true } : { hourCycle: 'h23' };
  const period = 'period' in spec ? spec.period : undefined;
  if (period === 'year') return new Intl.DateTimeFormat(lang, { year: 'numeric' }).format(range.start);
  if (period === 'month') return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(range.start);
  if (period === 'quarter') {
    return new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric' }).formatRange(range.start, range.end - 1);
  }
  if (range.end - range.start >= DAY) {
    // Whole days: the last day the bucket covers, not the next midnight
    return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).formatRange(
      range.start,
      range.end - 1,
    );
  }
  return new Intl.DateTimeFormat(lang, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    ...clock,
  }).formatRange(range.start, range.end);
}
