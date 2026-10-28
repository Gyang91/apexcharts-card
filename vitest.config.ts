import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/utils.ts',
        'src/locales.ts',
        'src/deep-equal.ts',
        'src/fire-event.ts',
        'src/const.ts',
        'src/apex-layouts.ts',
        'src/editor/helpers.ts',
        'src/editor/localize.ts',
        'src/editor/apex-config-utils.ts',
        'src/apexcharts-card.ts',
        'src/graphEntry.ts',
        'src/recorder.ts',
      ],
      exclude: ['src/types-config-ti.ts'],
    },
  },
});
