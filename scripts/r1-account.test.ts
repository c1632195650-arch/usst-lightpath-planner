/**
 * R 批 P1-2 · R1 账号与入口可见性（源码锁，与 wp7 同手法）
 * ============================================================
 * CY 走查实录：「右上没有账号菜单」「没有账号和导入课表」—— AccountMenu
 * 早已挂载但条件是「已登录」，serve.py 未启动（offline）时不渲染；引导页
 * 提前 return 没有顶栏，登录口在 Welcome 不可见。
 *
 * ⚠️ 反向验证（RV）：
 *   RV-R1a ← 删 App.tsx 的 offline 占位入口分支 → 用例一红
 *   RV-R1b ← 删 Welcome 的「已有账号？去登录」行 → 用例二红
 * 本仓无 jsdom，组件接线用源码字面量断言（wp7 / r2-addtask-panel 同一先例）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('R1.1/R1.3 源码锁: offline 态保留账号位（占位入口 + 重试连接 + 单机模式语义）', () => {
  const app = read('/src/App.tsx');
  // RV-R1a 锚：offline 分支必须在 header 里渲染占位入口
  assert.match(app, /auth\.status === 'offline' && \(/,
    'offline 态分支在位（删此分支 → 红）');
  assert.match(app, /<AccountOfflineMenu onRetry=\{probeAuth\} \/>/,
    'offline 态渲染账号占位入口');
  assert.match(app, /const probeAuth = useCallback/, '重试探测回调在位');
  assert.match(app, /import \{ AccountMenu, AccountOfflineMenu \}/, '占位入口已导入');

  const menu = read('/src/features/auth/AccountMenu.tsx');
  assert.match(menu, /data-testid="account-offline"/, '占位入口 testid');
  assert.match(menu, /data-testid="account-retry"/, '重试连接按钮');
  assert.match(menu, /重试连接/);
  // R1.3：offline 语义写进界面 —— 单机模式 / 数据仅存本机 / 记忆不与账号同步
  assert.match(menu, /单机模式/);
  assert.match(menu, /仅保存在本机|仅存本机/);
  assert.match(menu, /不与账号同步/);
});

test('R1.2 源码锁: 引导页（Welcome）有「已有账号？去登录」且接线重试探测', () => {
  const welcome = read('/src/features/welcome/Welcome.tsx');
  // RV-R1b 锚：删除提示行 → 红
  assert.match(welcome, /已有账号\？/, '「已有账号？」提示行在位');
  assert.match(welcome, /去登录/);
  assert.match(welcome, /data-testid="welcome-login-hint"/, '登录提示按钮 testid');
  assert.match(welcome, /onRetryAuth\?: \(\) => void/, '重试探测 prop 声明');
  assert.match(welcome, /onClick=\{onRetryAuth\}/, '点击接线重试探测');

  const app = read('/src/App.tsx');
  assert.match(app, /onRetryAuth=\{probeAuth\}/, 'App 把探测回调传给 Welcome');
});
