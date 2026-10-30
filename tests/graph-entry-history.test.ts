// Recent history is loaded over the websocket (history/history_during_period)
// with the smallest payload the series needs; user functions are compiled once
// per series; a failed load never leaves the series locked.
import GraphEntry from '../src/graphEntry';
import localForage from 'localforage';
import * as pjson from '../package.json';
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

function makeEntry(config: AnyRec, callWS: (msg: AnyRec) => Promise<unknown>, cache = false): GraphEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = new GraphEntry(0, 24 * HOUR, cache, config as any, undefined);
  const hass = mkHass({ [config.entity]: mkState(config.entity, '21', { unit_of_measurement: '°C' }) }) as AnyRec;
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

describe('binary sensor states', () => {
  const binary = 'binary_sensor.heating';
  const states = ['on', 'off', 'unknown', 'unavailable', 'on'];
  const binaryRows = states.map((s, i) => ({
    s,
    lu: (T0 + i * HOUR) / 1000,
    a: { battery: '80', mode: 'on' },
  }));

  it.each([
    ['previous version', '0.0.0', [null, null], 1],
    ['current version', pjson.version, [1, 0], 0],
  ])('handles %s cached history before the asynchronous purge finishes', async (_, version, cached, requests) => {
    const getItem = vi.spyOn(localForage, 'getItem').mockResolvedValue({
      span: 24 * HOUR,
      card_version: version,
      last_fetched: new Date(),
      data: [
        [T0, cached[0]],
        [T0 + HOUR, cached[1]],
      ],
    });
    const setItem = vi.spyOn(localForage, 'setItem').mockImplementation(async (_key, value) => value);
    try {
      const callWS = vi.fn(async () => ({ [binary]: binaryRows.slice(0, 2) }));
      const entry = makeEntry(seriesConfig({ entity: binary }), callWS, true);
      const hass = (entry as AnyRec)._hass;
      hass.states[binary].last_changed = new Date(T0 + HOUR).toISOString();
      await entry._updateHistory(new Date(T0), new Date(T0 + 2 * HOUR));
      expect(callWS).toHaveBeenCalledTimes(requests);
      expect(entry.history).toEqual([
        [T0, 1],
        [T0 + HOUR, 0],
      ]);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it.each([
    [undefined, [1, 0, null, null, 1]],
    ['zero', [1, 0, 0, 0, 1]],
    ['last', [1, 0, 0, 0, 1]],
  ])('maps raw on/off and respects fill_raw: %s', async (fill_raw, expected) => {
    const entry = makeEntry(seriesConfig({ entity: binary, fill_raw }), async () => ({ [binary]: binaryRows }));
    await entry._updateHistory(new Date(T0), new Date(T0 + 5 * HOUR));
    expect(entry.history.map(([, value]) => value)).toEqual(expected);
  });

  it('passes original strings to explicit transforms instead of converting them first', async () => {
    const entry = makeEntry(
      seriesConfig({
        entity: binary,
        transform: "return x === 'on' ? 0 : x === 'off' ? 1 : null;",
      }),
      async () => ({ [binary]: binaryRows }),
    );
    await entry._updateHistory(new Date(T0), new Date(T0 + 5 * HOUR));
    expect(entry.history.map(([, value]) => value)).toEqual([0, 1, null, null, 0]);
  });

  it('does not convert attributes or other nonnumeric domains', async () => {
    const attribute = makeEntry(seriesConfig({ entity: binary, attribute: 'battery' }), async () => ({
      [binary]: binaryRows,
    }));
    await attribute._updateHistory(new Date(T0), new Date(T0 + 5 * HOUR));
    expect(attribute.history.map(([, value]) => value)).toEqual([80, 80, 80, 80, 80]);

    const textAttribute = makeEntry(seriesConfig({ entity: binary, attribute: 'mode' }), async () => ({
      [binary]: binaryRows,
    }));
    await textAttribute._updateHistory(new Date(T0), new Date(T0 + 5 * HOUR));
    expect(textAttribute.history.map(([, value]) => value)).toEqual([null, null, null, null, null]);

    const sensor = makeEntry(seriesConfig(), async () => ({ [ENTITY]: binaryRows }));
    await sensor._updateHistory(new Date(T0), new Date(T0 + 5 * HOUR));
    expect(sensor.history.map(([, value]) => value)).toEqual([null, null, null, null, null]);
  });

  it.each([
    ['on', 1],
    ['off', 0],
    ['unknown', null],
    ['unavailable', null],
  ])('also converts %s when ignore_history is enabled', async (state, expected) => {
    const entry = makeEntry(seriesConfig({ entity: binary, ignore_history: true }), async () => {
      throw new Error('ignore_history must not request history');
    });
    entry.hass = mkHass({ [binary]: mkState(binary, state) });
    await entry._updateHistory(new Date(T0), new Date(T0 + HOUR));
    expect(entry.history.map(([, value]) => value)).toEqual([expected]);
  });
});

describe('websocket recent history', () => {
  it('isolates transforms from the statistics row shared by concurrent series', async () => {
    const connection = {};
    const hass = mkHass({ [ENTITY]: mkState(ENTITY, '1') }) as AnyRec;
    const item = {
      statistic_id: ENTITY,
      start: T0,
      end: T0 + HOUR,
      last_reset: null,
      max: 10,
      mean: 5,
      min: 1,
      sum: null,
      state: null,
      change: null,
    };
    hass.connection = connection;
    hass.callWS = vi.fn(async () => ({ [ENTITY]: [item] }));
    const lower = new GraphEntry(
      0,
      24 * HOUR,
      false,
      seriesConfig({ statistics: { type: 'min', period: 'hour' }, transform: 'entity.max = 999; return x;' }) as never,
      undefined,
    );
    const upper = new GraphEntry(
      0,
      24 * HOUR,
      false,
      seriesConfig({ statistics: { type: 'max', period: 'hour' } }) as never,
      undefined,
    );
    lower.hass = hass;
    upper.hass = hass;

    await Promise.all([
      lower._updateHistory(new Date(T0), new Date(T0 + HOUR)),
      upper._updateHistory(new Date(T0), new Date(T0 + HOUR)),
    ]);

    expect(hass.callWS).toHaveBeenCalledOnce();
    expect(lower.history[0][1]).toBe(1);
    expect(upper.history[0][1]).toBe(10);
    expect(item.max).toBe(10);
  });

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

describe('refreshes', () => {
  it('reuses the history in memory and only asks for what changed', async () => {
    const calls: AnyRec[] = [];
    const entry = makeEntry(seriesConfig(), async (msg) => {
      calls.push(msg);
      return calls.length === 1
        ? { [ENTITY]: rows.slice(0, 2) }
        : { [ENTITY]: [{ s: '22', lu: (T0 + 2 * HOUR) / 1000 }] };
    });
    const hass = (entry as AnyRec)._hass;
    const setState = (ts: number) => {
      entry.hass = {
        ...hass,
        states: { [ENTITY]: { ...hass.states[ENTITY], last_changed: new Date(ts).toISOString() } },
      };
    };

    setState(T0 + HOUR);
    await entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR));
    // Unchanged entity: no request at all
    await entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR));
    expect(calls).toHaveLength(1);

    // New state: one request from just after the last point, without the start state
    setState(T0 + 2 * HOUR);
    await entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR));
    expect(calls).toHaveLength(2);
    expect(new Date(calls[1].start_time).getTime()).toBe(T0 + HOUR + 1);
    expect(calls[1].include_start_time_state).toBe(false);
    expect(entry.history).toEqual([
      [T0, 20.5],
      [T0 + HOUR, 21],
      [T0 + 2 * HOUR, 22],
    ]);
  });
});

