/**
 * R批触发点①（2026-10-06 收官批次 P0-1b）· 梨宝侧「让梨宝评估这一版」源码锁
 * ============================================================
 * 缺口：用户在对话里确认完日程（confirmGoal 落盘）想听评价，没有任何入口。
 * 修复：confirmGoal 六类落盘成功的回执带 `evalAsk` → 渲染「让梨宝评估这一版」
 * 按钮 → 展开**复用**的 PlanEvalPanel（不另写 UI，任务书红线）。
 *
 * 接缝纪律（AGENTS.md 红线 6）：评估引擎逻辑（digestPlan/evaluateDigest）只在
 * weekPlanForChat 接缝里包一层（evaluatePlanForChat），LbaoChat 禁止直引
 * lib/planner —— 本文件同时锁正向（glue 在接缝）与负向（对话组件零直引）。
 *
 * L4 红线：采纳（onAdopt）只进重排草稿流（layer.tasks + usst:replan），
 * 不直接改已排日程 —— 锁「重排后生效」note 与 replan 广播在位。
 *
 * .tsx 渲染不被 node 测试加载器支持（icsHint 同款口径）→ 用源码锁；
 * 真实点击动线由 e2e/mobile-smoke.spec.ts 覆盖（P0-1c）。
 *
 * ⚠️ 反向验证（RV，红线 4）：摘掉 chat-eval-entry 按钮 → 本文件恰 1 红；
 *   还原后 sha256 与提交版一致（实跑记录见 overnight-log / 台账）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

/** 剥行注释与块注释（防「写在注释里骗测试」，icsHint 同款口径） */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('触发点① 源码锁: LbaoChat 回执区有「让梨宝评估这一版」入口并复用 PlanEvalPanel', () => {
  const chat = stripComments(src('/src/features/libao/LbaoChat.tsx'));
  assert.ok(chat.includes('PlanEvalPanel'), 'LbaoChat 必须复用周计划的 PlanEvalPanel（不另写 UI）');
  assert.ok(chat.includes('data-testid="chat-eval-entry"'), '评估入口按钮（RV 锚：摘掉 → 本文件红）');
  assert.ok(chat.includes('data-testid="chat-eval-panel"'), '面板展开容器在渲染路径上');
  assert.ok(chat.includes('让梨宝评估这一版'), '按钮文案');
  assert.ok(chat.includes('toggleChatEval'), '点击处理在位（点击后面板可见的运行时证据由 E2E 覆盖）');
  assert.match(chat, /message\.evalAsk &&/, '回执消息携带 evalAsk 才渲染入口');
});

test('触发点① 源码锁: confirmGoal 落盘回执带 evalAsk（六类动作全覆盖）', () => {
  const chat = stripComments(src('/src/features/libao/LbaoChat.tsx'));
  const n = (chat.match(/evalAsk: true,/g) ?? []).length;
  assert.ok(n >= 6, `confirmGoal 六类落盘回执都应带 evalAsk，实际 ${n}`);
});

test('触发点① 接缝锁: 评估 glue 在 weekPlanForChat，LbaoChat 不直引 lib/planner', () => {
  const seam = stripComments(src('/src/features/libao/weekPlanForChat.ts'));
  assert.match(seam, /export function evaluatePlanForChat/, 'glue 在唯一接缝（红线 6）');
  assert.match(seam, /digestPlan\(/, '接缝内包 digestPlan');
  assert.match(seam, /evaluateDigest\(/, '接缝内包 evaluateDigest');

  const chat = stripComments(src('/src/features/libao/LbaoChat.tsx'));
  assert.doesNotMatch(chat, /from '@\/lib\/planner\/(planDigest|planEval)'/,
    '对话组件禁止直引评估引擎（只能走 weekPlanForChat 接缝）');
  assert.match(chat, /evaluatePlanForChat/, '对话组件消费接缝 glue');
});

test('触发点① L4 锁: 采纳只进重排草稿流，不直接改已排日程', () => {
  const chat = stripComments(src('/src/features/libao/LbaoChat.tsx'));
  assert.ok(chat.includes("note: '采纳自日程评估（重排后生效）'"), '采纳任务如实标注「重排后生效」');
  assert.ok(chat.includes("new CustomEvent('usst:replan')"), '落草稿后广播重排（不直接写日程表）');
  assert.ok(chat.includes('pushUndoSnapshot'), '采纳前压 undo 快照（与「就这么排」同纪律）');
});
