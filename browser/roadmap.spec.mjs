import { expect, test } from '@playwright/test';

const mount = async (page, extra) => {
  await page.goto('/');
  await page.waitForFunction(() => window.ready);
  await page.evaluate((config) => {
    window.previewConfig = config;
    window.card = window.makeCard(config);
    document.querySelector('#dashboard').appendChild(window.card);
  }, extra);
  await page.waitForFunction(() => window.card._dataLoaded && !window.card._updating);
};

const capture = async (page, name) => {
  if (!process.env.UPDATE_DOC_IMAGES) return;
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    const dashboard = document.querySelector('#dashboard');
    window.originalDashboardStyle = dashboard.getAttribute('style');
    window.originalCardStyle = window.card.getAttribute('style');
    dashboard.style.cssText =
      'width:1400px;display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px;background:#edf2f7;box-sizing:border-box;';
    window.card.style.cssText += 'background:#fff;border-radius:12px;box-shadow:0 2px 8px #18315318;';
    const config = structuredClone(window.previewConfig);
    if (config.navigation?.show) config.navigation.initial = window.card._navigationPeriod;
    window.darkPreview = window.makeCard(config);
    window.darkPreview.style.cssText =
      '--primary-text-color:#edf3ff;--secondary-text-color:#b9c9de;--primary-color:#64b5f6;--card-background-color:#1d2636;--divider-color:#3a4659;color:#edf3ff;background:#1d2636;border-radius:12px;box-shadow:0 2px 8px #18315318;';
    dashboard.appendChild(window.darkPreview);
  });
  await page.waitForFunction(
    () => window.darkPreview._dataLoaded && !window.darkPreview._updating && !window.card._updating,
  );
  await page.evaluate(async () => {
    await Promise.all(
      [window.card, window.darkPreview].map((card) =>
        card._apexChart.updateOptions(
          { chart: { animations: { enabled: false, dynamicAnimation: { enabled: false } } } },
          false,
          false,
          false,
        ),
      ),
    );
  });
  await page.locator('#dashboard').screenshot({ path: `docs/${name}.png` });
  await page.evaluate(() => {
    window.darkPreview.remove();
    const dashboard = document.querySelector('#dashboard');
    if (window.originalDashboardStyle === null) dashboard.removeAttribute('style');
    else dashboard.setAttribute('style', window.originalDashboardStyle);
    if (window.originalCardStyle === null) window.card.removeAttribute('style');
    else window.card.setAttribute('style', window.originalCardStyle);
  });
  await page.setViewportSize(viewport);
};

test('calendar controls browse periods, reset current, resize and reconnect', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page, {
    navigation: { show: true },
    header: { show: true, title: 'Room temperatures · calendar navigation', show_states: true, colorize_states: true },
    series: [
      {
        entity: 'sensor.temp',
        name: 'Living room',
        type: 'area',
        color: '#3498db',
        opacity: 0.22,
        stroke_width: 3,
        data_generator:
          'return Array.from({length: 100}, (_, i) => [start.getTime() + i * (end.getTime() - start.getTime()) / 99, 21 + 2 * Math.sin(i / 7) + Math.cos(i / 3)]);',
      },
      {
        entity: 'sensor.temp',
        name: 'Bedroom',
        type: 'area',
        color: '#ff9800',
        opacity: 0.24,
        stroke_width: 3,
        data_generator:
          'return Array.from({length: 100}, (_, i) => [start.getTime() + i * (end.getTime() - start.getTime()) / 99, 18 + 1.5 * Math.sin(i / 7 + 1)]);',
      },
    ],
  });
  const initial = await page.evaluate(() => window.card._getSpanDates().start.getTime());
  await page.getByRole('button', { name: 'Previous period' }).click();
  await page.waitForFunction(() => !window.card._updating);
  expect(await page.evaluate(() => window.card._getSpanDates().start.getTime())).toBeLessThan(initial);
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.waitForFunction(() => !window.card._updating);
  expect(await page.evaluate(() => window.card._navigationPeriod)).toBe('month');
  await page.getByRole('button', { name: 'Next period' }).click();
  await page.waitForFunction(() => !window.card._updating);
  await page.getByRole('button', { name: 'Current', exact: true }).click();
  await page.waitForFunction(() => !window.card._updating);
  expect(await page.evaluate(() => window.card._navigationAnchor)).toBeUndefined();
  await capture(page, 'calendar-navigation');
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(page.getByRole('navigation')).toBeVisible();
  const width = await page.locator('.time-navigation').evaluate((nav) => nav.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(360);
  await page.evaluate(() => {
    window.card.remove();
    document.querySelector('#dashboard').appendChild(window.card);
  });
  await page.waitForFunction(() => window.card._dataLoaded && !window.card._updating);
  expect(errors).toEqual([]);
});

