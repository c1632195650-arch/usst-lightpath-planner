/**
 * 批次 2（交互升级方案 2026-10-02）· 交互层：按钮卡 + 追问快捷项 + 反馈精简
 * ============================================================
 * 「能按钮不打字」的三类落点（5.2）与反馈精简 ≤6 行（5.4）。
 *
 * 互通性是本批的生命线：按钮点击 = send(value)，value 必须被既有解析层
 * 理解 —— parseIntentSlots（when/effort/place）或 parseOptionChoice（方案N）。
 * 「value 可解析」的断言即互通锁；解析规则日后演进时这里先红。
 *
 * ⚠️ 反向验证（reversed-verified，删改实测见 commit message）：
 *   · describeVerdict 删 top2 截断/排序 → 行数与「另有N处」断言红；
 *   · quickOptionsFor 的 place value 若解析不出地点（extractPlace 后缀回退）→ 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractPlace, parseIntentSlots, parseOptionChoice } from '@/features/libao/libaoIntent';
import {
  describeVerdict,
  quickOptionsFor,
  replanOptionButtons,
  tagLine,
  type GoalVerdict,
} from '@/features/libao/weekPlanForChat';
import type { IntentSlots } from '@/features/libao/libaoIntent';

const TODAY = '2026-09-07'; // 周一

function slotsOf(over: Partial<IntentSlots> = {}): IntentSlots {
  return {
    intent: 'create',
    title: '打篮球',
    certainty: 'window',
    priorityHint: 80,
    missing: [],
    unclear: [],
    raw: '打篮球',
    ...over,
  };
}

/* ============================================================
 * 一、quickOptionsFor：每个 value 都要能被规则层解析回来（互通锁）
 * ========================================================== */

test('when 快捷项 · 4 个 value 全部解析出 when，晚上项带晚上窗', () => {
  const opts = quickOptionsFor('when', slotsOf(), { today: TODAY });
  assert.ok(opts.length >= 3 && opts.length <= 4, `when 快捷项 3-4 个，实际 ${opts.length}`);
  for (const o of opts) {
    const s = parseIntentSlots(o.value, TODAY);
    assert.ok(s.when, `「${o.value}」应解析出 when`);
  }
  for (const o of opts.filter((o) => o.value.includes('晚上'))) {
    const s = parseIntentSlots(o.value, TODAY);
    assert.equal(s.window?.text, '晚上', `「${o.value}」应带晚上窗`);
  }
});

test('when 快捷项 · 周六已过（周日）→ 推「下周六」不推「这周六」', () => {
  const monday = quickOptionsFor('when', slotsOf(), { today: '2026-09-07' });
  assert.ok(monday.some((o) => o.value === '这周六晚上'));
  const sunday = quickOptionsFor('when', slotsOf(), { today: '2026-09-13' });
  assert.ok(sunday.some((o) => o.value === '下周六晚上'), `周日应推下周六，实际：${sunday.map((o) => o.value).join(',')}`);
});

test('effort 快捷项 · 单日事件给时长档位，value 全部解析回 durationMin', () => {
  const opts = quickOptionsFor('effort', slotsOf({ when: { text: '明天', kind: 'relative', relativeDays: 1 } }));
  assert.deepEqual(opts.map((o) => o.label), ['45 分钟', '60 分钟', '90 分钟', '2 小时']);
  const expect = [45, 60, 90, 120];
  opts.forEach((o, i) => {
    const s = parseIntentSlots(o.value, TODAY);
    assert.equal(s.durationMin, expect[i], `「${o.value}」应解析出 ${expect[i]} 分钟`);
  });
});

test('effort 快捷项 · 长期诉求给频率档位，value 解析回 perWeek（「每天30分钟」也要双槽齐）', () => {
  const opts = quickOptionsFor('effort', slotsOf({ when: { text: '九月中旬', kind: 'window', month: 9, decade: 'middle' } }));
  assert.equal(opts.length, 3);
  const s0 = parseIntentSlots('每周2次', TODAY);
  assert.equal(s0.perWeekCount, 2);
  const s1 = parseIntentSlots('每周4次', TODAY);
  assert.equal(s1.perWeekCount, 4);
  const s2 = parseIntentSlots('每天都来，每次30分钟', TODAY);
  assert.equal(s2.perWeekCount, 7, '「每天都来，每次30分钟」= 每周7次（批次1互斥不拦隔词形态）');
  assert.equal(s2.durationMin, 30);
});

test('place 快捷项 · value（在+地点）全部被 extractPlace 认得（批次2扩了 场/舍/房 后缀）', () => {
  const opts = quickOptionsFor('place', slotsOf());
  for (const o of opts) {
    const place = extractPlace(o.value);
    assert.ok(place, `「${o.value}」应解析出地点`);
    assert.equal(o.label, place, `label 与解析结果一致：${o.label} vs ${place}`);
  }
});

/* ============================================================
 * 二、协商按钮 ↔ parseOptionChoice 互通（编号兜底双保险）
 * ========================================================== */

