/**
 * F15 常驻「正在进行」通知 · 接线守卫 —— tests/mobile-notify-ongoing.test.ts
 * ============================================================
 * 2026-10-08：CY 反馈「录制时要能体现有事件正在进行时的系统通知」——
 * 此前 showOngoing 已实现但**全仓无调用点**（不可演示），本轮接线：
 *   · notifyBridge：固定槽位 id（更新即替换）+ null 撤销（清待发 + 移通知栏已送达）
 *     + 动作按钮（完成 / 顺延 15 分，与两条软提醒同一套语义）；
 *   · useTodayData：同步成功后随 rescheduleToday 一起更新；
 *     前台每 60s 校对一次（块开始/结束自动切换）。
 *
 * 反向验证（严防假绿）：
 *   1. 把 pickOngoingBlock 改成恒返回 blocks[0] → 「窗口外为 null」三组红；
 *   2. 把 null 分支的 removeDeliveredNotifications 删掉 → ③ 红（常驻摘不掉）；
 *   3. 把 useTodayData 里的 showOngoing 调用删掉 → ④ 红（回到不可演示状态）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pickOngoingBlock } from '@/features/mobile/lib/notifyBridge.ts';
import type { TimeBlock } from '@/types';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', 'src', 'features', 'mobile');

function readSource(rel: string): string {
  let src = readFileSync(join(ROOT, rel), 'utf8');
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return src;
}

/** 最小块夹具（只喂 pickOngoingBlock 关心的字段） */
function blk(o: Partial<TimeBlock> & { id: string; startMin: number; endMin: number }): TimeBlock {
  return {
    kind: 'study',
    title: o.id,
    dayOfWeek: 1,
    ...o,
  } as TimeBlock;
}

/* ---------------- ① 时间窗纯函数 ---------------- */

test('pickOngoingBlock：窗口内命中 / 窗口外为 null（开始前、结束后、边界）', () => {
  const b = blk({ id: 'a', startMin: 600, endMin: 660 }); // 10:00–11:00
  assert.equal(pickOngoingBlock([b], 599)?.id, undefined, '开始前 1 分钟不出');
  assert.equal(pickOngoingBlock([b], 600)?.id, 'a', '开始时刻即命中（含左端）');
  assert.equal(pickOngoingBlock([b], 659)?.id, 'a', '结束前 1 分钟仍在进行');
  assert.equal(pickOngoingBlock([b], 660), null, '结束时刻即出（不含右端）');
  assert.equal(pickOngoingBlock([], 600), null, '空列表');
});

test('pickOngoingBlock：已标完成的当前块不出常驻；多个块取第一个进行中的', () => {
  const a = blk({ id: 'a', startMin: 600, endMin: 660 });
  const b = blk({ id: 'b', startMin: 620, endMin: 700 });
  assert.equal(pickOngoingBlock([a, b], 630)?.id, 'a', '重叠时取先者（列表顺序即优先级）');
  assert.equal(pickOngoingBlock([a, b], 630, new Set(['a']))?.id, 'b', 'a 已完成 → 顺延到 b');
  assert.equal(pickOngoingBlock([a], 630, new Set(['a'])), null, '当前块已完成 → 不出常驻');
  assert.equal(pickOngoingBlock([{ ...a, startMin: Number.NaN } as TimeBlock], 630), null, '坏数据不崩（NaN 不命中）');
});

/* ---------------- ② notifyBridge 发布/撤销语义（源码锁） ---------------- */

test('源码锁：showOngoing 固定槽位 + 撤销语义 + 动作按钮', () => {
  const src = readSource(join('lib', 'notifyBridge.ts'));
  assert.match(src, /ONGOING_NOTIF_ID\s*=\s*\d+/, '固定槽位 id 常量必须在位（单槽位：更新即替换）');
  assert.match(src, /id:\s*ONGOING_NOTIF_ID/, '发布必须用固定槽位 id');
  assert.match(src, /ongoing:\s*true/, '常驻标记（ongoing）不得丢');
  assert.match(src, /actionTypeId:\s*'block-actions'/, '常驻通知须带完成/顺延动作按钮（与软提醒同套语义）');
  assert.match(src, /removeDeliveredNotifications/, '撤销必须移除通知栏里已送达的那条（Android 上 cancel 摘不掉常驻）');
  assert.match(src, /LocalNotifications\.cancel\(\{\s*notifications:\s*\[\{\s*id:\s*ONGOING_NOTIF_ID/, '撤销必须清同槽位待发');
});

/* ---------------- ③ useTodayData 接线（源码锁） ---------------- */

test('源码锁：useTodayData 在同步后更新常驻 + 前台每分钟校对', () => {
  const src = readSource(join('lib', 'useTodayData.ts'));
  assert.match(src, /showOngoing\(pickOngoingBlock\(/, '同步成功后须更新常驻（与 rescheduleToday 同一节奏）');
  assert.match(src, /setInterval\(tick,\s*60_000\)/, '前台须每分钟校对（块开始/结束自动切换）');
  assert.match(src, /phaseRef\.current\s*!==\s*'ready'/, '数据未就绪不得误动常驻（防把上次会话的常驻误撤）');
});
