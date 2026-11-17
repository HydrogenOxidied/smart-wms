import path from 'node:path';
import { defineConfig } from '@playwright/test';

const backendDir = path.resolve(__dirname, '../backend');
const pythonExe = path.join(backendDir, '.venv', 'Scripts', 'python.exe');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8015',
    channel: 'msedge',
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `"${pythonExe}" -m uvicorn app.main:app --host 127.0.0.1 --port 8015`,
    cwd: backendDir,
    url: 'http://127.0.0.1:8015/api/v1/health',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      WMS_DATABASE_URL: 'sqlite:///./e2e_playwright.db',
      WMS_AUTO_SEED_DEMO: 'false',
    },
  },
});
