// Recent history is loaded over the websocket (history/history_during_period)
// with the smallest payload the series needs; user functions are compiled once
// per series; a failed load never leaves the series locked.
import GraphEntry from '../src/graphEntry';
import { mkHass, mkState } from './fixtures/hass';

const HOUR = 3600 * 1000;
const T0 = new Date('2026-07-01T00:00:00').getTime();
const ENTITY = 'sensor.temp';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

function seriesConfig(extra: AnyRec = {}): AnyRec {
  return {
    entity: ENTITY,
    index: 0,
    group_by: { duration: '1h', offset: '+0h', func: 'raw', fill: 'last' },
    show: {},
    ignore_history: false,
    ...extra,
  };
}

function makeEntry(config: AnyRec, callWS: (msg: AnyRec) => Promise<unknown>): GraphEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = new GraphEntry(0, 24 * HOUR, false, config as any, undefined);
  const hass = mkHass({ [ENTITY]: mkState(ENTITY, '21', { unit_of_measurement: '°C' }) }) as AnyRec;
  hass.callWS = callWS;
  hass.callApi = async () => {
    throw new Error('REST history must not be used');
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry.hass = hass as any;
  return entry;
}

const rows = [
  { s: '20.5', lu: T0 / 1000 },
  { s: '21', lu: (T0 + HOUR) / 1000 },
  { s: 'unavailable', lu: (T0 + 2 * HOUR) / 1000 },
];

describe('websocket recent history', () => {
  it('requests a minimal payload for plain state series and parses compressed rows', async () => {
    const calls: AnyRec[] = [];
    const entry = makeEntry(seriesConfig(), async (msg) => {
      calls.push(msg);
      return { [ENTITY]: rows };
    });

    expect(await entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR))).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      type: 'history/history_during_period',
      entity_ids: [ENTITY],
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: true,
      no_attributes: true,
    });
    expect(entry.history).toEqual([
      [T0, 20.5],
      [T0 + HOUR, 21],
      [T0 + 2 * HOUR, null],
    ]);
  });

  it('keeps attributes for attribute series and reads them from rows', async () => {
    const calls: AnyRec[] = [];
    const entry = makeEntry(seriesConfig({ attribute: 'battery' }), async (msg) => {
      calls.push(msg);
      return {
        [ENTITY]: [
          { s: 'on', a: { battery: 80 }, lu: T0 / 1000 },
          { s: 'on', a: { battery: 79 }, lu: (T0 + HOUR) / 1000, lc: T0 / 1000 },
        ],
      };
    });

    await entry._updateHistory(new Date(T0), new Date(T0 + 2 * HOUR));

    expect(calls[0]).toMatchObject({ minimal_response: false, no_attributes: false });
    // attribute series are timed on last_updated
    expect(entry.history).toEqual([
      [T0, 80],
      [T0 + HOUR, 79],
    ]);
  });

  it('uses last_changed (lc, falling back to lu) for state series', async () => {
    const entry = makeEntry(seriesConfig({ transform: 'return x * 2;' }), async () => ({
      [ENTITY]: [{ s: '10', a: {}, lu: (T0 + HOUR) / 1000, lc: T0 / 1000 }],
    }));

    await entry._updateHistory(new Date(T0), new Date(T0 + 2 * HOUR));

    expect(entry.history).toEqual([[T0, 20]]);
  });

  it('passes the full history item, entity_id included, to transform', async () => {
    const entry = makeEntry(
      seriesConfig({ transform: "return entity.entity_id === 'sensor.temp' ? entity.attributes.k : -1;" }),
      async () => ({ [ENTITY]: [{ s: '1', a: { k: 7 }, lu: T0 / 1000 }] }),
    );

    await entry._updateHistory(new Date(T0), new Date(T0 + HOUR));

    expect(entry.history).toEqual([[T0, 7]]);
  });
});

describe('user functions are compiled once per series', () => {
  it('transform is compiled once for all points and refreshes', async () => {
    const RealFunction = globalThis.Function;
    let compiled = 0;
    const Spy = new Proxy(RealFunction, {
      construct(target, args) {
        compiled++;
        return Reflect.construct(target, args);
      },
    });
    globalThis.Function = Spy as FunctionConstructor;
    try {
      const entry = makeEntry(seriesConfig({ transform: 'return x;' }), async () => ({
        [ENTITY]: rows.map((r) => ({ ...r, a: {} })),
      }));
      await entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR));
      await entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR));
    } finally {
      globalThis.Function = RealFunction;
    }
    expect(compiled).toBe(1);
  });

  it('data_generator keeps working across refreshes', async () => {
    const entry = makeEntry(
      seriesConfig({ data_generator: 'return [[start.getTime(), 1], [end.getTime(), 2]];' }),
      async () => ({}),
    );
    for (let i = 0; i < 2; i++) {
      expect(await entry._updateHistory(new Date(T0), new Date(T0 + HOUR))).toBe(true);
      expect(entry.history).toEqual([
        [T0, 1],
        [T0 + HOUR, 2],
      ]);
    }
  });
});

describe('update lock', () => {
  it('is released when the history request fails', async () => {
    let fail = true;
    const entry = makeEntry(seriesConfig(), async () => {
      if (fail) throw new Error('connection lost');
      return { [ENTITY]: rows };
    });

    await expect(entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR))).rejects.toThrow('connection lost');

    fail = false;
    expect(await entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR))).toBe(true);
    expect(entry.history).toHaveLength(3);
  });

  it('is released when data_generator throws', async () => {
    const entry = makeEntry(seriesConfig({ data_generator: 'throw new Error("boom");' }), async () => ({}));
    await expect(entry._updateHistory(new Date(T0), new Date(T0 + HOUR))).rejects.toThrow('boom');
    await expect(entry._updateHistory(new Date(T0), new Date(T0 + HOUR))).rejects.toThrow('boom');
  });
});
