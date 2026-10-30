import { HaFormSchema, SEL_FALSE, SEL_TRUE, SEL_UNDEFINED } from '../types';
import { t } from '../localize';

// Schemas below are exposed as functions (not module-level constants) so that option labels
// re-resolve to the current editor locale on every render.

// Entity field: switches to the statistic picker (ha-statistic-picker) when
// statistics mode is active, so external statistic IDs (source:object_id)
// can be selected too.
export function getSeriesEntitySchema(statisticsMode: boolean): HaFormSchema[] {
  return [{ name: 'entity', selector: statisticsMode ? { statistic: {} } : { entity: {} } }];
}

// ── Core fields rendered above the expandables (entity is handled separately). ──
export function getSeriesCoreSchema(): HaFormSchema[] {
  return [
    { name: 'name', selector: { text: {} } },
    {
      type: 'grid',
      name: '',
      schema: [
        {
          name: 'type',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: '', label: t('common.default') },
                { value: 'line', label: t('series.chartType.line') },
                { value: 'column', label: t('series.chartType.column') },
                { value: 'area', label: t('series.chartType.area') },
              ],
            },
          },
        },
      ],
    },
  ];
}

// Inner fields of the Group By expander (start_with_last rendered separately via bool-grid)
export function getSeriesGroupBySchema(): HaFormSchema[] {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'duration', selector: { text: {} } },
        {
          name: 'func',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: 'raw', label: t('series.func.raw') },
                { value: 'avg', label: t('series.func.avg') },
                { value: 'min', label: t('series.func.min') },
                { value: 'max', label: t('series.func.max') },
                { value: 'last', label: t('series.func.last') },
                { value: 'first', label: t('series.func.first') },
                { value: 'sum', label: t('series.func.sum') },
                { value: 'median', label: t('series.func.median') },
                { value: 'delta', label: t('series.func.delta') },
                { value: 'diff', label: t('series.func.diff') },
              ],
            },
          },
        },
      ],
    },
    {
      name: 'align',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: '', label: t('common.default') },
            { value: 'start', label: t('series.align.start') },
            { value: 'middle', label: t('series.align.middle') },
            { value: 'end', label: t('series.align.end') },
          ],
        },
      },
    },
    {
      name: 'fill',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'last', label: t('series.fill.last') },
            { value: 'null', label: t('series.fill.null') },
            { value: 'zero', label: t('series.fill.zero') },
          ],
        },
      },
    },
  ];
}

// ── Data processing ── (group_by rendered separately as a custom panel)
export function getSeriesDataProcessingSchema(): HaFormSchema[] {
  return [
    {
      name: 'statistics',
      type: 'expandable',
      title: t('series.statistics.title'),
      schema: [
        {
          type: 'grid',
          name: '',
          schema: [
            {
              name: 'type',
              selector: {
                select: {
                  mode: 'dropdown',
                  options: [
                    { value: '', label: t('common.none') },
                    { value: 'mean', label: t('series.statisticsType.mean') },
                    { value: 'max', label: t('series.statisticsType.max') },
                    { value: 'min', label: t('series.statisticsType.min') },
                    { value: 'sum', label: t('series.statisticsType.sum') },
                    { value: 'state', label: t('series.statisticsType.state') },
                    { value: 'change', label: t('series.statisticsType.change') },
                  ],
                },
              },
            },
            {
              name: 'period',
              selector: {
                select: {
                  mode: 'dropdown',
                  options: [
                    { value: '', label: t('common.none') },
                    { value: '5minute', label: t('series.statisticsPeriod.5minute') },
                    { value: 'hour', label: t('common.period.hour') },
                    { value: 'day', label: t('common.period.day') },
                    { value: 'week', label: t('common.period.week') },
                    { value: 'month', label: t('common.period.month') },
                  ],
                },
              },
            },
          ],
        },
        {
          name: 'align',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: '', label: t('common.none') },
                { value: 'start', label: t('series.align.start') },
                { value: 'middle', label: t('series.align.middle') },
                { value: 'end', label: t('series.align.end') },
              ],
            },
          },
        },
      ],
    },
    {
      name: 'fill_raw',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'null', label: t('series.fill.null') },
            { value: 'last', label: t('series.fill.last') },
            { value: 'zero', label: t('series.fill.zero') },
          ],
        },
      },
    },
    { name: 'transform', selector: { text: {} } },
    { name: 'data_generator', selector: { text: { multiline: true } } },
  ];
}

