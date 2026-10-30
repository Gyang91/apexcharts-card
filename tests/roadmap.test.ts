import '../src/apexcharts-card';
import '../src/editor/tabs/general-tab';
import { navigationRange } from '../src/calendar';
import { rangeAreaData, heatmapData, assertHeatmapBudget } from '../src/visual-data';
import { applyPreset } from '../src/editor/presets';
import { mkHass, mkState } from './fixtures/hass';
import { setLocale } from '../src/localize';
import type { ChartCardExternalConfig } from '../src/types-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCard = any;

const config = (extra: Partial<ChartCardExternalConfig> = {}): ChartCardExternalConfig => ({
  type: 'custom:apexcharts-card',
  series: [{ entity: 'sensor.a' }],
  ...extra,
});
const card = (extra: Partial<ChartCardExternalConfig> = {}): AnyCard => {
  const result = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
  result.setConfig(config(extra));
  result._hass = mkHass();
  return result;
};

describe('calendar navigation', () => {
  afterEach(() => {
    vi.useRealTimers();
    setLocale('en');
  });

  it.each([
    ['2026-03-29T12:00Z', 23],
    ['2026-10-25T12:00Z', 25],
  ])('uses actual calendar day length across DST at %s', (date, hours) => {
    const { start, end } = navigationRange(Date.parse(String(date)), 'day', 'Europe/Berlin');
    expect(end.getTime() - start.getTime()).toBe(Number(hours) * 3600000);
  });

  it('uses ISO weeks and leap-month boundaries', () => {
    const week = navigationRange(Date.parse('2026-01-01T12:00Z'), 'week', 'UTC');
    expect(week.start.toISOString()).toBe('2025-12-29T00:00:00.000Z');
    expect(week.end.toISOString()).toBe('2026-01-05T00:00:00.000Z');
    const month = navigationRange(Date.parse('2024-02-29T12:00Z'), 'month', 'UTC');
    expect(month.start.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(month.end.toISOString()).toBe('2024-03-01T00:00:00.000Z');
  });

  it('ends a skipped-midnight day at the following midnight rather than carrying 01:00 forward', () => {
    const range = navigationRange(Date.parse('2023-09-03T15:00Z'), 'day', 'America/Santiago');
    expect(range.start.toISOString()).toBe('2023-09-03T04:00:00.000Z');
    expect(range.end.toISOString()).toBe('2023-09-04T03:00:00.000Z');
    expect(() =>
      assertHeatmapBudget(
        [{ entity: 'sensor.a', group_by: { func: 'avg', period: 'day' } }],
        range.start.getTime(),
        range.end.getTime(),
        'America/Santiago',
        1,
      ),
    ).not.toThrow();
  });

  it('does not alter default ranges when disabled', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00Z'));
    const result = card({ graph_span: '6h' });
    expect(result._getSpanDates().end.getTime() - result._getSpanDates().start.getTime()).toBe(6 * 3600000 - 1);
    expect(result._renderNavigation().strings.join('')).toBe('');
  });

  it('resets cached history on navigation, ignores busy clicks and returns to current period', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00Z'));
    const result = card({ navigation: { show: true } });
    result._apexChart = {};
    result._graphs = [{ resetHistory: vi.fn() }];
    result._updateData = vi.fn(async () => {
      result._updating = false;
    });
    await result._navigate('day', -1);
    expect(result._getSpanDates().start.getTime()).toBeLessThan(Date.parse('2026-10-30T00:00Z'));
    expect(result._graphs[0].resetHistory).toHaveBeenCalledOnce();
    result._updating = true;
    await result._navigate('month');
    expect(result._navigationPeriod).toBe('day');
    result._updating = false;
    await result._navigate('month', 0);
    expect(result._navigationAnchor).toBeUndefined();
    expect(result._navigationPeriod).toBe('month');
  });

  it('rejects ambiguous span and non-timeline navigation', () => {
    expect(() => card({ navigation: { show: true }, span: { start: 'day' } })).toThrow(/span/);
    expect(() => card({ navigation: { show: true }, chart_type: 'pie' })).toThrow(/timeline/);
  });

  it('fetches the earlier full period rather than reusing later cached history', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00Z'));
    const result = card({ navigation: { show: true } });
    const hass = mkHass({ 'sensor.a': mkState('sensor.a', '5') });
    hass.locale.language = 'en';
    const calls: { start_time: string; end_time: string }[] = [];
    hass.callWS = vi.fn(async (message: AnyCard) => {
      calls.push(message);
      return { 'sensor.a': [{ s: '5', lu: Date.parse(message.start_time) / 1000 + 1 }] };
    }) as typeof hass.callWS;
    result.hass = hass;
    result._apexChart = { updateOptions: vi.fn().mockResolvedValue(undefined) };
    await result._updateData();
    const previousStart = result._getSpanDates().start.getTime();
    await result._navigate('day', -1);
    expect(calls).toHaveLength(2);
    expect(Date.parse(calls[1].end_time)).toBe(previousStart);
    expect(Date.parse(calls[1].start_time)).toBeLessThan(Date.parse(calls[0].start_time));
    expect(result._graphs[0].history.every(([time]: [number]) => time <= previousStart)).toBe(true);
    expect(result._loadError).toBeUndefined();
  });
});

