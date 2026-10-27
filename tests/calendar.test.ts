// Calendar periods (group_by.period) and time-weighted averages (time_avg).
import GraphEntry from '../src/graphEntry';
import { formatPeriod, periodBoundaries, startOfPeriod } from '../src/calendar';
import { mkHass, mkState } from './fixtures/hass';

const TZ = 'Europe/Berlin';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ENTITY = 'sensor.cost';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// Berlin wall-clock time -> epoch ms
const berlin = (iso: string, offset: '+01:00' | '+02:00') => new Date(`${iso}${offset}`).getTime();

describe('calendar periods', () => {
  it('day boundaries stay on midnight across the DST change (25 h day)', () => {
    const start = berlin('2026-10-24T00:00:00', '+02:00');
    const end = berlin('2026-10-27T00:00:00', '+01:00');
    const b = periodBoundaries(start, end, 'day', TZ);

    expect(b).toEqual([
      berlin('2026-10-24T00:00:00', '+02:00'),
      berlin('2026-10-25T00:00:00', '+02:00'),
      berlin('2026-10-26T00:00:00', '+01:00'),
      berlin('2026-10-27T00:00:00', '+01:00'),
    ]);
    expect(b[2] - b[1]).toBe(25 * HOUR);
  });

  it('months follow their real length and weeks start on Monday', () => {
    const b = periodBoundaries(
      berlin('2026-02-10T12:00:00', '+01:00'),
      berlin('2026-03-05T00:00:00', '+01:00'),
      'month',
      TZ,
    );
    expect(b).toEqual([
      berlin('2026-02-01T00:00:00', '+01:00'),
      berlin('2026-03-01T00:00:00', '+01:00'),
      berlin('2026-04-01T00:00:00', '+02:00'),
    ]);
    // Thursday 29 Oct 2026 -> Monday 26 Oct
    expect(startOfPeriod(berlin('2026-10-29T15:00:00', '+01:00'), 'week', TZ)).toBe(
      berlin('2026-10-26T00:00:00', '+01:00'),
    );
  });

  it('labels periods in the user language', () => {
    const july = berlin('2026-07-01T00:00:00', '+02:00');
    expect(formatPeriod(july, 'quarter', 'en', TZ)).toBe('Q3 2026');
    expect(formatPeriod(july, 'year', 'en', TZ)).toBe('2026');
    expect(formatPeriod(july, 'month', 'en', TZ)).toBe('Jul 2026');
    expect(formatPeriod(july, 'day', 'en', TZ)).toBe('Jul 1');
  });
});

function makeEntry(groupBy: AnyRec, points: [number, number][]): GraphEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__calendarPoints = points;
  const config: AnyRec = {
    entity: ENTITY,
    index: 0,
    type: 'column',
    group_by: { duration: '1h', offset: '+0h', fill: 'null', ...groupBy },
    show: {},
    ignore_history: false,
    data_generator: 'return window.__calendarPoints;',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = new GraphEntry(0, 3 * 24 * HOUR, false, config as any, undefined);
  const hass = mkHass({ [ENTITY]: mkState(ENTITY, '0') }) as AnyRec;
  hass.locale = { ...hass.locale, time_zone: 'server' };
  hass.config = { ...hass.config, time_zone: TZ };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry.hass = hass as any;
  return entry;
}

describe('group_by.period', () => {
  it('sums per calendar day across the DST change', async () => {
    const entry = makeEntry({ func: 'sum', period: 'day' }, [
      [berlin('2026-10-25T00:30:00', '+02:00'), 1], // early on the 25 h day
      [berlin('2026-10-25T23:30:00', '+01:00'), 2], // late on the same day
      [berlin('2026-10-26T00:30:00', '+01:00'), 4], // next day, just after midnight
    ]);
    await entry._updateHistory(
      new Date(berlin('2026-10-25T00:00:00', '+02:00')),
      new Date(berlin('2026-10-27T00:00:00', '+01:00')),
    );

    expect(entry.history).toEqual([
      [berlin('2026-10-25T00:00:00', '+02:00'), 3],
      [berlin('2026-10-26T00:00:00', '+01:00'), 4],
    ]);
  });
});

describe('group_by.func time_avg', () => {
  it('weighs each value by how long it was held', async () => {
    const t0 = berlin('2026-07-01T10:00:00', '+02:00');
    // 20 for 54 min, then 30 for 6 min: plain avg 26.7, time-weighted 21
    const entry = makeEntry({ func: 'time_avg', duration: '1h' }, [
      [t0, 20],
      [t0 + 54 * MIN, 30],
      [t0 + 59 * MIN, 30],
    ]);
    // fixed-duration buckets drop the first (partial) bucket: start one hour early
    await entry._updateHistory(new Date(t0 - HOUR), new Date(t0 + HOUR));

    expect(entry.history).toHaveLength(1);
    expect(entry.history[0][1]).toBeCloseTo(21, 6);
  });

  it('carries the value held from the previous bucket', async () => {
    const t0 = berlin('2026-07-01T10:00:00', '+02:00');
    // 10 from 10:00, 40 from 11:30: hour 11 holds 10 for 30 min then 40 for 30 min
    const entry = makeEntry({ func: 'time_avg', duration: '1h' }, [
      [t0, 10],
      [t0 + 90 * MIN, 40],
    ]);
    await entry._updateHistory(new Date(t0 - HOUR), new Date(t0 + 2 * HOUR));

    expect(entry.history.map(([, v]) => v)).toEqual([10, 25]);
  });
});
