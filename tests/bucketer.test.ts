// group_by bucketing: each point lands in the bucket whose
// [timestamp, next timestamp) holds it, in O(n log b), whatever the input order.
import GraphEntry, { findBucketIndex } from '../src/graphEntry';
import { mkHass, mkState } from './fixtures/hass';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = new Date('2026-07-01T00:00:00').getTime();
const ENTITY = 'sensor.power';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const buckets = (ts: number[]) => ts.map((timestamp) => ({ timestamp, data: [] }));

describe('findBucketIndex', () => {
  const b = buckets([0, 10, 20, 30]);

  it('finds the bucket holding the timestamp (start inclusive, end exclusive)', () => {
    expect(findBucketIndex(b, 0)).toBe(0);
    expect(findBucketIndex(b, 9)).toBe(0);
    expect(findBucketIndex(b, 10)).toBe(1);
    expect(findBucketIndex(b, 29)).toBe(2);
  });

  it('returns -1 outside the range', () => {
    expect(findBucketIndex(b, -1)).toBe(-1);
    expect(findBucketIndex(b, 30)).toBe(-1);
    expect(findBucketIndex(buckets([0]), 0)).toBe(-1);
    expect(findBucketIndex([], 0)).toBe(-1);
  });
});

function makeEntry(points: [number, number][]): GraphEntry {
  const config: AnyRec = {
    entity: ENTITY,
    index: 0,
    type: 'column',
    group_by: { duration: '1h', offset: '+0h', func: 'sum', fill: 'null' },
    show: {},
    ignore_history: false,
    data_generator: 'return window.__points;',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__points = points;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = new GraphEntry(0, 24 * HOUR, false, config as any, undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry.hass = mkHass({ [ENTITY]: mkState(ENTITY, '1') }) as any;
  return entry;
}

describe('group_by bucketing', () => {
  it('gives the same buckets for sorted and unsorted points', async () => {
    const points: [number, number][] = [
      [T0 + 5 * MIN, 1],
      [T0 + 50 * MIN, 2],
      [T0 + HOUR + 1, 4],
      [T0 + 3 * HOUR + 30 * MIN, 8],
    ];
    const sorted = makeEntry(points);
    await sorted._updateHistory(new Date(T0), new Date(T0 + 4 * HOUR));
    const unsorted = makeEntry([...points].reverse());
    await unsorted._updateHistory(new Date(T0), new Date(T0 + 4 * HOUR));

    expect(unsorted.history).toEqual(sorted.history);
    // The empty middle hour (fill: null) has no value, not 0
    expect(sorted.history.map(([, v]) => v)).toEqual([4, null, 8]);
  });

  it('buckets a day of 5-second samples quickly', async () => {
    const points: [number, number][] = [];
    for (let t = T0; t < T0 + 24 * HOUR; t += 5000) points.push([t, 1]);
    const entry = makeEntry(points);
    const started = performance.now();
    await entry._updateHistory(new Date(T0), new Date(T0 + 24 * HOUR));
    const elapsed = performance.now() - started;

    expect(entry.history.every(([, v]) => v === HOUR / 5000)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
