import { HaFormSchema } from '../types';
import { durationField } from '../helpers';

export const EXPERIMENTAL_BOOL_FIELDS = [
  'color_threshold',
  'hidden_by_default',
  'brush',
  'disable_config_validation',
] as const;

export const BRUSH_SCHEMA: HaFormSchema[] = [durationField('selection_span', ['1h', '6h', '12h', '1d'])];

// Locale text input; section_mode rendered separately via bool-grid
export const BEHAVIOR_SCHEMA: HaFormSchema[] = [{ name: 'locale', selector: { text: {} } }];
