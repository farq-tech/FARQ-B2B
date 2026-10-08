import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: '.', testMatch: [/landing\.spec\.ts$/, /screens-b\.spec\.ts$/], testIgnore: /node_modules/, outputDir: 'tmp/playwright', reporter: [['list']], workers: 1, use: { baseURL: 'http://localhost:5190', channel: 'chrome', viewport: { width: 1440, height: 900 }, locale: 'ar-SA' } })
