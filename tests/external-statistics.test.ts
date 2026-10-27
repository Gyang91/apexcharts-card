// External long-term statistics support: IDs shaped `source:object_id`
// (e.g. `veolia:1235075_daily_consumption`) have no entity in hass.states and
// no recorder history — only LTS data via recorder/statistics_during_period.
import '../src/apexcharts-card';
import GraphEntry from '../src/graphEntry';
import { mkHass, mkState } from './fixtures/hass';
import { computeName, computeUom, isExternalStatisticId } from '../src/utils';
import { getStatisticsMetadata } from '../src/recorder';
import { getSeriesEntitySchema } from '../src/editor/schemas/series';

const DAY = 24 * 3600 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const EXT_ID = 'veolia:1235075_daily_consumption';

const Ctor = () => customElements.get('apexcharts-card') as CustomElementConstructor;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const newCard = (): any => new (Ctor())();

function extBucket(statisticId: string, startMs: number, endMs: number, change: number): AnyRec {
  return {
    statistic_id: statisticId,
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

function mkMetadata(statisticId: string, name: string | null, unit: string | null): AnyRec {
  return {
    statistic_id: statisticId,
    source: statisticId.split(':')[0],
    name,
    display_unit_of_measurement: unit,
    statistics_unit_of_measurement: unit,
    unit_class: 'volume',
    has_mean: false,
    has_sum: true,
  };
}

beforeAll(async () => {
  await customElements.whenDefined('apexcharts-card');
});

describe('isExternalStatisticId', () => {
  it('matches source:object_id statistic IDs', () => {
    expect(isExternalStatisticId(EXT_ID)).toBe(true);
    expect(isExternalStatisticId('renault:kilometrage_zoe')).toBe(true);
  });

  it('rejects regular entity IDs and malformed values', () => {
    expect(isExternalStatisticId('sensor.water_meter')).toBe(false);
    expect(isExternalStatisticId('sensor.water:meter')).toBe(false);
    expect(isExternalStatisticId('Veolia:conso')).toBe(false);
    expect(isExternalStatisticId(':conso')).toBe(false);
    expect(isExternalStatisticId('veolia:')).toBe(false);
    expect(isExternalStatisticId('')).toBe(false);
    expect(isExternalStatisticId(undefined)).toBe(false);
  });
});

describe('setConfig validation', () => {
  it('throws a clear config error for an external statistic ID without the statistics option', () => {
    const card = newCard();
    expect(() => card.setConfig({ type: 'custom:apexcharts-card', series: [{ entity: EXT_ID }] })).toThrow(
      /statistics/,
    );
  });

  it('accepts an external statistic ID with the statistics option', () => {
    const card = newCard();
    expect(() =>
      card.setConfig({
        type: 'custom:apexcharts-card',
        series: [{ entity: EXT_ID, type: 'column', statistics: { type: 'change', period: 'day' } }],
      }),
    ).not.toThrow();
  });

  it('accepts a mixed card (regular entity + external statistic) and ignores extend_to on the external serie', () => {
    const card = newCard();
    expect(() =>
      card.setConfig({
        type: 'custom:apexcharts-card',
        series: [
          { entity: 'sensor.temp' },
          { entity: EXT_ID, type: 'column', statistics: { type: 'change', period: 'day' }, extend_to: 'now' },
        ],
      }),
    ).not.toThrow();
    expect(card._config.series[0].extend_to).toBe('end');
    expect(card._config.series[1].extend_to).toBe(false);
  });
});

describe('GraphEntry with an external statistic ID', () => {
  // Day-aligned boundaries, away from any DST transition in Europe/Paris
  const T0 = new Date('2026-07-01T00:00:00').getTime();

  function makeEntry(buckets: AnyRec[]): { entry: GraphEntry; callWS: ReturnType<typeof vi.fn> } {
    const config: AnyRec = {
      entity: EXT_ID,
      index: 0,
      type: 'column',
      statistics: { type: 'change', period: 'day' },
      group_by: { duration: '1h', offset: '+0h', func: 'raw', fill: 'last' },
      show: {},
      ignore_history: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = new GraphEntry(0, 2 * DAY, false, config as any, undefined);
    // No state object at all for the external ID
    const hass = mkHass({});
    const callWS = vi.fn(async (msg: AnyRec) =>
      msg.type === 'recorder/statistics_during_period' ? { [EXT_ID]: buckets } : {},
    );
    (hass as AnyRec).callWS = callWS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry.hass = hass as any;
    return { entry, callWS };
  }

  it('fetches statistics and builds correctly dated column buckets without any entity state', async () => {
    const { entry, callWS } = makeEntry([
      extBucket(EXT_ID, T0, T0 + DAY, 1.5),
      extBucket(EXT_ID, T0 + DAY, T0 + 2 * DAY, 2.5),
    ]);

    expect(await entry._updateHistory(new Date(T0), new Date(T0 + 2 * DAY))).toBe(true);
    expect(callWS).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'recorder/statistics_during_period',
        statistic_ids: [EXT_ID],
        period: 'day',
      }),
    );
    // Middle-aligned daily buckets with the `change` values
    expect(entry.history).toEqual([
      [T0 + DAY / 2, 1.5],
      [T0 + DAY + DAY / 2, 2.5],
    ]);
    expect(entry.lastState).toBe(2.5);
  });

  it('re-fetches on every update (no cache), so update_interval refreshes the serie', async () => {
    const { entry, callWS } = makeEntry([extBucket(EXT_ID, T0, T0 + DAY, 1.5)]);

    expect(await entry._updateHistory(new Date(T0), new Date(T0 + 2 * DAY))).toBe(true);
    expect(await entry._updateHistory(new Date(T0), new Date(T0 + 2 * DAY))).toBe(true);
    expect(callWS).toHaveBeenCalledTimes(2);
  });
});

