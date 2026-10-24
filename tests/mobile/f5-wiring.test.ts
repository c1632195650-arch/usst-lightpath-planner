/**
 * F5 接线①②验收（2026-10-25）
 * ============================================================
 * 接线①：MorningCard 自动取 deadlineStore（用户重要日 ∪ 静态校历）72h 窗——
 *   调用方不传 deadlines 时自动补（传了则尊重调用方）。
 * 接线②：useTodayData 同步成功 → scheduleBriefs（晨报+截止提醒，确定性 id 幂等）。
 * 源码锁风格（与既有守护同族），RV：摘接线 → 恰红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcOf = (rel: string) => readFileSync(join(here, rel), 'utf8');

test('F5-接① MorningCard：自动取 deadlineStore 的 upcoming 72h（不传 deadlines 时）', () => {
  const mc = srcOf('../../src/features/mobile/MorningCard.tsx');
  assert.match(mc, /loadUserDeadlines, mergeDeadlines, upcomingDeadlines/, '读 deadlineStore 三件');
  assert.match(mc, /props\.deadlines \?\? autoDeadlines/, '调用方显式传参优先，缺省自动取');
  assert.match(mc, /daysLeft >= -3 && daysLeft <= 3/, '72h 窗与 morningBrief WARN_WINDOW 同口径');
});

test('F5-接② useTodayData：同步成功后排晨报+截止提醒（确定性 id 幂等）', () => {
  const td = srcOf('../../src/features/mobile/lib/useTodayData.ts');
  assert.match(td, /planBriefNotifications, scheduleBriefs/, '通知扩展已 import');
  assert.match(td, /void scheduleBriefs\(planBriefNotifications\(brief, briefDeadlinesOf\(todayIso\), todayIso\)\)/, '同步成功 → 排程');
  assert.match(td, /briefDeadlinesOf/, 'deadlineStore → 提醒信号的共用通道');
  assert.match(td, /晨报排程失败不影响主流程/, '失败兜底（与块通知同口径）');
});
