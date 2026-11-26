import { expect, test, type Page } from '@playwright/test';

const mount = async (page: Page, extra?: Record<string, unknown>) => {
  await page.goto('/');
  await page.waitForFunction(() => window.ready);
  await page.evaluate((config: Record<string, unknown>) => {
    window.previewConfig = config;
    window.card = window.makeCard(config);
    document.querySelector('#dashboard').appendChild(window.card);
  }, extra);
  await page.waitForFunction(() => window.card._dataLoaded && !window.card._updating);
};

const capture = async (page: Page, name: string) => {
  if (!process.env.UPDATE_DOC_IMAGES) return;
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    const dashboard = document.querySelector<HTMLElement>('#dashboard');
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
    const dashboard = document.querySelector<HTMLElement>('#dashboard');
    if (window.originalDashboardStyle === null) dashboard.removeAttribute('style');
    else dashboard.setAttribute('style', window.originalDashboardStyle);
    if (window.originalCardStyle === null) window.card.removeAttribute('style');
    else window.card.setAttribute('style', window.originalCardStyle);
  });
  await page.setViewportSize(viewport);
};

test('calendar controls browse periods, reset current, resize and reconnect', async ({ page }) => {
  const errors: string[] = [];
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
  // These series come from data_generator, which may hold forecasts: the next arrow stays on.
  await expect(page.getByRole('button', { name: 'Next period' })).toBeEnabled();
  await page.getByRole('button', { name: 'Previous period' }).click();
  await page.getByRole('button', { name: 'Previous period' }).click();
  await page.waitForFunction(() => !window.card._updating && !window.card._navigationPending);
  await page.getByRole('button', { name: 'Next period' }).click();
  await page.waitForFunction(() => !window.card._updating && !window.card._navigationPending);
  // The label takes you back to the current period.
  await page.locator('button.time-navigation-label').click();
  await page.waitForFunction(() => !window.card._updating && !window.card._navigationPending);
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

test('calendar controls sit above the chart, fit narrow cards and keep a sensible tab order', async ({ page }) => {
  await mount(page, {
    navigation: { show: true, initial: 'week' },
    series: [
      {
        entity: 'sensor.temp',
        data_generator: 'return [[start.getTime(), 18], [end.getTime(), 20]];',
      },
    ],
  });
  const geometry = () =>
    page.locator('.time-navigation').evaluate((nav) => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      const root = nav.getRootNode() as ShadowRoot;
      return {
        nav: box(nav),
        graph: box(root.querySelector('#graph-wrapper')),
        step: box(nav.querySelector('.time-navigation-step')),
        periods: box(nav.querySelector('.time-navigation-periods')),
        arrows: Array.from(nav.querySelectorAll('.time-navigation-arrow'), box),
        periodButtons: Array.from(nav.querySelectorAll('.time-navigation-periods button'), (b: Element) => ({
          ...box(b),
          overflow: b.scrollWidth > b.clientWidth + 1,
        })),
      };
    });
  const expectFits = (g: Awaited<ReturnType<typeof geometry>>) => {
    expect(g.nav.bottom).toBeLessThanOrEqual(g.graph.top + 1);
    for (const arrow of g.arrows) {
      expect(arrow.width).toBeGreaterThanOrEqual(40);
      expect(arrow.height).toBeGreaterThanOrEqual(40);
    }
    for (const button of g.periodButtons) {
      expect(button.height).toBeGreaterThanOrEqual(32);
      expect(button.overflow).toBe(false);
      expect(button.left).toBeGreaterThanOrEqual(g.nav.left - 1);
      expect(button.right).toBeLessThanOrEqual(g.nav.right + 1);
    }
  };

  for (const width of [200, 260, 320, 440, 520, 700]) {
    await page.evaluate((cardWidth) => {
      document.querySelector<HTMLElement>('#dashboard').style.width = `${cardWidth}px`;
    }, width);
    const g = await geometry();
    expectFits(g);
    // Wide cards: stepper and period switch on one row. Phone-sized: switch on top, full width.
    if (width <= 420) {
      expect(g.periods.bottom).toBeLessThanOrEqual(g.step.top + 1);
      expect(g.periods.width).toBeGreaterThan(g.nav.width - 40);
    } else expect(Math.abs(g.step.top + g.step.height / 2 - (g.periods.top + g.periods.height / 2))).toBeLessThan(4);
  }

  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#dashboard').style.width = '320px';
    window.card.style.fontSize = '18px';
    window.card.hass = {
      ...window.card._hass,
      language: 'fr',
      locale: { ...window.card._hass.locale, language: 'fr' },
    };
    window.card.requestUpdate();
  });
  await expect(page.getByRole('button', { name: 'Semaine', exact: true })).toBeVisible();
  expectFits(await geometry());

  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#dashboard').style.width = '700px';
    window.card.style.fontSize = '';
    window.card.hass = {
      ...window.card._hass,
      language: 'en',
      locale: { ...window.card._hass.locale, language: 'en' },
    };
    window.card.requestUpdate();
  });
  await expect(page.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Tab order: previous, next (the label is plain text at the current period), then the periods.
  await page.getByRole('button', { name: 'Previous period' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Next period' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Week', exact: true })).toBeFocused();
});

