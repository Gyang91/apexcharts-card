import '../src/apexcharts-card';
import '../src/editor/components/yaxis-item-editor';
import type { ChartCardExternalConfig } from '../src/types-config';
import { getLayoutConfig } from '../src/apex-layouts';
import { mkHass } from './fixtures/hass';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCard = any;

const createCard = (extra: Partial<ChartCardExternalConfig> = {}): AnyCard => {
  const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
  card.setConfig({
    type: 'custom:apexcharts-card',
    series: [{ entity: 'sensor.a' }],
    ...extra,
  });
  return card;
};

describe('multiple Y-axes', () => {
  it('maps six independent axes in series order, not declaration order', () => {
    const yaxis = Array.from({ length: 6 }, (_, i) => ({ id: `axis${i}`, opposite: i % 2 === 1 }));
    const series = Array.from({ length: 6 }, (_, i) => ({ entity: `sensor.s${i}`, yaxis_id: `axis${5 - i}` }));
    const card = createCard({
      experimental: { brush: true },
      yaxis,
      series: [{ entity: 'sensor.brush', show: { in_chart: false, in_brush: true } }, ...series],
    });
    card._graphs = card._config.series.map((_: unknown, i: number) => ({
      minMaxWithTimestampForYAxis: () => ({ min: [0, i * 10 + 1], max: [1, i * 10 + 9] }),
    }));
    const axes = card._computeYAxisAutoMinMax(new Date(0), new Date(1000));
    expect(axes).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(axes[i]).toMatchObject({
        id: `axis${5 - i}`,
        opposite: (5 - i) % 2 === 1,
        min: (i + 1) * 10 + 1,
        max: (i + 1) * 10 + 9,
      });
    }
  });

  it('shares limits between series on one axis without mixing other axes', () => {
    const card = createCard({
      yaxis: [{ id: 'a' }, { id: 'b' }, { id: 'c', min: 1, max: 1000 }],
      series: [
        { entity: 'sensor.a', yaxis_id: 'a' },
        { entity: 'sensor.b', yaxis_id: 'b' },
        { entity: 'sensor.c', yaxis_id: 'a' },
        { entity: 'sensor.d', yaxis_id: 'c' },
      ],
    });
    card._graphs = [10, 100, 1, 200].map((value) => ({
      minMaxWithTimestampForYAxis: () => ({ min: [0, value], max: [1, value * 2] }),
    }));
    const axes = card._computeYAxisAutoMinMax(new Date(0), new Date(1000));
    expect(axes[0]).toMatchObject({ min: 1, max: 20, show: true });
    expect(axes[1]).toMatchObject({ min: 100, max: 200 });
    expect(axes[2]).toMatchObject({ min: 1, max: 20, show: false });
    expect(axes[3]).toMatchObject({ min: 1, max: 1000 });
  });

  it('rejects duplicate IDs rather than choosing an ambiguous axis', () => {
    expect(() =>
      createCard({ yaxis: [{ id: 'a' }, { id: 'a' }], series: [{ entity: 'sensor.a', yaxis_id: 'a' }] }),
    ).toThrow(/unique/);
  });

  it('rejects unknown and missing axis references', () => {
    expect(() =>
      createCard({ yaxis: [{ id: 'a' }, { id: 'b' }], series: [{ entity: 'sensor.a', yaxis_id: 'c' }] }),
    ).toThrow(/exist/);
    expect(() => createCard({ yaxis: [{ id: 'a' }, { id: 'b' }] })).toThrow(/yaxis_id/);
  });

  it('handles an unused axis without crashing range calculation', () => {
    const card = createCard({
      yaxis: [{ id: 'used', logarithmic: true }, { id: 'unused' }],
      series: [{ entity: 'sensor.a', yaxis_id: 'used' }],
    });
    card._graphs = [{ minMaxWithTimestampForYAxis: () => ({ min: [0, 1], max: [1, 100] }) }];
    expect(card._computeYAxisAutoMinMax(new Date(0), new Date(1000))[0]).toMatchObject({ min: 1, max: 100 });
  });
});

