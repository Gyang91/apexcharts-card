// Extremas and `now` annotations, pinned on the card's output
import '../src/apexcharts-card';
import { mkHass } from './fixtures/hass';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCard = any;

const T0 = Date.UTC(2026, 0, 10, 8, 0, 0);
const HOUR = 3600 * 1000;

async function cardWith(config: object, minMax: { min: [number, number | null]; max: [number, number | null] }) {
  await customElements.whenDefined('apexcharts-card');
  const card: AnyCard = document.createElement('apexcharts-card');
  card.setConfig({ type: 'custom:apexcharts-card', ...config });
  card._hass = mkHass();
  card._graphs = card._graphs.map(() => ({ minMaxWithTimestamp: vi.fn(() => structuredClone(minMax)) }));
  return card;
}

describe('annotations', () => {
  const minMax = { min: [T0 + HOUR, -2.5], max: [T0 + 2 * HOUR, 7.25] } as {
    min: [number, number | null];
    max: [number, number | null];
  };

  it.each([true, 'min', 'max', 'time', 'min+time', 'max+time'])('extremas: %s', async (extremas) => {
    const card = await cardWith({ series: [{ entity: 'sensor.a', show: { extremas } }] }, minMax);
    const result = card._computeAnnotations(new Date(T0), new Date(T0 + 3 * HOUR), new Date(T0 + 3 * HOUR));
    expect(result).toMatchSnapshot();
  });

  it('extremas across days add the date, honour offset and invert, and keep apex_config points', async () => {
    const card = await cardWith(
      {
        series: [{ entity: 'sensor.a', offset: '-1h', invert: true, show: { extremas: 'time' } }],
        apex_config: { annotations: { points: [{ x: 1, y: 1 }] } },
      },
      minMax,
    );
    const result = card._computeAnnotations(new Date(T0), new Date(T0 + 30 * HOUR), new Date(T0));
    expect(card._graphs[0].minMaxWithTimestamp).toHaveBeenCalledWith(T0 - HOUR, T0 + 29 * HOUR, expect.any(Number));
    expect(result).toMatchSnapshot();
  });

  it('skips a missing extrema and series without extremas', async () => {
    const card = await cardWith(
      { series: [{ entity: 'sensor.a', show: { extremas: true } }, { entity: 'sensor.b' }] },
      { min: [0, null], max: [T0, 3] },
    );
    const result = card._computeAnnotations(new Date(T0), new Date(T0 + HOUR), new Date(T0));
    expect(result.points).toHaveLength(1);
    expect(result.xaxis).toBeUndefined();
  });

  it('now marker, with apex_config x-axis annotations after it', async () => {
    const card = await cardWith(
      {
        series: [{ entity: 'sensor.a' }],
        now: { show: true, label: 'Now', color: 'red' },
        apex_config: { annotations: { xaxis: [{ x: 5 }] } },
      },
      minMax,
    );
    const result = card._computeAnnotations(new Date(T0), new Date(T0 + HOUR), new Date(T0 + HOUR / 2));
    expect(result).toMatchSnapshot();
  });

  it('no now marker unless shown', async () => {
    const card = await cardWith({ series: [{ entity: 'sensor.a' }], now: { label: 'Now' } }, minMax);
    expect(card._computeAnnotations(new Date(T0), new Date(T0 + HOUR), new Date(T0)).xaxis).toBeUndefined();
  });
});
