import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import os from 'os';

const isCI = !!process.env.CI;
const defaultPort = isCI ? '3001' : '3000';
const basePort = process.env.E2E_PORT || defaultPort;
const baseURL = `http://localhost:${basePort}`;

const e2eStorageDir = path.join(os.tmpdir(), `oc-mirror-e2e-${Date.now()}`);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(isCI
    ? {
        webServer: {
          command: 'npm run dev',
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120 * 1000,
          env: {
            ...process.env,
            STORAGE_DIR: e2eStorageDir,
          },
        },
      }
    : {}),
});