describe('card with external statistic series', () => {
  const statsConfig = (entity: string): AnyRec => ({
    entity,
    type: 'column',
    statistics: { type: 'change', period: 'day' },
  });

  it('does not warn "entity not available" and builds a stable synthetic entity', () => {
    const card = newCard();
    card.setConfig({ type: 'custom:apexcharts-card', series: [statsConfig(EXT_ID)] });
    card.hass = mkHass({});
    expect(card._warning).toBe(false);
    expect(card._entities[0]).toBeDefined();
    expect(card._entities[0].entity_id).toBe(EXT_ID);
    // Metadata not fetched yet: falls back to the raw statistic ID
    expect(card._entities[0].attributes.friendly_name).toBe(EXT_ID);
    // Repeated hass assignments keep the same synthetic object (no re-render churn)
    const first = card._entities[0];
    card.hass = mkHass({});
    expect(card._entities[0]).toBe(first);
  });

  it('mixed card: still warns when the regular entity is missing, not for the external one', () => {
    const card = newCard();
    card.setConfig({
      type: 'custom:apexcharts-card',
      series: [statsConfig(EXT_ID), { entity: 'sensor.temp' }],
    });
    card.hass = mkHass({});
    expect(card._warning).toBe(true);

    const card2 = newCard();
    card2.setConfig({
      type: 'custom:apexcharts-card',
      series: [statsConfig(EXT_ID), { entity: 'sensor.temp' }],
    });
    card2.hass = mkHass({ 'sensor.temp': mkState('sensor.temp', '21.5', { unit_of_measurement: '°C' }) });
    expect(card2._warning).toBe(false);
    expect(card2._entities[0].entity_id).toBe(EXT_ID);
    expect(card2._entities[1].entity_id).toBe('sensor.temp');
  });

  it('applies recorder metadata to name/unit and the synthetic entity', async () => {
    const id = 'veolia:meta_applied';
    const card = newCard();
    card.setConfig({ type: 'custom:apexcharts-card', series: [statsConfig(id)] });
    const hass = mkHass({});
    (hass as AnyRec).callWS = vi.fn(async (msg: AnyRec) =>
      msg.type === 'recorder/get_statistics_metadata' ? [mkMetadata(id, 'Consommation eau', 'm³')] : {},
    );
    card.hass = hass;
    await card._applyExternalStatisticsMetadata();

    expect(card._config.series[0].name).toBe('Consommation eau');
    expect(card._config.series[0].unit).toBe('m³');
    expect(card._entities[0].attributes.friendly_name).toBe('Consommation eau');
    expect(computeName(0, card._config.series, card._entities)).toBe('Consommation eau');
    expect(computeUom(0, card._config.series, card._entities)).toBe('m³');
  });

  it('missing metadata: name falls back to the raw statistic ID', async () => {
    const id = 'veolia:meta_missing';
    const card = newCard();
    card.setConfig({ type: 'custom:apexcharts-card', series: [statsConfig(id)] });
    const hass = mkHass({});
    (hass as AnyRec).callWS = vi.fn(async () => []);
    card.hass = hass;
    await card._applyExternalStatisticsMetadata();

    expect(card._config.series[0].name).toBeUndefined();
    expect(card._entities[0].attributes.friendly_name).toBe(id);
    expect(computeName(0, card._config.series, card._entities)).toBe(id);
  });

  it('show.in_header: raw displays the latest statistic value', async () => {
    const id = 'veolia:header_raw';
    const card = newCard();
    card.setConfig({
      type: 'custom:apexcharts-card',
      series: [{ ...statsConfig(id), show: { in_header: 'raw' } }],
    });
    const now = Date.now();
    const hass = mkHass({});
    (hass as AnyRec).callWS = vi.fn(async (msg: AnyRec) =>
      msg.type === 'recorder/statistics_during_period' ? { [id]: [extBucket(id, now - DAY, now, 42)] } : {},
    );
    card.hass = hass;
    card._apexChart = { updateOptions: vi.fn(async () => undefined) };
    await card._updateData();

    expect(card._headerState[0]).toBe(42);
  });
});

