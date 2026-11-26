// The editor shows only the settings a chart type can use, and offers to remove
// the ones the card would reject
import '../src/apexcharts-card';
import '../src/editor/index';
import { removeUnsupported, supports, unsupportedSettings } from '../src/editor/support';
import { mkHass } from './fixtures/hass';
import { t } from '../src/editor/localize';
import type { ChartCardExternalConfig } from '../src/types-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEl = Record<string, any>;

const chart = (chart_type: ChartCardExternalConfig['chart_type'], extra: AnyEl = {}): ChartCardExternalConfig => ({
  type: 'custom:apexcharts-card',
  chart_type,
  series: [
    { entity: 'sensor.a', group_by: { func: 'avg', duration: '1h' } },
    { entity: 'sensor.b', group_by: { func: 'avg', duration: '1h' } },
  ],
  ...extra,
});

const setConfig = (config: ChartCardExternalConfig) => () =>
  (document.createElement('apexcharts-card') as unknown as AnyEl).setConfig(config);

// Settings range bands and heatmaps reject, one at a time
const REJECTED: [string, AnyEl][] = [
  ['tabs.yaxis', { yaxis: [{ min: 0 }] }],
  ['field.stacked', { stacked: true }],
  ['field.brush', { experimental: { brush: true } }],
  ['field.hidden_by_default', { experimental: { hidden_by_default: true } }],
  ['field.color_threshold', { experimental: { color_threshold: true } }],
];
const REJECTED_SERIES: [string, AnyEl][] = [
  ['tabs.yaxis', { yaxis_id: 'a' }],
  ['field.invert', { invert: true }],
  ['field.in_chart', { show: { in_chart: false } }],
  ['field.extremas', { show: { extremas: true } }],
  ['field.datalabels', { show: { datalabels: true } }],
  ['field.color_threshold', { color_threshold: [{ value: 1, color: 'red' }] }],
];

describe('what each chart type supports', () => {
  beforeAll(() => customElements.whenDefined('apexcharts-card'));

  it.each(['heatmap', 'rangeArea'] as const)('matches what the card rejects on %s charts', (type) => {
    expect(setConfig(chart(type))).not.toThrow();
    for (const [label, extra] of REJECTED) {
      const config = chart(type, extra);
      expect(setConfig(config)).toThrow();
      expect(unsupportedSettings(config)).toEqual([label]);
      expect(setConfig(removeUnsupported(config))).not.toThrow();
    }
    for (const [label, extra] of REJECTED_SERIES) {
      const config = chart(type);
      Object.assign(config.series[0], extra);
      expect(setConfig(config)).toThrow();
      expect(unsupportedSettings(config)).toEqual([label]);
      expect(setConfig(removeUnsupported(config))).not.toThrow();
    }
  });

  it('flags calendar navigation on pie, donut and radial bar charts, as the card does', () => {
    const config = chart('pie', { navigation: { show: true } });
    expect(setConfig(config)).toThrow();
    expect(unsupportedSettings(config)).toEqual(['field.navigation']);
    expect(removeUnsupported(config)).not.toHaveProperty('navigation');
  });

  it('leaves line charts alone and keeps other settings when removing', () => {
    const line = chart(undefined, { stacked: true, yaxis: [{ min: 0 }], experimental: { brush: true } });
    expect(unsupportedSettings(line)).toEqual([]);
    expect(removeUnsupported(line)).toEqual(line);
    const heatmap = chart('heatmap', { yaxis: [{}], experimental: { brush: true, disable_config_validation: true } });
    expect(removeUnsupported(heatmap)).toEqual(chart('heatmap', { experimental: { disable_config_validation: true } }));
  });

  it('answers per chart type, line being the default', () => {
    expect(supports(chart(undefined), 'yaxis')).toBe(true);
    expect(supports(chart('pie'), 'yaxis')).toBe(false);
    expect(supports(chart('pie'), 'color_threshold')).toBe(true);
    expect(supports(chart('scatter'), 'series_type')).toBe(false);
    expect(supports(chart('heatmap'), 'now')).toBe(true);
    expect(supports(chart('heatmap'), 'markers')).toBe(false);
  });
});

