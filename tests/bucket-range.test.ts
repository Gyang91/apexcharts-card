// Time range of an aggregated point (src/bucket-range.ts)
import { bucketRange, chartBuckets, formatBucketRange } from '../src/bucket-range';
import { ChartCardConfig } from '../src/types';

const HOUR = 3600 * 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const config = (series: any[]) => ({ series_in_graph: series }) as unknown as ChartCardConfig;
const local = (iso: string) => new Date(iso).getTime(); // local time, as display timestamps are

describe('chartBuckets', () => {
  it('reads group_by periods and durations, with the default alignment', () => {
    expect(chartBuckets(config([{ group_by: { func: 'avg', period: 'hour', align: 'middle' } }]))).toEqual({
      period: 'hour',
      align: 'middle',
    });
    expect(chartBuckets(config([{ group_by: { func: 'avg', duration: '30min' } }]))).toEqual({
      duration: 30 * 60 * 1000,
      align: 'start',
    });
    expect(chartBuckets(config([{ type: 'column', group_by: { func: 'sum', duration: '1h' } }]))).toEqual({
      duration: HOUR,
      align: 'middle',
    });
  });

  it('reads statistics, where 5minute is a duration and middle is the default', () => {
    expect(chartBuckets(config([{ statistics: { type: 'mean', period: 'day' } }]))).toEqual({
      period: 'day',
      align: 'middle',
    });
    expect(chartBuckets(config([{ statistics: { type: 'mean', period: '5minute', align: 'end' } }]))).toEqual({
      duration: 5 * 60 * 1000,
      align: 'end',
    });
  });

  it('has none for raw data, or when series bucket differently', () => {
    expect(chartBuckets(config([{ group_by: { func: 'raw' } }]))).toBeUndefined();
    expect(chartBuckets(config([]))).toBeUndefined();
    expect(
      chartBuckets(
        config([{ group_by: { func: 'avg', period: 'hour' } }, { group_by: { func: 'avg', duration: '1h' } }]),
      ),
    ).toBeUndefined();
  });
});

describe('bucketRange', () => {
  const nine = local('2026-11-24T21:00:00');

  it('places a duration bucket around its point by alignment', () => {
    const spec = (align: 'start' | 'middle' | 'end') => ({ duration: HOUR, align });
    expect(bucketRange(nine, spec('start'))).toEqual({ start: nine, end: nine + HOUR });
    expect(bucketRange(nine + HOUR / 2, spec('middle'))).toEqual({ start: nine, end: nine + HOUR });
    expect(bucketRange(nine + HOUR, spec('end'))).toEqual({ start: nine, end: nine + HOUR });
  });

  it('finds the calendar period, the one before for a point at its end', () => {
    expect(bucketRange(nine + HOUR / 2, { period: 'hour', align: 'middle' })).toEqual({
      start: nine,
      end: nine + HOUR,
    });
    expect(bucketRange(nine + HOUR, { period: 'hour', align: 'end' })).toEqual({ start: nine, end: nine + HOUR });
    const day = bucketRange(local('2026-11-24T12:00:00'), { period: 'day', align: 'middle' });
    expect(day).toEqual({ start: local('2026-11-24T00:00:00'), end: local('2026-11-25T00:00:00') });
  });
});

describe('formatBucketRange', () => {
  const nine = local('2026-11-24T21:00:00');
  const hour = { start: nine, end: nine + HOUR };

  it('shows the date and the hours, on the card clock', () => {
    // ICU puts thin spaces around the dash in some versions
    expect(formatBucketRange(hour, { period: 'hour', align: 'middle' }, 'en', false)).toMatch(
      /^Tue, Nov 24, 21:00\s?–\s?22:00$/,
    );
    expect(formatBucketRange(hour, { period: 'hour', align: 'middle' }, 'en', true)).toMatch(
      /^Tue, Nov 24, 9:00\s?–\s?10:00\sPM$/,
    );
    expect(formatBucketRange(hour, { period: 'hour', align: 'middle' }, 'de', false)).toMatch(
      /^Di\., 24\. Nov\., 21:00\s?–\s?22:00( Uhr)?$/,
    );
  });

  it('shows the days a longer bucket covers, without the next midnight', () => {
    const day = { start: local('2026-11-24T00:00:00'), end: local('2026-11-25T00:00:00') };
    expect(formatBucketRange(day, { period: 'day', align: 'middle' }, 'en', false)).toBe('Tue, Nov 24');
    const week = { start: local('2026-11-23T00:00:00'), end: local('2026-11-30T00:00:00') };
    expect(formatBucketRange(week, { period: 'week', align: 'middle' }, 'en', false)).toMatch(
      /^Mon, Nov 23\s?–\s?Sun, Nov 29$/,
    );
  });

  it('names months, quarters and years', () => {
    const month = { start: local('2026-11-01T00:00:00'), end: local('2026-12-01T00:00:00') };
    expect(formatBucketRange(month, { period: 'month', align: 'middle' }, 'en', false)).toBe('November 2026');
    const quarter = { start: local('2026-10-01T00:00:00'), end: local('2027-01-01T00:00:00') };
    expect(formatBucketRange(quarter, { period: 'quarter', align: 'middle' }, 'en', false)).toMatch(
      /^Oct\s?–\s?Dec 2026$/,
    );
    const year = { start: local('2026-01-01T00:00:00'), end: local('2027-01-01T00:00:00') };
    expect(formatBucketRange(year, { period: 'year', align: 'middle' }, 'en', false)).toBe('2026');
  });
});
