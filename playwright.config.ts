import { defineConfig } from '@playwright/test';

// P1#9（2026-09-19）：E2E + 可访问性 + 视觉回归的承载配置。
// 用 vite preview（生产构建）而非 dev server——PWA/构建产物行为才作数。
// retries:1 且重试成功会记为 flaky 信号（不是"绿了就算"）；视觉阈值 0.02 起步，稳定两周后收到 ≤0.01。
export default defineConfig({
  testDir: './e2e',
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'zh-CN',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