test('navigation.position bottom puts the controls under the chart', async ({ page }) => {
  await mount(page, {
    navigation: { show: true, position: 'bottom' },
    series: [{ entity: 'sensor.temp', data_generator: 'return [[start.getTime(), 18], [end.getTime(), 20]];' }],
  });
  const [nav, graph] = await page
    .locator('.time-navigation')
    .evaluate((el) => [
      el.getBoundingClientRect().top,
      (el.getRootNode() as ShadowRoot).querySelector('#graph-wrapper').getBoundingClientRect().bottom,
    ]);
  expect(nav).toBeGreaterThanOrEqual(graph - 1);
});

test('renders integration-supplied range bounds with both headers and missing intervals', async ({ page }) => {
  const errors: string[] = [];
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
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page, {
    chart_type: 'heatmap',
    apex_config: { chart: { animations: { enabled: false } } },
    hours_12: false,
    header: { show: true, title: 'Hourly room temperatures', show_states: false },
    heatmap: {
      max_cells: 100,
      color_ranges: [
        { value: 0, color: '#3498db', name: 'Cool' },
        { value: 15, color: '#00bfa5', name: 'Mild' },
        { value: 18, color: '#ffca28', name: 'Comfort' },
        { value: 21, color: '#ff7043', name: 'Warm' },
      ],
    },
    series: [
      {
        entity: 'sensor.temp',
        name: 'Living room',
        group_by: { func: 'avg', period: 'hour', fill: 'null' },
        data_generator:
          'return Array.from({length: 24}, (_, i) => [start.getTime() + i * 3600000, i === 3 ? null : i === 1 ? 0 : 18 + Math.sin(i / 3) * 5]);',
      },
      {
        entity: 'sensor.temp',
        name: 'Bedroom',
        group_by: { func: 'avg', period: 'hour', fill: 'null' },
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
  expect(data.series.flatMap((row: { data: unknown[] }) => row.data).length).toBeLessThanOrEqual(100);
  expect(data.series[0].data.some((point: XY) => point.y === 0)).toBe(true);
  expect(data.series[0].data.every((point: XY) => point.y !== null)).toBe(true);
  const missing = await page.evaluate(() => {
    const time = window.card._graphs[0].history.find(([, value]: Point) => value === null)?.[0];
    return { time, painted: window.card._apexChart.w.config.series[0].data.some((point: XY) => point.x === time) };
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

for (const group_by of [
  { func: 'avg', period: 'hour' },
  { func: 'avg', duration: '1h' },
]) {
  test(`heatmap time labels line up with the cells (${group_by.period ? 'period' : 'duration'} buckets)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 600 });
    await mount(page, {
      chart_type: 'heatmap',
      graph_span: '24h',
      hours_12: false,
      apex_config: { chart: { animations: { enabled: false } } },
      series: ['Living', 'Bath'].map((name) => ({
        entity: 'sensor.temp',
        name,
        group_by,
        data_generator:
          'const out = []; for (let t = start.getTime(); t < end.getTime(); t += 600000) out.push([t, 20 + Math.sin(t / 7e6) * 3]); return out;',
      })),
    });
    await expect(page.locator('.apexcharts-heatmap-series').first()).toBeVisible();
    const measure = () =>
      page.evaluate((hourBuckets) => {
        const root = window.card.shadowRoot;
        const box = (el: Element) => el.getBoundingClientRect();
        const cells = [...root.querySelector('.apexcharts-heatmap-series').querySelectorAll('rect')].map(box);
        const left = cells[0].left;
        const width = (cells.at(-1).right - left) / cells.length;
        // The first bucket starts with the chart's window, or at the first full hour for
        // calendar hours (a partial hour is left out); not read from the cell timestamps,
        // which are what is under test
        const windowStart = window.card._getSpanDates().start;
        const firstStart = new Date(windowStart);
        if (hourBuckets) {
          firstStart.setMinutes(0, 0, 0);
          if (firstStart.getTime() < windowStart.getTime() - 1) firstStart.setHours(firstStart.getHours() + 1);
        }
        // a label may mark a time just before the first cell (ApexCharts' last tick before the axis)
        let minutes = firstStart.getHours() * 60 + firstStart.getMinutes() - 60;
        let day = 0;
        return (
          [...root.querySelectorAll('.apexcharts-xaxis-label')]
            .filter((label) => /\d\d:\d\d/.test(label.textContent))
            .map((label) => {
              // labels run left to right: a smaller clock time is the next day
              const [hour, minute] = label.textContent
                .match(/(\d\d):(\d\d)/)
                .slice(1)
                .map(Number);
              if (hour * 60 + minute + day * 1440 < minutes) day++;
              minutes = hour * 60 + minute + day * 1440;
              const startMinutes = firstStart.getHours() * 60 + firstStart.getMinutes();
              return {
                text: label.textContent,
                // position along the row in cells, and the label's time in hours after the first cell starts
                actual: (box(label).left + box(label).width / 2 - left) / width,
                expected: (minutes - startMinutes) / 60,
              };
            })
            // a label more than half a cell beside the grid counts as misplaced
            .map((label) =>
              label.actual < -0.5 || label.actual > cells.length + 0.5 ? { ...label, expected: Infinity } : label,
            )
        );
      }, !!group_by.period);
    // ApexCharts redraws the axis once the data arrives: measure until it has
    await expect
      .poll(
        async () => {
          const labels = await measure();
          return labels.length > 2 ? Math.max(...labels.map((label) => Math.abs(label.actual - label.expected))) : 1;
        },
        { timeout: 5000 },
      )
      .toBeLessThan(0.1);
  });
}

test('heatmap tooltip shows the time range of the hovered cell', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await mount(page, {
    chart_type: 'heatmap',
    graph_span: '24h',
    hours_12: false,
    apex_config: { chart: { animations: { enabled: false } } },
    series: [
      {
        entity: 'sensor.temp',
        name: 'Living',
        group_by: { func: 'avg', period: 'hour' },
        data_generator:
          'const out = []; for (let t = start.getTime(); t < end.getTime(); t += 600000) out.push([t, 20]); return out;',
      },
    ],
  });
  const cell = page.locator('apexcharts-card .apexcharts-heatmap-series rect').first();
  await expect(cell).toBeVisible();
  const expected = await page.evaluate(() => {
    // the first drawn cell is the first full hour of the window
    const first = new Date(window.card._getSpanDates().start);
    if (first.getMinutes() || first.getSeconds() || first.getMilliseconds())
      first.setHours(first.getHours() + 1, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return [first.getHours(), (first.getHours() + 1) % 24].map((h) => pad(h) + ':00');
  });
  await expect
    .poll(async () => {
      await cell.hover();
      return page.evaluate(() => window.card.shadowRoot.querySelector('.apexcharts-tooltip-title')?.textContent ?? '');
    })
    // a range over midnight names both dates: "Tue, Nov 24, 23:00 – Wed, Nov 25, 00:00"
    .toMatch(new RegExp(`${expected[0]}\\s?–\\s?(\\w+, \\w+ \\d+, )?${expected[1]}$`));
});

test('heatmap colour bands colour each cell by its value and list the bands in the legend', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await mount(page, {
    chart_type: 'heatmap',
    graph_span: '6h',
    apex_config: { chart: { animations: { enabled: false } } },
    heatmap: {
      color_ranges: [
        { value: 20, color: '#00ff00', name: 'Comfort' },
        { value: 22, color: '#ff0000' },
      ],
    },
    series: [
      {
        entity: 'sensor.temp',
        name: 'Living',
        group_by: { func: 'avg', period: 'hour' },
        // by clock hour, so every band appears whatever the time: 15, 21, 25, 15, ...
        data_generator:
          'const out = []; for (let t = start.getTime(); t < end.getTime(); t += 600000) out.push([t, [15, 21, 25][new Date(t).getHours() % 3]]); return out;',
      },
    ],
  });
  await expect(page.locator('apexcharts-card .apexcharts-heatmap-series rect').first()).toBeVisible();
  const result = await page.evaluate(() => {
    const root = window.card.shadowRoot;
    const cells = [...root.querySelector('.apexcharts-heatmap-series').querySelectorAll('rect')];
    const values = window.card._apexChart.w.config.series[0].data.map((point: XY) => point.y);
    return {
      // colours come back resolved (rgb): compare them as the browser normalises them
      cells: cells.map((cell, i) => {
        const probe = document.createElement('span');
        probe.style.color = cell.getAttribute('fill');
        document.body.appendChild(probe);
        const fill = getComputedStyle(probe).color;
        probe.remove();
        return { value: values[i], fill };
      }),
      legend: [...root.querySelectorAll('.apexcharts-legend-text')].map((text) => text.textContent),
    };
  });
  // the lowest band also covers values below it
  for (const cell of result.cells) {
    expect(cell.fill, String(cell.value)).toBe(cell.value >= 22 ? 'rgb(255, 0, 0)' : 'rgb(0, 255, 0)');
  }
  expect(result.cells.some((cell) => cell.value < 20)).toBe(true);
  expect(result.cells.some((cell) => cell.value >= 22)).toBe(true);
  // unnamed bands carry the sensor's unit
  expect(result.legend).toEqual(['Comfort', '≥ 22 °C']);
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
    window.editor.addEventListener('config-changed', (event: CustomEvent) =>
      window.editorEvents.push(event.detail.config),
    );
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
      window.card._hass.callWS = async (message: { type: string; start_time?: string }) => {
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
        window.requests.every((message: { type: string }) => message.type === 'recorder/statistics_during_period'),
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