test('replanOptionButtons · 「方案N」全部被 parseOptionChoice 确定性接住', () => {
  const buttons = replanOptionButtons([
    { label: '用「打篮球」换掉 周五(9.11) 15:00–16:00 的「图书馆自习」' },
    { label: '挪到下一周（2026-09-21 起）' },
    { label: '单次降到 45 分钟' },
  ]);
  buttons.forEach((b, i) => {
    assert.equal(parseOptionChoice(b.value, buttons.length), i + 1, `「${b.value}」应选中第 ${i + 1} 项`);
  });
  assert.equal(parseOptionChoice('方案4', 3), null, '越界编号不误接');
});

/* ============================================================
 * 三、describeVerdict 反馈精简：≤6 行、首条最相关、类型标签
 * ========================================================== */

function verdictOf(over: Partial<GoalVerdict>): GoalVerdict {
  return {
    kind: 'conflict',
    questions: [],
    added: [],
    studyDeltaMin: 0,
    placedCount: 0,
    candidateCount: 5,
    placedAt: [],
    caveats: [],
    reasons: [],
    ...over,
  };
}

test('反馈精简 · conflict：5 条挡路块按重叠度取 top2，行数 ≤6，不亮落点', () => {
  const v = verdictOf({
    caveats: ['你没说到什么时候为止，我按 21 天的窗口先铺了一版。', '没给地点 —— 转场时间按同校区估算。', '第三个口径。', '第四个口径。'],
    reasons: ['排进去会撞上硬冲突（重叠或转场来不及）—— 得换个时间或换个安排。'],
    placedAt: ['第2周 周五 15:00-16:00', '第2周 周日 15:00-16:00', '第3周 周五 15:00-16:00'],
    blockingBlocks: [
      { title: '低重叠', hint: '周五(9.11) 09:00–09:30', overlapMin: 10 },
      { title: '高重叠A', hint: '周五(9.11) 18:00–20:00', overlapMin: 120 },
      { title: '中重叠', hint: '周六(9.12) 19:00–20:00', overlapMin: 60 },
      { title: '高重叠B', hint: '周日(9.13) 18:00–20:00', overlapMin: 120 },
      { title: '零重叠', hint: '周一(9.14) 09:00–10:00', overlapMin: 0 },
    ],
  });
  const lines = describeVerdict(v);
  assert.ok(lines.length <= 6, `conflict 反馈应 ≤6 行，实际 ${lines.length}：${JSON.stringify(lines)}`);
  assert.ok(!lines.some((l) => l.includes('排到：')), 'blocked 不亮落点（版面让给卡点与选项）');
  // top2 = 重叠最大的两条（120 分钟），且并列时保持稳定序
  assert.ok(lines.some((l) => l.includes('高重叠A')));
  assert.ok(lines.some((l) => l.includes('高重叠B')));
  assert.ok(!lines.some((l) => l.includes('低重叠')));
  assert.ok(lines.some((l) => l.includes('另有 3 处时段被占')), `应有汇总行：${JSON.stringify(lines)}`);
  // 口径合并成一行
  assert.equal(lines.filter((l) => l.includes('窗口')).length, 1);
  assert.ok(lines[0].includes('；'), '口径应合并成一行（分号连接）');
});

test('反馈精简 · ok：落点最多 2 条 + 汇总行，行数 ≤6', () => {
  const v = verdictOf({
    kind: 'ok',
    placedAt: ['第2周 周五 15:00-16:00', '第2周 周日 15:00-16:00', '第3周 周五 15:00-16:00'],
    reasons: ['排得下，没有新增冲突。'],
  });
  const lines = describeVerdict(v);
  assert.ok(lines.length <= 6, `ok 反馈应 ≤6 行，实际 ${lines.length}`);
  assert.equal(lines.filter((l) => l.includes('排到：')).length, 2);
  assert.ok(lines.some((l) => l.includes('另有 1 块排在后面的周')));
});

test('类型标签 · 转场→🚶、挤自习→📦、硬冲突→⏰（tagLine 映射）', () => {
  assert.match(tagLine('· 转场来不及，得换近一点的'), /🚶 转场不够/);
  assert.match(tagLine('· 会挤掉约 90 分钟自习'), /📦 量放不下/);
  assert.match(tagLine('· 排进去会撞上硬冲突'), /⏰ 时间撞/);
  assert.match(tagLine('· 排得下，没有新增冲突。'), /^· 排得下/, '无关文案不加标签');
});

/* ============================================================
 * 四、源码锁：LbaoChat 渲染按钮卡并接 send(value)
 * ========================================================== */

test('源码锁 · 按钮卡渲染 + send(value) + 追问/候选六处接线', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'src', 'features', 'libao', 'LbaoChat.tsx'), 'utf8');
  assert.ok(src.includes('data-testid="msg-options"'), '应有按钮卡容器');
  assert.match(src, /message\.options\.map\(\(o, i\) =>/, '应渲染 options 列表');
  assert.match(src, /send\(o\.value\)/, '点击应发出 value');
  assert.ok(src.includes('都不合适？直接打字告诉我就行'), '必须保留自由输入的引导（自定义空间）');
  const wiringCount = (src.match(/quickOptionsFor\(/g) ?? []).length;
  assert.ok(wiringCount >= 5, `追问快捷项应接到 ≥5 处（4 处追问 + 1 处 import），实际 ${wiringCount}`);
  const candCount = (src.match(/value: t\.title|value: o\.title|value: b\.title/g) ?? []).length;
  assert.ok(candCount >= 5, `候选按钮应接到 ≥5 处（cancel/reschedule/replace/两处重列），实际 ${candCount}`);
});
