// Checks that the Home Assistant frontend still provides what the card and its editor use:
// every ha-/hui- element they render, every ha-form selector type, and the select
// selector's typed values. HA removed ha-textfield once and its fields went blank, with
// nothing in our tests noticing.
//
//   node scripts/check-ha-frontend.ts <path to a home-assistant/frontend checkout>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string, ext = /\.ts$/): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, ext) : ext.test(name) ? [path] : [];
  });

// What our source uses
const ours = files(new URL('../src', import.meta.url).pathname).map((file) => readFileSync(file, 'utf8'));
const elements = [...new Set(ours.flatMap((text) => [...text.matchAll(/<((?:ha|hui)-[a-z-]+)/g)].map((m) => m[1])))];
// Selector types on lines that build a selector, including ternaries such as
// `selector: mode ? { statistic: {} } : { entity: {} }`; the switch grid and duration fields
// build theirs in code, hence boolean and select
const selectorTypes = [
  ...new Set([
    ...ours.flatMap((text) =>
      text
        .split('\n')
        .filter((line) => line.includes('selector'))
        .flatMap((line) => [...line.matchAll(/\{ ([a-z_]+): \{/g)].map((m) => m[1])),
    ),
    'boolean',
    'select',
  ]),
];

// What the frontend defines
const root = process.argv[2];
if (!root) {
  console.error('Usage: node scripts/check-ha-frontend.ts <frontend checkout>');
  process.exit(2);
}
const theirs = files(join(root, 'src')).map((file) => readFileSync(file, 'utf8'));
const defined = new Set(
  theirs.flatMap((text) =>
    [...text.matchAll(/(?:@customElement|customElements\.define)\(\s*["'`]([a-z-]+)["'`]/g)].map((m) => m[1]),
  ),
);
const selectorFile = (type: string) =>
  join(root, 'src/components/ha-selector', `ha-selector-${type.replace(/_/g, '-')}.ts`);
const exists = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const missing = [
  ...elements.filter((element) => !defined.has(element)).map((element) => `element <${element}>`),
  ...selectorTypes.filter((type) => !exists(selectorFile(type))).map((type) => `ha-form selector "${type}"`),
  ...(exists(selectorFile('select')) && !readFileSync(selectorFile('select'), 'utf8').includes('custom_value')
    ? ['select selector option "custom_value" (typed durations)']
    : []),
];

console.log(
  `Checked ${elements.length} elements (${elements.join(', ')}) and ${selectorTypes.length} selectors (${selectorTypes.join(', ')}).`,
);
if (missing.length) {
  console.log(`Missing in the Home Assistant frontend:\n${missing.map((item) => `- ${item}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('All present.');
}
