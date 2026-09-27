/**
 * V1 —— 界面形态收口：成就常驻 / 满溢度 hover 详情 / 紧急度三档 / 换节奏提权 / 留白块
 * ============================================================
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §V1）：
 *   RV1 ← blankTaskFor 的 kind 改回 'activity' → 留白块用例红
 *   RV2 ← urgencyLevel 阈值位移 → 档位用例红
 *   RV3 ← AchievementPanel 挪回 editMode 包裹内 → 源码断言红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blankTaskFor } from '@/features/week/userPlanStore';
import { dayBreakdown, daySaturation } from '@/features/week/saturation';
import { urgencyLevel } from '@/features/calendar/deadlineStore';
import type { TimeBlock } from '@/types';

const block = (id: string, start: number, end: number, kind: TimeBlock['kind'] = 'study'): TimeBlock =>
  ({ id, kind, dayOfWeek: 1, startMin: start, endMin: end, title: id } as TimeBlock);

/* ---- V1-2: dayBreakdown ---- */

test('V1-2: dayBreakdown 分类分钟（课程/自习/活动/留白各归各类）', () => {
  const blocks = [
    block('c', 480, 600, 'course'),
    block('s', 600, 660, 'study'),
    block('a', 660, 720, 'activity'),
    block('b', 720, 780, 'blank'),
  ];
  const d = dayBreakdown(blocks);
  assert.deepEqual(d, { courseMin: 120, studyMin: 60, activityMin: 60, blankMin: 60 });
});

/* ---- V1-3: urgencyLevel 三档 ---- */

test('V1-3: urgencyLevel ≤3 红 / ≤7 橙 / 其余灰；边界值钉死', () => {
  // 反向：阈值位移 → 本用例红
  assert.equal(urgencyLevel(0), 'red');
  assert.equal(urgencyLevel(3), 'red');
  assert.equal(urgencyLevel(4), 'orange');
  assert.equal(urgencyLevel(7), 'orange');
  assert.equal(urgencyLevel(8), 'gray');
  assert.equal(urgencyLevel(30), 'gray');
});

/* ---- V1-5: blankTaskFor（留白块实体） ---- */

test('V1-5: blankTaskFor 产出 kind=blank 的固定任务，钉原时段', () => {
  // 反向：kind 改回 'activity' → 本用例红
  const t = blankTaskFor({ title: '篮球局', day: 3, startMin: 600, endMin: 720 }, 5);
  assert.equal(t.kind, 'blank', '必须生成 blank 块（与远方模式同一 kind，视觉语义一致）');
  assert.equal(t.title, '留白');
  assert.equal(t.dayOfWeek, 3);
  assert.equal(t.startMin, 600);
  assert.equal(t.durationMin, 120);
  assert.deepEqual(t.weeks, [5]);
  assert.ok((t.durationMin ?? 0) >= 30, '最短 30 分钟保底');
});

test('V1-5: blank 不进满溢度 occupied（留白不算「用户排的」）', () => {
  const sat = daySaturation([block('b', 480, 720, 'blank')], 7 * 60, 23 * 60);
  assert.equal(sat.occupiedMin, 0, '留白块不计 occupied');
});

/* ---- 源码接线断言 ---- */

const WVSRC = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/WeekPlanView.tsx', import.meta.url)), 'utf8');

test('V1-1 源码: AchievementPanel 在 editMode 包裹之外常驻', () => {
  // 反向：挪回包裹内 → 本用例红
  const src = WVSRC();
  const closeGate = src.indexOf('      )}\n\n      {/* V1-1');
  const panel = src.indexOf('<AchievementPanel key={activityVersion}');
  assert.ok(closeGate >= 0 && panel > closeGate, 'AchievementPanel 必须在 editMode 门闭合之后');
  // 且包裹内不再有第二份
  const gateStart = src.indexOf('{editMode && (');
  const gateEnd = closeGate;
  assert.equal(src.slice(gateStart, gateEnd).includes('<AchievementPanel'), false);
});

test('V1-4 源码: 「换个节奏」在编辑按钮之前（第一顺位）', () => {
  const src = WVSRC();
  const modeBtn = src.indexOf('data-testid="open-mode-setup"');
  const editBtn = src.indexOf('data-testid="edit-mode-toggle"');
  assert.ok(modeBtn >= 0 && editBtn > modeBtn, '换节奏必须在编辑按钮前面');
});

test('V1-5 源码: onKeepGap 走 blankTaskFor 落层；满溢度传 detail', () => {
  const src = WVSRC();
  assert.match(src, /tasks: addTask\(prev\.tasks, blankTaskFor\(deleteAsk, weekNo\)\)/);
  assert.match(src, /detail=\{\(\(\) => \{/);
});
