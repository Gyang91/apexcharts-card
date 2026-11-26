// Every switch and every dropdown option the editor offers, on every chart type, gives a
// config the card accepts: the editor never leads into a configuration error
import '../src/apexcharts-card';
import '../src/editor/index';
import { mkHass, mkState } from './fixtures/hass';
import type { ChartCardExternalConfig } from '../src/types-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEl = Record<string, any>;

const HOURLY = { func: 'avg', period: 'hour' } as const;
const BASES: Record<string, ChartCardExternalConfig> = {
  line: {
    type: 'custom:apexcharts-card',
    yaxis: [{ id: 'a' }],
    series: [
      { entity: 'sensor.a', yaxis_id: 'a' },
      { entity: 'sensor.b', yaxis_id: 'a' },
    ],
  },
  scatter: { type: 'custom:apexcharts-card', chart_type: 'scatter', series: [{ entity: 'sensor.a' }] },
  heatmap: {
    type: 'custom:apexcharts-card',
    chart_type: 'heatmap',
    series: [{ entity: 'sensor.a', group_by: HOURLY }],
    heatmap: { color_ranges: [{ value: 20, color: 'green' }] },
  },
  rangeArea: {
    type: 'custom:apexcharts-card',
    chart_type: 'rangeArea',
    series: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }],
  },
  pie: { type: 'custom:apexcharts-card', chart_type: 'pie', series: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }] },
  radialBar: { type: 'custom:apexcharts-card', chart_type: 'radialBar', series: [{ entity: 'sensor.a' }] },
};

const hass = mkHass({
  'sensor.a': mkState('sensor.a', '21', { unit_of_measurement: '°C' }),
  'sensor.b': mkState('sensor.b', '23', { unit_of_measurement: '°C' }),
});

const accepted = (config: ChartCardExternalConfig): string | undefined => {
  try {
    (document.createElement('apexcharts-card') as unknown as AnyEl).setConfig(config);
    return undefined;
  } catch (e) {
    return (e as Error).message.replace(/^.*\/\/\/ /, '');
  }
};

// Every element with this tag under root, through shadow roots
const deep = (root: ParentNode, tag: string): AnyEl[] => {
  const found: AnyEl[] = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.tagName.toLowerCase() === tag) found.push(el as AnyEl);
    if (el.shadowRoot) found.push(...deep(el.shadowRoot, tag));
  }
  return found;
};

const settle = async (root: AnyEl) => {
  for (let i = 0; i < 4; i++) {
    await root.updateComplete;
    for (const el of deep(root.shadowRoot, '*')) await el.updateComplete;
    await Promise.resolve();
  }
};

// Select options of a form's fields, flattening grids and expandables (with their data path)
type Option = { path: string[]; value: unknown };
const selectOptions = (schema: AnyEl[], path: string[] = []): Option[] =>
  schema.flatMap((field) => {
    if (field.schema)
      return selectOptions(field.schema, field.type === 'expandable' && field.name ? [...path, field.name] : path);
    const options = field.selector?.select?.options ?? [];
    return options.map((option: AnyEl) => ({ path: [...path, field.name], value: option.value ?? option }));
  });

const withValue = (data: AnyEl, path: string[], value: unknown): AnyEl => {
  const [key, ...rest] = path;
  return { ...data, [key]: rest.length ? withValue(data?.[key] ?? {}, rest, value) : value };
};

// One choice: the n-th switch grid or form under the tab, and what to send it
type Choice = { label: string; tag: string; index: number; detail: (el: AnyEl) => AnyEl };

const open = async (editor: AnyEl, base: ChartCardExternalConfig, tab: number) => {
  editor._config = undefined;
  editor.setConfig(base);
  await settle(editor);
  ([...editor.shadowRoot.querySelectorAll('.tab')][tab] as HTMLElement).click();
  await settle(editor);
  for (const list of deep(editor.shadowRoot, 'apexcharts-card-series-editor')) {
    list._expanded = Object.fromEntries((base.series ?? []).map((_, i) => [i, true]));
  }
  for (const list of deep(editor.shadowRoot, 'apexcharts-card-yaxis-editor')) {
    list._expanded = Object.fromEntries((base.yaxis ?? []).map((_, i) => [i, true]));
  }
  await settle(editor);
};

