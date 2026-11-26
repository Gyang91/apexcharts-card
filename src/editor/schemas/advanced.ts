import { HaFormSchema } from '../types';
import { durationField } from '../helpers';

// Brush, hidden-by-default and threshold switches sit next to the settings they unlock
export const EXPERIMENTAL_BOOL_FIELDS = ['disable_config_validation'] as const;

export const BRUSH_SCHEMA: HaFormSchema[] = [durationField('selection_span', ['1h', '6h', '12h', '1d'])];

// Locale text input; section_mode rendered separately via bool-grid
export const BEHAVIOR_SCHEMA: HaFormSchema[] = [{ name: 'locale', selector: { text: {} } }];
