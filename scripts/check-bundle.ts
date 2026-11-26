import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const bundle = readFileSync(new URL('../dist/apexcharts-card.js', import.meta.url));
const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;
// Ceilings that catch unnoticed growth: raise them on purpose, with the reason in the commit
const limits = { raw: 1_600_000, gzip: 458_000 };
console.log(`Bundle: ${bundle.byteLength} bytes raw, ${gzipBytes} bytes gzip`);
console.log(`Budgets: ${limits.raw} bytes raw, ${limits.gzip} bytes gzip`);
if (bundle.byteLength > limits.raw || gzipBytes > limits.gzip) {
  console.error('Bundle size budget exceeded. Investigate before changing the budgets.');
  process.exitCode = 1;
}
