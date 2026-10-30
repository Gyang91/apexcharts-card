// Statistics are shared between card instances on the same connection: a card
// shown again only asks for the last (possibly open) period onwards.
import { fetchHistory, fetchStatistics, getStatisticsMetadata } from '../src/recorder';
import { mkHass as fixtureHass } from './fixtures/hass';

const DAY = 24 * 3600 * 1000;
const T0 = new Date('2026-07-01T00:00:00').getTime();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const connectedHass = (callWS: (message: AnyRec) => Promise<unknown>) =>
  Object.assign(fixtureHass(), { connection: {}, callWS });

const row = (id: string, startMs: number, change: number): AnyRec => ({
  statistic_id: id,
  start: startMs,
  end: startMs + DAY,
  change,
});

function mkHass(id: string, answer: (msg: AnyRec) => AnyRec[]) {
  const calls: AnyRec[] = [];
  const hass = {
    connection: {},
    callWS: async (msg: AnyRec) => {
      calls.push(msg);
      return { [id]: answer(msg) };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { hass: hass as any, calls };
}

afterEach(() => vi.useRealTimers());

describe('fetchStatistics cache', () => {
  it('asks again only from the last cached period when a card is shown again', async () => {
    const id = 'sensor.cache_a';
    const { hass, calls } = mkHass(
      id,
      (msg) =>
        calls.length === 1
          ? [row(id, T0, 1), row(id, T0 + DAY, 2), row(id, T0 + 2 * DAY, 3)]
          : [row(id, T0 + 2 * DAY, 4)], // the open day changed meanwhile
    );
    const start = new Date(T0);
    const end = new Date(T0 + 3 * DAY);

    expect((await fetchStatistics(hass, id, start, end, 'day'))!.map((r) => r.change)).toEqual([1, 2, 3]);
    const again = await fetchStatistics(hass, id, start, end, 'day');

    expect(calls).toHaveLength(2);
    expect(new Date(calls[1].start_time).getTime()).toBe(T0 + 2 * DAY);
    expect(again!.map((r) => r.change)).toEqual([1, 2, 4]);
  });

  it('only returns rows inside the requested range', async () => {
    const id = 'sensor.cache_b';
    const { hass } = mkHass(id, () => [row(id, T0, 1), row(id, T0 + DAY, 2), row(id, T0 + 2 * DAY, 3)]);
    await fetchStatistics(hass, id, new Date(T0), new Date(T0 + 3 * DAY), 'day');

    const later = await fetchStatistics(hass, id, new Date(T0 + DAY), new Date(T0 + 3 * DAY), 'day');
    expect(later!.map((r) => r.change)).toEqual([2, 3]);
  });

  it('fetches everything again after the cache expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 3 * DAY);
    const id = 'sensor.cache_c';
    const { hass, calls } = mkHass(id, () => [row(id, T0, 1)]);
    await fetchStatistics(hass, id, new Date(T0), new Date(T0 + DAY), 'day');

    vi.setSystemTime(T0 + 3 * DAY + 11 * 60 * 1000);
    await fetchStatistics(hass, id, new Date(T0), new Date(T0 + DAY), 'day');

    expect(new Date(calls[1].start_time).getTime()).toBe(T0);
  });

  it('does not share statistics between connections', async () => {
    const id = 'sensor.cache_d';
    const a = mkHass(id, () => [row(id, T0, 1)]);
    const b = mkHass(id, () => [row(id, T0, 9)]);
    await fetchStatistics(a.hass, id, new Date(T0), new Date(T0 + DAY), 'day');

    const fromB = await fetchStatistics(b.hass, id, new Date(T0), new Date(T0 + DAY), 'day');
    expect(fromB!.map((r) => r.change)).toEqual([9]);
    expect(new Date(b.calls[0].start_time).getTime()).toBe(T0);
  });

  it('does not request a reversed range when navigating before the last cached period', async () => {
    const id = 'sensor.navigate';
    const { hass, calls } = mkHass(id, () => [row(id, T0, 1), row(id, T0 + 2 * DAY, 3)]);
    await fetchStatistics(hass, id, new Date(T0), new Date(T0 + 3 * DAY), 'day');
    const earlier = await fetchStatistics(hass, id, new Date(T0), new Date(T0 + DAY), 'day');
    expect(new Date(calls[1].start_time).getTime()).toBeLessThan(new Date(calls[1].end_time).getTime());
    expect(earlier!.map((value) => value.change)).toEqual([1]);
  });

  it('evicts the oldest statistic after 64 cached entries without losing returned data', async () => {
    const { hass, calls } = mkHass('unused', () => []);
    hass.callWS = async (message: AnyRec) => {
      calls.push(message);
      const id = message.statistic_ids[0];
      return { [id]: [row(id, T0, 1), row(id, T0 + DAY, 2)] };
    };
    for (let i = 0; i < 65; i++) {
      const result = await fetchStatistics(hass, `sensor.${i}`, new Date(T0), new Date(T0 + 2 * DAY), 'day');
      expect(result).toHaveLength(2);
    }
    await fetchStatistics(hass, 'sensor.0', new Date(T0), new Date(T0 + 2 * DAY), 'day');
    expect(new Date(calls.at(-1)!.start_time).getTime()).toBe(T0);
    await fetchStatistics(hass, 'sensor.64', new Date(T0), new Date(T0 + 2 * DAY), 'day');
    expect(new Date(calls.at(-1)!.start_time).getTime()).toBe(T0 + DAY);
  });

  it('does not retain an oversized response but returns all its rows', async () => {
    const id = 'sensor.huge';
    const huge = Array.from({ length: 32001 }, (_, i) => row(id, T0 + i * DAY, i));
    const { hass, calls } = mkHass(id, () => huge);
    const end = new Date(T0 + huge.length * DAY);
    expect(await fetchStatistics(hass, id, new Date(T0), end, 'day')).toHaveLength(32001);
    await fetchStatistics(hass, id, new Date(T0), end, 'day');
    expect(new Date(calls[1].start_time).getTime()).toBe(T0);
  });

  it('bounds total cached rows across statistics rather than just each individual response', async () => {
    const calls: AnyRec[] = [];
    const hass = connectedHass(async (message: AnyRec) => {
      calls.push(message);
      const id = message.statistic_ids[0];
      return { [id]: Array.from({ length: 17000 }, (_, i) => row(id, T0 + i * DAY, i)) };
    });
    const end = new Date(T0 + 17000 * DAY);
    await fetchStatistics(hass, 'sensor.a', new Date(T0), end, 'day');
    await fetchStatistics(hass, 'sensor.b', new Date(T0), end, 'day');
    await fetchStatistics(hass, 'sensor.a', new Date(T0), end, 'day');
    expect(new Date(calls[2].start_time).getTime()).toBe(T0);
  });
});

describe('concurrent recorder requests', () => {
  it('coalesces identical pending history requests but returns independent expanded arrays', async () => {
    let finish!: (value: AnyRec) => void;
    const callWS = vi.fn(
      () =>
        new Promise<AnyRec>((resolve) => {
          finish = resolve;
        }),
    );
    const hass = connectedHass(callWS);
    const options = { includeStartState: true, minimal: false };
    const a = fetchHistory(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), options);
    const b = fetchHistory(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), options);
    expect(callWS).toHaveBeenCalledOnce();
    finish({ 'sensor.a': [{ s: '12', lu: T0 / 1000, a: { nested: { value: 1 } } }] });
    const [first, second] = await Promise.all([a, b]);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first![0]).not.toBe(second![0]);
    expect(first![0].attributes).not.toBe(second![0].attributes);
    expect(first![0].attributes!.nested).not.toBe(second![0].attributes!.nested);
    const again = fetchHistory(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), options);
    expect(callWS).toHaveBeenCalledTimes(2);
    finish({});
    await again;
  });

  it('does not share different wire options, ranges, or HA connections', async () => {
    const callWS = vi.fn().mockResolvedValue({});
    const hass = connectedHass(callWS);
    const options = { includeStartState: true, minimal: true };
    await Promise.all([
      fetchHistory(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), options),
      fetchHistory(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), { ...options, minimal: false }),
      fetchHistory(hass, 'sensor.a', new Date(T0 + 1), new Date(T0 + DAY), options),
      fetchHistory(connectedHass(callWS), 'sensor.a', new Date(T0), new Date(T0 + DAY), options),
    ]);
    expect(callWS).toHaveBeenCalledTimes(4);
  });

  it('shares pending statistics and releases failed requests for retry', async () => {
    const callWS = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ 'sensor.a': [row('sensor.a', T0, 1)] });
    const hass = connectedHass(callWS);
    const a = fetchStatistics(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), 'day');
    const b = fetchStatistics(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), 'day');
    const failed = await Promise.allSettled([a, b]);
    expect(failed.every((value) => value.status === 'rejected')).toBe(true);
    expect(callWS).toHaveBeenCalledOnce();
    expect(await fetchStatistics(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), 'day')).toHaveLength(1);
    expect(callWS).toHaveBeenCalledTimes(2);
  });

  it('shares successful concurrent statistics requests without dropping rows', async () => {
    let finish!: (value: AnyRec) => void;
    const callWS = vi.fn(
      () =>
        new Promise<AnyRec>((resolve) => {
          finish = resolve;
        }),
    );
    const hass = connectedHass(callWS);
    const a = fetchStatistics(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), 'day');
    const b = fetchStatistics(hass, 'sensor.a', new Date(T0), new Date(T0 + DAY), 'day');
    expect(callWS).toHaveBeenCalledOnce();
    finish({ 'sensor.a': [row('sensor.a', T0, 7)] });
    const [first, second] = await Promise.all([a, b]);
    expect(first).toEqual(second);
    expect(first![0].change).toBe(7);
  });
});

