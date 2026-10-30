import { expect, test } from '@playwright/test';

const generatedSeries = {
  entity: 'sensor.temp',
  extend_to: false,
  curve: 'straight',
  data_generator: `
    const data = Array.from({length: 100000}, (_, i) =>
      [start.getTime() + i * (end.getTime() - start.getTime()) / 99999, Math.sin(i / 100)]);
    data[501][1] = 1000;
    data[502][1] = -1000;
    data[2000][1] = null;
    data[2001][1] = null;
    return data;
  `,
};

const mount = async (page, extra = {}) => {
  await page.goto('/');
  await page.waitForFunction(() => window.ready);
  await page.evaluate(
    (config) => {
      window.card = window.makeCard({
        downsample: true,
        yaxis: [{}],
        ...config,
      });
      document.querySelector('#dashboard').appendChild(window.card);
    },
    { series: [generatedSeries], ...extra },
  );
  await page.waitForFunction(() => window.card._dataLoaded && !window.card._updating && !window.card._samplingUpdate);
  await expect(page.locator('#graph .apexcharts-line').first()).toBeVisible();
};

test('samples 100000 points, preserving extrema, gaps, full history and header values', async ({ page }) => {
  await mount(page);
  await expect
    .poll(() => page.evaluate(() => window.card._apexChart.w.config.series[0].data.length))
    .toBeLessThan(3000);
  const result = await page.evaluate(() => {
    const full = window.card._graphs[0].history;
    const sampled = window.card._apexChart.w.config.series[0].data;
    return {
      fullCount: full.length,
      first: sampled[0],
      last: sampled.at(-1),
      fullFirst: full[0],
      fullLast: full.at(-1),
      spikes: sampled.filter(([, value]) => value === 1000 || value === -1000),
      gaps: sampled.filter(([, value]) => value === null).map(([time]) => time),
      expectedGaps: full.filter(([, value]) => value === null).map(([time]) => time),
      header: window.card._headerState[0],
      lastValue: full.at(-1)[1],
      axis: { min: window.card._apexChart.w.config.yaxis[0].min, max: window.card._apexChart.w.config.yaxis[0].max },
    };
  });
  expect(result.fullCount).toBe(100000);
  expect(result.first).toEqual(result.fullFirst);
  expect(result.last).toEqual(result.fullLast);
  expect(result.spikes).toHaveLength(2);
  expect(result.gaps).toEqual(result.expectedGaps);
  expect(result.header).toBe(result.lastValue);
  expect(result.axis).toEqual({ min: -1000, max: 1000 });
});

test('restores local zoom detail and adapts to phone width without fetching history', async ({ page }) => {
  await mount(page, {
    apex_config: { chart: { animations: { enabled: false }, zoom: { enabled: true }, toolbar: { show: true } } },
  });
  await page.evaluate(() => {
    window.historyCalls = 0;
    const graph = window.card._graphs[0];
    const update = graph._updateHistory.bind(graph);
    graph._updateHistory = (...args) => {
      window.historyCalls++;
      return update(...args);
    };
    const full = graph.history;
    window.zoomRange = { min: full[50000][0], max: full[50100][0] };
    window.card._apexChart.zoomX(window.zoomRange.min, window.zoomRange.max);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const range = window.zoomRange;
        return window.card._apexChart.w.config.series[0].data.filter(([time]) => time >= range.min && time <= range.max)
          .length;
      }),
    )
    .toBe(101);
  await page.setViewportSize({ width: 360, height: 740 });
  await expect.poll(() => page.evaluate(() => window.card._lastChartSize?.width)).toBeLessThanOrEqual(360);
  await page.evaluate(() => {
    const full = window.card._graphs[0].history;
    window.card._apexChart.zoomX(full[0][0], full.at(-1)[0]);
  });
  await expect
    .poll(() => page.evaluate(() => window.card._apexChart.w.config.series[0].data.length))
    .toBeLessThan(1500);
  expect(await page.evaluate(() => window.historyCalls)).toBe(0);
});