describe('group_by fill last', () => {
  it('starts from the value held before the window (sparse sensor, cached history)', async () => {
    const MIN = 60 * 1000;
    // A cached point before the window start, then a change late in the window:
    // the leading buckets must hold the earlier value, not be cut off.
    const entry = makeEntry(
      seriesConfig({ type: 'line', group_by: { duration: '10min', offset: '+0h', func: 'avg', fill: 'last' } }),
      async () => ({
        [ENTITY]: [
          { s: '10', lu: (T0 - 5 * MIN) / 1000 },
          { s: '12', lu: (T0 + 2 * HOUR) / 1000 },
        ],
      }),
    );

    await entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR));

    const history = entry.history;
    expect(history[0][0]).toBeLessThanOrEqual(T0 + 10 * MIN);
    expect(history[0][1]).toBe(10);
    expect(history.filter(([, v]) => v === null)).toHaveLength(0);
    expect(history[history.length - 1][1]).toBe(12);
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

describe('min and max', () => {
  const withHistory = (history: unknown[][]): GraphEntry => {
    const entry = makeEntry(seriesConfig(), async () => ({}));
    (entry as AnyRec)._computedHistory = history;
    return entry;
  };

  it('ignore null values', () => {
    const entry = withHistory([
      [T0, null],
      [T0 + 1, 3],
      [T0 + 2, -2],
      [T0 + 3, null],
      [T0 + 4, 7],
    ]);
    expect(entry.min).toBe(-2);
    expect(entry.max).toBe(7);
  });

  it('keep the previous results without history or values', () => {
    expect(withHistory([]).min).toBeUndefined();
    expect(withHistory([]).max).toBeUndefined();
    const nulls = withHistory([[T0, null]]);
    expect(nulls.min).toBe(Infinity);
    expect(nulls.max).toBe(-Infinity);
  });

  // Spreading this many values into Math.min/max throws a RangeError
  it('handle histories beyond the engine argument limit', () => {
    const history = Array.from({ length: 300_000 }, (_, i) => [T0 + i, i % 1000]);
    history[150_000] = [T0 + 150_000, -5];
    history[200_000] = [T0 + 200_000, 5000];
    const entry = withHistory(history);
    expect(entry.min).toBe(-5);
    expect(entry.max).toBe(5000);
  });
});
