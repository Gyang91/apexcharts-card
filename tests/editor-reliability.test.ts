// Edits made just before Save, removing a row, or reordering items never get lost or misplaced
import '../src/editor/index';
import { mkHass } from './fixtures/hass';
import type { ChartCardExternalConfig } from '../src/types-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEl = Record<string, any>;

const heatmap = (): ChartCardExternalConfig => ({
  type: 'custom:apexcharts-card',
  chart_type: 'heatmap',
  series: [{ entity: 'sensor.a', group_by: { func: 'avg', period: 'hour' } }],
  heatmap: {
    color_ranges: [
      { value: 18, color: 'blue' },
      { value: 22, color: 'red' },
    ],
  },
});

const editField = (form: AnyEl, value: unknown) => {
  const [field] = form.schema;
  form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { [field.name]: value } } }));
};

const openBands = async () => {
  const editor = document.createElement('apexcharts-card-editor') as unknown as AnyEl;
  editor.hass = mkHass();
  editor.setConfig(heatmap());
  document.body.appendChild(editor as unknown as Node);
  await editor.updateComplete;
  const tab = [...editor.shadowRoot.querySelectorAll('.tab')][2] as HTMLElement;
  tab.click();
  await editor.updateComplete;
  const display = editor.shadowRoot.querySelector('apexcharts-card-editor-display');
  await display.updateComplete;
  const list = display.shadowRoot.querySelector('apexcharts-card-color-threshold-editor');
  await list.updateComplete;
  const sent: ChartCardExternalConfig[] = [];
  editor.addEventListener('config-changed', (ev: CustomEvent) => sent.push(ev.detail.config));
  const valueForms = () =>
    [...list.shadowRoot.querySelectorAll('ha-form')].filter((form: AnyEl) => form.schema[0].name === 'value');
  return { editor, list, sent, valueForms };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('editor reliability', () => {
  it('sends a band value typed just before Save is pressed', async () => {
    const { sent, valueForms } = await openBands();
    editField(valueForms()[1], 25);
    window.dispatchEvent(new Event('pointerdown'));
    expect(sent.at(-1)?.heatmap?.color_ranges?.[1].value).toBe(25);
  });

  it('applies a pending edit to its own row when another row is removed', async () => {
    const { list, sent, valueForms } = await openBands();
    editField(valueForms()[1], 25);
    (list.shadowRoot.querySelector('.item-controls ha-icon-button') as HTMLElement).click();
    vi.advanceTimersByTime(1000);
    const ranges = sent.at(-1)?.heatmap?.color_ranges;
    expect(ranges).toEqual([{ value: 25, color: 'red' }]);
  });
});

describe('per-item editor state', () => {
  it('does not carry a series’ Custom smoothing over to the series moved into its place', async () => {
    const list = document.createElement('apexcharts-card-series-editor') as unknown as AnyEl;
    list.hass = mkHass();
    list.config = {
      type: 'custom:apexcharts-card',
      series: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }],
    };
    list._expanded = { 0: true };
    document.body.appendChild(list as unknown as Node);
    await list.updateComplete;
    const item = () => list.shadowRoot.querySelector('apexcharts-card-series-item-editor');
    item()._smoothingChanged(new CustomEvent('value-changed', { detail: { value: { smoothing: 'custom' } } }));
    expect(item()._smoothing()).toBe('custom');
    list.config = { ...list.config, series: [{ entity: 'sensor.b' }, { entity: 'sensor.a' }] };
    await list.updateComplete;
    await item().updateComplete;
    expect(item()._smoothing()).toBe('none');
  });

  it('does not carry a picked y-axis limit mode over to another axis', async () => {
    const list = document.createElement('apexcharts-card-yaxis-editor') as unknown as AnyEl;
    list.hass = mkHass();
    list.config = {
      type: 'custom:apexcharts-card',
      series: [{ entity: 'sensor.a' }],
      yaxis: [{ id: 'a' }, { id: 'b' }],
    };
    list._expanded = { 0: true };
    document.body.appendChild(list as unknown as Node);
    await list.updateComplete;
    const item = () => list.shadowRoot.querySelector('apexcharts-card-yaxis-item-editor');
    item()._onChange(
      new CustomEvent('value-changed', { detail: { value: { ...item()._formData(), min_mode: 'soft' } } }),
    );
    expect(item()._formData().min_mode).toBe('soft');
    list.config = { ...list.config, yaxis: [{ id: 'b' }, { id: 'a' }] };
    await list.updateComplete;
    await item().updateComplete;
    expect(item()._formData().min_mode).toBe('auto');
  });
});
