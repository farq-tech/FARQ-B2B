import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir:'tests', testMatch:'b2b-production.spec.ts', outputDir:'tmp/playwright-b2b', workers:1,
  reporter:[['list']], use:{baseURL:'http://127.0.0.1:5187',channel:'chrome',locale:'ar-SA'},
  webServer:{command:'npx vite --host 127.0.0.1 --port 5187 --strictPort',url:'http://127.0.0.1:5187',reuseExistingServer:true},
})
