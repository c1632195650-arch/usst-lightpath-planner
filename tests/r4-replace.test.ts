/**
 * R 批 P0-1 · R4 替换链路修复 —— 纯函数层 + 相位纪律测试
 * ============================================================
 * 任务书依据：outputs/R批任务书-交zcode-2026-10-02.md §三 P0-1（R4.1-R4.5）。
 * 根因（真机实录）：「把下周二的饭后消食替换成打篮球」→ ① 候选不看时间（周一
 * 同名块全进来）；② 候选回复被 LLM 抢答成 new_intent → 重问「大概占多久」。
 *
 * ⚠️ 反向验证（RV，红线 4）：
 *   RV-R4a ← 删 findCancelTargets 的 dayOfWeek 过滤分支 → 本文件「天过滤」用例红
 *   RV-R4b ← 删 validateDialogAct 的 picking 相位纪律 → 「相位纪律」用例红
 *   RV-R4c ← 删 LbaoChat 的 askPickDay 落点 → 源码断言红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  dayOfWeekFromReply,
  findCancelTargets,
  type CancelTarget,
} from '@/features/libao/weekPlanForChat';
import {
  pickingDayTopic,
  pickingTopic,
  validateDialogAct,
  type DialogTopic,
} from '@/features/libao/dialogManager';
import { classifyGoal, replacementAffinity } from '@/features/libao/taxonomy';
import type { TimeBlock } from '@/types';
import type { UserTask } from '@/lib/planner/templates';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

const block = (id: string, day: number, start: number, title: string, kind: TimeBlock['kind'] = 'activity'): TimeBlock =>
  ({ id, kind, dayOfWeek: day, startMin: start, endMin: start + 30, title } as TimeBlock);

const task = (id: string, title: string, day: number | undefined, weeks?: number[]): UserTask =>
  ({ id, title, durationMin: 30, ...(day != null ? { dayOfWeek: day } : {}), ...(weeks ? { weeks } : {}) } as UserTask);

/* ---------------- R4.1 · 候选带时间（day 维度过滤） ---------------- */

test('R4.1: findCancelTargets 天过滤 —— 「下周二的」只留周二的候选', () => {
  const tasks: UserTask[] = [task('t1', '饭后消食', 1), task('t2', '饭后消食', 2), task('t3', '饭后消食', 3)];
  const blocks: TimeBlock[] = [block('w12-d2-activity-a', 2, 780, '饭后消食')];
  const all = findCancelTargets('饭后消食', tasks, blocks);
  assert.equal(all.length, 4, '不加天过滤：周一/周二/周三同名待办 + 周二引擎块全在候选里（旧 bug 复现基线）');

  const tue = findCancelTargets('饭后消食', tasks, blocks, undefined, { dayOfWeek: 2 });
  assert.equal(tue.length, 2, 'dayOfWeek=2：只剩周二的待办与引擎块');
  assert.ok(tue.every((t) => t.dayOfWeek === 2), `候选全在周二：${tue.map((t) => t.hint).join('；')}`);
});

test('R4.1: 「不限天」的 user 任务在点了天的约束下不进候选（没法证明它在那天）', () => {
  const tasks: UserTask[] = [task('t1', '饭后消食', undefined)];
  const noFilter = findCancelTargets('饭后消食', tasks, []);
  assert.equal(noFilter.length, 1);
  const filtered = findCancelTargets('饭后消食', tasks, [], undefined, { dayOfWeek: 2 });
  assert.equal(filtered.length, 0, 'dayOfWeek=2：不限天任务被滤掉');
});

test('R4.1: 不传 opts 时行为与引入前逐位一致（cancel 老路径零漂移）', () => {
  const tasks: UserTask[] = [task('t1', '饭后消食', 1)];
  const blocks: TimeBlock[] = [block('w12-d1-activity-a', 1, 780, '饭后消食')];
  const out = findCancelTargets('饭后消食', tasks, blocks, { termStart: '2026-08-31', weekNo: 12 });
  assert.equal(out.length, 2);
  assert.ok(out[0].hint.includes('周一'), 'hint 仍带星期与日期');
});

/* ---------------- R4.5 · 按类目推荐替换目标 ---------------- */

test('R4.5: replacementAffinity —— 同类 2 > 双健康 1 > 无关 0', () => {
  assert.equal(replacementAffinity('打篮球', '篮球训练'), 2, '同为有氧类');
  assert.equal(replacementAffinity('打篮球', '饭后消食'), 1, '健康目标 × 健康习惯块（消食词表）');
  assert.equal(replacementAffinity('打篮球', '高数复习'), 0, '健康 × 学习无关');
  assert.equal(classifyGoal('打篮球'), 'sport-aerobic');
});

test('R4.5: findCancelTargets preferTitle —— 健康类目标时健康候选排前面', () => {
  const blocks: TimeBlock[] = [
    block('w12-d1-activity-hobby', 1, 840, '社团活动'),
    block('w12-d2-activity-sport', 2, 900, '篮球活动'),
  ];
  const out = findCancelTargets('活动', [], blocks, undefined, { preferTitle: '打篮球' });
  assert.equal(out.length, 2);
  assert.equal(out[0].title, '篮球活动', '同类（有氧）候选排第一');
  const neutral = findCancelTargets('活动', [], blocks);
  assert.equal(neutral[0].title, '社团活动', '不传 preferTitle：保持先待办后日程的原顺序');
});

/* ---------------- R4.2 · 两级收窄（先问哪一天，再问哪一段） ---------------- */

