import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const bundle = readFileSync(new URL('../dist/apexcharts-card.js', import.meta.url));
const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;
// Deliberate ceilings, not performance claims: review increases alongside feature changes.
// History (raw bytes):
// - 1_550_000 -> 1_575_000: apexcharts 8.7.0 -> 8.8.2 and @ctrl/tinycolor 4.2.2 -> 4.3.0 (#51)
//   grew the bundle from 1_527_614 to 1_550_541 (+22.9 KB raw, +7.7 KB gzip). All of it is
//   upstream library code (apexcharts core +43 KB, tinycolor OKLCH support +12 KB, unminified);
//   no card code changed.
const limits = { raw: 1_575_000, gzip: 450_000 };
console.log(`Bundle: ${bundle.byteLength} bytes raw, ${gzipBytes} bytes gzip`);
console.log(`Budgets: ${limits.raw} bytes raw, ${limits.gzip} bytes gzip`);
if (bundle.byteLength > limits.raw || gzipBytes > limits.gzip) {
  console.error('Bundle size budget exceeded. Investigate before changing the budgets.');
  process.exitCode = 1;
}
