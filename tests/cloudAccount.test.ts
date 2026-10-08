/**
 * 云账号与云同步开关（2026-10-06「假联通」修复 · 必修 2/3）—— tests/cloudAccount.test.ts
 * node --test 直跑；localStorage 用内存桩（Node 无 DOM）。
 *
 * 锁的契约：
 *   · 登录/注册成功 → 身份落**移动端同组键**（usst.mobile.token/user，审计断点④）
 *     + 云同步开关自动置 '1'（审计断点②，必修 3）；
 *   · getUserId() 账号 ID 优先（acct-<n>），无账号/坏数据回退设备 ID（审计断点①）；
 *   · 登出 = 清身份 + 关开关。
 *
 * ⚠️ 反向验证记录（2026-10-06，严防假绿）：
 *   1. 把 applyLoginSuccess 里的 setCloudSync(true) 删掉 → 「登录后开关自动打开」红；
 *   2. 把 getUserId 的账号分支删掉 → 「账号优先」与「坏 JSON 回退」两组红；
 *   3. 把 logout 里的 setCloudSync(false) 删掉 → 「登出后开关关」红。
 *   均已实操验证变红后恢复，过程见提交记录。
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyLoginSuccess, logout, readCloudSyncOn, setCloudSync,
} from '@/lib/cloudAccount';
import { getUserId } from '@/lib/identity';
import {
  loadIdentity, TOKEN_KEY, USER_KEY as ACCOUNT_USER_KEY, ICS_KEY,
} from '@/features/mobile/lib/auth';
import { SWITCH_KEY } from '@/features/mobile/lib/webSync';
import type { AuthResponse } from '@/features/mobile/lib/types';

/** 内存版 localStorage（Node --test 环境没有 DOM storage） */
function installStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as Record<string, unknown>).localStorage = stub;
  return store;
}

beforeEach(() => {
  installStorageStub();
});

const RES: AuthResponse = { userId: 7, token: 'tok-abc', icsToken: 'ics-xyz' };

/* ---------------- 开关 ---------------- */

test('云同步开关：缺省关；setCloudSync 显式写 1/0，关是 0 不是删键', () => {
  const store = installStorageStub();
  assert.equal(readCloudSyncOn(), false, '未登录/未设置 = 关（默认关承诺不破）');
  setCloudSync(true);
  assert.equal(store.get(SWITCH_KEY), '1');
  assert.equal(readCloudSyncOn(), true);
  setCloudSync(false);
  assert.equal(store.get(SWITCH_KEY), '0', '显式关闭落 0，保留用户选择痕迹');
  assert.equal(readCloudSyncOn(), false);
});

/* ---------------- 登录成功收口（必修 2 + 必修 3） ---------------- */

test('applyLoginSuccess：身份与移动端同键落盘 + 开关自动置 1', () => {
  const store = installStorageStub();
  const id = applyLoginSuccess(RES, '秃头披风侠');
  assert.equal(id.token, 'tok-abc');
  assert.equal(id.userId, 7);
  assert.equal(id.username, '秃头披风侠');
  assert.equal(id.icsToken, 'ics-xyz');
  // 同键断言（审计断点④：两端键不同 = 永远读不到对方登录态）
  assert.equal(store.get(TOKEN_KEY), 'tok-abc');
  assert.deepEqual(JSON.parse(store.get(ACCOUNT_USER_KEY)!), { userId: 7, username: '秃头披风侠' });
  assert.equal(store.get(SWITCH_KEY), '1', '登录后开关必须自动打开（必修 3）');
  // loadIdentity 能读回 —— webSync 钩子下一轮 tick 即可拿到 token
  assert.equal(loadIdentity()?.token, 'tok-abc');
});

test('logout：清身份（含 ICS）+ 开关关；再登录不受残留影响', () => {
  const store = installStorageStub();
  applyLoginSuccess(RES, '秃头披风侠');
  logout();
  assert.ok(!store.has(TOKEN_KEY), 'token 键必须清除');
  assert.ok(!store.has(ACCOUNT_USER_KEY), '账号键必须清除');
  assert.ok(!store.has(ICS_KEY), 'ICS 键跟着账号走（登出即清）');
  assert.equal(store.get(SWITCH_KEY), '0', '登出必须显式关开关（token 没了还开着 = 永远 no-token 的假联通）');
  assert.equal(readCloudSyncOn(), false);
});

/* ---------------- getUserId：账号 ID 优先（审计断点①） ---------------- */

test('getUserId：有账号 → acct-<userId>；无账号 → 设备 ID u-*（原语义）', () => {
  const store = installStorageStub();
  assert.ok(getUserId().startsWith('u-'), '无账号回退设备 ID（老用户无感）');
  store.set(ACCOUNT_USER_KEY, JSON.stringify({ userId: 7, username: '秃头披风侠' }));
  assert.equal(getUserId(), 'acct-7', '登录后记忆/画像走账号 ID，跨端续用');
});

test('getUserId：账号键损坏/非法 → 回退设备 ID，不抛错不猜', () => {
  const store = installStorageStub();
  store.set(ACCOUNT_USER_KEY, '{bad json');
  assert.ok(getUserId().startsWith('u-'));
  store.set(ACCOUNT_USER_KEY, JSON.stringify({ userId: '3', username: 'x' })); // 非数字
  assert.ok(getUserId().startsWith('u-'), 'userId 类型不对不许用');
  store.set(ACCOUNT_USER_KEY, JSON.stringify({ userId: 0 })); // 非法值域
  assert.ok(getUserId().startsWith('u-'));
  store.set(ACCOUNT_USER_KEY, JSON.stringify({ userId: -1 }));
  assert.ok(getUserId().startsWith('u-'));
});

test('getUserId：登出（账号键清除）后回到设备 ID，进程内不残留', () => {
  const store = installStorageStub();
  store.set(ACCOUNT_USER_KEY, JSON.stringify({ userId: 7, username: 'x' }));
  assert.equal(getUserId(), 'acct-7');
  store.delete(ACCOUNT_USER_KEY);
  assert.ok(getUserId().startsWith('u-'), '账号键消失必须立即回退，不能缓存账号 ID');
});

/* ---------------- 登录补拉云端待办/目标（2026-10-08 录前补洞 · 源码锁） ----------------
 * 背景：todos/goals 不在 AppState 里（memoStore 独立键），此前网页端登录只采纳
 * 「账号侧七个字段」，待办/目标从不下云 —— 全新浏览器登录后「待办 / 目标」页是空的。
 * 反向验证：删掉 CloudAccountCard 里的 fetchCloudMemo/writeCachedMemo 调用 → 本用例红。 */

test('源码锁：登录成功路径拉取云端待办/目标并写入本地缓存（防回归）', () => {
  const card = readFileSync(
    fileURLToPath(new URL('../src/features/cloudSync/CloudAccountCard.tsx', import.meta.url)),
    'utf8',
  );
  assert.match(card, /import \{[^}]*fetchCloudMemo[^}]*\} from '@\/features\/memo\/webMemo'/, '登录卡须引入 webMemo 的云端拉取');
  assert.match(card, /await fetchCloudMemo\(res\.token\)/, '登录成功后须以该账号 token 拉取云端待办/目标');
  assert.match(card, /writeCachedMemo\(memo\.data\)/, '拉到的待办/目标必须写入本地缓存（待办页与总览数字卡读的就是它）');
});
