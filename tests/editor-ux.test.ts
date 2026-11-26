// Visual editor usability: live typing, format hints, presets and limit modes
import '../src/editor/components/color-threshold-editor';
import '../src/editor/components/color-input';
import '../src/editor/components/series-editor';
import '../src/editor/components/series-item-editor';
import '../src/editor/components/yaxis-item-editor';
import {
  debounced,
  isValidYaxisLimit,
  parseYaxisLimit,
  serializeYaxisLimit,
  smoothingOf,
  typedNumber,
} from '../src/editor/helpers';
import { getGeneralBottomSchema, GENERAL_TOP_SCHEMA } from '../src/editor/schemas/general';
import { getSeriesGroupBySchema } from '../src/editor/schemas/series';
import { mkHass } from './fixtures/hass';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEl = Record<string, any>;

const make = (tag: string, props: AnyEl = {}): AnyEl => {
  const el = document.createElement(tag) as unknown as AnyEl;
  Object.assign(el, props);
  document.body.appendChild(el as unknown as Node);
  return el;
};

const typeInto = (field: Element, text: string) => {
  (field as HTMLInputElement).value = text;
  field.dispatchEvent(new Event('input'));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('editor helpers', () => {
  it('debounces per key, so a change in one field does not drop another', () => {
    const fn = vi.fn();
    const call = debounced(fn, (key: string) => key);
    call('a');
    call('b');
    call('a');
    vi.advanceTimersByTime(400);
    expect(fn.mock.calls).toEqual([['b'], ['a']]);
  });

  it('accepts only complete numbers while typing', () => {
    expect(typedNumber('1.5')).toBe(1.5);
    expect(typedNumber('-2')).toBe(-2);
    expect(typedNumber('1.')).toBeUndefined();
    expect(typedNumber('-')).toBeUndefined();
  });

  it('reads and writes y-axis limits as a mode and a number', () => {
    expect(parseYaxisLimit(undefined)).toEqual({ mode: 'auto' });
    expect(parseYaxisLimit('auto')).toEqual({ mode: 'auto' });
    expect(parseYaxisLimit(5)).toEqual({ mode: 'fixed', value: 5 });
    expect(parseYaxisLimit('~15')).toEqual({ mode: 'soft', value: 15 });
    expect(parseYaxisLimit('|-5|')).toEqual({ mode: 'padding', value: -5 });
    expect(parseYaxisLimit('|+10|')).toEqual({ mode: 'padding', value: 10 });
    expect(serializeYaxisLimit('fixed', 0)).toBe(0);
    expect(serializeYaxisLimit('soft', 15)).toBe('~15');
    expect(serializeYaxisLimit('padding', 10)).toBe('|+10|');
    expect(serializeYaxisLimit('padding', -5)).toBe('|-5|');
    expect(serializeYaxisLimit('soft', undefined)).toBeUndefined();
    expect(serializeYaxisLimit('auto', 3)).toBeUndefined();
  });

  it('accepts the |+N| padding the README documents', () => {
    expect(isValidYaxisLimit('|+20|')).toBe(true);
    expect(isValidYaxisLimit('|-20|')).toBe(true);
    expect(isValidYaxisLimit('|20')).toBe(false);
  });

  it('names group_by settings that match a smoothing preset', () => {
    expect(smoothingOf(undefined)).toBe('none');
    expect(smoothingOf({ func: 'raw' })).toBe('none');
    expect(smoothingOf({ func: 'avg', duration: '1h', fill: 'null' })).toBe('avg_1h');
    expect(smoothingOf({ func: 'avg', duration: '2h' })).toBe('custom');
    expect(smoothingOf({ func: 'diff' })).toBe('custom');
  });

  it('offers common durations in a list that also takes a typed value', () => {
    const fields = [
      ...GENERAL_TOP_SCHEMA,
      ...getGeneralBottomSchema()[0].schema!,
      ...getSeriesGroupBySchema()[0].schema!.slice(0, 1),
    ];
    expect(fields.map((field) => field.name)).toEqual(['graph_span', 'update_interval', 'update_delay', 'duration']);
    for (const field of fields) {
      expect(field.selector?.select).toMatchObject({ custom_value: true });
      expect(field.selector?.select.options.length).toBeGreaterThan(2);
    }
  });
});

describe('colour band and threshold rows', () => {
  const rows = (thresholds: AnyEl[], third = 'opacity') => {
    const list = make('apexcharts-card-color-threshold-editor', { thresholds, third });
    const changed = vi.fn();
    list.addEventListener('value-changed', changed);
    return { list, changed };
  };
  const fields = async (list: AnyEl, label: string) => {
    await list.updateComplete;
    return [...list.shadowRoot.querySelectorAll(`ha-textfield[label="${label}"]`)] as Element[];
  };

  it('updates while typing, after a short pause, and keeps the row where it is', async () => {
    const { list, changed } = rows([
      { value: 10, color: 'red' },
      { value: 20, color: 'blue' },
    ]);
    const [first] = await fields(list, 'Value');
    typeInto(first, '30');
    expect(changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(changed.mock.calls[0][0].detail.value).toEqual([
      { value: 30, color: 'red' },
      { value: 20, color: 'blue' },
    ]);
  });

  it('keeps the row when its value is cleared or half typed', async () => {
    const { list, changed } = rows([{ value: 10, color: 'red' }]);
    const [value] = await fields(list, 'Value');
    typeInto(value, '');
    vi.advanceTimersByTime(400);
    typeInto(value, '-');
    vi.advanceTimersByTime(400);
    expect(changed).not.toHaveBeenCalled();
  });

  it('shows what each field expects', async () => {
    const { list } = rows([{ value: 10, color: 'red' }], 'name');
    const [name] = await fields(list, 'Name');
    expect((name as AnyEl).helper).toBe('Shown in the legend');
    // bands get no hint of their own: the panel explains them once
    expect(list.shadowRoot.querySelector('.hint')).toBeNull();
    const colour = list.shadowRoot.querySelector('apexcharts-card-color-input');
    await colour.updateComplete;
    expect(colour.shadowRoot.querySelector('ha-textfield').helper).toContain('#hex');
  });

  it('draws the bands as a colour strip in value order, following their colours', async () => {
    const { list } = rows(
      [
        { value: 22, color: 'red' },
        { value: 20, color: 'green' },
        { value: 24, color: 'blue' },
      ],
      'name',
    );
    list.unit = '°C';
    await list.updateComplete;
    const strip = [...list.shadowRoot.querySelectorAll('.band-bar div')].map((el: AnyEl) => el.style.background);
    expect(strip).toEqual(['green', 'red', 'blue']);
    const scale = [...list.shadowRoot.querySelectorAll('.band-scale span')].map((el: Element) =>
      el.textContent!.trim(),
    );
    expect(scale).toEqual(['22', '24', '°C']);
    list.thresholds = [{ value: 20, color: 'orange' }];
    await list.updateComplete;
    expect(list.shadowRoot.querySelector('.band-bar div').style.background).toBe('orange');
  });

  it('adds a row above the last value and changes the colour from the picker', async () => {
    const { list, changed } = rows([{ value: 10, color: 'red' }]);
    await list.updateComplete;
    list.shadowRoot.querySelector('.add-button').click();
    expect(changed.mock.calls[0][0].detail.value[1]).toEqual({ value: 20 });

    const colour = list.shadowRoot.querySelector('apexcharts-card-color-input');
    await colour.updateComplete;
    const picker = colour.shadowRoot.querySelector('input[type="color"]');
    picker.value = '#00ff00';
    picker.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(400);
    expect(changed.mock.calls[1][0].detail.value).toEqual([{ value: 10, color: '#00ff00' }]);
  });
});

describe('series thresholds and smoothing', () => {
  const config = (extra: AnyEl = {}) => ({
    type: 'custom:apexcharts-card',
    series: [{ entity: 'sensor.a' }],
    ...extra,
  });

  it('shows the thresholds panel without the experimental switch, with a note', async () => {
    const item = make('apexcharts-card-series-item-editor', {
      hass: mkHass(),
      config: config(),
      series: { entity: 'sensor.a' },
    });
    await item.updateComplete;
    expect(item.shadowRoot.querySelector('apexcharts-card-color-threshold-editor')).not.toBeNull();
    expect(item.shadowRoot.textContent).toContain('experimental colour-threshold mode');

    const heatmap = make('apexcharts-card-series-item-editor', {
      hass: mkHass(),
      config: config({ chart_type: 'heatmap' }),
      series: { entity: 'sensor.a' },
    });
    await heatmap.updateComplete;
    expect(heatmap.shadowRoot.querySelector('apexcharts-card-color-threshold-editor')).toBeNull();
  });

  it('turns the experimental switch on with the first threshold', () => {
    const editor = make('apexcharts-card-series-editor', { hass: mkHass(), config: config() });
    const changed = vi.fn();
    editor.addEventListener('config-changed', changed);
    const series = { entity: 'sensor.a', color_threshold: [{ value: 1, color: 'red' }] };
    editor._seriesChanged(0, new CustomEvent('series-changed', { detail: { series } }));
    expect(changed.mock.calls[0][0].detail.config.experimental).toEqual({ color_threshold: true });
  });

  it('writes a smoothing preset into group_by, keeping its other settings', () => {
    const item = make('apexcharts-card-series-item-editor', {
      hass: mkHass(),
      config: config(),
      series: { entity: 'sensor.a', group_by: { func: 'max', duration: '2h', fill: 'zero' } },
    });
    const changed = vi.fn();
    item.addEventListener('series-changed', changed);
    expect(item._smoothing()).toBe('custom');
    item._smoothingChanged(new CustomEvent('value-changed', { detail: { value: { smoothing: 'avg_1h' } } }));
    expect(changed.mock.calls[0][0].detail.series.group_by).toEqual({ func: 'avg', duration: '1h', fill: 'zero' });
    item.series = { entity: 'sensor.a', group_by: { func: 'avg', duration: '1h' } };
    item._smoothingChanged(new CustomEvent('value-changed', { detail: { value: { smoothing: 'none' } } }));
    expect(changed.mock.calls[1][0].detail.series.group_by).toBeUndefined();
  });

  it('shows the group_by fields only for Custom', async () => {
    const item = make('apexcharts-card-series-item-editor', {
      hass: mkHass(),
      config: config(),
      series: { entity: 'sensor.a', group_by: { func: 'avg', duration: '1h' } },
    });
    await item.updateComplete;
    const groupByForm = () =>
      [...item.shadowRoot.querySelectorAll('ha-form')].some((form: AnyEl) =>
        form.schema?.some((field: AnyEl) => field.name === 'align'),
      );
    expect(groupByForm()).toBe(false);
    item._smoothingChanged(new CustomEvent('value-changed', { detail: { value: { smoothing: 'custom' } } }));
    await item.updateComplete;
    expect(groupByForm()).toBe(true);
  });
});

describe('y-axis min and max modes', () => {
  const axis = (yaxis: AnyEl) => {
    const editor = make('apexcharts-card-yaxis-item-editor', { hass: mkHass(), yaxis });
    const changed = vi.fn();
    editor.addEventListener('value-changed', changed);
    return { editor, changed };
  };
  const change = (editor: AnyEl, value: AnyEl) =>
    editor._onChange(new CustomEvent('value-changed', { detail: { value: { ...editor._formData(), ...value } } }));

  it('writes the README syntax from a mode and a number', () => {
    const { editor, changed } = axis({ id: 'a' });
    expect(editor._formData()).toMatchObject({ min_mode: 'auto', max_mode: 'auto' });
    change(editor, { min_mode: 'soft', min: 15 });
    expect(changed.mock.calls[0][0].detail.value).toEqual({ id: 'a', min: '~15' });
    editor.yaxis = { id: 'a', min: '~15' };
    change(editor, { max_mode: 'padding', max: 10 });
    expect(changed.mock.calls[1][0].detail.value).toEqual({ id: 'a', min: '~15', max: '|+10|' });
  });

  it('keeps a picked mode on screen until its number is typed', async () => {
    const { editor, changed } = axis({ id: 'a' });
    change(editor, { min_mode: 'fixed' });
    expect(changed.mock.calls[0][0].detail.value).toEqual({ id: 'a' });
    expect(editor._formData().min_mode).toBe('fixed');
    await editor.updateComplete;
    const limits = editor.shadowRoot.querySelector('ha-form').schema[1].schema;
    expect(limits.map((field: AnyEl) => field.name)).toEqual(['min_mode', 'min']);
    expect(limits[1].helper).toContain('always starts here');
  });

  it('leaves limits it did not touch as written', () => {
    const { editor, changed } = axis({ min: 0, max: 'auto', tick_step: 1 });
    change(editor, { decimals: 1 });
    expect(changed.mock.calls[0][0].detail.value).toEqual({ min: 0, max: 'auto', tick_step: 1, decimals: 1 });
  });
});
