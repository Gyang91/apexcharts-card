// Non-regression test for #160: a narrow card must not be held open by a wide chart.
//
// On a fresh load ApexCharts pins a pixel width on the chart from the first measurement,
// and an SVG wider than the card keeps the grid track (and therefore #header / #graph)
// at its own min-content width. `grid-template-columns: 1fr` is `minmax(auto, 1fr)`, so
// the track cannot shrink below that; the graph never gets narrower, its ResizeObserver
// never fires and nothing corrects the width. The rules that allowed shrinking used to
// live under `ha-card.section` only, which a plain auto-height card never matches.
import '../src/apexcharts-card';
import { mkHass, mkState } from './fixtures/hass';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCard = any;

async function mountCard(extraConfig: Record<string, unknown> = {}): Promise<AnyCard> {
  const Ctor = customElements.get('apexcharts-card') as CustomElementConstructor;
  const card: AnyCard = new Ctor();
  card.setConfig({
    type: 'custom:apexcharts-card',
    series: [{ entity: 'sensor.temp' }],
    ...extraConfig,
  });
  card._hass = mkHass({ 'sensor.temp': mkState('sensor.temp', '21') });
  card._entities = [card._hass.states['sensor.temp']];
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

describe('#160 wrapper accepts shrinking (narrow cards)', () => {
  it.each([
    ['auto-height card', {}],
    ['sections card filling a fixed height', { section_mode: true }],
  ])('%s', async (_name, extraConfig) => {
    const card = await mountCard(extraConfig as Record<string, unknown>);
    try {
      const wrapper = card.shadowRoot.querySelector('.wrapper');
      expect(wrapper).not.toBeNull();
      // minmax(0, 1fr) instead of minmax(auto, 1fr): the track follows the card, not the SVG.
      expect(getComputedStyle(wrapper as Element).gridTemplateColumns).toBe('minmax(0, 1fr)');

      const graphWrapper = card.shadowRoot.querySelector('#graph-wrapper');
      expect(graphWrapper).not.toBeNull();
      // Without this the wrapper itself is sized by the chart's min-content width.
      // happy-dom reports a zero length unitless ('0'), so compare the value, not the string.
      expect(parseFloat(getComputedStyle(graphWrapper as Element).minWidth)).toBe(0);
    } finally {
      card.remove();
    }
  });
});
