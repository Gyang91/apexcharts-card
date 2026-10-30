import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.ready);
});

const mount = async (page, extra = {}) => {
  await page.evaluate((config) => {
    window.card = window.makeCard(config);
    document.querySelector('#dashboard').appendChild(window.card);
  }, extra);
  await expect(page.locator('apexcharts-card #graph .apexcharts-line').first()).toBeVisible();
  await page.waitForFunction(() => window.card._dataLoaded && !window.card._updating);
};

test('renders, resizes to a phone, changes theme and reconnects cleanly', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expect
    .poll(() => page.locator('apexcharts-card .apexcharts-svg').evaluate((svg) => svg.getBoundingClientRect().width))
    .toBeLessThanOrEqual(360);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--primary-text-color', '#eee');
    window.card.remove();
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.card._apexChart === undefined)).toBe(true);
  await page.evaluate(() => document.querySelector('#dashboard').appendChild(window.card));
  await expect(page.locator('apexcharts-card .apexcharts-line')).toBeVisible();
  await page.waitForFunction(() => window.card._dataLoaded && !window.card._updating);
  await expect(page.locator('apexcharts-card .apexcharts-canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('keeps a Sections-style card within a fixed-height cell', async ({ page }) => {
  await page.evaluate(() => {
    window.card = window.makeCard({ grid_options: { rows: 4 } });
    window.card.layout = 'grid';
    const dashboard = document.querySelector('#dashboard');
    dashboard.style.height = '350px';
    dashboard.appendChild(window.card);
  });
  await expect(page.locator('apexcharts-card .apexcharts-line')).toBeVisible();
  await expect(page.locator('apexcharts-card')).toHaveAttribute('data-fill-height', '');
  await expect
    .poll(() => page.locator('apexcharts-card').evaluate((card) => card.getBoundingClientRect().height))
    .toBe(350);
});

test('shows a load failure, preserves the chart and recovers on the next refresh', async ({ page }) => {
  await mount(page);
  const lastUpdated = await page.evaluate(() => window.card._lastUpdated.getTime());
  await page.evaluate(async () => {
    window.fixture.fail = true;
    await window.card._updateData();
  });
  await expect(page.locator('.data-status')).toContainText('Could not load data for sensor.temp');
  expect(await page.evaluate(() => window.card._lastUpdated.getTime())).toBe(lastUpdated);
  await expect(page.locator('apexcharts-card .apexcharts-line')).toBeVisible();
  await page.evaluate(async () => {
    window.fixture.fail = false;
    await window.card._updateData();
  });
  await expect(page.locator('.data-status')).toHaveCount(0);
});

test('explains empty data without treating zero as missing', async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    window.fixture.empty = true;
    await window.card._updateData();
  });
  await expect(page.locator('.data-status')).toContainText('No numeric data in this time range');
  await page.evaluate(async () => {
    window.fixture.empty = false;
    window.fixture.zero = true;
    await window.card._updateData();
  });
  await expect(page.locator('.data-status')).toHaveCount(0);
});

test('does not create charts after detaching during asynchronous initialization', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => {
    window.card = window.makeCard();
    window.metadataStarted = false;
    window.card._applyExternalStatisticsMetadata = () =>
      new Promise((resolve) => {
        window.metadataStarted = true;
        window.releaseMetadata = resolve;
      });
    document.querySelector('#dashboard').appendChild(window.card);
  });
  await page.waitForFunction(() => window.metadataStarted);
  await page.evaluate(() => {
    window.card.remove();
    window.releaseMetadata();
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.card._apexChart === undefined)).toBe(true);
  expect(errors).toEqual([]);
});

test('reports chart initialization failures without retry loops', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => {
    window.card = window.makeCard();
    window.initializationAttempts = 0;
    window.card._applyExternalStatisticsMetadata = async () => {
      window.initializationAttempts++;
      throw new Error('test metadata failure');
    };
    document.querySelector('#dashboard').appendChild(window.card);
  });
  await expect(page.locator('.data-status')).toContainText('Chart could not start');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.initializationAttempts)).toBe(1);
  expect(errors).toEqual([]);
});