describe('logarithmic Y-axes', () => {
  it('passes logarithmic settings through to the chart, alongside linear axes', () => {
    const card = createCard({
      yaxis: [{ id: 'log', logarithmic: true, log_base: 2 }, { id: 'linear' }],
      series: [
        { entity: 'sensor.a', yaxis_id: 'log' },
        { entity: 'sensor.b', yaxis_id: 'linear' },
      ],
    });
    const layout = getLayoutConfig(card._config, mkHass(), []) as AnyCard;
    expect(layout.yaxis[0]).toMatchObject({ logarithmic: true, logBase: 2 });
    expect(layout.yaxis[0]).not.toHaveProperty('log_base');
    expect(layout.yaxis[1].logarithmic).not.toBe(true);
  });

  it('retains legacy ApexCharts log options and gives explicit card options precedence', () => {
    const legacy = createCard({ yaxis: [{ apex_config: { logarithmic: true, logBase: 2 } }] });
    expect(legacy._config.apex_config.yaxis[0]).toMatchObject({ logarithmic: true, logBase: 2 });
    const override = createCard({
      yaxis: [{ logarithmic: false, log_base: 10, apex_config: { logarithmic: true, logBase: 2 } }],
    });
    expect(override._config.apex_config.yaxis[0]).toMatchObject({ logarithmic: false, logBase: 10 });
  });

  it.each([0, 1, -2])('rejects invalid logarithm base %s', (log_base) => {
    expect(() => createCard({ yaxis: [{ logarithmic: true, log_base }] })).toThrow(/greater than 1/);
  });

  it('validates legacy logarithm bases and limits, too', () => {
    expect(() => createCard({ yaxis: [{ apex_config: { logarithmic: true, logBase: 1 } }] })).toThrow(/greater than 1/);
    expect(() => createCard({ yaxis: [{ min: 0, apex_config: { logarithmic: true } }] })).toThrow(/positive/);
  });

  it.each([0, -1, '~0', '~-1'])('rejects nonpositive fixed/soft limits %s', (min) => {
    expect(() => createCard({ yaxis: [{ logarithmic: true, min }] })).toThrow(/positive/);
  });

  it('does not round logarithmic limits down to zero with linear align_to', () => {
    const card = createCard({ yaxis: [{ logarithmic: true, align_to: 10 }] });
    card._graphs = [
      {
        minMaxWithTimestampForYAxis: () => ({ min: [0, 0.01], max: [1, 100] }),
      },
    ];
    expect(card._computeYAxisAutoMinMax(new Date(0), new Date(1000))[0]).toMatchObject({ min: 0.01, max: 100 });
  });

  it('retains linear align_to behavior', () => {
    const card = createCard({ yaxis: [{ align_to: 10 }] });
    card._graphs = [
      {
        minMaxWithTimestampForYAxis: () => ({ min: [0, 1], max: [1, 19] }),
      },
    ];
    expect(card._computeYAxisAutoMinMax(new Date(0), new Date(1000))[0]).toMatchObject({ min: 0, max: 20 });
  });
});

describe('Y-axis logarithmic editor', () => {
  it('shows legacy settings and validation errors for invalid log configuration', () => {
    const editor = new (
      customElements.get('apexcharts-card-yaxis-item-editor') as CustomElementConstructor
    )() as AnyCard;
    editor.hass = mkHass();
    editor.yaxis = { apex_config: { logarithmic: true, logBase: 2 } };
    expect(editor._formData().log_base).toBe(2);
    const container = document.createElement('div');
    container.appendChild(editor);
    document.body.appendChild(container);
    editor.yaxis = { logarithmic: true, log_base: 1, min: 0 };
    return editor.updateComplete.then(() => {
      expect(editor.shadowRoot.textContent).toContain('greater than 1');
      expect(editor.shadowRoot.textContent).toContain('positive');
      container.remove();
    });
  });
  it('round-trips base and explicit scale choice without losing other axis settings', () => {
    const editor = new (
      customElements.get('apexcharts-card-yaxis-item-editor') as CustomElementConstructor
    )() as AnyCard;
    editor.yaxis = { id: 'log', opposite: true, logarithmic: true, log_base: 2 };
    const changed = vi.fn();
    editor.addEventListener('value-changed', changed);
    expect(editor._formData().log_base).toBe(2);
    editor._showChanged(new CustomEvent('value-changed', { detail: { name: 'logarithmic', value: false } }));
    expect(changed.mock.calls[0][0].detail.value).toMatchObject({
      id: 'log',
      opposite: true,
      logarithmic: false,
      log_base: 2,
    });
    editor._onChange(new CustomEvent('value-changed', { detail: { value: { log_base: 10 } } }));
    expect(changed.mock.calls[1][0].detail.value.log_base).toBe(10);
    editor._onChange(new CustomEvent('value-changed', { detail: { value: { log_base: '' } } }));
    expect(changed.mock.calls[2][0].detail.value).not.toHaveProperty('log_base');
  });
});
