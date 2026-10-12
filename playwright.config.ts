import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.e2e.ts',
  timeout: 90_000,
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1280, height: 800 } },
  webServer: [
    { command: 'npx vite --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: true },
    // the built site, the one place the service worker runs
    { command: 'npx vite build && npx vite preview --port 5175 --strictPort', url: 'http://localhost:5175', reuseExistingServer: true },
  ],
});
