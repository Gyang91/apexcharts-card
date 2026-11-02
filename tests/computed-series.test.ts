// A series computed from other series (RomRider#900): timestamp alignment,
// the compute data source in GraphEntry, config rules and load order.
import '../src/apexcharts-card';
import GraphEntry from '../src/graphEntry';
import { alignSeries } from '../src/align';
import { computeName } from '../src/utils';
import type { ChartCardExternalConfig } from '../src/types-config';
import type { EntityCachePoints } from '../src/types';
import { mkHass, mkState } from './fixtures/hass';

const HOUR = 3600 * 1000;
const T0 = new Date('2026-07-01T00:00:00').getTime();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const createCard = (extra: Partial<ChartCardExternalConfig>): AnyRec => {
  const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as unknown as AnyRec;
  card.setConfig({ type: 'custom:apexcharts-card', series: [], ...extra });
  return card;
};

function computedEntry(compute: string, extra: AnyRec = {}): GraphEntry {
  const config = {
    compute,
    index: 0,
    group_by: { duration: '1h', offset: '+0h', func: 'raw', fill: 'last' },
    show: {},
    ignore_history: false,
    ...extra,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = new GraphEntry(0, 24 * HOUR, true, config as any, undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry.hass = mkHass({}) as any;
  return entry;
}

describe('alignSeries', () => {
  const a: EntityCachePoints = [
    [0, 1],
    [20, 3],
  ];
  const b: EntityCachePoints = [
    [10, 5],
    [20, null],
    [30, NaN],
  ];

  it('without hold, a series only has values at its own timestamps', () => {
    expect(alignSeries([a, b])).toEqual([
      [0, [1, null]],
      [10, [null, 5]],
      [20, [3, null]],
      [30, [null, null]],
    ]);
  });

  it('with hold, a series keeps its last value until its next point', () => {
    expect(alignSeries([a, b], true)).toEqual([
      [0, [1, null]],
      [10, [1, 5]],
      [20, [3, null]],
      [30, [3, null]],
    ]);
  });

  it('takes the last point of a repeated timestamp', () => {
    expect(
      alignSeries([
        [
          [0, 1],
          [0, 2],
        ],
      ]),
    ).toEqual([[0, [2]]]);
  });
});

describe('GraphEntry compute', () => {
  const inputs = {
    import: [
      [T0, 500],
      [T0 + 2 * HOUR, 800],
    ] as EntityCachePoints,
    export: [
      [T0 + HOUR, 200],
      [T0 + 2 * HOUR, 0],
    ] as EntityCachePoints,
  };

  it('applies the function at every input timestamp, each input holding its value', async () => {
    const entry = computedEntry('return values.import - values.export;');
    expect(await entry._updateHistory(new Date(T0), new Date(T0 + 3 * HOUR), inputs)).toBe(true);
    // At T0 export has no value yet: 500 - null is 500 in JS
    expect(entry.history).toEqual([
      [T0, 500],
      [T0 + HOUR, 300],
      [T0 + 2 * HOUR, 800],
    ]);
    expect(entry.lastState).toBe(800);
  });

  it('gives the timestamp and hass, and turns non-finite results into null', async () => {
    const entry = computedEntry('return x === values.t ? 1 / values.v : "a";');
    await entry._updateHistory(new Date(T0), new Date(T0 + HOUR), {
      t: [[T0, T0]],
      v: [
        [T0, 0],
        [T0 + 1, 4],
      ],
    });
    expect(entry.history).toEqual([
      [T0, null],
      [T0 + 1, null],
    ]);
  });

  it('buckets the result with its own group_by', async () => {
    const entry = computedEntry('return values.a * 2;', {
      group_by: { duration: '1h', offset: '+0h', func: 'avg', fill: 'null' },
    });
    // Fixed-duration buckets start one step before the range: the first one is dropped
    await entry._updateHistory(new Date(T0), new Date(T0 + 2 * HOUR), {
      a: [
        [T0 + HOUR, 1],
        [T0 + 1.5 * HOUR, 3],
      ],
    });
    expect(entry.history).toEqual([[T0 + HOUR, 4]]);
  });

  it('names the function in its errors', async () => {
    const entry = computedEntry('return values.a.b.c;');
    await expect(entry._updateHistory(new Date(T0), new Date(T0 + HOUR), { a: [[T0, 1]] })).rejects.toThrow(
      /in 'return values\.a\.b\.c;'/,
    );
  });
});

describe('computed series config', () => {
  const sources = [
    { entity: 'sensor.import', id: 'import' },
    { entity: 'sensor.export', id: 'export' },
  ];

  it('requires an entity unless the series is computed', () => {
    expect(() => createCard({ series: [{} as never] })).toThrow(/'entity' is required/);
    expect(() => createCard({ series: [...sources, { compute: 'return 1;' }] })).not.toThrow();
  });

  it('rejects options that pick an entity data on a computed series', () => {
    expect(() => createCard({ series: [{ compute: 'return 1;', statistics: { type: 'mean' } } as never] })).toThrow(
      /can't use 'statistics'/,
    );
    expect(() => createCard({ series: [{ compute: 'return 1;', entity: 'sensor.a' }] })).toThrow(/can't use 'entity'/);
  });

  it('does not inherit those options from all_series_config', () => {
    const card = createCard({
      all_series_config: { statistics: { type: 'mean' }, stroke_width: 3 },
      series: [...sources, { compute: 'return 1;' }],
    });
    expect(card._config.series[2].statistics).toBeUndefined();
    expect(card._config.series[2].stroke_width).toBe(3);
    expect(card._config.series[0].statistics).toEqual({ type: 'mean' });
  });

  it('rejects duplicate series IDs', () => {
    expect(() =>
      createCard({
        series: [
          { entity: 'sensor.a', id: 'x' },
          { entity: 'sensor.b', id: 'x' },
        ],
      }),
    ).toThrow(/Series IDs must be unique: x/);
  });

  it('is named after its id when it has no name', () => {
    expect(computeName(undefined, 0, [{ compute: 'return 1;', id: 'net' }])).toBe('net');
    expect(computeName(undefined, 0, [{ compute: 'return 1;', id: 'net', name: 'Net grid' }])).toBe('Net grid');
  });
});

describe('computed series in the card', () => {
  it('loads its sources first and reads them on the chart time axis', async () => {
    const card = createCard({
      series: [
        { entity: 'sensor.import', id: 'import', offset: '-1h' },
        { compute: 'return values.import - values.export;', id: 'net' },
        { entity: 'sensor.export', id: 'export', time_delta: '+1h' },
        { compute: 'return values.net * 2 + (values.later ?? 0);' },
        { compute: 'return 7;', id: 'later' },
      ],
    });
    const calls: string[] = [];
    card._graphs.forEach((graph: AnyRec, index: number) => {
      const real = graph._updateHistory.bind(graph);
      graph._updateHistory = async (start: Date, end: Date, inputs?: Record<string, EntityCachePoints>) => {
        calls.push(`${index}`);
        if (!card._config.series[index].compute) {
          // Source histories, as fetched (before their offset / time_delta)
          Object.defineProperty(graph, 'history', {
            value: index === 0 ? [[T0 - HOUR, 500]] : [[T0 - HOUR, 200]],
          });
          return true;
        }
        return real(start, end, inputs);
      };
    });
    const results = await card._updateHistories(new Date(T0), new Date(T0 + HOUR), false);
    expect(results.every((result: PromiseSettledResult<unknown>) => result.status === 'fulfilled')).toBe(true);
    // Sources first, then computed series in config order
    expect(calls).toEqual(['0', '2', '1', '3', '4']);
    // import is shifted +1h by its offset, export +1h by its time_delta: both at T0
    expect(card._graphs[1].history).toEqual([[T0, 300]]);
    // A computed series reads the computed series above it, not the ones below
    expect(card._graphs[3].history).toEqual([[T0, 600]]);
  });

  it('does not warn about a missing entity for a computed series', () => {
    const card = createCard({
      series: [{ entity: 'sensor.a', id: 'a' }, { compute: 'return values.a;' }],
    });
    card.hass = mkHass({ 'sensor.a': mkState('sensor.a', '1') });
    expect(card._warning).toBe(false);
    expect(card._hasNoEntityState(1)).toBe(true);
    expect(card._hasNoEntityState(0)).toBe(false);
  });
});

describe('README compute examples', () => {
  it('accept the rooms total and share example', () => {
    const card = createCard({
      all_series_config: { yaxis_id: 'power', statistics: { type: 'mean', period: 'hour' } },
      series: [
        { entity: 'sensor.kitchen_power', id: 'kitchen' },
        { entity: 'sensor.office_power', id: 'office' },
        { entity: 'sensor.living_power', id: 'living' },
        { name: 'Total', id: 'total', compute: 'return values.kitchen + values.office + values.living;' },
        {
          name: 'Office share',
          unit: '%',
          yaxis_id: 'percent',
          compute: 'return values.total ? (values.office / values.total) * 100 : null;',
        },
      ],
      yaxis: [{ id: 'power' }, { id: 'percent', opposite: true, min: 0, max: 100 }],
    });
    expect(card._config.series.map((serie: AnyRec) => serie.yaxis_id)).toEqual([
      'power',
      'power',
      'power',
      'power',
      'percent',
    ]);
    expect(card._config.series[3].statistics).toBeUndefined();
  });
});
