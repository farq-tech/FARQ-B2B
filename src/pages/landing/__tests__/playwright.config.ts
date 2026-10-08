import { defineConfig } from '@playwright/test'

// Landing-page tests (kept inside src/pages/landing — the repo's tests/ folder is outside this track's bounds).
// Run: npx playwright test -c src/pages/landing/__tests__/playwright.config.ts
// Dev server on :5191 serving the dev-only entry /src/pages/landing/dev.html. Uses installed Chrome.
export default defineConfig({
  testDir: '.',
  outputDir: '../../../../tmp/playwright-landing',
  reporter: [['list']],
  workers: 1,
  use: { baseURL: 'http://localhost:5191', channel: 'chrome', locale: 'ar-SA', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'npx vite --port 5191 --strictPort', url: 'http://localhost:5191/src/pages/landing/dev.html', reuseExistingServer: true, cwd: '../../../..' },
})
