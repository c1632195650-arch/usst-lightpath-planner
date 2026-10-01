/**
 * 账号缓存隔离守卫（持久化与账号系统实施规格书 §5.5，2026-10-01 补）
 * ============================================================
 * 背景：localStorage 缓存原先**没有归属标记** —— 换账号/注册新号时，旧账号的
 * 画像、课表、onboarded 标记原样留在本机，新账号一进去就读到旧画像
 * （「注册了新账号却还是用原来账号的画像」事故）。
 *
 * 本文件钉三条不变量：
 *   ① 本机归属标记 `usst.local_owner.v1` 是 localOnly —— 绝不进 cloudKeys()；
 *   ② 登录页必须接线「过户」流程：换账号清本机缓存 + 整页重载；
 *   ③ 注销账号（§5.6）= 服务端删号（级联清 kv/sessions）+ 前端密码二次确认。
 *
 * 纯静态 + 纯函数校验（node:fs / node:test），与 storageRegistry.test.ts 同风格。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptAccount, clearLocalCache, cloudKeys, getLocalOwner, setLocalOwner } from '@/lib/persistence';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** 剥注释：登录页注释里也会提这些函数名，不能算「接线」 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

test('§5.5①：本机归属标记是 localOnly，绝不进 cloudKeys()', () => {
  assert.ok(!cloudKeys().includes('usst.local_owner.v1'), '归属标记一旦入库，换设备就会串号');
  // 四个过户原语必须导出（登录页依赖它们）
  assert.equal(typeof getLocalOwner, 'function', 'persistence 应导出 getLocalOwner');
  assert.equal(typeof setLocalOwner, 'function', 'persistence 应导出 setLocalOwner');
  assert.equal(typeof clearLocalCache, 'function', 'persistence 应导出 clearLocalCache');
  assert.equal(typeof adoptAccount, 'function', 'persistence 应导出 adoptAccount');
});

test('§5.5②：登录页接线过户流程（换账号清缓存 + 整页重载）', () => {
  const code = stripComments(readFileSync(join(SRC, 'features/auth/LoginPage.tsx'), 'utf8'));
  assert.match(code, /adoptAccount/, '登录成功应调 adoptAccount 把本机缓存过户给该账号');
  assert.match(code, /clearLocalCache/, '「不并入」路径应清空本机缓存（旧账号不得漏进新账号）');
  assert.match(code, /setLocalOwner/, '并入 / 过户后应标记缓存归属账号');
  assert.match(code, /location\.reload/, '缓存被重置后应整页重载（仅切 auth 状态时各 store 仍握旧数据）');
  // 旧的漏洞写法：把「暂不并入」直接当成「进入」而不碰本机缓存
  assert.doesNotMatch(
    code,
    /暂不，先进入/,
    '旧的「暂不，先进入」正是漏数据的那条路 —— 应改成清缓存后进入纯新账号',
  );
});

test('§5.6：注销账号 = 服务端删号端点 + 前端二次确认（破坏性操作）', () => {
  const serve = readFileSync(join(HERE, '..', 'serve.py'), 'utf8');
  assert.match(serve, /\/api\/auth\/delete/, 'serve.py 应有 POST /api/auth/delete 路由');
  assert.match(serve, /DELETE FROM users WHERE id=\?/, '注销应删 users 行（kv/sessions 靠 ON DELETE CASCADE）');
  assert.match(serve, /PRAGMA foreign_keys=ON/, '必须开启外键强制，否则级联删除不生效（残留孤儿 kv）');

  const menu = stripComments(readFileSync(join(SRC, 'features/auth/AccountMenu.tsx'), 'utf8'));
  assert.match(menu, /deleteAccount/, '账号菜单应接 deleteAccount');
  assert.match(menu, /注销账号/, '菜单里要有「注销账号」入口（在「退出登录」下面）');
  assert.match(menu, /type="password"/, '注销需重新输入密码二次确认（无密码找回，规格书 §1.3）');
  assert.match(menu, /clearLocalCache/, '注销后应清本机缓存（别把已删账号的数据留在本机）');
  assert.match(menu, /clearLocalOwner/, '注销后应清本机归属标记');
  assert.match(menu, /location\.reload/, '注销后应整页重载（清空内存态，回登录页）');
});

