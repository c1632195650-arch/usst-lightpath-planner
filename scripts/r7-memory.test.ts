/**
 * R 批 P1-3 · R7 梨宝记忆 —— 空态解释 + 长期偏好入记忆（源码锁）
 * ============================================================
 * CY 走查实录：「梨宝的记忆」面板 待你确认（0）· 已生效（0）—— 界面不解释
 * 为什么是 0，看起来像坏了；纯排程也不产记忆条目。
 *
 * ⚠️ 反向验证（RV）：
 *   RV-R7a ← 删 memory.py::add_preference_fact 或 app.py 的 preference 分支 → 用例二红
 *   RV-R7b ← 删 LbaoChat 的长期偏好写入块 → 用例二红
 * 本仓无 jsdom，接线用源码字面量断言；服务端逻辑由 scripts/test_memory_facts.py
 * （需活后端）覆盖，此处锁通道存在性与口径。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('R7.2 源码锁: MemoryPanel 空态解释「为什么是 0」（身份/课表/长期偏好去哪儿了）', () => {
  const s = read('/src/features/libao/MemoryPanel.tsx');
  assert.match(s, /还没有待确认的记忆/, '待确认空态解释');
  assert.match(s, /年级 \/ 学院 \/ 专业/, '空态说明身份信息来源');
  assert.match(s, /导入课表的/, '空态说明课表来源');
  assert.match(s, /还没有已生效的记忆/, '已生效空态解释');
  assert.match(s, /长期偏好/, '空态说明长期偏好也会进这里（R7.3）');
});

test('R7.3 源码锁: 长期偏好入记忆通道在位（server / api / LbaoChat 三段）', () => {
  // 服务端：preference 类自动生效（与 objective 的 pending 闸刻意相反），key 限前缀
  const mem = read('/server/memory.py');
  assert.match(mem, /def add_preference_fact/, 'memory.add_preference_fact 在位');
  assert.match(mem, /"preference", key, str\(value\)\[:200\], "applied"/, '偏好直落 applied（自动生效）');
  assert.match(mem, /_merge_into_profile\(user_id, row\["key"\], row\["value"\]\)/, '并入画像');

  const app = read('/server/app.py');
  assert.match(app, /kind: str = "objective"/, 'MemoryFactReq 带 kind（缺省旧口径）');
  assert.match(app, /body\.key\.startswith\("preferences\."\)/, 'key 限 preferences. 前缀');

  // 前端：api 封装 + 确认落盘时写入（只认长期信号）
  const api = read('/src/lib/api.ts');
  assert.match(api, /export function addPreferenceFact/, 'api.addPreferenceFact 在位');
  assert.match(api, /kind: 'preference'/);

  const chat = read('/src/features/libao/LbaoChat.tsx');
  assert.match(chat, /addPreferenceFact\(identity\.userId, g\.title/, 'confirmGoal create 路径写入记忆');
  assert.match(chat, /s\.perWeekCount != null \|\| s\.when\?\.recurring/, '只认长期信号（每周N次 / 每周X）');
  assert.match(chat, /\.catch\(\(\) => \{ \/\* 记忆服务未连接：静默降级 \*\/ \}\)/, '失败静默（排程本体不受影响）');
  // L4 边界不回退：偏好只是「记」，不动日程 —— 写入点必须在落盘之后（saveUserPlan 之后的代码段）
  const writeAt = chat.indexOf('addPreferenceFact(identity.userId');
  const saveAt = chat.indexOf('saveUserPlan(nextLayer);', chat.indexOf('create（原有路径）'));
  assert.ok(writeAt > saveAt, '记忆写入在日程落盘之后（不替代落盘，L4 不变）');
});