test('resamples a brush selection independently while retaining full overview extent', async ({ page }) => {
  await mount(page, {
    experimental: { brush: true },
    brush: { selection_span: '1h' },
    series: [{ ...generatedSeries, show: { in_brush: true } }],
  });
  await expect(page.locator('.apexcharts-canvas')).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const range = window.card._readChartRange(window.card._apexChart);
        if (!range) return 0;
        const visible = window.card._apexChart.w.config.series[0].data.filter(
          ([time]) => time >= range.min && time <= range.max,
        );
        return visible.length;
      }),
    )
    .toBeGreaterThan(300);
  const selection = page.locator('#brush .apexcharts-selection-rect');
  await expect(selection).toBeVisible();
  const before = await page.evaluate(() => window.card._readChartRange(window.card._apexChart));
  const box = await selection.boundingBox();
  expect(box.width).toBeGreaterThan(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.card._readChartRange(window.card._apexChart).min))
    .toBeLessThan(before.min);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const range = window.card._readChartRange(window.card._apexChart);
        const full = window.card._graphs[0].history.filter(([time]) => time >= range.min && time <= range.max);
        const sampled = window.card._apexChart.w.config.series[0].data.filter(
          ([time]) => time >= range.min && time <= range.max,
        );
        const overview = window.card._apexBrush.w.config.series[0].data.filter(
          ([time]) => time >= range.min && time <= range.max,
        );
        return sampled.length > overview.length * 2 && sampled.length <= full.length;
      }),
    )
    .toBe(true);
  const overview = await page.evaluate(() => ({
    first: window.card._apexBrush.w.config.series[0].data[0][0],
    last: window.card._apexBrush.w.config.series[0].data.at(-1)[0],
    fullFirst: window.card._graphs[0].history[0][0],
    fullLast: window.card._graphs[0].history.at(-1)[0],
    points: window.card._apexBrush.w.config.series[0].data.length,
  }));
  expect(overview.first).toBe(overview.fullFirst);
  expect(overview.last).toBe(overview.fullLast);
  expect(overview.points).toBeLessThan(3000);
});

for (const initiallyHidden of [false, true]) {
  test(`preserves legend choices through adaptive resizing and refresh; initially hidden: ${initiallyHidden}`, async ({
    page,
  }) => {
    await mount(page, {
      experimental: { brush: true, hidden_by_default: initiallyHidden },
      series: [
        { ...generatedSeries, name: 'Visible', show: { in_brush: true } },
        { ...generatedSeries, name: 'Hidden', show: { in_brush: true, hidden_by_default: initiallyHidden } },
      ],
    });
    const legends = page.locator('#graph .apexcharts-legend-series');
    if (!initiallyHidden) await legends.nth(1).click();
    await expect(legends.nth(1)).toHaveClass(/apexcharts-inactive-legend/);
    await legends.nth(1).click();
    await expect(legends.nth(1)).not.toHaveClass(/apexcharts-inactive-legend/);
    await legends.nth(0).click();
    await expect(legends.nth(0)).toHaveClass(/apexcharts-inactive-legend/);
    await page.setViewportSize({ width: 360, height: 740 });
    await expect.poll(() => page.evaluate(() => window.card._lastChartSize?.width)).toBeLessThanOrEqual(360);
    await page.evaluate(() => window.card._updateData());
    await expect(legends.nth(0)).toHaveClass(/apexcharts-inactive-legend/);
    await expect(legends.nth(1)).not.toHaveClass(/apexcharts-inactive-legend/);
    expect(
      await page.evaluate(() =>
        window.card._apexBrush.w.config.series.every((series) => !series.hidden && series.data.length > 0),
      ),
    ).toBe(true);
  });
}

test('@performance compares full detail with optional sampled rendering on the same browser', async ({
  page,
}, testInfo) => {
  const measurements = [];
  for (const enabled of [false, true, true, false]) {
    const started = Date.now();
    await mount(page, { downsample: enabled });
    const result = await page.evaluate(() => ({
      sourcePoints: window.card._graphs[0].history.length,
      renderedPoints: window.card._apexChart.w.config.series[0].data.length,
      error: window.card._loadError ?? null,
    }));
    measurements.push({ downsample: enabled, elapsedMs: Date.now() - started, ...result });
  }
  for (const result of measurements) {
    expect(result.sourcePoints).toBe(100000);
    expect(result.error).toBeNull();
    if (result.downsample) expect(result.renderedPoints).toBeLessThan(3000);
    else expect(result.renderedPoints).toBe(100000);
  }
  console.log(
    JSON.stringify({ scenario: '100000 points, full versus sampled; includes fixture navigation', measurements }),
  );
  await testInfo.attach('downsampling-comparison', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
});
