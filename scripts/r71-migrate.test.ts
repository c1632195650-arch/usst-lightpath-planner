/**
 * R 批 P1-4 · R7.1 设备台账 → 账号台账 迁移合并（源码锁）
 * ============================================================
 * CY 2026-10-03 拍板：R7.1 走「迁移合并」（不是弃置）。
 * 根因：`identity.getUserId()` 未登录用随机设备 id、登录后用账号名 ——
 * 「先离线用、后登录」读写指向两个台账，梨宝记忆凭空清零（走查实录：面板 0/0）。
 *
 * ⚠️ 本仓无 jsdom，接线用源码字面量断言；服务端迁移逻辑由
 * scripts/test_r71_migrate.py（10 条，含三种冲突策略 + 画像字段级合并）覆盖，
 * HTTP 端点由 scripts/r71_endpoint_probe.py 真机打一遍。
 *
 * 反向验证（RV-R71）：
 *   RV-R71a← 摘掉 App.tsx 的 migrateMemoryLedger 调用 → 用例一红
 *   RV-R71b ← 摘掉 auth.ts 的 /api/memory/migrate 请求 → 用例二红
 *   RV-R71c ← 摘掉 identity.ts 的 getDeviceUserId → 用例一+二红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('R7.1 源码锁: 设备 id 可单独取（不因登录态被覆盖）', () => {
  const id = read('/src/lib/identity.ts');
  assert.match(id, /export function getDeviceUserId/, 'getDeviceUserId 在位');
  // 关键咬合：已登录时 getUserId 返回账号，但设备 id 仍要能读到 —— 否则无处可迁
  assert.match(id, /if \(authedUsername && saved === authedUsername\) return null;/,
    '设备 id 与账号同名时返回 null（无独立设备台账，不必迁）');
  assert.match(id, /return saved;/, '否则返回设备 id 原值');
});

test('R7.1 源码锁: 迁移通道三段在位（api 封装 / 登录成功接线 / 后端端点）', () => {
  // ① auth.ts 封装
  const auth = read('/src/lib/auth.ts');
  assert.match(auth, /export async function migrateMemoryLedger/, 'migrateMemoryLedger 在位');
  assert.match(auth, /'\/api\/memory\/migrate'/, '打 /api/memory/migrate');
  assert.match(auth, /strategy: MigrateStrategy = 'account_wins'/, '默认账号优先（CY 定稿口径）');
  // 离线/失败必须静默返回 ok:false —— 迁移是尽力而为，不该挡住登录
  assert.match(auth, /return fallback; \/\/ 服务不可达 → 静默：迁移是尽力而为，不该挡住登录/,
    '迁移失败静默（不抛、不挡登录）');

  // ② App.tsx 登录成功接线：必须在 setAuthedUserId 之前取设备 id
  const app = read('/src/App.tsx');
  assert.match(app, /import \{ fetchMe, migrateMemoryLedger, type AuthStatus \}/, 'App 引入迁移封装');
  assert.match(app, /const deviceId = getDeviceUserId\(\);/, '登录成功时取设备 id');
  assert.match(app, /void migrateMemoryLedger\(deviceId, u\)/, '触发迁移（fire-and-forget）');
  const takeAt = app.indexOf('const deviceId = getDeviceUserId();');
  const setAt = app.indexOf('setAuthedUserId(u);');
  assert.ok(takeAt > 0 && setAt > 0, '两处调用都在');
  assert.ok(takeAt < setAt,
    '必须在 setAuthedUserId 之前取设备 id —— 之后 getUserId 已是账号，取不到设备台账');

  // ③ 后端端点
  const srv = read('/server/app.py');
  assert.match(srv, /@app\.post\("\/api\/memory\/migrate"\)/, '迁移端点在位');
  const mem = read('/server/memory.py');
  assert.match(mem, /def migrate_user_id\(old_id, new_id, strategy="account_wins"\)/,
    'migrate_user_id 在位，默认账号优先');
  assert.match(mem, /def _merge_profiles\(old_id, new_id\)/, '画像字段级合并在位');
});