// color_threshold gradients stay aligned across null gaps (RomRider#1111)
import '../src/apexcharts-card';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCard = any;

const makeCard = (extra: Record<string, unknown> = {}): AnyCard => {
  const card = new (customElements.get('apexcharts-card') as CustomElementConstructor)() as AnyCard;
  card.setConfig({
    type: 'custom:apexcharts-card',
    experimental: { color_threshold: true },
    series: [
      {
        entity: 'sensor.temp',
        color_threshold: [
          { value: 0, color: 'blue' },
          { value: 30, color: 'red' },
        ],
      },
    ],
    ...extra,
  });
  card._graphs = [{ min: 10, max: 30 }];
  return card;
};

// Two pieces of one line split by a gap, each with its own gradient
const makeChart = () => {
  const el = document.createElement('div');
  el.innerHTML = `<svg><defs>
      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"></linearGradient>
      <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"></linearGradient>
    </defs>
    <g class="apexcharts-series" data:realIndex="0">
      <path stroke="url(#g1)"></path><path stroke="url('#g2')"></path>
    </g></svg>`;
  return { el, w: { layout: { gridHeight: 200 }, globals: { minYArr: [0], maxYArr: [40] }, config: { yaxis: [{}] } } };
};

describe('color_threshold gradients across gaps', () => {
  it('spans every piece of a line over the same series min..max', () => {
    const card = makeCard();
    const layout: AnyCard = { chart: { events: { updated: vi.fn() } } };
    card._configureThresholdGradients(layout, false);
    const chart = makeChart();
    layout.chart.events.updated(chart, {});
    for (const id of ['g1', 'g2']) {
      const gradient = chart.el.querySelector(`#${id}`)!;
      expect(gradient.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
      // max 30 on a 0..40 axis is 50 px from the top, min 10 is 150 px
      expect([gradient.getAttribute('y1'), gradient.getAttribute('y2')]).toEqual(['50', '150']);
    }
  });

  it('keeps custom events and maps inverted series from the top', () => {
    const card = makeCard({
      series: [{ entity: 'sensor.temp', invert: true, color_threshold: [{ value: 0 }] }],
    });
    const custom = vi.fn();
    const layout: AnyCard = { chart: { events: { mounted: custom } } };
    card._configureThresholdGradients(layout, false);
    const chart = makeChart();
    chart.w.globals = { minYArr: [-40], maxYArr: [0] };
    layout.chart.events.mounted(chart, {});
    expect(custom).toHaveBeenCalledWith(chart, {});
    const gradient = chart.el.querySelector('#g1')!;
    // inverted: drawn from -10 (top) to -30
    expect([gradient.getAttribute('y1'), gradient.getAttribute('y2')]).toEqual(['50', '150']);
  });

  it('does nothing without thresholds or with a custom fill', () => {
    const layout: AnyCard = {};
    makeCard({ experimental: {} })._configureThresholdGradients(layout, false);
    makeCard({ apex_config: { fill: { type: 'solid' } } })._configureThresholdGradients(layout, false);
    expect(layout.chart).toBeUndefined();
  });
});
