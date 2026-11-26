// List items: arrows move, a separate chevron expands
import '../src/editor/components/series-editor';
import '../src/editor/components/yaxis-editor';
import { mkHass } from './fixtures/hass';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEl = Record<string, any>;

afterEach(() => document.body.replaceChildren());

const mount = async (tag: string, config: AnyEl) => {
  const el = document.createElement(tag) as unknown as AnyEl;
  el.hass = mkHass();
  el.config = { type: 'custom:apexcharts-card', series: [{ entity: 'sensor.a' }], ...config };
  document.body.appendChild(el as unknown as Node);
  await el.updateComplete;
  return el;
};
const headers = (el: AnyEl) => [...el.shadowRoot.querySelectorAll('.item-controls')] as Element[];
const button = (controls: Element, cls: string) => controls.querySelector(`ha-icon-button.${cls}`) as AnyEl;

describe('list item controls', () => {
  it('shows only the arrows an item can use, and no expand-like icon among them', async () => {
    const el = await mount('apexcharts-card-series-editor', {
      series: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }, { entity: 'sensor.c' }],
    });
    const [first, middle, last] = headers(el);
    const moves = (c: Element) => [...c.querySelectorAll('ha-icon-button.move')] as AnyEl[];
    expect(moves(first).map((b) => b.classList.contains('unused'))).toEqual([true, false]);
    expect(moves(middle).map((b) => b.classList.contains('unused'))).toEqual([false, false]);
    expect(moves(last).map((b) => b.classList.contains('unused'))).toEqual([false, true]);
    const chevron = button(first, 'chevron');
    expect(moves(first).every((b) => b.path !== chevron.path)).toBe(true);
  });

  it('turns the chevron and moves items with the arrows', async () => {
    const el = await mount('apexcharts-card-yaxis-editor', { yaxis: [{ id: 'a' }, { id: 'b' }] });
    const changed = vi.fn();
    el.addEventListener('config-changed', changed);
    const [first] = headers(el);
    button(first, 'chevron').click();
    await el.updateComplete;
    expect(button(headers(el)[0], 'chevron').classList.contains('open')).toBe(true);
    (headers(el)[0].querySelectorAll('ha-icon-button.move')[1] as AnyEl).click();
    expect(changed.mock.calls[0][0].detail.config.yaxis.map((y: AnyEl) => y.id)).toEqual(['b', 'a']);
  });

  it('has no arrows for a single item', async () => {
    const el = await mount('apexcharts-card-series-editor', {});
    expect(headers(el)[0].querySelectorAll('ha-icon-button.move').length).toBe(0);
  });
});
