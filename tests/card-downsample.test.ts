import '../src/apexcharts-card';
import '../src/editor/tabs/general-tab';
import { mkHass } from './fixtures/hass';
import type { ChartCardExternalConfig } from '../src/types-config';
import type { EntityCachePoints } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCard = any;

const history: EntityCachePoints = Array.from({ length: 10000 }, (_, i) => [i, i === 500 ? 1000 : i % 10]);
const createCard = (extra: Partial<ChartCardExternalConfig> = {}): AnyCard => {
  const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
  card.setConfig({
    type: 'custom:apexcharts-card',
    downsample: true,
    series: [{ entity: 'sensor.a', extend_to: false }],
    ...extra,
  });
  card._hass = mkHass();
  card._graphs = card._config.series.map(() => ({
    _updateHistory: vi.fn().mockResolvedValue(true),
    history,
    lastState: 9,
    minMaxWithTimestampForYAxis: () => ({ min: [0, 0], max: [500, 1000] }),
  }));
  card._apexChart = { updateOptions: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
  card.attachShadow({ mode: 'open' });
  const graph = document.createElement('div');
  graph.id = 'graph';
  Object.defineProperty(graph, 'clientWidth', { configurable: true, value: 100 });
  const brush = document.createElement('div');
  brush.id = 'brush';
  Object.defineProperty(brush, 'clientWidth', { configurable: true, value: 50 });
  card.shadowRoot.append(graph, brush);
  return card;
};

describe('adaptive card downsampling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('samples rendered data only, preserving header, annotations, custom axis limits and history', async () => {
    const card = createCard({
      yaxis: [{}],
      series: [{ entity: 'sensor.a', extend_to: false, show: { extremas: true } }],
    });
    card._entities = [];
    card._graphs[0].minMaxWithTimestamp = () => ({ min: [0, 0], max: [500, 1000] });
    card._graphs[0].min = 0;
    card._graphs[0].max = 1000;
    await card._updateData();
    const update = card._apexChart.updateOptions.mock.calls[0][0];
    expect(update.series[0].data.length).toBeLessThanOrEqual(404);
    expect(update.series[0].data).toContainEqual([500, 1000]);
    expect(update.yaxis[0]).toMatchObject({ min: 0, max: 1000 });
    expect(update.annotations.points).toEqual(expect.arrayContaining([expect.objectContaining({ y: 1000 })]));
    expect(card._headerState).toEqual([9]);
    expect(card._graphs[0].history).toBe(history);
    expect(card._graphs[0].history).toHaveLength(10000);
  });

  it.each([
    { downsample: false },
    { chart_type: 'scatter' as const },
    { stacked: true },
    { apex_config: { chart: { stacked: true } } },
    { series: [{ entity: 'sensor.a', type: 'column' as const, extend_to: false as const }] },
    { series: [{ entity: 'sensor.a', curve: 'stepline' as const, extend_to: false as const }] },
    { apex_config: { stroke: { curve: 'stepline' } } },
    { apex_config: { stroke: { curve: 'linestep' } } },
    {
      apex_config: { stroke: { curve: 'stepline' } },
      series: [{ entity: 'sensor.a', curve: 'smooth' as const, extend_to: false as const }],
    },
    {
      apex_config: { stroke: { curve: 'linestep' } },
      series: [{ entity: 'sensor.a', curve: 'smooth' as const, extend_to: false as const }],
    },
  ])('retains full detail for excluded configurations: %j', async (extra) => {
    const card = createCard(extra);
    await card._updateData();
    expect(card._apexChart.updateOptions.mock.calls[0][0].series[0].data).toHaveLength(10000);
    expect(card._samplingSeries).toBeUndefined();
  });

  it('resamples a zoomed range from full cached data without another history request', async () => {
    const card = createCard();
    await card._updateData();
    card._apexChart.axes = { w: { globals: { minX: 5000, maxX: 5100 } } };
    card._resampleCharts();
    await card._samplingUpdate;
    const sampled = card._apexChart.updateOptions.mock.calls.at(-1)[0].series[0].data;
    expect(sampled.filter(([time]: [number]) => time >= 5000 && time <= 5100)).toEqual(history.slice(5000, 5101));
    expect(card._graphs[0]._updateHistory).toHaveBeenCalledOnce();
    const calls = card._apexChart.updateOptions.mock.calls.length;
    card._resampleCharts();
    expect(card._apexChart.updateOptions.mock.calls).toHaveLength(calls);
  });

  it('resamples main and brush independently and rebuilds on width changes', async () => {
    const card = createCard({
      experimental: { brush: true },
      series: [{ entity: 'sensor.a', extend_to: false, show: { in_brush: true } }],
    });
    card._apexBrush = { updateOptions: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
    await card._updateData();
    expect(card._apexChart.updateOptions.mock.calls[0][0].series[0].data.length).toBeLessThanOrEqual(404);
    expect(card._apexBrush.updateOptions.mock.calls[0][0].series[0].data.length).toBeLessThanOrEqual(204);
    Object.defineProperty(card.shadowRoot.querySelector('#graph'), 'clientWidth', { value: 300 });
    card._resampleCharts();
    await card._samplingUpdate;
    expect(card._apexChart.updateOptions.mock.calls.at(-1)[0].series[0].data.length).toBeGreaterThan(404);
    card.disconnectedCallback();
    expect(card._samplingSeries).toBeUndefined();
    expect(card._samplingKey).toBeUndefined();
  });

  it('maps brush-only and inverted/offset main series without altering original samples', async () => {
    const card = createCard({
      experimental: { brush: true },
      series: [
        { entity: 'sensor.brush', extend_to: false, show: { in_chart: false, in_brush: true } },
        { entity: 'sensor.a', extend_to: false, invert: true, time_delta: '+1s' },
      ],
    });
    await card._updateData();
    const sampled = card._apexChart.updateOptions.mock.calls[0][0].series[0].data;
    expect(sampled).toContainEqual([1500, -1000]);
    expect(history[500]).toEqual([500, 1000]);
  });

  it('preserves existing updated callbacks and does not install sampling callbacks when disabled', () => {
    const card = createCard();
    const updated = vi.fn();
    const layout = { chart: { events: { updated } } };
    card._queueResample = vi.fn();
    card._configureSampling(layout);
    layout.chart.events.updated('chart', 'options');
    expect(updated).toHaveBeenCalledWith('chart', 'options');
    expect(card._queueResample).toHaveBeenCalledOnce();
    card._config.downsample = false;
    const disabled = { chart: { events: { updated } } };
    card._configureSampling(disabled);
    expect(disabled.chart.events.updated).toBe(updated);
  });

  it('round-trips the opt-in editor switch without dropping other settings', () => {
    const editor = new (customElements.get('apexcharts-card-editor-general') as CustomElementConstructor)() as AnyCard;
    editor.config = { type: 'custom:apexcharts-card', series: [{ entity: 'sensor.a' }], graph_span: '7d' };
    const changed = vi.fn();
    editor.addEventListener('config-changed', changed);
    editor._boolChanged(new CustomEvent('value-changed', { detail: { name: 'downsample', value: true } }));
    expect(changed.mock.calls[0][0].detail.config).toMatchObject({ downsample: true, graph_span: '7d' });
  });

  it('does not redraw the brush on a main-chart-only viewport change', async () => {
    const card = createCard({
      experimental: { brush: true },
      series: [{ entity: 'sensor.a', extend_to: false, show: { in_brush: true } }],
    });
    card._apexBrush = { updateOptions: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
    await card._updateData();
    card._resampleCharts();
    await card._samplingUpdate;
    const calls = card._apexBrush.updateOptions.mock.calls.length;
    card._apexChart.axes = { w: { globals: { minX: 5000, maxX: 5100 } } };
    card._resampleCharts();
    await card._samplingUpdate;
    expect(card._apexBrush.updateOptions).toHaveBeenCalledTimes(calls);
    expect(card._graphs[0]._updateHistory).toHaveBeenCalledOnce();
  });

  it('cancels a queued frame on teardown without rendering a replacement chart', async () => {
    const card = createCard();
    await card._updateData();
    vi.spyOn(card, 'isConnected', 'get').mockReturnValue(true);
    let frame!: FrameRequestCallback;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 123;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    card._queueResample();
    card._queueResample();
    expect(window.requestAnimationFrame).toHaveBeenCalledOnce();
    card.disconnectedCallback();
    expect(cancel).toHaveBeenCalledWith(123);
    const replacement = { updateOptions: vi.fn() };
    card._apexChart = replacement;
    frame(0);
    expect(replacement.updateOptions).not.toHaveBeenCalled();
    expect(card._samplingSeries).toBeUndefined();
  });

  it('ignores a pending sampling failure after teardown and chart replacement', async () => {
    const card = createCard();
    await card._updateData();
    let reject!: (error: Error) => void;
    card._apexChart.updateOptions.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    card._resampleCharts();
    const pending = card._samplingUpdate;
    await Promise.resolve();
    card.disconnectedCallback();
    const replacement = { updateOptions: vi.fn() };
    card._apexChart = replacement;
    reject(new Error('old render failed'));
    await pending;
    expect(card._loadError).toBeUndefined();
    expect(card._samplingUpdate).toBeUndefined();
    expect(replacement.updateOptions).not.toHaveBeenCalled();
  });

  it('reports synchronous rendering failures and releases the sampling lock for retry', async () => {
    const card = createCard();
    await card._updateData();
    const error = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    card._apexChart.updateOptions.mockImplementationOnce(() => {
      throw new Error('render failed');
    });
    card._resampleCharts();
    await card._samplingUpdate;
    expect(card._loadError).toContain('Chart refresh failed');
    expect(card._samplingUpdate).toBeUndefined();
    expect(card._samplingKey).toBeUndefined();
    expect(error).toHaveBeenCalled();
    card._resampleCharts();
    await card._samplingUpdate;
    expect(card._samplingKey).toBeDefined();
  });

  it('waits for adaptive rendering before starting the next history refresh', async () => {
    const card = createCard();
    await card._updateData();
    let finish!: () => void;
    card._apexChart.updateOptions.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    card._resampleCharts();
    await Promise.resolve();
    const refresh = card._updateData();
    await Promise.resolve();
    expect(card._graphs[0]._updateHistory).toHaveBeenCalledOnce();
    finish();
    await refresh;
    expect(card._graphs[0]._updateHistory).toHaveBeenCalledTimes(2);
  });
});
