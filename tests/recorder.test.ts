// Statistics are shared between card instances on the same connection: a card
// shown again only asks for the last (possibly open) period onwards.
import { fetchStatistics } from '../src/recorder';

const DAY = 24 * 3600 * 1000;
const T0 = new Date('2026-07-01T00:00:00').getTime();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

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
});