describe('editor follows the chart type', () => {
  const mount = async (tag: string, config: ChartCardExternalConfig, props: AnyEl = {}) => {
    const el = document.createElement(tag) as unknown as AnyEl;
    el.hass = mkHass();
    if (tag === 'apexcharts-card-editor') el.setConfig(config);
    else el.config = config;
    Object.assign(el, props);
    document.body.appendChild(el as unknown as Node);
    await el.updateComplete;
    return el;
  };
  const formFields = (el: AnyEl): string[] =>
    [...el.shadowRoot.querySelectorAll('ha-form')].flatMap((form: AnyEl) =>
      (JSON.stringify(form.schema).match(/"name":"[a-z_]+"/g) ?? []).map((match) => match.slice(8, -1)),
    );
  const boolFields = (el: AnyEl): string[] =>
    [...el.shadowRoot.querySelectorAll('apexcharts-card-bool-grid')].flatMap((grid: AnyEl) =>
      grid.fields.map((field: AnyEl) => field.name),
    );

  afterEach(() => document.body.replaceChildren());

  it('hides the Y-Axis tab and offers to remove the axes a heatmap cannot use', async () => {
    const editor = await mount('apexcharts-card-editor', chart('heatmap', { yaxis: [{ min: 0 }] }));
    const tabs = [...editor.shadowRoot.querySelectorAll('.tab')].map((tab: AnyEl) => tab.textContent.trim());
    expect(tabs).not.toContain(t('tabs.yaxis'));
    const banner = editor.shadowRoot.querySelector('.unsupported');
    expect(banner.textContent).toContain(`${t('editor.unsupported')} ${t('tabs.yaxis')}`);

    const changed = vi.fn();
    editor.addEventListener('config-changed', changed);
    editor.shadowRoot.querySelector('.unsupported button').click();
    expect(changed.mock.calls[0][0].detail.config).not.toHaveProperty('yaxis');
    await editor.updateComplete;
    expect(editor.shadowRoot.querySelector('.unsupported')).toBeNull();

    const line = await mount('apexcharts-card-editor', chart('line'));
    expect([...line.shadowRoot.querySelectorAll('.tab')].map((tab: AnyEl) => tab.textContent.trim())).toContain(
      t('tabs.yaxis'),
    );
    expect(line.shadowRoot.querySelector('.unsupported')).toBeNull();
  });

  it('shows only the series settings the chart type uses', async () => {
    const series = { entity: 'sensor.a' };
    const line = await mount('apexcharts-card-series-item-editor', chart('line', { yaxis: [{ id: 'a' }] }), { series });
    expect(formFields(line)).toEqual(
      expect.arrayContaining(['type', 'curve', 'stroke_width', 'opacity', 'extend_to', 'extremas', 'yaxis_id']),
    );
    expect(boolFields(line)).toEqual(expect.arrayContaining(['invert', 'in_chart']));

    const pie = await mount('apexcharts-card-series-item-editor', chart('pie'), { series });
    // the series type field is in the form holding the name
    const core = [...pie.shadowRoot.querySelectorAll('ha-form')].find((form: AnyEl) => 'name' in form.data);
    expect(core.data).toHaveProperty('type');
    expect(JSON.stringify(core.schema)).not.toContain('"type"');
    for (const name of ['curve', 'stroke_width', 'extend_to', 'extremas']) {
      expect(formFields(pie)).not.toContain(name);
    }
    expect(formFields(pie)).toEqual(expect.arrayContaining(['opacity', 'datalabels']));
    expect(pie.shadowRoot.querySelector('apexcharts-card-color-threshold-editor')).not.toBeNull();

    const heatmap = await mount('apexcharts-card-series-item-editor', chart('heatmap'), { series });
    for (const name of ['opacity', 'datalabels', 'extremas', 'curve']) {
      expect(formFields(heatmap)).not.toContain(name);
    }
    expect(boolFields(heatmap)).not.toEqual(expect.arrayContaining(['invert']));
    expect(boolFields(heatmap)).not.toContain('in_chart');
    expect(heatmap.shadowRoot.querySelector('apexcharts-card-color-threshold-editor')).toBeNull();
  });

  it('shows only the display panels and general switches the chart type uses', async () => {
    const panels = (el: AnyEl) =>
      [...el.shadowRoot.querySelectorAll('ha-expansion-panel')].map((panel: AnyEl) => panel.getAttribute('header'));
    const pie = await mount('apexcharts-card-editor-display', chart('pie'));
    const gated = ['nowMarker', 'grid', 'markers', 'annotations'].map((key) => t(`display.panel.${key}`));
    for (const header of gated) {
      expect(panels(pie)).not.toContain(header);
    }
    const line = await mount('apexcharts-card-editor-display', chart('line'));
    expect(panels(line)).toEqual(expect.arrayContaining(gated));

    const general = await mount('apexcharts-card-editor-general', chart('pie'));
    expect(boolFields(general)).not.toEqual(expect.arrayContaining(['navigation']));
    expect(boolFields(general)).not.toContain('stacked');
    expect(boolFields(general)).not.toContain('downsample');
    expect(general.shadowRoot.querySelector('.section').firstElementChild.textContent).toContain(
      t('general.chartType'),
    );

    const advanced = await mount('apexcharts-card-editor-advanced', chart('heatmap'));
    expect(boolFields(advanced)).toEqual(['section_mode', 'disable_config_validation', 'cache']);
  });
});
