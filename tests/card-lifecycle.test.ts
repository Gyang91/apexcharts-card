import '../src/apexcharts-card';
import { mkHass, mkState } from './fixtures/hass';
import { setLocale } from '../src/localize';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCard = any;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const chart = () => ({
  updateOptions: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn(),
});

const graph = () => ({
  _updateHistory: vi.fn().mockResolvedValue(true),
  history: [[Date.now(), 12]],
  lastState: 12,
});

const cardWithData = (): AnyCard => {
  const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
  card.setConfig({ type: 'custom:apexcharts-card', series: [{ entity: 'sensor.temp' }] });
  card._hass = mkHass({ 'sensor.temp': mkState('sensor.temp', '12') });
  card._entities = [card._hass.states['sensor.temp']];
  card._graphs = [graph()];
  card._apexChart = chart();
  card._loaded = true;
  card._dataLoaded = true;
  return card;
};

describe('card lifecycle and diagnostics', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('cancels recorder-delay refreshes when detached', async () => {
    vi.useFakeTimers();
    const card = cardWithData();
    vi.spyOn(card, '_initialLoad').mockResolvedValue(undefined);
    document.body.appendChild(card);
    await card.updateComplete;
    const update = vi.spyOn(card, '_updateData').mockResolvedValue(undefined);
    card.hass = mkHass({ 'sensor.temp': mkState('sensor.temp', '13') });
    expect(card._updateTimeout).toBeDefined();
    card.remove();
    await vi.runAllTimersAsync();
    expect(update).not.toHaveBeenCalled();
    expect(card._updateTimeout).toBeUndefined();
    expect(card._updating).toBe(false);
  });

  it('does not queue refreshes from state changes while detached', () => {
    const card = cardWithData();
    card.hass = mkHass({ 'sensor.temp': mkState('sensor.temp', '13') });
    expect(card._updateTimeout).toBeUndefined();
    expect(card._updating).toBe(false);
  });

  it('does not let an old request update a replacement chart or release its lock', async () => {
    const card = cardWithData();
    const old = deferred<boolean>();
    card._graphs[0]._updateHistory.mockReturnValueOnce(old.promise);
    const previousChart = card._apexChart;
    const update = card._updateData();
    await Promise.resolve();
    card.disconnectedCallback();
    const replacement = chart();
    card._apexChart = replacement;
    card._updating = true;
    old.resolve(true);
    await update;
    expect(previousChart.updateOptions).not.toHaveBeenCalled();
    expect(replacement.updateOptions).not.toHaveBeenCalled();
    expect(card._updating).toBe(true);
  });

  it('waits for the previous history fetch before refreshing reused series after reconnect', async () => {
    const card = cardWithData();
    const old = deferred<boolean>();
    card._graphs[0]._updateHistory.mockReturnValueOnce(old.promise);
    const update = card._updateData();
    await Promise.resolve();
    card.disconnectedCallback();
    const replacement = chart();
    card._apexChart = replacement;
    const fresh = card._updateData();
    await Promise.resolve();
    expect(card._graphs[0]._updateHistory).toHaveBeenCalledTimes(1);
    old.resolve(true);
    await Promise.all([update, fresh]);
    expect(card._graphs[0]._updateHistory).toHaveBeenCalledTimes(2);
    expect(replacement.updateOptions).toHaveBeenCalledOnce();
    expect(card._updating).toBe(false);
  });

  it('ignores a stale rejection after reconnect', async () => {
    const card = cardWithData();
    const old = deferred<boolean>();
    card._graphs[0]._updateHistory.mockReturnValueOnce(old.promise);
    const update = card._updateData();
    await Promise.resolve();
    card.disconnectedCallback();
    card._apexChart = chart();
    card._loadError = 'new status';
    card._updating = true;
    old.reject(new Error('old network failure'));
    await update;
    expect(card._loadError).toBe('new status');
    expect(card._updating).toBe(true);
  });

  it('waits for every series to settle after one request fails', async () => {
    const card = cardWithData();
    const other = deferred<boolean>();
    card._graphs.push({ ...graph(), _updateHistory: vi.fn().mockReturnValue(other.promise) });
    card._graphs[0]._updateHistory.mockRejectedValueOnce(new Error('offline'));
    card._updating = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const update = card._updateData();
    await Promise.resolve();
    await Promise.resolve();
    expect(card._updating).toBe(true);
    expect(card._apexChart.updateOptions).not.toHaveBeenCalled();
    other.resolve(true);
    await update;
    expect(card._updating).toBe(false);
    expect(card._loadError).toContain('sensor.temp');
  });

  it('keeps the last successful timestamp after failure and clears diagnostics on recovery', async () => {
    const card = cardWithData();
    setLocale('en');
    const lastSuccess = new Date(0);
    card._lastUpdated = lastSuccess;
    card._graphs[0]._updateHistory.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await card._updateData();
    expect(card._lastUpdated).toBe(lastSuccess);
    expect(card._loadError).toContain('Could not load data for sensor.temp');
    expect(card._apexChart.updateOptions).not.toHaveBeenCalled();
    await card._updateData();
    expect(card._loadError).toBeUndefined();
    expect(card._lastUpdated.getTime()).toBeGreaterThan(0);
    expect(card._apexChart.updateOptions).toHaveBeenCalledOnce();
  });

  it('reports chart rendering failures, not a successful refresh', async () => {
    const card = cardWithData();
    setLocale('en');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    card._apexChart.updateOptions.mockRejectedValueOnce(new Error('render failed'));
    const lastSuccess = card._lastUpdated;
    await card._updateData();
    expect(card._loadError).toContain('Chart refresh failed');
    expect(card._lastUpdated).toBe(lastSuccess);
    expect(card._updating).toBe(false);
  });

  it('does not release the refresh lock while a brush render is pending after main-chart failure', async () => {
    const card = cardWithData();
    const pending = deferred<void>();
    card._apexBrush = chart();
    card._apexBrush.updateOptions.mockReturnValueOnce(pending.promise);
    card._apexChart.updateOptions.mockRejectedValueOnce(new Error('main chart failed'));
    card._updating = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const update = card._updateData();
    await vi.waitFor(() => expect(card._apexBrush.updateOptions).toHaveBeenCalledOnce());
    expect(card._updating).toBe(true);
    pending.resolve();
    await update;
    expect(card._updating).toBe(false);
    expect(card._loadError).toBeDefined();
  });

  it.each([{ history: [] }, { history: [[0, null]] }, { history: [[0, NaN]] }])(
    'identifies empty/non-numeric histories: $history',
    async ({ history }) => {
      const card = cardWithData();
      card._graphs[0].history = history;
      await card._updateData();
      expect(card._empty).toBe(true);
      card._graphs[0].history = [[0, 0]];
      await card._updateData();
      expect(card._empty).toBe(false);
    },
  );

  it('destroys an orphan brush and resets initialization even without a main chart', () => {
    const card = cardWithData();
    card._apexChart = undefined;
    const brush = chart();
    card._apexBrush = brush;
    card._initializing = card._lifecycle;
    card.disconnectedCallback();
    expect(brush.destroy).toHaveBeenCalledOnce();
    expect(card._apexBrush).toBeUndefined();
    expect(card._initializing).toBeUndefined();
    expect(card._loaded).toBe(false);
  });

  it('persists legend choices across data updates without custom axes and leaves the brush visible', async () => {
    const card = cardWithData();
    card.setConfig({
      type: 'custom:apexcharts-card',
      experimental: { hidden_by_default: true, brush: true },
      series: [{ entity: 'sensor.temp', show: { hidden_by_default: true, in_brush: true } }],
    });
    card._graphs = [graph()];
    card._apexBrush = chart();
    const layout: AnyCard = {};
    card._configureSeriesVisibility(layout);
    await card._updateData();
    expect(card._apexChart.updateOptions.mock.calls[0][0].series[0].hidden).toBe(true);
    expect(card._apexBrush.updateOptions.mock.calls[0][0].series[0]).not.toHaveProperty('hidden');
    layout.chart.events.legendClick(card._apexChart, 0, {});
    await card._updateData();
    expect(card._apexChart.updateOptions.mock.calls[1][0].series[0].hidden).toBe(false);
    expect(card._apexBrush.updateOptions.mock.calls[1][0].series[0]).not.toHaveProperty('hidden');
  });
});
