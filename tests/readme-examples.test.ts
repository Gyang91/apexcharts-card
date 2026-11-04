// Every complete card example in the README must work when pasted: valid
// YAML that the card accepts. Fragments (templates, option snippets without
// `type: custom:apexcharts-card`) and other cards are skipped.
import '../src/apexcharts-card';
import { load } from 'js-yaml';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');
const examples = [...readme.matchAll(/```yaml\n([\s\S]*?)```/g)]
  .map((match) => ({
    yaml: match[1],
    line: readme.slice(0, match.index).split('\n').length,
  }))
  .filter(({ yaml }) => /^\s*type: custom:apexcharts?-card\s*$/m.test(yaml));

describe('README card examples', () => {
  it('finds the examples', () => {
    expect(examples.length).toBeGreaterThan(40);
  });

  it.each(examples)('example at README.md line $line is valid', async ({ yaml }) => {
    await customElements.whenDefined('apexcharts-card');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = load(yaml) as any;
    // A nested card (e.g. inside auto-entities) is checked as written there
    if (config.type !== 'custom:apexcharts-card') {
      expect(config.type).not.toMatch(/apexchart-card/);
      return;
    }
    const card = document.createElement('apexcharts-card') as unknown as { setConfig(c: unknown): void };
    // Templates live in the dashboard config, which a test has none of
    if (config.config_templates) {
      expect(() => card.setConfig(config)).toThrow(/is missing from your config/);
      return;
    }
    expect(() => card.setConfig(config)).not.toThrow();
  });
});
