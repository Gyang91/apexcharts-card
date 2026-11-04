// Series colors: threshold colors of the chart, gradient stops and the
// header state color, pinned on the card's output
import '../src/apexcharts-card';
import { mkHass } from './fixtures/hass';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCard = any;

const THRESHOLDS = [
  { value: 0, color: '#0000ff' },
  { value: 10, color: '#00ff00', opacity: 0.5 },
  { value: 20, color: '#ff0000' },
];

async function card(config: object): Promise<AnyCard> {
  await customElements.whenDefined('apexcharts-card');
  const c: AnyCard = document.createElement('apexcharts-card');
  c.setConfig({ type: 'custom:apexcharts-card', ...config });
  c._hass = mkHass();
  return c;
}

describe('header state color', () => {
  const config = (type?: string, extra: object = {}) => ({
    experimental: { color_threshold: true },
    header: { show: true, colorize_states: true },
    series: [
      {
        entity: 'sensor.a',
        type,
        color: '#123456',
        color_threshold: THRESHOLDS,
        show: { header_color_threshold: true },
      },
    ],
    ...extra,
  });

  it.each([-5, 0, 5, 10, 15, 20, 25])('line, value %s', async (value) => {
    const c = await card(config());
    expect(c._computeHeaderStateColor(c._config.series[0], value)).toMatchSnapshot();
  });

  it.each([-5, 5, 15, 25])('column, value %s', async (value) => {
    const c = await card(config('column'));
    expect(c._computeHeaderStateColor(c._config.series[0], value)).toMatchSnapshot();
  });

  it('falls back to the series color for null, without thresholds, or without colorize_states', async () => {
    const c = await card(config());
    expect(c._computeHeaderStateColor(c._config.series[0], null)).toBe('color: #123456;');
    const plain = await card({ header: { colorize_states: true }, series: [{ entity: 'sensor.a', color: '#123456' }] });
    expect(plain._computeHeaderStateColor(plain._config.series[0], 5)).toBe('color: #123456;');
    const off = await card({ series: [{ entity: 'sensor.a', color: '#123456' }] });
    expect(off._computeHeaderStateColor(off._config.series[0], 5)).toBe('');
  });

  it('uses the series color for thresholds without a color', async () => {
    const c = await card({
      experimental: { color_threshold: true },
      header: { colorize_states: true },
      series: [
        {
          entity: 'sensor.a',
          color: '#123456',
          color_threshold: [{ value: 0 }, { value: 10 }],
          show: { header_color_threshold: true },
        },
      ],
    });
    expect([-1, 5, 11].map((v) => c._computeHeaderStateColor(c._config.series[0], v))).toMatchSnapshot();
  });
});

describe('fill color stops', () => {
  const ranges: [number, number][] = [
    [0, 20],
    [5, 15],
    [-10, 30],
    [12, 12],
    [25, 40],
  ];

  it.each(['line', 'area', 'column'])('%s series', async (type) => {
    const c = await card({
      experimental: { color_threshold: true },
      series: [{ entity: 'sensor.a', type, color_threshold: THRESHOLDS }],
    });
    const serie = c._config.series[0];
    const stops = ranges.flatMap(([min, max]) => [
      c._computeFillColorStops(serie, min, max, '#123456', false),
      c._computeFillColorStops(serie, min, max, '#123456', true),
    ]);
    expect(stops).toMatchSnapshot();
  });

  it('has no stops without thresholds', async () => {
    const c = await card({ series: [{ entity: 'sensor.a' }] });
    expect(c._computeFillColorStops(c._config.series[0], 0, 1, '#123456')).toBeUndefined();
  });
});

describe('chart colors', () => {
  it('gives column series with thresholds a function of the value; line series keep a color', async () => {
    const c = await card({
      experimental: { color_threshold: true },
      series: [
        { entity: 'sensor.a', type: 'column', color: '#123456', color_threshold: THRESHOLDS },
        { entity: 'sensor.b', color: '#654321', color_threshold: THRESHOLDS },
        { entity: 'sensor.c', type: 'column', color: '#abcdef', color_threshold: [{ value: 1 }] },
      ],
    });
    const colors = c._computeChartColors(false);
    expect(colors).toHaveLength(3);
    expect([-1, 0, 5, 10, 15, 25].map((value) => colors[0]({ value }))).toMatchSnapshot();
    expect(colors[1]).toBe('#654321');
    expect([0, 5].map((value) => colors[2]({ value }))).toMatchSnapshot();
  });

  it('gives every series a function on a plain-color chart type', async () => {
    const c = await card({
      chart_type: 'scatter',
      experimental: { color_threshold: true },
      series: [{ entity: 'sensor.a', color: '#123456', color_threshold: THRESHOLDS }],
    });
    expect(typeof c._computeChartColors(false)[0]).toBe('function');
  });

  it('keeps plain colors without experimental.color_threshold', async () => {
    const c = await card({ series: [{ entity: 'sensor.a', color: '#123456', color_threshold: THRESHOLDS }] });
    expect(c._computeChartColors(false)).toEqual(['#123456']);
  });

  it('threshold fill: one entry per series, none with a custom apex fill', async () => {
    const c = await card({
      experimental: { color_threshold: true },
      series: [
        { entity: 'sensor.a', color_threshold: THRESHOLDS },
        { entity: 'sensor.b', type: 'column', color_threshold: THRESHOLDS },
        { entity: 'sensor.c' },
      ],
    });
    c._graphs = c._graphs.map(() => ({ min: 0, max: 20 }));
    expect(c._computeThresholdFill(false)).toMatchSnapshot();
    const custom = await card({ apex_config: { fill: { type: 'solid' } }, series: [{ entity: 'sensor.a' }] });
    expect(custom._computeThresholdFill(false)).toBeUndefined();
  });
});
