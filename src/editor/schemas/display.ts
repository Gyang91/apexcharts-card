import { HaFormSchema } from '../types';

// Header title text input (booleans rendered separately via bool-grid)
export const HEADER_TITLE_SCHEMA: HaFormSchema[] = [{ name: 'title', selector: { text: {} } }];
export const HEADER_BOOL_FIELDS = [
  'show',
  'floating',
  'show_states',
  'colorize_states',
  'standard_format',
  'disable_actions',
] as const;

// Label text field; the colour has its own picker and `show` is rendered via bool-grid
export const NOW_SCHEMA: HaFormSchema[] = [{ name: 'label', selector: { text: {} } }];

export const SHOW_BOOL_FIELDS = ['loading', 'last_updated'] as const;
