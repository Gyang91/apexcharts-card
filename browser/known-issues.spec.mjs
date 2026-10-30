import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.ready);
});

const settle = async (page) => {
  await page.waitForFunction(() => window.card._dataLoaded && !window.card._updating);
  await page.evaluate(() =>
    window.card._apexChart.updateOptions(
      { chart: { animations: { enabled: false, dynamicAnimation: { enabled: false } } } },
      false,
      false,
      false,
    ),
  );
};

test('smooth area fills stay inside each numeric run across missing data and refreshes', async ({ page }) => {
  await page.evaluate(() => {
    window.areaValues = [null, 8, 7, 9, null, null, 8, 7, 9, null];
    window.card = window.makeCard({
      graph_span: '9h',
      apex_config: { yaxis: { min: 0, max: 10 } },
      series: [
        {
          entity: 'sensor.temp',
          type: 'area',
          curve: 'smooth',
          extend_to: false,
          data_generator: `
            return window.areaValues.map((value, i) => [start.getTime() + i * 3600000, value]);
          `,
        },
      ],
    });
    document.querySelector('#dashboard').appendChild(window.card);
  });
  const checkFill = async () => {
    const fill = await page.evaluate(() => {
      const chart = window.card._apexChart;
      const { minX, maxX, gridWidth, gridHeight } = chart.w.globals;
      const points = chart.w.config.series[0].data;
      const paths = [...window.card.shadowRoot.querySelectorAll('path.apexcharts-area')];
      return {
        paths: paths.length,
        invalid: paths.some((path) => /NaN|Infinity/.test(path.getAttribute('d'))),
        filled: points.map(([timestamp]) => {
          const x = ((timestamp - minX) / (maxX - minX)) * gridWidth;
          return paths.some((path) => path.isPointInFill(new DOMPoint(x, gridHeight * 0.75)));
        }),
      };
    });
    expect(fill.paths).toBeGreaterThan(0);
    expect(fill.invalid).toBe(false);
    expect(fill.filled).toEqual([false, true, true, true, false, false, true, true, true, false]);
  };
  await settle(page);
  await checkFill();
  await page.setViewportSize({ width: 360, height: 740 });
  await page.evaluate(async () => window.card._updateData());
  await settle(page);
  await checkFill();
});

for (const sparse of [false, true]) {
  test(`grouped column geometry stays within the aggregation interval (sparse: ${sparse})`, async ({ page }) => {
    await page.evaluate((sparse) => {
      window.sparseColumns = sparse;
      window.card = window.makeCard({
        graph_span: '6h',
        series: [
          {
            entity: 'sensor.temp',
            type: 'column',
            extend_to: false,
            stroke_width: 0,
            group_by: { duration: '1h', func: 'sum', fill: 'null' },
            data_generator: `
            window.groupingEnd = end.getTime();
            return Array.from({length: 6}, (_, i) =>
              [end.getTime() - (5.5 - i) * 3600000, i + 1])
              .filter((_, i) => !window.sparseColumns || i === 1);
          `,
          },
        ],
      });
      document.querySelector('#dashboard').appendChild(window.card);
    }, sparse);
    await settle(page);
    const result = await page.evaluate(() => {
      const chart = window.card._apexChart;
      const { minX, maxX, gridWidth } = chart.w.globals;
      const data = chart.w.config.series[0].data;
      const bars = [...window.card.shadowRoot.querySelectorAll('.apexcharts-bar-area')];
      const pixel = (timestamp) => ((timestamp - minX) / (maxX - minX)) * gridWidth;
      return bars
        .filter((bar) => bar.getBBox().height > 0)
        .map((bar, i) => {
          const box = bar.getBBox();
          const [timestamp, value] = data[i];
          const bucketStart = window.groupingEnd - (5 - i) * 3600000;
          return {
            value,
            widthFraction: box.width / (pixel(bucketStart + 3600000) - pixel(bucketStart)),
            midpointError: Math.abs(timestamp - bucketStart - 1800000),
            centerError: Math.abs(box.x + box.width / 2 - pixel(timestamp)),
            leftInside: box.x >= pixel(bucketStart) - 1,
            rightInside: box.x + box.width <= pixel(bucketStart + 3600000) + 1,
          };
        });
    });
    expect(result).toHaveLength(sparse ? 1 : 5);
    expect(result.map((bar) => bar.value)).toEqual(sparse ? [2] : [2, 3, 4, 5, 6]);
    for (const bar of result) {
      expect(bar.midpointError).toBeLessThan(1);
      expect(bar.centerError).toBeLessThan(1);
      expect(bar.widthFraction).toBeGreaterThan(0.3);
      expect(bar.leftInside).toBe(true);
      expect(bar.rightInside).toBe(true);
    }
  });
}

test('binary history, gaps, computed and raw headers render without a transform', async ({ page }) => {
  await page.evaluate(() => {
    const binary = 'binary_sensor.heating';
    const series = { entity: binary, curve: 'stepline', extend_to: false };
    window.card = window.makeCard({
      cache: false,
      graph_span: '4h',
      series: [series, { ...series, show: { in_header: 'raw', in_chart: false } }],
    });
    const state = {
      ...window.card._hass.states['sensor.temp'],
      entity_id: binary,
      state: 'on',
      attributes: { friendly_name: 'Heating' },
    };
    window.card.hass = {
      ...window.card._hass,
      states: { [binary]: state },
      callWS: async (message) => {
        if (message.type !== 'history/history_during_period') throw new Error('Unexpected request');
        const start = Date.parse(message.start_time) / 1000;
        return {
          [binary]: ['off', 'on', 'unknown', 'unavailable', 'on'].map((s, i) => ({
            s,
            lu: start + i * 3600,
          })),
        };
      },
    };
    document.querySelector('#dashboard').appendChild(window.card);
  });
  await settle(page);
  expect(
    await page.evaluate(() => ({
      values: window.card._apexChart.w.config.series[0].data.map(([, value]) => value),
      header: window.card._headerState,
    })),
  ).toEqual({ values: [0, 1, null, null, 1], header: [1, 1] });
  await expect(page.locator('.data-status')).toHaveCount(0);
  await page.evaluate(() => {
    const binary = 'binary_sensor.heating';
    window.card.hass = {
      ...window.card._hass,
      states: {
        [binary]: { ...window.card._hass.states[binary], state: 'unavailable' },
      },
    };
  });
  expect(await page.evaluate(() => window.card._headerState[1])).toBeNull();
});