test('renders integration-supplied range bounds with both headers and missing intervals', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page, {
    chart_type: 'rangeArea',
    color_list: ['#9c5cff', '#ff9800'],
    apex_config: { chart: { animations: { enabled: false } }, fill: { opacity: 0.42 }, stroke: { width: 2 } },
    header: { show: true, title: 'Temperature · lower / upper envelope', show_states: true, colorize_states: true },
    series: [
      {
        entity: 'sensor.temp',
        name: 'Lower',
        data_generator:
          'return Array.from({length: 24}, (_, i) => [start.getTime() + i * 3600000, i === 8 ? null : 17 + Math.sin(i / 4)]);',
      },
      {
        entity: 'sensor.temp',
        name: 'Upper',
        data_generator:
          'return Array.from({length: 24}, (_, i) => [start.getTime() + i * 3600000, i === 8 ? null : 23 + Math.sin(i / 4)]);',
      },
    ],
  });
  await expect(page.locator('.apexcharts-rangeArea-series')).toBeVisible();
  const data = await page.evaluate(() => ({
    series: window.card._apexChart.w.config.series,
    headers: window.card._headerState,
    error: window.card._loadError,
  }));
  expect(data.error).toBeUndefined();
  expect(data.series).toHaveLength(1);
  expect(data.series[0].data[8].y).toEqual([null, null]);
  expect(data.series[0].data[0].y).toEqual([17, 23]);
  expect(data.headers).toHaveLength(2);
  await capture(page, 'range-band');
  expect(errors).toEqual([]);
});

test('renders bounded aggregated heatmaps and reports over-budget data without truncation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page, {
    chart_type: 'heatmap',
    apex_config: {
      chart: { animations: { enabled: false } },
      plotOptions: {
        heatmap: {
          enableShades: false,
          colorScale: {
            ranges: [
              { from: -100, to: 14.999, color: '#3498db', name: 'Cool' },
              { from: 15, to: 17.999, color: '#00bfa5', name: 'Mild' },
              { from: 18, to: 20.999, color: '#ffca28', name: 'Comfort' },
              { from: 21, to: 100, color: '#ff7043', name: 'Warm' },
            ],
          },
        },
      },
    },
    header: { show: true, title: 'Hourly room temperatures', show_states: false },
    heatmap: { max_cells: 100 },
    series: [
      {
        entity: 'sensor.temp',
        name: 'Living room',
        group_by: { func: 'avg', duration: '1h', fill: 'null' },
        data_generator:
          'return Array.from({length: 24}, (_, i) => [start.getTime() + i * 3600000, i === 3 ? null : i === 1 ? 0 : 18 + Math.sin(i / 3) * 5]);',
      },
      {
        entity: 'sensor.temp',
        name: 'Bedroom',
        group_by: { func: 'avg', duration: '1h', fill: 'null' },
        data_generator:
          'return Array.from({length: 24}, (_, i) => [start.getTime() + i * 3600000, 16 + Math.sin(i / 3) * 4]);',
      },
    ],
  });
  await expect(page.locator('.apexcharts-heatmap-series').first()).toBeVisible();
  const data = await page.evaluate(() => ({
    series: window.card._apexChart.w.config.series,
    error: window.card._loadError,
  }));
  expect(data.error).toBeUndefined();
  expect(data.series).toHaveLength(2);
  expect(data.series.flatMap((row) => row.data).length).toBeLessThanOrEqual(100);
  expect(data.series[0].data.some((point) => point.y === 0)).toBe(true);
  expect(data.series[0].data.every((point) => point.y !== null)).toBe(true);
  const missing = await page.evaluate(() => {
    const time = window.card._graphs[0].history.find(([, value]) => value === null)?.[0];
    return { time, painted: window.card._apexChart.w.config.series[0].data.some((point) => point.x === time) };
  });
  expect(missing.time).toBeDefined();
  expect(missing.painted).toBe(false);
  await capture(page, 'heatmap');
  await page.evaluate(async () => {
    window.card._config.heatmap.max_cells = 2;
    await window.card._updateData();
  });
  await expect(page.locator('.data-status')).toContainText('Heatmap exceeds 2 cells');
  expect(errors).toEqual([]);
});

