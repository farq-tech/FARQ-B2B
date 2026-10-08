import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: 'tests', outputDir: 'tmp/playwright', reporter: [['list']], workers: 1, use: { baseURL: 'http://localhost:5190', channel: 'chrome', viewport: { width: 1176, height: 1100 }, locale: 'ar-SA' } })
