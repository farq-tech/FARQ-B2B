import { defineConfig } from '@playwright/test'

// Session tests against the REAL pricing proxy (server.py, production build) in front of a fake Farq API
// (tests-session/stub_api.py). Run: npm run build && npx playwright test -c tests-session/playwright.config.ts
export const STUB = 'http://127.0.0.1:5197'
export default defineConfig({
  testDir: '.',
  outputDir: '../tmp/playwright-session',
  reporter: [['list']],
  workers: 1,
  use: { baseURL: 'http://localhost:5198', channel: 'chrome', locale: 'ar-SA', viewport: { width: 1280, height: 900 } },
  webServer: [
    { command: 'python3 tests-session/stub_api.py 5197', url: `${STUB}/__stub/state`, cwd: '..', reuseExistingServer: false },
    { command: 'python3 server.py', url: 'http://127.0.0.1:5198/robots.txt', cwd: '..', reuseExistingServer: false,
      env: { PORT: '5198', FARQ_API_ORIGIN: STUB, TARGETING_ORIGIN: STUB, FARQ_SESSION_SECRET: 'qa-session-secret-0123456789abcdef0123456789', ALLOWED_EMAILS: 'abdulrhman@farq.sa' } },
  ],
})
