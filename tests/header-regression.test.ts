// The header (title and series states) renders and acts the same for every kind of setup:
// the snapshot was recorded before the header moved out of the card into header.ts
import '../src/apexcharts-card';
import { mkHass, mkState } from './fixtures/hass';
import type { ChartCardExternalConfig } from '../src/types-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEl = Record<string, any>;

const base = (extra: Partial<ChartCardExternalConfig> = {}): ChartCardExternalConfig => ({
  type: 'custom:apexcharts-card',
  header: { show: true, title: 'Rooms', show_states: true },
  series: [
    { entity: 'sensor.a', name: 'Living' },
    { entity: 'sensor.b' },
    { entity: 'import:energy', statistics: { type: 'mean' } },
    { entity: 'sensor.a', show: { as_duration: 'second' } },
    { entity: 'sensor.b', show: { name_in_header: false } },
    { entity: 'sensor.a', show: { in_header: false } },
    { entity: 'sensor.b', show: { zero_in_header: false } },
    { entity: 'sensor.a', show: { null_in_header: false } },
  ],
  ...extra,
});

const CASES: Record<string, ChartCardExternalConfig> = {
  default: base(),
  floating: base({ header: { show: true, title: 'Rooms', show_states: true, floating: true } }),
  standardFormat: base({ header: { show: true, title: 'Rooms', show_states: true, standard_format: true } }),
  noStates: base({ header: { show: true, title: 'Rooms' } }),
  noTitle: base({ header: { show: true, show_states: true } }),
  disabled: base({ header: { show: true, title: 'Rooms', show_states: true, disable_actions: true } }),
  titleTap: base({
    header: {
      show: true,
      title: 'Rooms',
      show_states: true,
      title_actions: { tap_action: { action: 'navigate', navigation_path: '/rooms' } },
    },
  }),
  titleNone: base({
    header: { show: true, title: 'Rooms', title_actions: { tap_action: { action: 'none' } } },
  }),
  titleHoldOnly: base({
    header: {
      show: true,
      title: 'Rooms',
      title_actions: { tap_action: { action: 'none' }, hold_action: { action: 'more-info', entity: 'sensor.b' } },
    },
  }),
  stateActions: base({
    series: [
      { entity: 'sensor.a', header_actions: { tap_action: { action: 'more-info', entity: 'sensor.b' } } },
      { entity: 'sensor.b', header_actions: { tap_action: { action: 'none' } } },
      {
        entity: 'import:energy',
        statistics: { type: 'mean' },
        header_actions: { tap_action: { action: 'call-service', service: 'light.toggle' } },
      },
      {
        entity: 'sensor.a',
        header_actions: { tap_action: { action: 'none' }, double_tap_action: { action: 'more-info' } },
      },
    ],
  }),
};

const STATES: (number | null)[] = [21.456, 1234.5, null, 3725, 0, 22, 0, null];

// Markup as the browser draws it: attributes in name order (their order means nothing)
const serialise = (node: Node): string => {
  // Spaces at the edges of a text are not drawn (white-space: normal or nowrap)
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const attrs = [...el.attributes]
    .map((attr) => `${attr.name}="${attr.value}"`)
    .sort()
    .join(' ');
  const inner = [...el.childNodes].map(serialise).join('');
  return `<${el.localName}${attrs ? ` ${attrs}` : ''}>${inner}</${el.localName}>`;
};
const normalise = (el: Element) => serialise(el).replace(/> +</g, '><').replace(/ +/g, ' ').trim();

async function render(config: ChartCardExternalConfig) {
  const card = document.createElement('apexcharts-card') as unknown as AnyEl;
  card.setConfig(config);
  const hass = mkHass({
    'sensor.a': mkState('sensor.a', '21', { unit_of_measurement: '°C', friendly_name: 'Sensor A' }),
    'sensor.b': mkState('sensor.b', '5', { unit_of_measurement: 'W' }),
  }) as AnyEl;
  hass.callService = vi.fn();
  card.hass = hass;
  card._headerState = STATES.slice(0, config.series.length);
  document.body.appendChild(card as unknown as Node);
  await card.updateComplete;
  return { card, hass };
}

describe('header', () => {
  afterEach(() => document.body.replaceChildren());

  it.each(Object.keys(CASES))('renders and acts the same: %s', async (name) => {
    const { card, hass } = await render(CASES[name]);
    const header = card.shadowRoot.querySelector('#header');
    const events: string[] = [];
    for (const type of ['hass-more-info', 'location-changed', 'hass-action']) {
      card.addEventListener(type, (ev: CustomEvent) => events.push(`${type} ${JSON.stringify(ev.detail ?? null)}`));
    }
    const pushState = vi.spyOn(history, 'pushState').mockImplementation(() => undefined);
    const targets = header ? [...header.querySelectorAll('#header__title, #states__state')] : [];
    for (const [i, target] of targets.entries()) {
      for (const action of ['tap', 'hold', 'double_tap']) {
        target.dispatchEvent(new CustomEvent('action', { detail: { action } }));
        events.push(`${i} ${action}: ${pushState.mock.calls.length} navigations`);
      }
    }
    pushState.mockRestore();
    expect({
      html: header ? normalise(header) : null,
      events,
      services: hass.callService.mock.calls,
    }).toMatchSnapshot();
  });
});