test('editor presets require a click and preserve entity identity through the real editor', async ({ page }) => {
  await mount(page, {});
  await page.evaluate(async () => {
    window.editor = await window.card.constructor.getConfigElement();
    window.editor.hass = window.card._hass;
    window.editor.setConfig({
      type: 'custom:apexcharts-card',
      series: [{ entity: 'sensor.temp', name: 'My sensor' }],
    });
    window.editorEvents = [];
    window.editor.addEventListener('config-changed', (event) => window.editorEvents.push(event.detail.config));
    window.card.remove();
    document.querySelector('#dashboard').appendChild(window.editor);
  });
  await expect(page.getByRole('button', { name: 'Apply temperature' })).toBeVisible();
  expect(await page.evaluate(() => window.editorEvents.length)).toBe(0);
  await page.getByRole('button', { name: 'Apply power', exact: true }).click();
  expect(await page.evaluate(() => window.editorEvents.at(-1).series[0])).toMatchObject({
    entity: 'sensor.temp',
    name: 'My sensor',
    type: 'line',
    group_by: { func: 'avg' },
  });
  await page.getByRole('button', { name: 'Apply consumption', exact: true }).click();
  expect(await page.evaluate(() => window.editorEvents.at(-1).series[0])).toMatchObject({
    entity: 'sensor.temp',
    statistics: { type: 'change', period: 'day' },
    type: 'column',
  });
  if (process.env.UPDATE_DOC_IMAGES) {
    await page.locator('.preset-actions').screenshot({ path: 'docs/editor-presets.png' });
  }
});

test('calendar buttons work with touch and long-term statistics without extra polling', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => {
      window.requests = [];
      window.card = window.makeCard({
        navigation: { show: true, initial: 'week' },
        series: [
          { entity: 'sensor.temp', type: 'column', statistics: { type: 'mean', period: 'day', align: 'start' } },
        ],
      });
      window.card._hass.callWS = async (message) => {
        window.requests.push(message);
        const start = Date.parse(message.start_time);
        return { 'sensor.temp': [{ start, end: start + 86400000, mean: 12 }] };
      };
      document.querySelector('#dashboard').appendChild(window.card);
    });
    await page.waitForFunction(() => window.card._dataLoaded && !window.card._updating);
    const calls = await page.evaluate(() => window.requests.length);
    await page.getByRole('button', { name: 'Previous period' }).tap();
    await page.waitForFunction(() => !window.card._updating);
    expect(await page.evaluate(() => window.requests.length)).toBe(calls + 1);
    expect(
      await page.evaluate(() =>
        window.requests.every((message) => message.type === 'recorder/statistics_during_period'),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.card._loadError)).toBeUndefined();
  } finally {
    await context.close();
  }
});

test('range bands recover from crossed bounds and explain unpaired or empty data', async ({ page }) => {
  await mount(page, {
    chart_type: 'rangeArea',
    series: [
      {
        entity: 'sensor.temp',
        data_generator:
          'return window.fixture.empty ? [] : [[start.getTime(), window.fixture.fail ? 30 : 10], [end.getTime(), 12]];',
      },
      {
        entity: 'sensor.temp',
        data_generator:
          'return window.fixture.empty ? [] : [[start.getTime() + (window.fixture.unpaired ? 1 : 0), 20], [end.getTime() + (window.fixture.unpaired ? 1 : 0), 22]];',
      },
    ],
  });
  await page.evaluate(async () => {
    window.fixture.fail = true;
    await window.card._updateData();
  });
  await expect(page.locator('.data-status')).toContainText('lower bound exceeds');
  await page.evaluate(async () => {
    window.fixture.fail = false;
    await window.card._updateData();
  });
  await expect(page.locator('.data-status')).toHaveCount(0);
  await page.evaluate(async () => {
    window.fixture.unpaired = true;
    await window.card._updateData();
  });
  await expect(page.locator('.data-status')).toContainText('No numeric data');
  await page.evaluate(async () => {
    window.fixture.empty = true;
    await window.card._updateData();
  });
  await expect(page.locator('.data-status')).toContainText('No numeric data');
});
