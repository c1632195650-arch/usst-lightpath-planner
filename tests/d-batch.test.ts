/**
 * D 批 · 对话管理器化（2026-09-27 夜）—— 源码接线断言
 * ============================================================
 * 与 v0/v1/v2/v3 同一手法：纯逻辑进单测、组件接线用源码字面量断言钉住。
 * 反向验证锚点（RV）：
 *   D0-RV ← send() 里删掉 `activeMode === 'chat'` 改道闸 → 提示卡断言红
 *   D0-RV ← 删掉 mode-sched 按钮 → 接线断言红
 *   D1-RV ← dialogManager 的快照迁移/白名单删项 → 对应纯函数用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

/* ---------------- D0 · 双模式按钮 ---------------- */

test('D0 源码: 模式分段切换在位（问答/排程硬区分）', () => {
  const chat = src('/src/features/libao/LbaoChat.tsx');
  assert.match(chat, /data-testid="mode-sched"/, '排程模式按钮');
  assert.match(chat, /data-testid="mode-chat"/, '问答模式按钮');
  assert.match(chat, /const \[mode, setMode\] = useState<'chat' \| 'sched'>\(/, 'mode 状态在位');
  assert.match(chat, /switchMode\('chat'\)/, '切回问答走唯一入口');
});

test('D0 源码: 问答模式排程意图不静默改道（出切换提示，原句重发）', () => {
  const chat = src('/src/features/libao/LbaoChat.tsx');
  // 反向：删掉 activeMode 闸 → runGoalSlots 在问答模式也会跑，提示卡断言红
  assert.match(chat, /activeMode === 'chat'/, '问答模式拦截闸在位');
  assert.match(chat, /modeHint: q/, '提示卡携带原句');
  assert.match(chat, /modeHint != null && \(/, '提示卡渲染在位');
  assert.match(chat, /send\(q, \{ forceMode: 'sched' \}\)/, '继续按钮 = 切模式 + 原句重发');
});

test('D0 快照: mode 随快照存取（恢复时接续，不退回问答）', () => {
  const chat = src('/src/features/libao/LbaoChat.tsx');
  assert.match(chat, /mode\?: 'chat' \| 'sched';/, '快照类型带 mode');
  assert.match(chat, /boot\?\.mode \?\? \(boot\?\.schedMode === 'collect' \? 'sched' : 'chat'\)/,
    '老快照按活跃排程态推导 mode');
});
