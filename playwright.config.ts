import { defineConfig } from '@playwright/test'

// Keyboard tests against the dev harness / gallery (dev server on :5180). Uses the
// installed Google Chrome (channel: 'chrome') — no browser download.
export default defineConfig({
  testDir: 'tests',
  outputDir: 'tmp/playwright',
  reporter: [['list']],
  workers: 1,
  use: { baseURL: 'http://localhost:5180', channel: 'chrome', viewport: { width: 1176, height: 1100 }, locale: 'ar-SA' },
  webServer: { command: 'npx vite --port 5180 --strictPort', url: 'http://localhost:5180', reuseExistingServer: true },
})