describe('bounded visual data', () => {
  afterEach(() => {
    vi.useRealTimers();
    setLocale('en');
  });

  it('builds a statistics min/max envelope from one shared recorder response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00Z'));
    const result = card({
      chart_type: 'rangeArea',
      graph_span: '7d',
      series: [
        { entity: 'sensor.a', statistics: { type: 'min', period: 'day', align: 'start' } },
        { entity: 'sensor.a', statistics: { type: 'max', period: 'day', align: 'start' } },
      ],
    });
    const hass = mkHass({ 'sensor.a': mkState('sensor.a', '8', { unit_of_measurement: '°C' }) });
    hass.locale.language = 'en';
    const callWS = vi.fn().mockResolvedValue({
      'sensor.a': [
        {
          statistic_id: 'sensor.a',
          start: Date.parse('2026-10-29'),
          end: Date.parse('2026-10-30'),
          min: 5,
          max: 12,
          mean: 8,
        },
      ],
    });
    hass.callWS = callWS;
    result.hass = hass;
    result._apexChart = { updateOptions: vi.fn().mockResolvedValue(undefined) };
    await result._updateData();
    expect(callWS).toHaveBeenCalledOnce();
    expect(result._apexChart.updateOptions.mock.calls[0][0].series[0].data).toEqual([
      { x: Date.parse('2026-10-29'), y: [5, 12] },
    ]);
    expect(result._headerState).toEqual([5, 12]);
    expect(result._loadError).toBeUndefined();
  });

  it('pairs exact timestamps without interpolating missing bounds or changing inputs', () => {
    const lower: [number, number | null][] = [
      [0, 1],
      [1, null],
      [2, 0],
      [3, 5],
    ];
    const upper: [number, number | null][] = [
      [0, 2],
      [1, 3],
      [2, 0],
      [4, 8],
    ];
    expect(rangeAreaData(lower, upper)).toEqual([
      { x: 0, y: [1, 2] },
      { x: 1, y: [null, null] },
      { x: 2, y: [0, 0] },
      { x: 3, y: [null, null] },
      { x: 4, y: [null, null] },
    ]);
    expect(lower[1][1]).toBeNull();
  });

  it('rejects inverted bounds and ambiguous timestamps', () => {
    expect(() => rangeAreaData([[0, 3]], [[0, 2]])).toThrow(/lower bound/);
    expect(() =>
      rangeAreaData(
        [
          [0, 1],
          [0, 2],
        ],
        [],
      ),
    ).toThrow(/timestamps/);
    expect(() => heatmapData([[[NaN, 1]]])).toThrow(/timestamps/);
  });

  it('aligns heatmap rows and preserves zeros and missing cells', () => {
    expect(
      heatmapData(
        [
          [
            [0, 0],
            [2, 5],
          ],
          [[1, 7]],
        ],
        6,
      ),
    ).toEqual([
      [
        { x: 0, y: 0 },
        { x: 1, y: null },
        { x: 2, y: 5 },
      ],
      [
        { x: 0, y: null },
        { x: 1, y: 7 },
        { x: 2, y: null },
      ],
    ]);
  });

  it('enforces total aligned cell count at the exact limit without silently truncating', () => {
    const row: [number, number][] = Array.from({ length: 256 }, (_, i) => [i, i]);
    expect(heatmapData([row, row], 512)[0]).toHaveLength(256);
    expect(() => heatmapData([row, row], 511)).toThrow(/511 cells/);
    expect(() => heatmapData([row], 2049)).toThrow(/2048/);
    expect(() => heatmapData([row], 0.5)).toThrow(/integer/);
  });

  it('validates unsupported visual configurations before loading any data', () => {
    expect(() => card({ chart_type: 'rangeArea' })).toThrow(/exactly two/);
    expect(() => card({ chart_type: 'heatmap' })).toThrow(/aggregation/);
    expect(() =>
      card({ chart_type: 'heatmap', series: [{ entity: 'sensor.a', group_by: { func: 'avg' } }], stacked: true }),
    ).toThrow(/stacking/);
    expect(() => card({ heatmap: { max_cells: 10 } })).toThrow(/chart_type/);
  });

  it('rejects projected excessive buckets before any history fetch and keeps last good data', async () => {
    const result = card({
      chart_type: 'heatmap',
      graph_span: '365d',
      series: [{ entity: 'sensor.a', group_by: { func: 'avg', duration: '1min' } }],
    });
    result._apexChart = { updateOptions: vi.fn() };
    result._graphs = [{ _updateHistory: vi.fn() }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await result._updateData();
    expect(result._graphs[0]._updateHistory).not.toHaveBeenCalled();
    expect(result._apexChart.updateOptions).not.toHaveBeenCalled();
    expect(result._loadError).toContain('Heatmap exceeds 512 cells');
    expect(result._updating).toBe(false);
    warn.mockRestore();
  });

  it('counts calendar and statistics buckets across DST without unbounded boundary arrays', () => {
    const start = Date.parse('2026-03-29T00:00+01:00');
    const end = Date.parse('2026-03-30T00:00+02:00');
    expect(() =>
      assertHeatmapBudget([{ entity: 'sensor.a', statistics: { period: 'hour' } }], start, end, 'Europe/Berlin', 23),
    ).not.toThrow();
    expect(() =>
      assertHeatmapBudget([{ entity: 'sensor.a', statistics: { period: 'hour' } }], start, end, 'Europe/Berlin', 22),
    ).toThrow(/22 cells/);
    expect(() =>
      assertHeatmapBudget(
        [{ entity: 'sensor.a', group_by: { func: 'avg', period: 'month' } }],
        Date.parse('2024-01-01'),
        Date.parse('2025-01-01'),
        'UTC',
        12,
      ),
    ).not.toThrow();
  });
});

