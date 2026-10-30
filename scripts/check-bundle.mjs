import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const bundle = readFileSync(new URL('../dist/apexcharts-card.js', import.meta.url));
const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;
// Deliberate ceilings, not performance claims: review increases alongside feature changes.
const limits = { raw: 1_550_000, gzip: 450_000 };
console.log(`Bundle: ${bundle.byteLength} bytes raw, ${gzipBytes} bytes gzip`);
console.log(`Budgets: ${limits.raw} bytes raw, ${limits.gzip} bytes gzip`);
if (bundle.byteLength > limits.raw || gzipBytes > limits.gzip) {
  console.error('Bundle size budget exceeded. Investigate before changing the budgets.');
  process.exitCode = 1;
}
