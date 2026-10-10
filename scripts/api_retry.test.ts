/**
 * 维护批 P1-3（2026-10-11）· api.ts 统一超时 + 幂等 GET 单次重试测试
 * ==================================================================
 * 覆盖（可编程 fetch 桩，同 libao-understand-retry.test.ts 惯例）：
 *   [1] GET 首次 200 → 恰好 1 次调用（不误重试）；
 *   [2] GET 503→200 → 单次重试后成功，共 2 次调用；
 *   [3] GET 网络异常→200 → 重试成功；
 *   [4] GET 连续 503 → 恰好重试 1 次（共 2 次）后按原契约 throw `HTTP 503`；
 *   [5] POST 网络异常 → **不重试**（非幂等），恰好 1 次调用后 throw；
 *   [6] GET/POST 都带 AbortSignal（超时闸存在的证据）。
 *
 * RV 反向验证：把 api.ts get() 里的两处「单次重试」摘掉 → [2][3][4] 红；
 * 把 timeoutSignal() 摘掉 → [6] 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lbaoHealth, resetMemory } from '@/lib/api';

type FetchStep = (() => { status: number; body?: unknown; throwNetwork?: boolean });

function stubFetch(script: FetchStep[]): { calls: () => number; inits: () => RequestInit[]; restore: () => void } {
  const orig = globalThis.fetch;
  let i = 0;
  const inits: RequestInit[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    inits.push(init ?? {});
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (step().throwNetwork) throw new TypeError('fetch failed (simulated)');
    const { status, body } = step();
    return new Response(JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    calls: () => i,
    inits: () => inits,
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

test('GET 首次 200：恰好 1 次调用', async () => {
  const s = stubFetch([() => ({ status: 200, body: { ok: true } })]);
  try {
    const r = await lbaoHealth();
    assert.equal(r.ok, true);
    assert.equal(s.calls(), 1, '成功不应重试');
  } finally {
    s.restore();
  }
});

test('GET 503→200：幂等单次重试成功', async () => {
  const s = stubFetch([
    () => ({ status: 503 }),
    () => ({ status: 200, body: { ok: true } }),
  ]);
  try {
    const r = await lbaoHealth();
    assert.equal(r.ok, true);
    assert.equal(s.calls(), 2, '503 应触发恰好一次重试');
  } finally {
    s.restore();
  }
});

test('GET 网络异常→200：重试成功', async () => {
  const s = stubFetch([
    () => ({ throwNetwork: true }),
    () => ({ status: 200, body: { ok: true } }),
  ]);
  try {
    const r = await lbaoHealth();
    assert.equal(r.ok, true);
    assert.equal(s.calls(), 2);
  } finally {
    s.restore();
  }
});

test('GET 连续 503：重试恰一次后按原契约 throw HTTP 503', async () => {
  const s = stubFetch([() => ({ status: 503 })]);
  try {
    await assert.rejects(lbaoHealth(), /HTTP 503/);
    assert.equal(s.calls(), 2, '只重试一次，共 2 次调用');
  } finally {
    s.restore();
  }
});

test('POST 网络异常：不重试（非幂等），直接 throw', async () => {
  const s = stubFetch([() => ({ throwNetwork: true })]);
  try {
    await assert.rejects(resetMemory({ userId: 'u-t', sessionId: 's-t' }));
    assert.equal(s.calls(), 1, 'POST 绝不自动重发');
  } finally {
    s.restore();
  }
});

test('GET/POST 都携带 AbortSignal（超时闸存在）', async () => {
  const s = stubFetch([() => ({ status: 200, body: { ok: true } })]);
  try {
    await lbaoHealth();
    await resetMemory({ userId: 'u-t', sessionId: 's-t' }).catch(() => undefined);
    const [getInit, postInit] = s.inits();
    assert.ok(getInit?.signal instanceof AbortSignal, 'GET 应带超时 signal');
    assert.ok(postInit?.signal instanceof AbortSignal, 'POST 应带超时 signal');
  } finally {
    s.restore();
  }
});
