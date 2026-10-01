/**
 * persistence.ts 双写持久化层的可测部分（Node 无 localStorage / fetch，
 * 因此只测纯函数与登记口径 —— 与本仓「抽纯函数」的测试惯例一致）。
 * 集成行为（HTTP 往返 / 回灌合并）由 T7 手测清单覆盖。
 *
 * 覆盖：
 *   ① cloudKeys() = 登记表 − legacy，且 legacy 恒为 2（新增 key 时只改 REGISTERED_TOTAL）
 *   ② jsonSame：键序无关的深度相等 / 嵌套数组对象 / 不等情形 / 脏串回落
 *   ③ serve.py 的 WRITABLE_KEYS ⊇ cloudKeys() —— 服务端白名单与前端登记表必须一致
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cloudKeys, jsonSame } from '@/lib/persistence';
import { STORAGE_KEY_LIST, metaOf } from '@/lib/storageRegistry';

/**
 * 登记表总数（新增 localStorage key 时**只改这一个数**）。
 * 它同时是三处的一致性锚点：本文件 / `lib/persistence.cloudKeys()` / `serve.py WRITABLE_KEYS`。
 * 2026-09-27：14 → 16（+`usst.libao.basic_info`，+`usst.libao.chat.*` 与 `deadlines` 属 LbaoChat 线，
 * 见其各自登记项）。
 * 2026-10-01：16 → 17（+`usst.local_owner.v1`，localOnly 本机专属、不入库）。
 */
const REGISTERED_TOTAL = 17;

test('① cloudKeys：legacy 只迁不写、localOnly 只写本机，其余登记 key 全部可入库', () => {
  const keys = cloudKeys();
  const legacy = STORAGE_KEY_LIST.filter((k) => metaOf(k)?.legacy);
  const localOnly = STORAGE_KEY_LIST.filter((k) => metaOf(k)?.localOnly);
  assert.equal(STORAGE_KEY_LIST.length, REGISTERED_TOTAL, '登记表总数变了 → 改 REGISTERED_TOTAL');
  assert.equal(legacy.length, 2, 'legacy 恒为 2（assignments / plan-edits），新增 legacy 要显式改这里');
  assert.equal(localOnly.length, 1, 'localOnly 恒为 1（local_owner），新增 localOnly 要显式改这里');
  assert.equal(
    keys.length,
    REGISTERED_TOTAL - legacy.length - localOnly.length,
    '可入库 = 登记总数 − legacy 数 − localOnly 数',
  );
  assert.ok(!keys.includes('usst-assignments-v1'), 'legacy assignments 不入库');
  assert.ok(!keys.includes('usst-plan-edits-v1'), 'legacy plan-edits 不入库');
  assert.ok(!keys.includes('usst.local_owner.v1'), '本机归属标记不上云（上云会跨账号/跨设备串号）');
  // 点号风格四条必须在列
  assert.ok(keys.includes('usst.telemetry.v1'));
  assert.ok(keys.includes('usst.libao.user_id'));
  assert.ok(keys.includes('usst.libao.session_id'));
  assert.ok(keys.includes('usst.libao.basic_info'), 'WP1 基础信息前置：必须可入库');
  // 主存储必须在列
  assert.ok(keys.includes('usst-life-assistant-v2'));
});

test('③ serve.py 的 WRITABLE_KEYS 必须覆盖 cloudKeys()（前端登记了、服务端不认 = 静默丢同步）', () => {
  const servePy = join(dirname(fileURLToPath(import.meta.url)), '..', 'serve.py');
  const src = readFileSync(servePy, 'utf8');
  const block = src.match(/WRITABLE_KEYS\s*=\s*frozenset\(\{([\s\S]*?)\}\)/);
  assert.ok(block, 'serve.py 里没找到 WRITABLE_KEYS = frozenset({...})');
  const serverKeys = new Set(block[1].match(/'[^']+'|"[^"]+"/g)?.map((s) => s.slice(1, -1)) ?? []);
  const missing = cloudKeys().filter((k) => !serverKeys.has(k));
  assert.deepEqual(
    missing,
    [],
    `serve.py 的 WRITABLE_KEYS 缺这些 key（会被 400 拒绝且前端静默降级）：\n${missing.join('\n')}`,
  );
});

test('② jsonSame：键序无关、嵌套结构、不等与脏串回落', () => {
  assert.ok(jsonSame('{"a":1,"b":2}', '{"b":2,"a":1}'), '键序无关');
  assert.ok(jsonSame('{"a":{"x":[1,2],"y":"z"}}', '{"a":{"y":"z","x":[1,2]}}'), '嵌套深度');
  assert.ok(jsonSame('"1"', '"1"'), '字符串值');
  assert.ok(!jsonSame('{"a":1}', '{"a":2}'), '值不同');
  assert.ok(!jsonSame('{"a":1}', '{"a":1,"b":null}'), '缺键不算相等');
  assert.ok(!jsonSame('[1,2]', '[2,1]'), '数组序敏感');
  assert.ok(jsonSame('raw-a', 'raw-a'), '脏串相同');
  assert.ok(!jsonSame('raw-a', 'raw-b'), '脏串不同');
});
