/**
 * 维护批 P1-2（2026-10-11）· ErrorBoundary + 全局错误监听测试
 * ===========================================================
 * 覆盖：
 *   [1] errorCopy 纯函数：Error / 字符串 / 空值三态，detail 截断；
 *   [2] globalErrors：安装幂等、error 与 unhandledrejection 都进环形缓冲、
 *       超限挤旧、reset 清空；
 *   [3] 源码锁：两个入口必须包 <AppErrorBoundary> 且安装全局监听
 *       （RV：把 main.tsx 的包装摘掉 → 本用例红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { errorCopy } from '@/components/errorCopy';
import {
  installGlobalErrorHandlers,
  recordError,
  getErrorRing,
  resetErrorRing,
} from '@/lib/globalErrors';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* ---------------- [1] errorCopy ---------------- */

test('errorCopy：Error 实例取 message', () => {
  const c = errorCopy(new Error('boom-123'));
  assert.equal(c.title, '页面出了点小问题');
  assert.ok(c.detail.includes('boom-123'));
});

test('errorCopy：字符串 / 空值兜底；超长截断到 160', () => {
  assert.equal(errorCopy('plain').detail, 'plain');
  assert.equal(errorCopy(undefined).detail, '未知错误');
  const long = errorCopy(new Error('x'.repeat(500)));
  assert.ok(long.detail.length <= 160, `detail 应截断，实际 ${long.detail.length}`);
});

/* ---------------- [2] globalErrors ---------------- */

type Listener = (e: unknown) => void;

function installWindowStub() {
  const listeners = new Map<string, Listener[]>();
  const stub = {
    addEventListener: (t: string, fn: Listener) => {
      listeners.set(t, [...(listeners.get(t) ?? []), fn]);
    },
  };
  (globalThis as Record<string, unknown>).window = stub;
  return listeners;
}

test('installGlobalErrorHandlers：error / unhandledrejection 都记录，且幂等', () => {
  resetErrorRing();
  const listeners = installWindowStub();
  installGlobalErrorHandlers();
  installGlobalErrorHandlers(); // 幂等：第二次不重复挂
  assert.equal(listeners.get('error')?.length, 1, 'error 监听应恰好挂一个');
  assert.equal(listeners.get('unhandledrejection')?.length, 1, 'rejection 监听应恰好挂一个');

  (listeners.get('error') as Listener[])[0]({ message: 'sync-boom' });
  (listeners.get('unhandledrejection') as Listener[])[0]({ reason: new Error('rej-boom') });
  const ring = getErrorRing();
  assert.equal(ring.length, 2);
  assert.equal(ring[0].kind, 'error');
  assert.ok(ring[0].message.includes('sync-boom'));
  assert.equal(ring[1].kind, 'unhandledrejection');
  assert.ok(ring[1].message.includes('rej-boom'));
});

test('recordError：环形缓冲超限挤掉最旧', () => {
  resetErrorRing();
  for (let i = 0; i < 25; i++) recordError('error', `e${i}`);
  const ring = getErrorRing();
  assert.equal(ring.length, 20, '上限 20');
  assert.ok(ring[0].message.includes('e5'), '最旧的 e0..e4 被挤掉');
  assert.ok(ring[19].message.includes('e24'));
  resetErrorRing();
  assert.equal(getErrorRing().length, 0);
});

/* ---------------- [3] 源码锁 ---------------- */

test('两个入口都包了 AppErrorBoundary 并安装全局监听（RV 源码锁）', () => {
  const web = readFileSync(join(ROOT, 'src', 'main.tsx'), 'utf-8');
  const mobile = readFileSync(join(ROOT, 'src', 'features', 'mobile', 'main.tsx'), 'utf-8');
  assert.ok(web.includes('<AppErrorBoundary>'), 'web 入口缺错误边界');
  assert.ok(web.includes('installGlobalErrorHandlers()'), 'web 入口缺全局监听安装');
  assert.ok(mobile.includes('<AppErrorBoundary>'), 'mobile 入口缺错误边界');
  assert.ok(mobile.includes('installGlobalErrorHandlers()'), 'mobile 入口缺全局监听安装');
});
