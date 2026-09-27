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
  assert.match(chat, /mode: 'chat' \| 'sched';/, '快照类型带 mode');
  assert.match(chat, /modeFromV2\(s\.mode, s\.schedMode\)/, 'v2 迁移按推导补 mode');
  assert.match(chat, /boot\?\.mode \?\? 'chat'/, 'v3 快照 mode 原样恢复');
});

/* ---------------- D1 · dialogManager ---------------- */

const slotsOf = (over: Record<string, unknown> = {}) => ({
  intent: 'create', title: '出去玩', certainty: 'unknown', priorityHint: 85,
  missing: [], unclear: [], raw: '明天晚上出去玩一小时', ...over,
}) as Parameters<typeof import('@/features/libao/dialogManager').collectTopic>[0];

test('D1: topicFromV2 —— clarify→collect、clarifyPicking→picking（v2 快照迁移）', async () => {
  const dm = await import('@/features/libao/dialogManager');
  const t1 = dm.topicFromV2(
    { slots: slotsOf(), asked: ['when'] } as never, null,
  );
  assert.equal(t1?.phase, 'collect');
  assert.deepEqual(t1?.asked, ['when']);

  const target = { taskId: 't1', title: '操场跑步', origin: 'user' as const, hint: '周三 60 分钟' };
  const t2 = dm.topicFromV2(
    null,
    { kind: 'reschedule', slots: slotsOf(), candidates: [target] } as never,
  );
  assert.equal(t2?.phase, 'picking');
  assert.equal(t2?.pickKind, 'reschedule');
  assert.deepEqual(t2?.candidates?.[0], { idx: 0, title: '操场跑步', origin: 'user', hint: '周三 60 分钟', target });

  assert.equal(dm.topicFromV2(null, null), null);
});

test('D1: serializeDialogState —— 白名单有界，target/verdict 绝不外发', async () => {
  const dm = await import('@/features/libao/dialogManager');
  const { pickingTopic, serializeDialogState } = dm;
  const target = { taskId: 't1', title: '操场跑步', origin: 'user' as const, hint: '周三 60 分钟' };
  const topic = pickingTopic('cancel', slotsOf(), [target]);
  const s = serializeDialogState({ topic, missStreak: 1 });
  const json = JSON.stringify(s);
  assert.ok(json.length <= 4 * 1024, '状态序列化必须 ≤4KB');
  assert.ok(!json.includes('taskId'), '执行器目标不外发给 LLM');
  assert.ok(Array.isArray(s.topic?.candidates) && (s.topic!.candidates as unknown[]).length === 1);
  assert.equal(s.missStreak, 1);
  assert.equal(serializeDialogState({ topic: null, missStreak: 0 }).topic, null);
});

test('D1: validateDialogAct —— 防编造（idx 必须在候选清单 / confirm 要草稿在场 / negotiate 要阻塞事实）', async () => {
  const dm = await import('@/features/libao/dialogManager');
  const { pickingTopic, draftTopic, blockedTopic, validateDialogAct } = dm;
  const target = { taskId: 't1', title: '操场跑步', origin: 'user' as const, hint: '周三' };
  const pick = pickingTopic('cancel', slotsOf(), [target]);
  // 反向：把 idx 校验放宽为「放行任何数字」→ 前两条断言红
  assert.equal(validateDialogAct('pick_candidate', { candidate_idx: 0 }, { topic: pick }), true);
  assert.equal(validateDialogAct('pick_candidate', { candidate_idx: 7 }, { topic: pick }), false, '编造的 idx 必须拦下');
  assert.equal(validateDialogAct('pick_candidate', { candidate_idx: 0 }, { topic: draftTopic(slotsOf(), 1) }), false);
  assert.equal(validateDialogAct('confirm_draft', {}, { topic: draftTopic(slotsOf(), 1) }), true);
  assert.equal(validateDialogAct('confirm_draft', {}, { topic: pick }), false, '没有草稿不许 confirm');
  const blocked = blockedTopic(slotsOf(), {
    kind: 'no_placement', verdict: {} as never, blockingBlocks: [],
  });
  assert.equal(validateDialogAct('negotiate_block', { option: 'swap_block' }, { topic: blocked }), true);
  assert.equal(validateDialogAct('negotiate_block', { option: 'swap_block' }, { topic: null }), false);
  assert.equal(validateDialogAct('chit_chat', {}, { topic: null }), true);
  assert.equal(validateDialogAct('new_intent', { intent: 'create' }, { topic: null }), true);
  assert.equal(validateDialogAct('new_intent', { intent: 'nope' as never }, { topic: null }), false);
  assert.equal(validateDialogAct('hijack' as never, {}, { topic: null }), false, 'act 白名单外一律拦');
});

test('D1: 议题轮数上限 —— turns 超限过期（防无限占用）', async () => {
  const dm = await import('@/features/libao/dialogManager');
  const { collectTopic, bumpTurns, topicExpired, TOPIC_TURNS_LIMIT } = dm;
  let t = collectTopic(slotsOf(), []);
  for (let i = 0; i < TOPIC_TURNS_LIMIT; i++) {
    t = bumpTurns(t);
    assert.equal(topicExpired(t), false, `第 ${t.turns} 轮不该过期`);
  }
  t = bumpTurns(t);
  assert.equal(topicExpired(t), true, `turns=${t.turns} 应当过期`);
});

test('D1: sanitizeTopic —— 跨版本脏数据当没有（不挡死聊天页）', async () => {
  const dm = await import('@/features/libao/dialogManager');
  assert.equal(dm.sanitizeTopic(null), null);
  assert.equal(dm.sanitizeTopic({ phase: 'nope' }), null);
  assert.equal(dm.sanitizeTopic({ phase: 'collect', intent: 'create' }), null, '缺 slots 不放行');
  const ok = dm.sanitizeTopic({ phase: 'collect', intent: 'create', slots: slotsOf(), asked: ['when'], createdAt: 1, turns: 0 });
  assert.equal(ok?.phase, 'collect');
  assert.deepEqual(ok?.asked, ['when']);
});

