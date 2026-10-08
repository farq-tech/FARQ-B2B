import { defineConfig } from '@playwright/test'
// Runs the repo suite (tests/) against the already-running dev server on :5193 (no second server).
export default defineConfig({
  testDir: '../../../tests',
  outputDir: '../../../tmp/playwright-repo',
  reporter: [['list']],
  workers: 1,
  use: { baseURL: 'http://localhost:5193', channel: 'chrome', viewport: { width: 1176, height: 1100 }, locale: 'ar-SA' },
})
