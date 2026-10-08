import { defineConfig } from '@playwright/test'

// Track D tests (screens 03–06) against the dev server already running on :5193
// (npx vite --port 5193 --strictPort). Installed Chrome, no browser download, one worker.
export default defineConfig({
  testDir: '.',
  testMatch: /screens-b\.spec\.ts$/,
  outputDir: '../../../tmp/playwright-screens-b',
  reporter: [['list']],
  workers: 1,
  use: { baseURL: 'http://localhost:5193', channel: 'chrome', viewport: { width: 1440, height: 900 }, locale: 'ar-SA' },
})