test('R4.2: dayOfWeekFromReply —— 「周二/星期三/周天」都能收窄成天', () => {
  assert.equal(dayOfWeekFromReply('周二'), 2);
  assert.equal(dayOfWeekFromReply('就星期三吧'), 3);
  assert.equal(dayOfWeekFromReply('周天'), 7);
  assert.equal(dayOfWeekFromReply('饭后消食'), null, '标题回复不是天词');
  assert.equal(dayOfWeekFromReply(''), null);
});

test('R4.2: pickingDayTopic 挂全量池并标 day 相；pickingTopic 标 segment 相', () => {
  const slots = { intent: 'replace' as const, title: '打篮球', missing: [], unclear: [], raw: '', certainty: 'unknown' as const };
  const pool: CancelTarget[] = [
    { taskId: 't1', title: '饭后消食', origin: 'user', hint: '周一 · 30 分钟', dayOfWeek: 1 },
    { taskId: 't2', title: '饭后消食', origin: 'user', hint: '周二 · 30 分钟', dayOfWeek: 2 },
    { taskId: 't3', title: '饭后消食', origin: 'user', hint: '周三 · 30 分钟', dayOfWeek: 3 },
    { taskId: 't4', title: '饭后消食', origin: 'user', hint: '周四 · 30 分钟', dayOfWeek: 4 },
    { taskId: 't5', title: '饭后消食', origin: 'user', hint: '周五 · 30 分钟', dayOfWeek: 5 },
    { taskId: 't6', title: '饭后消食', origin: 'user', hint: '周六 · 30 分钟', dayOfWeek: 6 },
  ];
  const dayTopic = pickingDayTopic('replace', slots, pool);
  assert.equal(dayTopic.phase, 'picking');
  assert.equal(dayTopic.pickStage, 'day');
  assert.equal(dayTopic.candidates?.length, 6, 'day 相挂全量池（天按钮要数天数）');

  const seg = pickingTopic('replace', slots, pool);
  assert.equal(seg.pickStage, 'segment');
  assert.equal(seg.candidates?.length, 5, 'segment 相沿用引入前的 5 条上限');
});

/* ---------------- R4.3 · 相位纪律（picking 相禁止 new_intent 接管） ---------------- */

const pickState = (): { topic: DialogTopic | null } => {
  const slots = { intent: 'replace' as const, title: '打篮球', missing: [], unclear: [], raw: '', certainty: 'unknown' as const };
  return {
    topic: pickingTopic('replace', slots, [
      { taskId: 't1', title: '饭后消食', origin: 'user', hint: '周二 · 30 分钟', dayOfWeek: 2 },
    ]),
  };
};

test('R4.3: picking 相位纪律 —— 只许 pick_candidate / discard_topic', () => {
  const st = pickState();
  const okPick = validateDialogAct('pick_candidate', { candidate_idx: 0 }, st);
  assert.equal(okPick, true, '挑块放行');
  assert.equal(validateDialogAct('discard_topic', {}, st), true, '放弃放行');

  // 根因封死：LLM 把候选回复裁成 new_intent → 白名单层一票拒绝
  assert.equal(validateDialogAct('new_intent', { intent: 'create' }, st), false, 'new_intent 在 picking 相被拒');
  assert.equal(validateDialogAct('ask_slot', { slot: 'effort' }, st), false, 'ask_slot 在 picking 相被拒');
  assert.equal(validateDialogAct('chit_chat', {}, st), false, 'chit_chat 在 picking 相被拒');
  assert.equal(validateDialogAct('confirm_draft', {}, st), false, 'confirm_draft 在 picking 相被拒');
});

test('R4.3: 非 picking 相位行为不变（collect 相 new_intent 照常放行）', () => {
  const slots = { intent: 'create' as const, title: '打篮球', missing: [], unclear: [], raw: '', certainty: 'unknown' as const };
  const st = { topic: pickingTopic('replace', slots, [{ taskId: 't1', title: 'X', origin: 'user' as const, hint: '' }]) };
  // 同一形状但相位改为 collect（transitionTopic 只换字段）
  const collectState = { topic: { ...st.topic!, phase: 'collect' as const, pickStage: undefined } };
  assert.equal(validateDialogAct('new_intent', { intent: 'create' }, collectState), true, 'collect 相不受纪律影响');
});

/* ---------------- 源码接线断言 ---------------- */

test('R4.4 源码: 挑块确定性匹配已提到 tryDialogAct 之前', () => {
  const chat = src('/src/features/libao/LbaoChat.tsx');
  const pickAt = chat.indexOf('if (clarifyPicking) {');
  const dialogAt = chat.indexOf('if (DIALOG_ENABLED && activeMode');
  assert.ok(pickAt >= 0 && dialogAt >= 0, '两个分支都在');
  assert.ok(pickAt < dialogAt, '确定性挑块必须先于 dialog 裁决主干（RV-R4c：换回旧顺序本断言红）');
});

test('R4.2 源码: 两级收窄落点在位（day 相问句 + pickingDayTopic 接线）', () => {
  const chat = src('/src/features/libao/LbaoChat.tsx');
  assert.match(chat, /askPickDay\('replace', slots, q, targets\)/, 'replace 多候选跨天 → 先问哪一天');
  assert.match(chat, /askPickDay\('cancel', slots, q, targets\)/, 'cancel 同口径');
  assert.match(chat, /pickingDayTopic\(kind, slots, targets\)/, 'day 相议题构造器接线');
  assert.match(chat, /topic\?\.pickStage === 'day'/, '挑块接续消费 day 相');
});