describe('explicit editor presets', () => {
  it('keeps entity identity, units, transforms and actions without mutating config', () => {
    const original = config({
      chart_type: 'heatmap',
      heatmap: { max_cells: 99 },
      all_series_config: { statistics: { type: 'sum' }, group_by: { func: 'sum' }, color: 'red' },
      series: [
        {
          entity: 'sensor.a',
          unit: 'W',
          transform: 'return x * 2;',
          header_actions: { tap_action: { action: 'more-info' } },
        },
      ],
    });
    const next = applyPreset(original, 'power');
    expect(next.chart_type).toBeUndefined();
    expect(next.heatmap).toBeUndefined();
    expect(next.all_series_config?.statistics).toBeUndefined();
    expect(next.all_series_config?.color).toBe('red');
    expect(next.series[0]).toMatchObject({
      entity: 'sensor.a',
      unit: 'W',
      transform: 'return x * 2;',
      type: 'line',
      group_by: { func: 'avg', duration: '5min' },
      header_actions: original.series[0].header_actions,
    });
    expect(original.chart_type).toBe('heatmap');
    expect(original.all_series_config?.statistics?.type).toBe('sum');
  });

  it('keeps consumption change separate from mean power and external statistics mean', () => {
    const energy = applyPreset(config(), 'consumption');
    expect(energy.series[0]).toMatchObject({
      type: 'column',
      statistics: { type: 'change', period: 'day' },
      group_by: { func: 'raw' },
      extend_to: false,
    });
    const temperature = applyPreset(config({ series: [{ entity: 'import:temp' }] }), 'temperature');
    expect(temperature.series[0].statistics?.type).toBe('mean');
    expect(() => card(energy)).not.toThrow();
    expect(card({ ...energy, chart_type: 'line' })._config.series[0].type).toBe('column');
  });

  it('only emits a preset after explicit action and preserves config through editor events', () => {
    const editor = new (customElements.get('apexcharts-card-editor-general') as CustomElementConstructor)() as AnyCard;
    editor.config = config();
    const changed = vi.fn();
    editor.addEventListener('config-changed', changed);
    expect(changed).not.toHaveBeenCalled();
    editor._applyPreset('consumption');
    expect(changed.mock.calls[0][0].detail.config.series[0].statistics.type).toBe('change');
    editor.config = config({ span: { start: 'day' }, navigation: { initial: 'week' } });
    editor._navigationChanged(new CustomEvent('value-changed', { detail: { value: true } }));
    expect(changed.mock.calls[1][0].detail.config.navigation).toEqual({ show: true, initial: 'week' });
    expect(changed.mock.calls[1][0].detail.config.span).toBeUndefined();
  });
});