describe('getStatisticsMetadata', () => {
  it('resolves the matching metadata and caches it per statistic ID', async () => {
    const id = 'test:metadata_cache';
    const hass = mkHass({});
    const callWS = vi.fn(async () => [mkMetadata(id, 'Cached', 'kWh')]);
    (hass as AnyRec).callWS = callWS;

    const meta1 = await getStatisticsMetadata(hass, id);
    const meta2 = await getStatisticsMetadata(hass, id);
    expect(meta1?.name).toBe('Cached');
    expect(meta2).toBe(meta1);
    expect(callWS).toHaveBeenCalledTimes(1);
    expect(callWS).toHaveBeenCalledWith({ type: 'recorder/get_statistics_metadata', statistic_ids: [id] });
  });

  it('resolves undefined when the recorder has no metadata for the ID', async () => {
    const id = 'test:metadata_missing';
    const hass = mkHass({});
    (hass as AnyRec).callWS = vi.fn(async () => []);
    expect(await getStatisticsMetadata(hass, id)).toBeUndefined();
  });

  it('resolves undefined without hass', async () => {
    expect(await getStatisticsMetadata(undefined, 'test:no_hass')).toBeUndefined();
  });
});

describe('name/unit fallbacks for external statistics', () => {
  it('computeName falls back to the raw statistic ID without any entity', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeName(0, [{ entity: EXT_ID }] as any)).toBe(EXT_ID);
  });

  it('series name/unit overrides still win', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const series = [{ entity: EXT_ID, name: 'Eau', unit: 'L' }] as any;
    expect(computeName(0, series)).toBe('Eau');
    expect(computeUom(0, series)).toBe('L');
  });
});

describe('editor entity schema', () => {
  it('uses the regular entity selector outside statistics mode', () => {
    expect(getSeriesEntitySchema(false)).toEqual([{ name: 'entity', selector: { entity: {} } }]);
  });

  it('switches to the statistic picker when statistics mode is active', () => {
    expect(getSeriesEntitySchema(true)).toEqual([{ name: 'entity', selector: { statistic: {} } }]);
  });
});
