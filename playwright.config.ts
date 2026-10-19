import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/ui', timeout: 30000, use: { baseURL: 'http://127.0.0.1:1420', browserName: 'chromium', channel: 'msedge', viewport: { width: 1280, height: 860 } }, webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: true }, reporter: 'list', outputDir: 'qa/output/playwright' });