// ── Appearance ──
export function getSeriesAppearanceSchema(): HaFormSchema[] {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        {
          name: 'curve',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: '', label: t('common.default') },
                { value: 'smooth', label: t('series.curve.smooth') },
                { value: 'straight', label: t('series.curve.straight') },
                { value: 'stepline', label: t('series.curve.stepline') },
                { value: 'monotoneCubic', label: t('series.curve.monotoneCubic') },
              ],
            },
          },
        },
        {
          name: 'opacity',
          selector: { number: { min: 0, max: 1, step: 0.05, mode: 'box' } },
        },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        {
          name: 'stroke_width',
          selector: { number: { min: 0, max: 20, step: 1, mode: 'box' } },
        },
        { name: 'stroke_dash', selector: { text: {} } },
      ],
    },
    {
      name: 'extend_to',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: SEL_UNDEFINED, label: t('common.default') },
            { value: 'end', label: t('field.end') },
            { value: 'now', label: t('series.extendTo.now') },
            { value: SEL_FALSE, label: t('common.disabled') },
          ],
        },
      },
    },
  ];
}

// Visibility selects (booleans are rendered separately via bool-grid)
export function getSeriesVisibilitySelectSchema(): HaFormSchema[] {
  return [
    {
      name: 'in_header',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: SEL_UNDEFINED, label: t('common.default') },
            { value: SEL_TRUE, label: t('common.yes') },
            { value: SEL_FALSE, label: t('common.no') },
            { value: 'raw', label: t('series.inHeader.raw') },
            { value: 'before_now', label: t('series.inHeader.beforeNow') },
            { value: 'after_now', label: t('series.inHeader.afterNow') },
          ],
        },
      },
    },
    {
      name: 'as_duration',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: SEL_UNDEFINED, label: t('common.none') },
            { value: 'millisecond', label: t('series.duration.millisecond') },
            { value: 'second', label: t('series.duration.second') },
            { value: 'minute', label: t('common.period.minute') },
            { value: 'hour', label: t('common.period.hour') },
            { value: 'day', label: t('common.period.day') },
            { value: 'week', label: t('common.period.week') },
            { value: 'month', label: t('common.period.month') },
            { value: 'year', label: t('common.period.year') },
          ],
        },
      },
    },
    {
      name: 'extremas',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: SEL_UNDEFINED, label: t('common.off') },
            { value: SEL_TRUE, label: t('series.extremas.all') },
            { value: 'time', label: t('series.extremas.time') },
            { value: 'min', label: t('series.statisticsType.min') },
            { value: 'max', label: t('series.statisticsType.max') },
            { value: 'min+time', label: t('series.extremas.minTime') },
            { value: 'max+time', label: t('series.extremas.maxTime') },
          ],
        },
      },
    },
    {
      name: 'datalabels',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: SEL_UNDEFINED, label: t('common.off') },
            { value: SEL_TRUE, label: t('common.on') },
            { value: 'total', label: t('series.datalabels.total') },
            { value: 'percent', label: t('series.datalabels.percent') },
          ],
        },
      },
    },
  ];
}

// Visibility booleans - rendered via bool-grid. Each entry tracks its default value.
export const SERIES_VISIBILITY_BOOL_FIELDS: { name: string; defaultValue: boolean }[] = [
  { name: 'in_chart', defaultValue: true },
  { name: 'in_legend', defaultValue: true },
  { name: 'legend_value', defaultValue: true },
  { name: 'name_in_header', defaultValue: true },
  { name: 'offset_in_name', defaultValue: true },
  { name: 'null_in_header', defaultValue: true },
  { name: 'zero_in_header', defaultValue: true },
];

// ── Advanced ──
export function getSeriesAdvancedBaseSchema(): HaFormSchema[] {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'attribute', selector: { text: {} } },
        { name: 'unit', selector: { text: {} } },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        {
          name: 'float_precision',
          selector: { number: { min: 0, max: 10, step: 1, mode: 'box' } },
        },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'offset', selector: { text: {} } },
        { name: 'time_delta', selector: { text: {} } },
      ],
    },
  ];
}
