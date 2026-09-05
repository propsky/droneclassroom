import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** L-04 Chrome / Edge / Safari + L-02 iPad Safari 展場最低規格 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:5173' },
    },
    {
      name: 'webkit-ipad',
      use: { ...devices['iPad Pro 11'], baseURL: 'http://localhost:5173' },
    },
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], baseURL: 'http://localhost:5173' },
    },
  ],
  webServer: [
    {
      command:
        'ENTITLEMENT_MODE=enforce DATABASE_URL=postgresql+asyncpg://unused pnpm --filter @creafly/api dev',
      cwd: rootDir,
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @creafly/simulator dev',
      cwd: rootDir,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
