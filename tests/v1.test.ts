/**
 * V1 —— 界面形态收口：成就常驻 / 满溢度 hover 详情 / 紧急度三档 / 换节奏提权 / 留白块
 * ============================================================
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §V1）：
 *   RV1 ← blankTaskFor 的 kind 改回 'activity' → 留白块用例红
 *   RV2 ← urgencyLevel 阈值位移 → 档位用例红
 *   RV3 ← AchievementPanel 从目标页撤下（或回流到周页）→ 源码断言红（2026-10-08 改锚，见下）
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

/**
 * ⚠️ 2026-10-08 改锚（Ray 周页批次接入）：周页拆组件后三处断言的落点：
 *   · AchievementPanel → GoalsPage（2026-10-08 CY 裁决：从周页迁目标页常驻）；
 *   · 「换个节奏」/「编辑」按钮 → WeekToolsPanel（操作条整体搬入）；
 *   · 留白块 blankTaskFor → WeekPlanView；满溢度 detail → WeekTimelineGrid 列头。
 * 语义（V1-1 常驻 / V1-4 顺序 / V1-5 留白实体+满溢度详情）不变。
 */
const WVSRC = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/WeekPlanView.tsx', import.meta.url)), 'utf8');
const PANELSRC = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/WeekToolsPanel.tsx', import.meta.url)), 'utf8');
const GRIDSRC = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/WeekTimelineGrid.tsx', import.meta.url)), 'utf8');
const GOALSSRC = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/activity/GoalsPage.tsx', import.meta.url)), 'utf8');

test('V1-1 源码（2026-10-08 改锚）: 投入与成就迁「目标页」常驻', () => {
  // CY 裁决（2026-10-08 截图）：成就面板从周页删去 —— 它已在「目标」页常驻（GoalsPage）。
  // 本用例把「常驻」的锚点从周页改到目标页，并断言周页不再挂（防回流）。
  assert.match(GOALSSRC(), /<AchievementPanel weekNo=\{weekNo\} termStart=\{schedule\.termStart\} \/>/, '目标页常驻投入与成就');
  assert.equal(WVSRC().includes('<AchievementPanel'), false, '周页不再挂成就面板（已迁目标页）');
});

test('V1-4 源码（2026-10-08 改锚）: 周页操作条按 Ray 设计收敛', () => {
  // CY 裁决：操作条 =「‹ › 回到今天 / 撤销 / 重做 / 调整」；编辑模式与一键还原下线/迁移，
  // 「换个节奏」不再占操作条（入口留总览 checklist 与导入完成弹窗）。
  const src = PANELSRC();
  assert.match(src, /data-testid="week-goto-today"/, '回到今天在位');
  assert.match(src, /data-testid="weekplan-prev-week"/, '换周 ‹ 在位');
  assert.match(src, /↩ 撤销/, '撤销在位');
  assert.match(src, /↪ 重做/, '重做在位');
  assert.match(src, /<Icon name="settings" size="xs" \/>调整/, '调整在位（Icon 图鉴）');
  assert.equal(src.includes('edit-mode-toggle'), false, '编辑模式开关已下线');
  assert.equal(src.includes('open-mode-setup'), false, '换个节奏不再占操作条');
});

test('V1-5 源码: onKeepGap 走 blankTaskFor 落层；满溢度传 detail', () => {
  const src = WVSRC();
  assert.match(src, /tasks: addTask\(prev\.tasks, blankTaskFor\(deleteAsk, weekNo\)\)/);
  assert.match(GRIDSRC(), /detail=\{\(\(\) => \{/);
});