const choicesOf = (editor: AnyEl, tab: number): Choice[] => [
  ...deep(editor.shadowRoot, 'apexcharts-card-bool-grid').flatMap((grid, index) =>
    (grid.fields as AnyEl[]).map((field) => ({
      label: `tab ${tab} switch ${field.name}=${!field.value}`,
      tag: 'apexcharts-card-bool-grid',
      index,
      detail: () => ({ name: field.name, value: !field.value }),
    })),
  ),
  ...deep(editor.shadowRoot, 'ha-form').flatMap((form, index) =>
    selectOptions(form.schema ?? []).map((option) => ({
      label: `tab ${tab} ${option.path.join('.')}=${String(option.value)}`,
      tag: 'ha-form',
      index,
      detail: (el: AnyEl) => ({ value: withValue(el.data ?? {}, option.path, option.value) }),
    })),
  ),
];

describe.each(Object.keys(BASES))('every editor choice on a %s chart', (type) => {
  it('gives a config the card accepts', async () => {
    const base = BASES[type];
    expect(accepted(base)).toBeUndefined();
    const editor = document.createElement('apexcharts-card-editor') as unknown as AnyEl;
    editor.hass = hass;
    document.body.appendChild(editor as unknown as Node);
    let last: ChartCardExternalConfig | undefined;
    editor.addEventListener('config-changed', (ev: CustomEvent) => (last = ev.detail.config));
    editor.setConfig(base);
    await settle(editor);
    const failures: string[] = [];
    const tabs = editor.shadowRoot.querySelectorAll('.tab').length;
    for (let tab = 0; tab < tabs; tab++) {
      await open(editor, base, tab);
      for (const choice of choicesOf(editor, tab)) {
        await open(editor, base, tab);
        const el = deep(editor.shadowRoot, choice.tag)[choice.index];
        last = undefined;
        el.dispatchEvent(new CustomEvent('value-changed', { detail: choice.detail(el) }));
        editor._send();
        const error = last && accepted(last);
        if (error) failures.push(`${choice.label}: ${error}`);
      }
    }
    editor.remove();
    expect(failures).toEqual([]);
  }, 120000);
});

describe('choices made one after another', () => {
  const general = async (config: ChartCardExternalConfig) => {
    const tab = document.createElement('apexcharts-card-editor-general') as unknown as AnyEl;
    tab.hass = hass;
    tab.config = config;
    document.body.appendChild(tab as unknown as Node);
    await tab.updateComplete;
    const sent: ChartCardExternalConfig[] = [];
    tab.addEventListener('config-changed', (ev: CustomEvent) => sent.push(ev.detail.config));
    return { tab, sent };
  };
  afterEach(() => document.body.replaceChildren());

  it('replaces the span start with an end picked after it, and the other way round', async () => {
    const { tab, sent } = await general({ ...BASES.line, span: { start: 'day' } });
    tab._onValueChanged(
      new CustomEvent('value-changed', {
        detail: { value: { ...tab._formData(), span: { start: 'day', end: 'hour' } } },
      }),
    );
    expect(sent[0].span).toEqual({ end: 'hour' });
    expect(accepted(sent[0])).toBeUndefined();
    tab.config = sent[0];
    tab._onValueChanged(
      new CustomEvent('value-changed', {
        detail: { value: { ...tab._formData(), span: { start: 'week', end: 'hour' } } },
      }),
    );
    expect(sent[1].span).toEqual({ start: 'week' });
  });

  it('offers no span settings while calendar navigation is on', async () => {
    const { tab } = await general({ ...BASES.line, navigation: { show: true } });
    const names = JSON.stringify([...tab.shadowRoot.querySelectorAll('ha-form')].map((form: AnyEl) => form.schema));
    expect(names).not.toContain('"name":"span"');
  });

  it('gives an accepted config for every preset from every chart type', async () => {
    const { applyPreset, PRESETS, presetChartType } = await import('../src/editor/presets');
    const { changeChartType, emptyStash } = await import('../src/editor/support');
    for (const [type, base] of Object.entries(BASES)) {
      for (const preset of PRESETS) {
        const next = applyPreset(changeChartType(base, presetChartType(preset), emptyStash()), preset);
        expect(accepted(next), `${type} → ${preset}`).toBeUndefined();
      }
    }
  });
});
