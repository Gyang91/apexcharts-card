// The editor sends Home Assistant at most one config per interval, since every config
// rebuilds the preview card, and loses no change on the way
import '../src/editor/index';
import { stable } from '../src/editor/helpers';
import { mkHass } from './fixtures/hass';
import type { ChartCardExternalConfig } from '../src/types-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEl = Record<string, any>;

const config = (title = 'A'): ChartCardExternalConfig => ({
  type: 'custom:apexcharts-card',
  header: { title },
  series: [{ entity: 'sensor.a' }],
});

const mount = async () => {
  const editor = document.createElement('apexcharts-card-editor') as unknown as AnyEl;
  editor.hass = mkHass();
  editor.setConfig(config());
  document.body.appendChild(editor as unknown as Node);
  await editor.updateComplete;
  const sent = vi.fn();
  editor.addEventListener('config-changed', (ev: CustomEvent) => sent(ev.detail.config.header.title));
  return { editor, sent };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('sending the config to Home Assistant', () => {
  it('sends a change at once, then the latest one per interval while typing', async () => {
    const { editor, sent } = await mount();
    for (const title of ['B', 'BC', 'BCD']) editor._fireConfig(config(title));
    expect(sent.mock.calls).toEqual([['B']]);
    vi.advanceTimersByTime(250);
    expect(sent.mock.calls).toEqual([['B'], ['BCD']]);
  });

  it('sends a waiting change before focus or a tap leaves the editor, and when closed', async () => {
    const { editor, sent } = await mount();
    editor._fireConfig(config('B'));
    editor._fireConfig(config('C'));
    editor.dispatchEvent(new FocusEvent('focusout'));
    expect(sent.mock.calls.at(-1)).toEqual(['C']);

    vi.advanceTimersByTime(250);
    editor._fireConfig(config('D'));
    editor._fireConfig(config('E'));
    window.dispatchEvent(new Event('pointerdown'));
    expect(sent.mock.calls.at(-1)).toEqual(['E']);

    vi.advanceTimersByTime(250);
    editor._fireConfig(config('F'));
    editor._fireConfig(config('G'));
    editor.remove();
    expect(sent.mock.calls.at(-1)).toEqual(['G']);
  });

  it('ignores its own config coming back, and an older one while a newer waits', async () => {
    const { editor } = await mount();
    editor._fireConfig(config('B'));
    editor._fireConfig(config('C'));
    const shown = editor._config;
    editor.setConfig(config('B'));
    expect(editor._config).toBe(shown);
    editor.setConfig(config('C'));
    expect(editor._config).toBe(shown);
  });

  it('takes a config edited in YAML, dropping the change still waiting', async () => {
    const { editor, sent } = await mount();
    editor._fireConfig(config('B'));
    editor._fireConfig(config('C'));
    editor.setConfig(config('YAML'));
    expect(editor._config.header.title).toBe('YAML');
    vi.advanceTimersByTime(500);
    expect(sent.mock.calls).toEqual([['B']]);
  });
});

describe('stable form objects', () => {
  it('returns the object already handed out for the same content', () => {
    const first = stable([{ name: 'a', selector: { text: {} } }]);
    expect(stable([{ name: 'a', selector: { text: {} } }])).toBe(first);
    expect(stable([{ name: 'b', selector: { text: {} } }])).not.toBe(first);
  });
});
