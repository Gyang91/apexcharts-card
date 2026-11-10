import { stylesApex } from '../src/styles';

describe('stylesApex tooltip marker', () => {
  const cssText = String(stylesApex);

  it('does not draw a glyph on top of the SVG marker rendered by apexcharts (#131)', () => {
    expect(cssText).not.toMatch(/\.apexcharts-tooltip-marker(\[[^\]]*\])?::before/);
  });
});

describe('stylesApex tooltip theme', () => {
  const cssText = String(stylesApex);

  it('maps the ApexCharts tooltip colour variables to the HA theme', () => {
    expect(cssText).toMatch(/--apx-tt-color-muted:\s*var\(--secondary-text-color\)/);
    expect(cssText).toMatch(/--apx-tt-color:\s*var\(--primary-text-color\)/);
    expect(cssText).toMatch(/--apx-tt-bg:\s*var\(--card-background-color\)/);
  });
});
