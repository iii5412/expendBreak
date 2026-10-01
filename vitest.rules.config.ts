import { defineConfig } from 'vitest/config';

// Security-rules tests need the Firebase emulators, so they run separately from
// the unit tests: `npm run test:rules` starts the emulators and then this config.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    // The emulators hold shared state; run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
