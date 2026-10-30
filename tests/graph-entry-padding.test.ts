// Column width bug: with a single (or irregular) statistics bucket, ApexCharts
// derives the column width from the smallest gap between points and renders a
// giant column. GraphEntry pads the whole span with [ts, null] bucket
// boundaries when the interval is known (statistics.period / group_by).
import GraphEntry from '../src/graphEntry';
import { mkHass, mkState } from './fixtures/hass';

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

function seriesConfig(extra: AnyRec = {}): AnyRec {
  return {
    entity: 'sensor.water_meter',
    index: 0,
    group_by: { duration: '1h', offset: '+0h', func: 'raw', fill: 'last' },
    show: {},
    ignore_history: false,
    ...extra,
  };
}

// Statistics buckets as returned by recorder/statistics_during_period: epoch-ms
function statBucket(startMs: number, endMs: number, change: number): AnyRec {
  return {
    statistic_id: 'sensor.water_meter',
    start: startMs,
    end: endMs,
    last_reset: null,
    max: null,
    mean: null,
    min: null,
    sum: null,
    state: null,
    change,
  };
}

function makeEntry(config: AnyRec, graphSpanMs: number, buckets: AnyRec[]): GraphEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = new GraphEntry(0, graphSpanMs, false, config as any, undefined);
  const hass = mkHass({
    'sensor.water_meter': mkState('sensor.water_meter', '123.4', { unit_of_measurement: 'm³' }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (hass as AnyRec).callWS = async () => ({ 'sensor.water_meter': buckets });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry.hass = hass as any;
  return entry;
}

// Day-aligned boundaries, away from any DST transition in Europe/Paris
const T0 = new Date('2026-07-01T00:00:00').getTime();

describe('statistics span padding (column width fix)', () => {
  it('fills missing monthly statistics periods using HA calendar boundaries', async () => {
    const instant = (date: string) => Date.parse(`${date}T00:00:00+01:00`);
    const janStart = instant('2026-01-01');
    const febStart = instant('2026-02-01');
    const aprStart = Date.parse('2026-04-01T00:00:00+02:00');
    const mayStart = Date.parse('2026-05-01T00:00:00+02:00');
    const entry = makeEntry(seriesConfig({ statistics: { type: 'change', period: 'month' } }), mayStart - janStart, [
      statBucket(janStart, febStart, 1),
      statBucket(aprStart, mayStart, 2),
    ]);

    await entry._updateHistory(new Date(janStart), new Date(mayStart));

    expect(entry.history).toEqual(
      [
        [(febStart + Date.parse('2026-03-01T00:00:00+01:00')) / 2, null],
        [(Date.parse('2026-03-01T00:00:00+01:00') + aprStart) / 2, null],
        [(janStart + febStart) / 2, 1],
        [(aprStart + mayStart) / 2, 2],
      ].sort(([left], [right]) => left - right),
    );
  });

  it('pads monthly column statistics in the Home Assistant time zone', async () => {
    const instant = (date: string) => Date.parse(`${date}T00:00:00+01:00`);
    const febStart = instant('2026-02-01');
    const aprStart = Date.parse('2026-04-01T00:00:00+02:00');
    const mayStart = Date.parse('2026-05-01T00:00:00+02:00');
    const entry = makeEntry(
      seriesConfig({ type: 'column', statistics: { type: 'change', period: 'month' } }),
      mayStart - febStart,
      [statBucket(aprStart, mayStart, 2)],
    );

    await entry._updateHistory(new Date(febStart), new Date(mayStart));

    expect(entry.history).toEqual([
      [(febStart + Date.parse('2026-02-28T23:00:00Z')) / 2, null],
      [(Date.parse('2026-02-28T23:00:00Z') + aprStart) / 2, null],
      [(aprStart + mayStart) / 2, 2],
    ]);
  });

  it.each([
    ['day', Date.parse('2026-10-24T22:00:00Z'), Date.parse('2026-10-25T23:00:00Z')],
    ['month', Date.parse('2026-02-01T00:00:00Z'), Date.parse('2026-03-01T00:00:00Z')],
    ['month', Date.parse('2026-07-01T00:00:00Z'), Date.parse('2026-08-01T00:00:00Z')],
  ])('centers a %s statistic using its actual recorder boundaries', async (period, start, end) => {
    const entry = makeEntry(seriesConfig({ type: 'column', statistics: { type: 'change', period } }), end - start, [
      statBucket(start, end, 2),
    ]);
    await entry._updateHistory(new Date(start), new Date(end));
    expect(entry.history).toEqual([[start + (end - start) / 2, 2]]);
  });

  it('a single day bucket on a 14d span is padded to 14 evenly spaced points', async () => {
    const config = seriesConfig({ type: 'column', statistics: { type: 'change', period: 'day' } });
    const start = new Date(T0);
    const end = new Date(T0 + 14 * DAY);
    // Only ONE real bucket: the most recent day
    const entry = makeEntry(config, 14 * DAY, [statBucket(T0 + 13 * DAY, T0 + 14 * DAY, 0.5)]);

    expect(await entry._updateHistory(start, end)).toBe(true);
    const history = entry.history;

    expect(history).toHaveLength(14);
    // 13 padding points + 1 real value, real point last and untouched
    expect(history.filter(([, v]) => v === null)).toHaveLength(13);
    expect(history[13][1]).toBe(0.5);
    expect(history[13][0]).toBe(T0 + 13 * DAY + DAY / 2); // align middle: start + 12h
    // Evenly spaced boundaries -> ApexCharts sees a constant 1-day interval
    for (let i = 1; i < history.length; i++) {
      expect(history[i][0] - history[i - 1][0]).toBe(DAY);
    }
    // Points sorted and within the span
    expect(history[0][0]).toBeGreaterThanOrEqual(start.getTime());
    expect(history[13][0]).toBeLessThanOrEqual(end.getTime());
  });

  it('two consecutive buckets keep their values and get boundary padding around them', async () => {
    const config = seriesConfig({ type: 'column', statistics: { type: 'change', period: 'day' } });
    const start = new Date(T0);
    const end = new Date(T0 + 14 * DAY);
    const entry = makeEntry(config, 14 * DAY, [
      statBucket(T0 + 6 * DAY, T0 + 7 * DAY, 0.3),
      statBucket(T0 + 7 * DAY, T0 + 8 * DAY, 0.7),
    ]);

    await entry._updateHistory(start, end);
    const history = entry.history;

    expect(history).toHaveLength(14);
    const real = history.filter(([, v]) => v !== null);
    expect(real.map(([, v]) => v)).toEqual([0.3, 0.7]);
    for (let i = 1; i < history.length; i++) {
      expect(history[i][0] - history[i - 1][0]).toBe(DAY);
    }
  });

  it('two distant buckets: internal gap and both edges are all padded', async () => {
    const config = seriesConfig({ type: 'column', statistics: { type: 'change', period: 'day' } });
    const start = new Date(T0);
    const end = new Date(T0 + 14 * DAY);
    const entry = makeEntry(config, 14 * DAY, [
      statBucket(T0 + 3 * DAY, T0 + 4 * DAY, 0.3),
      statBucket(T0 + 10 * DAY, T0 + 11 * DAY, 0.9),
    ]);

    await entry._updateHistory(start, end);
    const history = entry.history;

    expect(history).toHaveLength(14);
    expect(history.filter(([, v]) => v !== null)).toHaveLength(2);
    expect(history[3][1]).toBe(0.3);
    expect(history[10][1]).toBe(0.9);
    for (let i = 1; i < history.length; i++) {
      expect(history[i][0] - history[i - 1][0]).toBe(DAY);
    }
  });

  it('a full span needs no padding and stays untouched', async () => {
    const config = seriesConfig({ type: 'column', statistics: { type: 'change', period: 'day' } });
    const start = new Date(T0);
    const end = new Date(T0 + 3 * DAY);
    const entry = makeEntry(config, 3 * DAY, [
      statBucket(T0, T0 + DAY, 0.1),
      statBucket(T0 + DAY, T0 + 2 * DAY, 0.2),
      statBucket(T0 + 2 * DAY, T0 + 3 * DAY, 0.3),
    ]);

    await entry._updateHistory(start, end);
    const history = entry.history;

    expect(history).toHaveLength(3);
    expect(history.every(([, v]) => v !== null)).toBe(true);
  });

  it('period hour over 24h: one bucket padded to 24 hourly points', async () => {
    const config = seriesConfig({ type: 'column', statistics: { type: 'mean', period: 'hour' } });
    const start = new Date(T0);
    const end = new Date(T0 + 24 * HOUR);
    const entry = makeEntry(config, 24 * HOUR, [{ ...statBucket(T0 + 23 * HOUR, T0 + 24 * HOUR, 0), mean: 21.5 }]);

    await entry._updateHistory(start, end);
    const history = entry.history;

    expect(history).toHaveLength(24);
    expect(history[23][1]).toBe(21.5);
    expect(history.filter(([, v]) => v === null)).toHaveLength(23);
    for (let i = 1; i < history.length; i++) {
      expect(history[i][0] - history[i - 1][0]).toBe(HOUR);
    }
  });

  it('does NOT pad line series (padding is column-only)', async () => {
    const config = seriesConfig({ type: 'line', statistics: { type: 'change', period: 'day' } });
    const start = new Date(T0);
    const end = new Date(T0 + 14 * DAY);
    const entry = makeEntry(config, 14 * DAY, [statBucket(T0 + 13 * DAY, T0 + 14 * DAY, 0.5)]);

    await entry._updateHistory(start, end);
    expect(entry.history).toHaveLength(1);
  });

  it('keeps lastState on the last REAL value despite trailing null padding', async () => {
    const config = seriesConfig({ type: 'column', statistics: { type: 'change', period: 'day' } });
    const start = new Date(T0);
    const end = new Date(T0 + 14 * DAY);
    // Real bucket in the middle: trailing padding otherwise hides the value
    const entry = makeEntry(config, 14 * DAY, [statBucket(T0 + 6 * DAY, T0 + 7 * DAY, 0.42)]);

    await entry._updateHistory(start, end);
    expect(entry.history[entry.history.length - 1][1]).toBeNull();
    expect(entry.lastState).toBe(0.42);
  });

  it('group_by series are already regular by construction (bucketer pads the span)', async () => {
    const config = seriesConfig({
      type: 'column',
      group_by: { duration: '1d', offset: '+0h', func: 'sum', fill: 'null' },
    });
    const start = new Date(T0);
    const end = new Date(T0 + 14 * DAY);
    const entry = makeEntry(config, 14 * DAY, []);
    // group_by uses the recent-history API, not statistics
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hass = mkHass({
      'sensor.water_meter': mkState('sensor.water_meter', '123.4', { unit_of_measurement: 'm³' }),
    }) as AnyRec;
    hass.callWS = async () => ({
      'sensor.water_meter': [{ s: '0.5', lu: (T0 + 13 * DAY + HOUR) / 1000 }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry.hass = hass as any;

    await entry._updateHistory(start, end);
    const history = entry.history;

    // The bucketer generates one bucket per day across the span (13-14
    // boundaries depending on range rounding): what matters for the column
    // width is that the spacing is constant and empty buckets exist as null.
    expect(history.length).toBeGreaterThanOrEqual(13);
    expect(history.filter(([, v]) => v !== null && v !== 0).length).toBeLessThanOrEqual(1);
    for (let i = 1; i < history.length; i++) {
      expect(history[i][0] - history[i - 1][0]).toBe(DAY);
    }
  });
});
