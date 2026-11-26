import { HaFormSchema, SEL_FALSE, SEL_TRUE, SEL_UNDEFINED } from '../types';
import { t } from '../localize';
import { durationField, INTERVAL_PRESETS, OFFSET_PRESETS, SPAN_PRESETS } from '../helpers';

export const GENERAL_TOP_SCHEMA: HaFormSchema[] = [durationField('graph_span', SPAN_PRESETS)];

// Layout select, rendered side-by-side with the `stacked` bool-grid switch.
// A function (not a module-level constant) so option labels re-resolve to the current locale
// on every render.
export function getLayoutSchema(): HaFormSchema[] {
  return [
    {
      name: 'layout',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: '', label: t('common.default') },
            { value: 'minimal', label: t('general.layout.minimal') },
          ],
        },
      },
    },
  ];
}

export function getGeneralBottomSchema(): HaFormSchema[] {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        durationField('update_interval', INTERVAL_PRESETS),
        durationField('update_delay', ['500ms', '1500ms', '3s', '5s']),
      ],
    },
    {
      name: 'hours_12',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: SEL_UNDEFINED, label: t('common.auto') },
            { value: SEL_TRUE, label: t('common.yes') },
            { value: SEL_FALSE, label: t('common.no') },
          ],
        },
      },
    },
    {
      name: 'span',
      type: 'expandable',
      title: t('general.span.title'),
      schema: [
        {
          name: 'start',
          helper: t('general.span.start.helper'),
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: '', label: t('common.none') },
                { value: 'minute', label: t('common.period.minute') },
                { value: 'hour', label: t('common.period.hour') },
                { value: 'day', label: t('common.period.day') },
                { value: 'week', label: t('common.period.week') },
                { value: 'month', label: t('common.period.month') },
                { value: 'year', label: t('common.period.year') },
                { value: 'isoWeek', label: t('common.period.isoWeek') },
              ],
            },
          },
        },
        {
          name: 'end',
          helper: t('general.span.end.helper'),
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: '', label: t('common.none') },
                { value: 'minute', label: t('common.period.minute') },
                { value: 'hour', label: t('common.period.hour') },
                { value: 'day', label: t('common.period.day') },
                { value: 'week', label: t('common.period.week') },
                { value: 'month', label: t('common.period.month') },
                { value: 'year', label: t('common.period.year') },
                { value: 'isoWeek', label: t('common.period.isoWeek') },
              ],
            },
          },
        },
        durationField('offset', OFFSET_PRESETS, t('general.span.offset.helper')),
      ],
    },
  ];
}
