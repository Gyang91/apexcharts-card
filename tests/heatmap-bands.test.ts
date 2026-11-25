// Heatmap colour bands: heatmap.color_ranges, its ApexCharts colour scale and
// its panel in the visual editor
import '../src/apexcharts-card';
import '../src/editor/tabs/display-tab';
import '../src/editor/components/color-threshold-editor';
import { getLayoutConfig } from '../src/apex-layouts';
import { heatmapColorScale } from '../src/visual-data';
import { mkHass } from './fixtures/hass';
import type { ChartCardExternalConfig } from '../src/types-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const BANDS = [
  { value: 22, color: '#d8b13a', name: 'warm' },
  { value: 20, color: '#5fa772', name: 'comfort' },
  { value: 23, color: '#e0772f' },
];

const heatmap = (extra: Partial<ChartCardExternalConfig> = {}): ChartCardExternalConfig => ({
  type: 'custom:apexcharts-card',
  chart_type: 'heatmap',
  series: [{ entity: 'sensor.a', group_by: { func: 'avg', period: 'hour' } }],
  ...extra,
});

function internalConfig(config: ChartCardExternalConfig): AnyRec {
  const card = document.createElement('apexcharts-card') as unknown as { setConfig(c: unknown): void; _config: AnyRec };
  card.setConfig(config);
  return card._config;
}

describe('heatmapColorScale', () => {
  it('covers every value: sorted bands from -∞ and up to +∞, each up to just below the next', () => {
    const ranges = heatmapColorScale(BANDS);
    expect(ranges.map((range) => [range.name, range.color])).toEqual([
      ['comfort', '#5fa772'],
      ['warm', '#d8b13a'],
      ['≥ 23', '#e0772f'],
    ]);
    expect(ranges[0].from).toBe(-Number.MAX_VALUE);
    expect(ranges[0].to).toBeLessThan(22);
    expect(ranges[0].to).toBeGreaterThan(21.9999);
    expect(ranges[1].from).toBe(22);
    expect(ranges[2].to).toBe(Number.MAX_VALUE);
  });

  it('names unnamed bands after their limits', () => {
    const ranges = heatmapColorScale([
      { value: 0, color: 'blue' },
      { value: 10, color: 'green' },
      { value: 20, color: 'red' },
    ]);
    expect(ranges.map((range) => range.name)).toEqual(['< 10', '10 – 20', '≥ 20']);
    expect(heatmapColorScale([{ value: 5, color: 'red' }])[0]).toMatchObject({
      name: '≥ 5',
      from: -Number.MAX_VALUE,
      to: Number.MAX_VALUE,
    });
  });

  it('resolves colours through the given function, e.g. theme variables', () => {
    const ranges = heatmapColorScale([{ value: 0, color: 'var(--x)' }], (color) => `resolved(${color})`);
    expect(ranges[0].color).toBe('resolved(var(--x))');
  });
});

describe('heatmap.color_ranges on the chart', () => {
  beforeAll(async () => {
    await customElements.whenDefined('apexcharts-card');
  });

  it('is a valid option and replaces the shaded scale with the bands and a legend', () => {
    const layout = getLayoutConfig(
      internalConfig(heatmap({ heatmap: { color_ranges: BANDS } })),
      mkHass(),
      [],
    ) as AnyRec;
    expect(layout.plotOptions.heatmap.enableShades).toBe(false);
    expect(layout.plotOptions.heatmap.colorScale.ranges.map((range: AnyRec) => range.name)).toEqual([
      'comfort',
      'warm',
      '≥ 23',
    ]);
    expect(layout.legend.show).toBe(true);
    // legend entries are the bands: their names as they are, one marker size
    expect(layout.legend.formatter('comfort')).toBe('comfort');
    expect(typeof layout.legend.markers.size).toBe('number');
  });

  it('keeps the shaded scale without bands', () => {
    const layout = getLayoutConfig(internalConfig(heatmap()), mkHass(), []) as AnyRec;
    expect(layout.plotOptions.heatmap.enableShades).toBe(true);
    expect(layout.plotOptions.heatmap.colorScale).toBeUndefined();
    expect(layout.legend.show).toBe(false);
  });

  it('rejects a band without a value or a colour', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = (band: any) => () => internalConfig(heatmap({ heatmap: { color_ranges: [band] } }));
    expect(bad({ color: 'red' })).toThrow(/color_ranges/);
    expect(bad({ value: 1 })).toThrow(/color_ranges/);
  });
});

describe('heatmap bands in the visual editor', () => {
  const display = (config: ChartCardExternalConfig) => {
    const tab = document.createElement('apexcharts-card-editor-display') as unknown as AnyRec;
    tab.hass = mkHass();
    tab.config = config;
    document.body.appendChild(tab as unknown as Node);
    return tab;
  };

  afterEach(() => document.body.replaceChildren());

  it('shows the band list for heatmaps only, with a name field per band', async () => {
    const tab = display(heatmap({ heatmap: { color_ranges: BANDS } }));
    await tab.updateComplete;
    const list = tab.shadowRoot.querySelector('apexcharts-card-color-threshold-editor');
    expect(list).not.toBeNull();
    expect(list.third).toBe('name');
    expect(list.thresholds).toEqual(BANDS);
    await list.updateComplete;
    expect(list.shadowRoot.querySelectorAll('ha-textfield[label="Name"]').length).toBe(3);

    const line = display({ type: 'custom:apexcharts-card', series: [{ entity: 'sensor.a' }] });
    await line.updateComplete;
    expect(line.shadowRoot.querySelector('apexcharts-card-color-threshold-editor')).toBeNull();
  });

  it('saves bands under heatmap, keeping max_cells, and removes heatmap when empty', () => {
    const tab = display(heatmap({ heatmap: { max_cells: 100 } }));
    const changed = vi.fn();
    tab.addEventListener('config-changed', changed);
    tab._heatmapBandsChanged(new CustomEvent('value-changed', { detail: { value: [BANDS[1]] } }));
    expect(changed.mock.calls[0][0].detail.config.heatmap).toEqual({ max_cells: 100, color_ranges: [BANDS[1]] });

    tab.config = heatmap({ heatmap: { color_ranges: [BANDS[1]] } });
    tab._heatmapBandsChanged(new CustomEvent('value-changed', { detail: { value: [] } }));
    expect(changed.mock.calls[1][0].detail.config.heatmap).toBeUndefined();
  });

  it('keeps series thresholds as they were: an opacity field, the default add label', async () => {
    const list = document.createElement('apexcharts-card-color-threshold-editor') as unknown as AnyRec;
    list.thresholds = [{ value: 1, color: 'red', opacity: 0.5 }];
    document.body.appendChild(list as unknown as Node);
    await list.updateComplete;
    expect(list.shadowRoot.querySelectorAll('ha-textfield[label="Opacity"]').length).toBe(1);
    expect(list.shadowRoot.querySelectorAll('ha-textfield[label="Name"]').length).toBe(0);
    expect(list.shadowRoot.querySelector('.add-button').textContent).toContain('Add Threshold');
  });
});