test('preserves legend visibility and brush charts across refreshes', async ({ page }) => {
  await mount(page, {
    experimental: { brush: true, hidden_by_default: true },
    series: [
      {
        entity: 'sensor.temp',
        name: 'Visible',
        data_generator: 'return [[start.getTime(), 12], [end.getTime(), 13]];',
        show: { in_brush: true },
      },
      {
        entity: 'sensor.temp',
        name: 'Initially hidden',
        data_generator: 'return [[start.getTime(), 15], [end.getTime(), 16]];',
        show: { hidden_by_default: true, in_brush: true },
      },
    ],
  });
  await expect(page.locator('.apexcharts-canvas')).toHaveCount(2);
  await expect(page.locator('#graph .apexcharts-legend-series').nth(1)).toHaveClass(/apexcharts-inactive-legend/);
  await expect(page.locator('#brush .apexcharts-line').nth(1)).toHaveAttribute('d', /^M/);
  await page.locator('#graph .apexcharts-legend-series').nth(1).click();
  await expect(page.locator('#graph .apexcharts-legend-series').nth(1)).not.toHaveClass(/apexcharts-inactive-legend/);
  await page.evaluate(() => window.card._updateData());
  await expect(page.locator('#graph .apexcharts-legend-series').nth(1)).not.toHaveClass(/apexcharts-inactive-legend/);
});

test('ignores an old initialization after a replacement chart has loaded', async ({ page }) => {
  await page.evaluate(() => {
    window.card = window.makeCard();
    window.metadataStarted = false;
    window.card._applyExternalStatisticsMetadata = () =>
      new Promise((resolve) => {
        window.metadataStarted = true;
        window.releaseMetadata = resolve;
      });
    document.querySelector('#dashboard').appendChild(window.card);
  });
  await page.waitForFunction(() => window.metadataStarted);
  await page.evaluate(() => {
    window.card.remove();
    window.card._applyExternalStatisticsMetadata = async () => {};
    document.querySelector('#dashboard').appendChild(window.card);
  });
  await page.waitForFunction(() => window.card._dataLoaded && !window.card._updating);
  await page.evaluate(() => {
    window.replacement = window.card._apexChart;
    window.releaseMetadata();
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.card._apexChart === window.replacement)).toBe(true);
  await expect(page.locator('.apexcharts-canvas')).toHaveCount(1);
});

test('@performance records generated-data render baseline without dropping samples', async ({ page }, testInfo) => {
  const result = await page.evaluate(async () => {
    const start = performance.now();
    const cards = Array.from({ length: 3 }, () => {
      const card = window.makeCard({
        series: [
          {
            entity: 'sensor.temp',
            data_generator: `
              return Array.from({length: 10000}, (_, i) =>
                [start.getTime() + i * (end.getTime() - start.getTime()) / 9999, Math.sin(i / 100)]);
            `,
          },
        ],
      });
      document.querySelector('#dashboard').appendChild(card);
      return card;
    });
    await Promise.all(cards.map((card) => card.updateComplete));
    return { start };
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('apexcharts-card')].every((card) => card._dataLoaded && !card._updating),
  );
  const measurement = await page.evaluate(({ start }) => {
    const cards = [...document.querySelectorAll('apexcharts-card')];
    return {
      scenario: 'Three generated-data cards, 10000 points each; no HA network',
      elapsedMs: Math.round(performance.now() - start),
      retainedPoints: cards.map((card) => card._graphs[0].history.length),
      renderedPoints: cards.map((card) => card._apexChart.w.config.series[0].data.length),
      errors: cards.map((card) => card._loadError ?? null),
    };
  }, result);
  expect(measurement.retainedPoints).toEqual([10000, 10000, 10000]);
  expect(measurement.renderedPoints).toEqual([10000, 10000, 10000]);
  expect(measurement.errors).toEqual([null, null, null]);
  console.log(JSON.stringify(measurement));
  await testInfo.attach('performance-baseline', {
    body: JSON.stringify(measurement, null, 2),
    contentType: 'application/json',
  });
});
