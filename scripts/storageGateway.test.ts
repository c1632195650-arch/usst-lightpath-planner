/**
 * r7 · 存储网关守护测试（D7，2026-10-24）
 * ============================================================
 * 网关是"只增不改"的新层（存量键读写路径零改动，storage.test.ts 8 条
 * 存量断言不动即是最直接的零回归证据）。这里守三件事：
 *   ① 登记表完整性：三个既有分片键都在册（主状态 + mobile 两键）；
 *   ② 未登记键拒绝：gwLoad/gwSave 对表外键不给服务（防新键再散一片）；
 *   ③ 读写容错：round-trip、坏 JSON 读回 null 不抛。
 * RV：摘掉 gwSave 的未登记检查 → ②恰红（实测留痕）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, gwLoad, gwSave, type StorageLike } from '@/lib/storageGateway';

/** 内存桩：与 localStorage 同构（测试不碰浏览器）。 */
function memStore(): StorageLike & { dump: Map<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: m,
  };
}

test('r7 · 登记表：三个既有分片键都在册（主状态 + mobile 两键）', () => {
  const keys = REGISTRY.map((e) => e.key);
  for (const k of ['usst-life-assistant-v2', 'usst.mobile.memoCache', 'usst.mobile.memoOwner']) {
    assert.ok(keys.includes(k), `登记表缺既有键 ${k}`);
  }
  // 登记表自身字段完备：键名全仓唯一、owner 非空、version ≥ 1
  assert.equal(new Set(keys).size, keys.length, '登记表键名重复');
  for (const e of REGISTRY) {
    assert.ok(e.owner.length > 0, `${e.key} 缺 owner（找不到负责人）`);
    assert.ok(e.version >= 1, `${e.key} version < 1`);
  }
});

test('r7 · 未登记键拒绝：gwLoad 返回 undefined、gwSave 返回 false（不静默服务）', () => {
  const s = memStore();
  assert.equal(gwLoad(s, 'usst.someNewFeature.v1'), undefined);
  assert.equal(gwSave(s, 'usst.someNewFeature.v1', { a: 1 }), false);
  assert.equal(s.dump.has('usst.someNewFeature.v1'), false, '被拒绝的键不应落盘');
});

test('r7 · 已登记键 round-trip + 坏 JSON 读回 null 不抛', () => {
  const s = memStore();
  assert.equal(gwSave(s, 'usst.mobile.memoCache', [{ id: 't1' }]), true);
  assert.deepEqual(gwLoad(s, 'usst.mobile.memoCache'), [{ id: 't1' }]);
  // 键不存在 → null；坏 JSON → null（与 storage.ts 的"不抛异常"纪律一致）
  assert.equal(gwLoad(s, 'usst.mobile.memoOwner'), null);
  s.setItem('usst.mobile.memoCache', 'not-json{');
  assert.equal(gwLoad(s, 'usst.mobile.memoCache'), null);
});
