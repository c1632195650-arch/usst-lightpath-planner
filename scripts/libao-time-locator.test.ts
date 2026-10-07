/**
 * 按确切时间定位测试（2026-10-07，缺口②：梨宝根据确切时间进行替换/删除/挪动）
 * ============================================================
 * 守的规则：
 *   1. 冒号钟点：「14:00」「14:00到15:30」→ ClockHint 840/930（课表口 24h 制）
 *   2. 定位时间抽取：move/replace 旧时间在动词前、cancel 在动词后
 *   3. missingSlots 放宽：只有定位时间（没说块名）不再追问 target
 *   4. 一步到位：runReschedule 的钟点优先级（clock.startMin 最高）在槽位层验证
 *
 * ⚠️ 反向验证：删 extractTargetWhen / 冒号原子分支 / missingSlots 的放宽，用例逐组变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClockRange, extractTarget, extractTargetWhen, missingSlots, parseIntentSlots } from '@/features/libao/libaoIntent';

test('冒号钟点：14:00 直落 840（24h 制不歧义），14:00到15:30 产区间', () => {
  const single = extractClockRange('14:00 开个短会');
  assert.ok(single, '冒号钟点被抽到');
  assert.equal(single!.startMin, 840);
  assert.equal(single!.ambig, undefined, '14 点无 24h 歧义');

  const range = extractClockRange('周三 14:00到15:30 的自习');
  assert.ok(range);
  assert.equal(range!.startMin, 840);
  assert.equal(range!.endMin, 930);

  const half = extractClockRange('21:30 开会');
  assert.ok(half);
  assert.equal(half!.startMin, 21 * 60 + 30);
});

test('定位时间抽取：replace/move 取动词前，cancel 取动词后', () => {
  // replace：「把周三14:00的自习换成周五15:00」→ 定位段 = 动词前
  const r = extractTargetWhen('把周三14:00的自习换成周五15:00', 'before-verb');
  assert.ok(r);
  assert.equal(r.day, 3);
  assert.equal(r.clock?.startMin, 840);

  // cancel：「删掉周三下午两点那个自习」→ 定位段 = 动词后
  const c = extractTargetWhen('删掉周三下午两点那个自习', 'after-verb');
  assert.ok(c);
  assert.equal(c.day, 3);
  assert.equal(c.clock?.startMin, 14 * 60, '「下午两点」语境提升到 14:00');

  // 老句式不误产定位时间：「把高数复习挪到周四」（只有新时间）
  const old = extractTargetWhen('把高数复习挪到周四', 'before-verb');
  assert.equal(old, undefined, '动词前没有时间 → undefined（新时间不受影响）');
});

test('extractTarget 认带时间的把字句/删除句（此前只有冒号形态会被阻断）', () => {
  assert.equal(extractTarget('把周三14:00的自习换成周五15:00'), '自习', '冒号此前阻断连续捕获，由剥时间通道接住');
  // 「的」是汉字、本就在老正则字符类内 —— 全串捕获，与块标题互含匹配（老行为不变）
  assert.equal(extractTarget('把周三下午的自习挪到周五'), '周三下午的自习');
  assert.equal(extractTarget('删掉周三下午两点那个自习'), '周三下午两点那个自习');
  assert.equal(extractTarget('把高数复习挪到周四'), '高数复习', '老句式行为不变');
});

test('missingSlots 放宽：纯时间定位（没说块名）不再追问 target', () => {
  const s = parseIntentSlots('删掉周三下午两点那个自习');
  assert.equal(s.intent, 'cancel');
  assert.equal(s.targetDay, 3);
  assert.equal(s.targetClock?.startMin, 840);
  assert.equal(s.missing.includes('target'), false, '有时间定位就够，不再问「你要动的是哪一块」');

  const s2 = parseIntentSlots('把周三14:00的自习换成周五15:00');
  assert.equal(s2.intent, 'replace');
  assert.equal(s2.targetDay, 3);
  assert.equal(s2.targetClock?.startMin, 840);
  assert.equal(s2.when?.weekday, 5, '新时间（周五）在 when');
  assert.equal(s2.clock?.startMin, 900, '新钟点（15:00）在 clock —— 与 targetClock 严格分开');
});

test('老路径回归：只有块名没时间时行为与此前一致', () => {
  const s = parseIntentSlots('取消高数复习');
  assert.equal(s.targetHint, '高数复习');
  assert.equal(s.targetDay, undefined);
  assert.equal(s.targetClock, undefined);
  assert.equal(s.missing.includes('target'), false);

  const s2 = parseIntentSlots('取消它');
  assert.equal(s2.missing.includes('target'), true, '块名抽不到、也没时间 → 仍追问（老行为）');
});
