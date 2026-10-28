// Side-effect import: registers the `apexcharts-card` custom element.
// The module also purges stale localForage entries at import time (caught internally)
// and reads `window`/`document` -- all provided by the happy-dom environment.
import '../src/apexcharts-card';
import { mkHass, mkState } from './fixtures/hass';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCard = any;

describe('apexcharts-card', () => {
  beforeAll(async () => {
    await customElements.whenDefined('apexcharts-card');
  });

  it('registers the custom element', () => {
    expect(customElements.get('apexcharts-card')).toBeDefined();
  });

  describe('setConfig', () => {
    const Ctor = () => customElements.get('apexcharts-card') as CustomElementConstructor;
    const newCard = (): AnyCard => new (Ctor())();

    it('throws on a null config', () => {
      const card = newCard();
      expect(() => card.setConfig(null)).toThrow();
    });

    it('throws on an empty config', () => {
      const card = newCard();
      expect(() => card.setConfig({})).toThrow();
    });

    it('throws when series is missing', () => {
      const card = newCard();
      expect(() => card.setConfig({ type: 'custom:apexcharts-card' })).toThrow(/series/);
    });

    it('throws on an unknown top-level key (strict ts-interface-checker validation)', () => {
      const card = newCard();
      expect(() =>
        card.setConfig({
          type: 'custom:apexcharts-card',
          series: [{ entity: 'sensor.temp' }],
          not_a_real_key: true,
        }),
      ).toThrow(/extraneous/);
    });

    it('accepts a minimal valid config', () => {
      const card = newCard();
      expect(() =>
        card.setConfig({ type: 'custom:apexcharts-card', series: [{ entity: 'sensor.temp' }] }),
      ).not.toThrow();
    });

    it('migrates the legacy `entities` key to `series`', () => {
      const card = newCard();
      expect(() =>
        card.setConfig({ type: 'custom:apexcharts-card', entities: [{ entity: 'sensor.temp' }] }),
      ).not.toThrow();
      expect(card._config.series).toHaveLength(1);
      expect(card._config.series[0].entity).toBe('sensor.temp');
      expect(card._config.entities).toBeUndefined();
    });

    it('accepts appearance: "minimal"', () => {
      const card = newCard();
      expect(() =>
        card.setConfig({
          type: 'custom:apexcharts-card',
          appearance: 'minimal',
          series: [{ entity: 'sensor.temp' }],
        }),
      ).not.toThrow();
    });

    it('throws on an invalid appearance value', () => {
      const card = newCard();
      expect(() =>
        card.setConfig({
          type: 'custom:apexcharts-card',
          appearance: 'invalid',
          series: [{ entity: 'sensor.temp' }],
        }),
      ).toThrow();
    });
  });

  describe('getGridOptions', () => {
    it('returns a fixed 12-column, auto-height grid layout', () => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      card.setConfig({ type: 'custom:apexcharts-card', series: [{ entity: 'sensor.temp' }] });
      const grid = card.getGridOptions();
      expect(grid).toEqual({ columns: 12, rows: 'auto', min_columns: 6, min_rows: 2 });
      expect(grid.columns % 3).toBe(0);
    });
  });

  describe('filling a fixed-height sections cell', () => {
    const cardWith = (extra: Record<string, unknown> = {}, layout?: string): AnyCard => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      card.setConfig({ type: 'custom:apexcharts-card', series: [{ entity: 'sensor.temp' }], ...extra });
      card.layout = layout;
      return card;
    };
    const graph = (clientHeight: number) => ({ clientWidth: 400, clientHeight }) as HTMLElement;
    const withCharts = (card: AnyCard) => {
      card._apexChart = { updateOptions: vi.fn() };
      card._apexBrush = { updateOptions: vi.fn() };
      return card;
    };

    it('fills only a grid cell with a numeric row count', () => {
      expect(cardWith({ grid_options: { rows: 4 } }, 'grid')._fillsHeight()).toBe(true);
      expect(cardWith({ grid_options: { rows: 'auto' } }, 'grid')._fillsHeight()).toBe(false);
      expect(cardWith({ grid_options: { columns: 6 } }, 'grid')._fillsHeight()).toBe(false);
      // grid_options is ignored outside sections, where the host has no fixed height.
      expect(cardWith({ grid_options: { rows: 4 } })._fillsHeight()).toBe(false);
    });

    it('fills with section_mode outside sections only', () => {
      expect(cardWith({ section_mode: true })._fillsHeight()).toBe(true);
      expect(cardWith({ section_mode: true }, 'panel')._fillsHeight()).toBe(true);
      // An auto-rows cell has no fixed height to fill.
      expect(cardWith({ section_mode: true, grid_options: { columns: 6 } }, 'grid')._fillsHeight()).toBe(false);
      expect(cardWith({ section_mode: true, grid_options: { rows: 5 } }, 'grid')._fillsHeight()).toBe(true);
    });

    it('sizes the chart to #graph, unless apex_config sets a height or #graph is not laid out', () => {
      expect(cardWith({ grid_options: { rows: 4 } }, 'grid')._chartFillHeight(graph(208))).toBe(208);
      expect(cardWith({ grid_options: { rows: 4 } })._chartFillHeight(graph(208))).toBeUndefined();
      expect(
        cardWith({ grid_options: { rows: 4 }, apex_config: { chart: { height: 300 } } }, 'grid')._chartFillHeight(
          graph(208),
        ),
      ).toBeUndefined();
      expect(cardWith({ grid_options: { rows: 4 } }, 'grid')._chartFillHeight(graph(20))).toBeUndefined();
    });

    it('resizes the main chart height with the cell and keeps the brush height', () => {
      const card = withCharts(cardWith({ grid_options: { rows: 4 } }, 'grid'));
      card._resizeCharts(graph(208));
      expect(card._apexChart.updateOptions).toHaveBeenLastCalledWith(
        { chart: { width: 400, height: 208 } },
        false,
        true,
      );
      expect(card._apexBrush.updateOptions).toHaveBeenLastCalledWith({ chart: { width: 400 } }, false, true);
    });

    it('hands the height back to ApexCharts once when rows go back to auto', () => {
      const card = withCharts(cardWith({ grid_options: { rows: 4 } }, 'grid'));
      card._resizeCharts(graph(208));
      card.setConfig({ type: 'custom:apexcharts-card', series: [{ entity: 'sensor.temp' }] });
      card._resizeCharts(graph(170));
      expect(card._apexChart.updateOptions).toHaveBeenLastCalledWith(
        { chart: { width: 400, height: 'auto' } },
        false,
        true,
      );
      card._resizeCharts(graph(170));
      expect(card._apexChart.updateOptions).toHaveBeenLastCalledWith({ chart: { width: 400 } }, false, true);
    });

    it('leaves the height alone for auto rows', () => {
      const card = withCharts(cardWith({}, 'grid'));
      card._resizeCharts(graph(170));
      expect(card._apexChart.updateOptions).toHaveBeenLastCalledWith({ chart: { width: 400 } }, false, true);
    });

    it('marks the host and ha-card so the CSS can hand #graph the leftover height', () => {
      const card = cardWith({ grid_options: { rows: 4 } }, 'grid');
      card._hass = mkHass({ 'sensor.temp': mkState('sensor.temp', '21') });
      card._entities = [card._hass.states['sensor.temp']];
      const tpl = card.render();
      expect(card.hasAttribute('data-fill-height')).toBe(true);
      expect(JSON.stringify(tpl.values)).toContain('"section":true');

      card.layout = undefined;
      card.render();
      expect(card.hasAttribute('data-fill-height')).toBe(false);
    });
  });

  describe('disconnectedCallback', () => {
    it('destroys the chart and brush so a discarded card can be garbage collected', () => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      card.setConfig({ type: 'custom:apexcharts-card', series: [{ entity: 'sensor.temp' }] });
      const chart = { destroy: vi.fn() };
      const brush = { destroy: vi.fn() };
      card._apexChart = chart;
      card._apexBrush = brush;
      card._loaded = true;
      card._dataLoaded = true;
      card._brushInit = true;

      card.disconnectedCallback();

      expect(chart.destroy).toHaveBeenCalledOnce();
      expect(brush.destroy).toHaveBeenCalledOnce();
      expect(card._apexChart).toBeUndefined();
      expect(card._apexBrush).toBeUndefined();
      // Cleared so connectedCallback rebuilds the chart when HA reattaches the card.
      expect(card._loaded).toBe(false);
      expect(card._dataLoaded).toBe(false);
      expect(card._brushInit).toBe(false);
    });
  });

  describe('brush series colors', () => {
    const newCard = (
      type: 'line' | 'area' | 'column',
      thresholds = true,
      extra: Record<string, unknown> = {},
    ): AnyCard => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      card.setConfig({
        type: 'custom:apexcharts-card',
        experimental: { brush: true, color_threshold: thresholds },
        ...extra,
        series: [
          {
            entity: 'sensor.main',
            color: '#ff0000',
            type,
            color_threshold: [{ value: 0 }, { value: 100 }],
          },
          {
            entity: 'sensor.brush_one',
            color: '#0000ff',
            type,
            show: { in_chart: false, in_brush: true },
            color_threshold: [{ value: 0 }, { value: 100 }],
          },
          {
            entity: 'sensor.brush_two',
            color: '#00ff00',
            type,
            show: { in_chart: false, in_brush: true },
            color_threshold: [{ value: 0 }, { value: 100 }],
          },
        ],
      });
      return card;
    };

    it.each([false, true])('keeps every brush color with thresholds enabled=%s', (thresholds) => {
      const card = newCard('area', thresholds);
      expect(card._computeChartColors(true)).toEqual(['#0000ff', '#00ff00']);
      expect(card._computeChartColors(false)).toEqual(['#ff0000']);
    });

    it('uses each brush column color when a threshold omits its color', () => {
      const card = newCard('column');
      const colors = card._computeChartColors(true);
      expect(colors).toHaveLength(2);
      expect(colors[0]({ value: 50 })).toBe('#0000ff');
      expect(colors[1]({ value: 50 })).toBe('#00ff00');
      expect(card._computeChartColors(false)[0]({ value: 50 })).toBe('#ff0000');

      card._config.series_in_brush[0].color_threshold[1].color = '#ffff00';
      expect(card._computeChartColors(true)[0]({ value: 101 })).toBe('#ffff00');
    });

    it.each(['main', 'brush', 'both'])('preserves explicit %s fill across repeated data updates', async (target) => {
      const fill = {
        type: 'gradient',
        opacity: 0.4,
        gradient: {
          type: 'horizontal',
          colorStops: [{ offset: 0, color: '#123456', opacity: 0.4 }],
        },
      };
      const customMain = target !== 'brush';
      const customBrush = target !== 'main';
      const card = newCard('area', true, {
        ...(customMain ? { apex_config: { fill } } : {}),
        ...(customBrush ? { brush: { apex_config: { fill } } } : {}),
      });
      card._hass = mkHass();
      card._graphs = card._config.series.map(() => ({
        _updateHistory: vi.fn().mockResolvedValue(true),
        history: [],
        min: 0,
        max: 100,
      }));
      card._apexChart = { updateOptions: vi.fn().mockResolvedValue(undefined) };
      card._apexBrush = { updateOptions: vi.fn().mockResolvedValue(undefined) };

      for (let i = 0; i < 2; i++) {
        await card._updateData();
        const mainUpdate = card._apexChart.updateOptions.mock.calls[i][0];
        const brushUpdate = card._apexBrush.updateOptions.mock.calls[i][0];
        if (customMain) expect(mainUpdate).not.toHaveProperty('fill');
        else expect(mainUpdate.fill.gradient.colorStops).toHaveLength(1);
        if (customBrush) expect(brushUpdate).not.toHaveProperty('fill');
        else expect(brushUpdate.fill.gradient.colorStops).toHaveLength(2);
      }
      if (customMain) expect(card._config.apex_config.fill).toEqual(fill);
      if (customBrush) expect(card._config.brush.apex_config.fill).toEqual(fill);
    });

    it.each(['line', 'area'] as const)('sends independent %s gradient colors to both charts', async (type) => {
      const card = newCard(type);
      card._hass = mkHass();
      card._graphs = card._config.series.map(() => ({
        _updateHistory: vi.fn().mockResolvedValue(true),
        history: [],
        min: 0,
        max: 100,
      }));
      const chart = { updateOptions: vi.fn<(options: unknown) => Promise<void>>().mockResolvedValue(undefined) };
      const brush = { updateOptions: vi.fn<(options: unknown) => Promise<void>>().mockResolvedValue(undefined) };
      card._apexChart = chart;
      card._apexBrush = brush;

      await card._updateData();

      expect(chart.updateOptions).toHaveBeenCalledOnce();
      expect(brush.updateOptions).toHaveBeenCalledOnce();
      const mainStops = card._apexChart.updateOptions.mock.calls[0][0].fill.gradient.colorStops;
      const brushStops = card._apexBrush.updateOptions.mock.calls[0][0].fill.gradient.colorStops;
      const alpha = type === 'line' ? 'ff' : '';
      expect(mainStops).toHaveLength(1);
      expect(mainStops[0].map((stop: { color: string }) => stop.color)).toEqual([`#ff0000${alpha}`, `#ff0000${alpha}`]);
      expect(brushStops).toHaveLength(2);
      expect(brushStops[0].map((stop: { color: string }) => stop.color)).toEqual([
        `#0000ff${alpha}`,
        `#0000ff${alpha}`,
      ]);
      expect(brushStops[1].map((stop: { color: string }) => stop.color)).toEqual([
        `#00ff00${alpha}`,
        `#00ff00${alpha}`,
      ]);
    });
  });

  describe('brush selection refresh', () => {
    const HOUR = 3600_000;
    const T0 = Date.UTC(2026, 6, 1);
    const refresh = async (
      currentMin: number,
      currentMax: number,
      start = 10,
      end = 34,
      initialized = true,
      previousEnd = 24,
      selectionSpan = '6h',
      missingAxes = false,
    ) => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      card.setConfig({
        type: 'custom:apexcharts-card',
        graph_span: '24h',
        experimental: { brush: true },
        brush: { selection_span: selectionSpan },
        series: [{ entity: 'sensor.temp', show: { in_brush: true } }],
      });
      card._hass = mkHass();
      card._graphs = [{ _updateHistory: vi.fn().mockResolvedValue(true), history: [] }];
      card._getSpanDates = () => ({
        start: new Date(T0 + start * HOUR),
        end: new Date(T0 + end * HOUR),
      });
      card._brushInit = initialized;
      card._apexChart = {
        axes: { w: { globals: { minX: T0 + currentMin * HOUR, maxX: T0 + currentMax * HOUR } } },
        updateOptions: vi.fn().mockResolvedValue(undefined),
      };
      card._apexBrush = {
        axes: { w: { globals: { minX: T0 + (previousEnd - 24) * HOUR, maxX: T0 + previousEnd * HOUR } } },
        updateOptions: vi.fn().mockResolvedValue(undefined),
      };
      if (missingAxes) delete card._apexChart.axes;

      await card._updateData();

      expect(card._apexBrush.updateOptions).toHaveBeenCalledOnce();
      const { min, max } = card._apexBrush.updateOptions.mock.calls[0][0].chart.selection.xaxis;
      expect(Number.isFinite(min)).toBe(true);
      expect(Number.isFinite(max)).toBe(true);
      expect(min).toBeGreaterThanOrEqual(T0 + start * HOUR);
      expect(max).toBeLessThanOrEqual(T0 + end * HOUR);
      return [(min - T0) / HOUR, (max - T0) / HOUR];
    };

    it('keeps a historical selection unchanged while it is still in range', async () => {
      expect(await refresh(12, 18)).toEqual([12, 18]);
    });

    it('moves a partially expired selection forward without changing its width', async () => {
      expect(await refresh(8, 14)).toEqual([10, 16]);
    });

    it('moves a completely expired selection into the new window', async () => {
      expect(await refresh(1, 7)).toEqual([10, 16]);
    });

    it('moves a selection back when the available end moves earlier', async () => {
      expect(await refresh(20, 26, 0, 24)).toEqual([18, 24]);
    });

    it('limits the selected width when the available window shrinks', async () => {
      expect(await refresh(2, 20, 10, 14)).toEqual([10, 14]);
    });

    it('initializes the selection at the latest end', async () => {
      expect(await refresh(0, 24, 10, 34, false)).toEqual([28, 34]);
    });

    it('keeps following the end when the previous selection was live', async () => {
      expect(await refresh(18, 24)).toEqual([28, 34]);
    });

    it('bounds an initial selection span larger than the available history', async () => {
      expect(await refresh(0, 24, 10, 34, false, 24, '48h')).toEqual([10, 34]);
    });

    it.each([
      [NaN, 18],
      [12, Infinity],
      [18, 12],
      [12, 12],
    ])('resets invalid selection bounds (%s, %s) with a warning', async (min, max) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        expect(await refresh(min, max)).toEqual([28, 34]);
        expect(warn).toHaveBeenCalledWith(
          'apexcharts-card: ',
          'Brush selection bounds are unavailable or invalid; resetting to the latest range.',
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('recovers when the chart has no axes yet', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        expect(await refresh(12, 18, 10, 34, true, 24, '6h', true)).toEqual([28, 34]);
        expect(warn).toHaveBeenCalledOnce();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('threshold gradient stops', () => {
    const stops = (min: number, max: number, invert = false) => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      return card._computeFillColorStops(
        {
          type: 'area',
          color_threshold: [
            { value: 0, color: '#000000', opacity: 0 },
            { value: 100, color: '#ffffff', opacity: 1 },
          ],
        },
        min,
        max,
        '#ff0000',
        invert,
      );
    };

    it('clips colors, opacity and offsets to the visible value range', () => {
      expect(stops(25, 75)).toEqual([
        { offset: 0, color: '#bfbfbf', opacity: 0.75 },
        { offset: 100, color: '#3f3f3f', opacity: 0.25 },
      ]);
    });

    it('reverses the gradient when values are inverted', () => {
      expect(stops(25, 75, true)).toEqual([
        { offset: 0, color: '#3f3f3f', opacity: 0.25 },
        { offset: 100, color: '#bfbfbf', opacity: 0.75 },
      ]);
    });

    it.each([
      [-50, -10, '#000000', 0],
      [110, 150, '#ffffff', 1],
    ])('uses the nearest threshold outside the threshold range (%s to %s)', (min, max, color, opacity) => {
      const result = stops(Number(min), Number(max));
      expect(result).toHaveLength(1);
      expect(result[0].color).toBe(color);
      expect(result[0].opacity).toBe(opacity);
      expect(result[0].offset).toBeGreaterThanOrEqual(0);
      expect(result[0].offset).toBeLessThanOrEqual(100);
    });

    it('handles a constant value without non-finite offsets', () => {
      const result = stops(50, 50);
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { offset: 0, color: '#7f7f7f', opacity: 0.5 },
        { offset: 0, color: '#7f7f7f', opacity: 0.5 },
      ]);
    });

    it('keeps thresholds inside a wider data range at their actual positions', () => {
      expect(stops(-50, 150)).toEqual([
        { offset: 25, color: '#ffffff', opacity: 1 },
        { offset: 75, color: '#000000', opacity: 0 },
      ]);
    });

    it('does not generate gradient stops for an all-null history', () => {
      expect(stops(Infinity, -Infinity)).toEqual([]);
    });
  });

  describe('initial series visibility', () => {
    it('does not hide time-series again after data loads', async () => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      card.setConfig({
        type: 'custom:apexcharts-card',
        experimental: { hidden_by_default: true },
        series: [{ entity: 'sensor.temp', show: { hidden_by_default: true } }],
      });
      card._hass = mkHass();
      const hideSeries = vi.fn();
      card._apexChart = { hideSeries };
      card._updateData = vi.fn().mockResolvedValue(undefined);

      card._firstDataLoad();
      await Promise.resolve();

      expect(card._updateData).toHaveBeenCalledOnce();
      expect(hideSeries).not.toHaveBeenCalled();
    });

    it('preserves initial hiding for non-time-series charts', async () => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      card.setConfig({
        type: 'custom:apexcharts-card',
        chart_type: 'pie',
        experimental: { hidden_by_default: true },
        series: [{ entity: 'sensor.temp', name: 'Temperature', show: { hidden_by_default: true } }],
      });
      card._hass = mkHass();
      const hideSeries = vi.fn();
      card._apexChart = { hideSeries };
      card._updateData = vi.fn().mockResolvedValue(undefined);

      card._firstDataLoad();
      await Promise.resolve();

      expect(hideSeries).toHaveBeenCalledWith('Temperature');
    });
  });

  describe('hidden series custom y-axis scaling', () => {
    const newCard = (axis: Record<string, unknown> = {}, enabled = true): AnyCard => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      card.setConfig({
        type: 'custom:apexcharts-card',
        experimental: { brush: true, hidden_by_default: enabled },
        yaxis: [axis],
        series: [
          { entity: 'sensor.brush', show: { in_chart: false, in_brush: true } },
          { entity: 'sensor.visible', offset: '+1h' },
          { entity: 'sensor.hidden', show: { hidden_by_default: true } },
        ],
      });
      card._graphs = [
        { minMaxWithTimestampForYAxis: vi.fn(() => ({ min: [0, -999], max: [1, 9999] })) },
        { minMaxWithTimestampForYAxis: vi.fn(() => ({ min: [0, 10], max: [1, 20] })) },
        { minMaxWithTimestampForYAxis: vi.fn(() => ({ min: [0, 100], max: [1, 200] })) },
      ];
      card._graphs.forEach((graph: AnyCard) => {
        graph._updateHistory = vi.fn();
      });
      return card;
    };

    it('excludes initially hidden and brush-only series, using original indexes for offsets', () => {
      const card = newCard();
      const axes = card._computeYAxisAutoMinMax(new Date(0), new Date(1000));
      expect(axes).toEqual([
        expect.objectContaining({ min: 10, max: 20 }),
        expect.objectContaining({ min: 10, max: 20 }),
      ]);
      expect(card._graphs[0].minMaxWithTimestampForYAxis).not.toHaveBeenCalled();
      expect(card._graphs[1].minMaxWithTimestampForYAxis).toHaveBeenCalledWith(3600_000, 3601_000);
      expect(card._graphs[2].minMaxWithTimestampForYAxis).not.toHaveBeenCalled();
    });

    it('keeps hidden_by_default inert without the experimental flag', () => {
      const card = newCard({}, false);
      const axes = card._computeYAxisAutoMinMax(new Date(0), new Date(1000));
      expect(axes[0]).toMatchObject({ min: 10, max: 200 });
    });

    it('preserves fixed limits and applies soft limits to visible values', () => {
      const fixed = newCard({ min: 0, max: 50 });
      expect(fixed._computeYAxisAutoMinMax(new Date(0), new Date(1000))[0]).toMatchObject({ min: 0, max: 50 });
      const soft = newCard({ min: '~0', max: '~50' });
      expect(soft._computeYAxisAutoMinMax(new Date(0), new Date(1000))[0]).toMatchObject({ min: 0, max: 50 });
    });

    it('applies inversion and absolute limits using the visible series original index', () => {
      const card = newCard({ min: '|5|', max: '|10|' });
      card._config.series_in_graph[0].invert = true;
      expect(card._computeYAxisAutoMinMax(new Date(0), new Date(1000))[0]).toMatchObject({ min: -15, max: 0 });
    });

    it('restores configured soft limits when every series becomes hidden', () => {
      const card = newCard({ min: '~0', max: '~50' });
      card._hiddenSeries = new Set([1]);
      expect(card._computeYAxisAutoMinMax(new Date(0), new Date(1000))[0]).toMatchObject({ min: 0, max: 200 });
      card._hiddenSeries.add(2);
      expect(card._computeYAxisAutoMinMax(new Date(0), new Date(1000))[0]).toMatchObject({ min: 0, max: 50 });
    });

    it('keeps independently configured y-axes separate', () => {
      const card = newCard();
      const graphs = card._graphs;
      const series = card._config.series.map((serie: AnyCard) => ({
        entity: serie.entity,
        show: serie.show,
        yaxis_id: serie.index === 2 ? 'second' : 'first',
      }));
      card.setConfig({
        type: 'custom:apexcharts-card',
        experimental: { brush: true, hidden_by_default: true },
        yaxis: [{ id: 'first' }, { id: 'second', min: 0, max: 500 }],
        series,
      });
      card._graphs = graphs;
      const axes = card._computeYAxisAutoMinMax(new Date(0), new Date(1000));
      expect(axes[0]).toMatchObject({ min: 10, max: 20 });
      expect(axes[1]).toMatchObject({ min: 0, max: 500 });
    });

    it('updates visibility by chart index, preserves custom callbacks and avoids fetching history', async () => {
      const card = newCard();
      const callbacks: FrameRequestCallback[] = [];
      const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      });
      try {
        const chart: AnyCard = { updateOptions: vi.fn().mockResolvedValue(undefined) };
        card._apexChart = chart;
        const custom = vi.fn();
        const layout: AnyCard = { chart: { events: { legendClick: custom } } };
        card._configureSeriesVisibility(layout);
        card._getSpanDates = () => ({ start: new Date(0), end: new Date(1000) });

        layout.chart.events.legendClick(chart, 1, {});
        expect(custom).toHaveBeenCalledWith(chart, 1, {});
        callbacks.shift()!(0);
        await Promise.resolve();
        expect(chart.updateOptions.mock.calls[0][0].yaxis[0]).toMatchObject({ min: 10, max: 200 });

        layout.chart.events.legendClick(chart, 0, {});
        callbacks.shift()!(0);
        await Promise.resolve();
        expect(chart.updateOptions.mock.calls[1][0].yaxis[0]).toMatchObject({ min: 100, max: 200 });

        layout.chart.events.legendClick(chart, 1, {});
        callbacks.shift()!(0);
        await Promise.resolve();
        const axis = chart.updateOptions.mock.calls[2][0].yaxis[0];
        expect(axis.min).toBeUndefined();
        expect(axis.max).toBeUndefined();
        card._graphs.forEach((graph: AnyCard) => expect(graph._updateHistory).not.toHaveBeenCalled());
      } finally {
        frame.mockRestore();
      }
    });

    it('does not track clicks when legend toggling is explicitly disabled', () => {
      const card = newCard();
      const layout = { legend: { onItemClick: { toggleDataSeries: false } }, chart: { events: {} } };
      card._configureSeriesVisibility(layout);
      expect(layout.chart.events).not.toHaveProperty('legendClick');
    });

    it('does not treat distributed-bar legend items as series toggles', () => {
      const card = newCard();
      const layout = { plotOptions: { bar: { distributed: true } }, chart: { events: {} } };
      card._configureSeriesVisibility(layout);
      expect(layout.chart.events).not.toHaveProperty('legendClick');
    });

    it('reinitializes visibility when the chart is recreated', () => {
      const card = newCard();
      card._configureSeriesVisibility({});
      card._hiddenSeries.clear();
      card._configureSeriesVisibility({});
      expect(card._computeYAxisAutoMinMax(new Date(0), new Date(1000))[0]).toMatchObject({ min: 10, max: 20 });
    });

    it('ignores a queued axis update after its chart was replaced', () => {
      const card = newCard();
      const callbacks: FrameRequestCallback[] = [];
      const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      });
      try {
        const chart = { updateOptions: vi.fn().mockResolvedValue(undefined) };
        card._apexChart = chart;
        const layout: AnyCard = {};
        card._configureSeriesVisibility(layout);
        layout.chart.events.legendClick(chart, 1, {});
        card._apexChart = undefined;
        callbacks.shift()!(0);
        expect(chart.updateOptions).not.toHaveBeenCalled();
      } finally {
        frame.mockRestore();
      }
    });
  });

  describe('getCardSize', () => {
    it('returns 3', () => {
      const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
      expect(card.getCardSize()).toBe(3);
    });
  });

  describe('getStubConfig', () => {
    it('returns a config with a header and a series built from a numeric sensor', () => {
      const hass = mkHass({
        'sensor.temp': mkState('sensor.temp', '21.5', { unit_of_measurement: '°C' }),
        'light.living_room': mkState('light.living_room', 'on', {}),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = customElements.get('apexcharts-card') as any;
      const stub = Ctor.getStubConfig(hass, ['sensor.temp'], []);
      expect(stub.header).toBeDefined();
      expect(stub.header.title).toBe('ApexCharts-Card');
      expect(stub.series.length).toBeGreaterThan(0);
      expect(stub.series[0].entity).toBe('sensor.temp');
    });
  });

  describe('window.customCards registration', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = () => (window as any).customCards.find((c: AnyCard) => c.type === 'apexcharts-card');

    it('registers a preview entry with documentationURL and a getEntitySuggestion function', () => {
      const e = entry();
      expect(e).toBeDefined();
      expect(e.preview).toBe(true);
      expect(typeof e.documentationURL).toBe('string');
      expect(typeof e.getEntitySuggestion).toBe('function');
    });

    describe('getEntitySuggestion', () => {
      it('returns null for non-numeric domains (e.g. light)', () => {
        const hass = mkHass({ 'light.foo': mkState('light.foo', 'on', {}) });
        expect(entry().getEntitySuggestion(hass, 'light.foo')).toBeNull();
      });

      it('returns an array of suggestions for a "measurement" state_class sensor', () => {
        const hass = mkHass({
          'sensor.power': mkState('sensor.power', '10', {
            state_class: 'measurement',
            unit_of_measurement: 'W',
          }),
        });
        const suggestion = entry().getEntitySuggestion(hass, 'sensor.power');
        expect(Array.isArray(suggestion)).toBe(true);
        expect(suggestion.length).toBeGreaterThan(0);
      });

      it('returns an array of suggestions for a "total_increasing" state_class sensor', () => {
        const hass = mkHass({
          'sensor.energy': mkState('sensor.energy', '10', {
            state_class: 'total_increasing',
            unit_of_measurement: 'kWh',
          }),
        });
        const suggestion = entry().getEntitySuggestion(hass, 'sensor.energy');
        expect(Array.isArray(suggestion)).toBe(true);
        expect(suggestion.length).toBeGreaterThan(0);
      });

      it('returns a single plain suggestion object for a numeric sensor without state_class', () => {
        const hass = mkHass({
          'sensor.plain': mkState('sensor.plain', '10', { unit_of_measurement: 'W' }),
        });
        const suggestion = entry().getEntitySuggestion(hass, 'sensor.plain');
        expect(Array.isArray(suggestion)).toBe(false);
        expect(suggestion).not.toBeNull();
        expect(suggestion.config).toBeDefined();
      });
    });
  });
});