describe('bounded connection-scoped metadata', () => {
  it('does not reuse metadata from a different Home Assistant connection', async () => {
    const a = connectedHass(vi.fn().mockResolvedValue([{ statistic_id: 'sensor.a', name: 'A' }]));
    const b = connectedHass(vi.fn().mockResolvedValue([{ statistic_id: 'sensor.a', name: 'B' }]));
    expect((await getStatisticsMetadata(a, 'sensor.a'))?.name).toBe('A');
    expect((await getStatisticsMetadata(b, 'sensor.a'))?.name).toBe('B');
  });

  it('expires metadata after ten minutes and bounds the number of retained IDs', async () => {
    vi.useFakeTimers();
    const callWS = vi.fn().mockResolvedValue([]);
    const hass = connectedHass(callWS);
    for (let i = 0; i < 65; i++) await getStatisticsMetadata(hass, `sensor.${i}`);
    await getStatisticsMetadata(hass, 'sensor.0');
    expect(callWS).toHaveBeenCalledTimes(66);
    await getStatisticsMetadata(hass, 'sensor.64');
    expect(callWS).toHaveBeenCalledTimes(66);
    vi.advanceTimersByTime(10 * 60 * 1000);
    await getStatisticsMetadata(hass, 'sensor.64');
    expect(callWS).toHaveBeenCalledTimes(67);
  });
});
