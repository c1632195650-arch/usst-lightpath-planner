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

/* ---------------- D3 · ActExecutor 与 send() 优先级链 ---------------- */

test('D3 源码: send() 优先级链 —— 出口①确定性退出 → dialog 裁决 → 规则链路兜底', () => {
  const chat = src('/src/features/libao/LbaoChat.tsx');
  // 反向：删掉 DIALOG_ENABLED 闸 → 总回退开关失灵（§11 一行回 S/T 批行为的承诺落空）
  assert.match(chat, /const DIALOG_ENABLED = true;/, '总回退开关在位');
  assert.match(chat, /if \(DIALOG_ENABLED && activeMode === 'sched' && online !== false\)/,
    '排程模式+在线才走 dialog 主干');
  assert.match(chat, /await tryDialogAct\(q, today, history\)/, '每轮恰一次 dialog 裁决');
  assert.match(chat, /const ACT_EXECUTORS: Record<DialogAct,/, '8 个 act 执行器映射在位');
});

test('D3 源码: confirm_draft 双闸（confidence≥0.8 且整句命中确认词表）', () => {
  const chat = src('/src/features/libao/LbaoChat.tsx');
  // 反向：删掉词表闸 → 「好不好嘛」这类犹豫句也会被当成同意，L4 失守
  assert.match(chat, /ctx\.confidence >= 0\.8 && CONFIRM_RE\.test\(ctx\.q/);
  assert.match(chat, /\^\(好\|好呀\|好啊\|行\|可以\|对\|确认\|就这么排\|就这么办\|排吧\|嗯\+\)/);
});

test('D3 源码: topic 生命周期（草稿/阻塞/议题续用）在位', () => {
  const chat = src('/src/features/libao/LbaoChat.tsx');
  assert.match(chat, /const markDraft = useCallback/, '草稿→topic{draft}');
  assert.match(chat, /const markBlocked = useCallback/, '阻塞→topic{blocked}');
  assert.match(chat, /priorFailed: \{ title: slots\.title, slots \}/, 'B① 议题续用记录');
  assert.match(chat, /kind: 'replace', slots, candidates: targets/, 'B② replace 多候选改道 picking');
  assert.match(chat, /t\?\.priorFailed\n\s+&& merged\.durationMin == null/, 'replace 隐含用刚才失败的事');
  assert.match(chat, /await ragReply\(ctx\.q\)/, 'chit_chat 走 RAG 且议题保留');
  assert.match(chat, /topicExpired\(\{ \.\.\.topic, turns: topic\.turns \+ 1 \}\)/, 'turns 超限自动作废');
});

/* ---------------- D4 · 引擎修复（weekPlanForChat / templates / construct） ---------------- */

test('D4: goalToTasks 产出 budgetExempt + notAfterMin（窗口上界不再丢）', async () => {
  const { goalToTasks } = await import('@/features/libao/weekPlanForChat');
  type Schedule = import('@/types').Schedule;
  type Course = import('@/types').Course;
  const course = (id: string, day: number, sp: number, ep: number): Course => ({
    id, name: id, credit: 2, category: '公共基础', campus: 'JG516', building: '第一教学楼',
    slots: [{ dayOfWeek: day as Course['slots'][number]['dayOfWeek'], startPeriod: sp, endPeriod: ep, weeks: [3, 4] }],
  });
  const SCHEDULE: Schedule = {
    semesterName: '2026-2027-1', semesterType: 'autumn', termStart: '2026-09-07',
    totalWeeks: 20, source: 'demo', courses: [course('c1', 1, 1, 2)],
  };
  const slots = {
    intent: 'create', title: '出去玩', certainty: 'exact' as const, priorityHint: 85,
    missing: [], unclear: [], raw: '明天晚上出去玩一小时',
    dateFrom: '2026-09-28', dateTo: '2026-09-28',
    durationMin: 60,
    window: { fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' },
  } as Parameters<typeof goalToTasks>[0];
  // 反向：goalToTasks 撤掉 budgetExempt/notAfterMin → 本用例红
  const tasks = goalToTasks(slots, SCHEDULE, '2026-09-27');
  assert.ok(tasks.length > 0);
  for (const t of tasks) {
    assert.equal(t.budgetExempt, true, '用户点名块必须豁免活动预算');
    assert.equal(t.notAfterMin, 23 * 60, '窗口 toMin 必须成为放置上界');
  }
});

test('D4: 晚上窗内真排上 + 与既有块同日共存（引擎级，evening 豁免生效）', async () => {
  const { goalToTasks, checkGoalFeasibility, planWeekWithTasks } = await import('@/features/libao/weekPlanForChat');
  type Schedule = import('@/types').Schedule;
  type Course = import('@/types').Course;
  const course = (id: string, day: number, sp: number, ep: number): Course => ({
    id, name: id, credit: 2, category: '公共基础', campus: 'JG516', building: '第一教学楼',
    slots: [{ dayOfWeek: day as Course['slots'][number]['dayOfWeek'], startPeriod: sp, endPeriod: ep, weeks: [4] }],
  });
  const SCHEDULE: Schedule = {
    semesterName: '2026-2027-1', semesterType: 'autumn', termStart: '2026-09-07',
    totalWeeks: 20, source: 'demo', courses: [course('c1', 1, 1, 2)],
  };
  // 占满明天下午与晚间的既有块 —— 修预算前「出去玩」会被静默挤掉（placed=0）
  const heavy = [
    { id: 'u-run', title: '操场跑步', kind: 'activity' as const, dayOfWeek: 1, startMin: 17 * 60 + 55, durationMin: 60, weeks: [4] },
    { id: 'u-occ1', title: '占位一', dayOfWeek: 1, startMin: 13 * 60, durationMin: 120, weeks: [4] },
    { id: 'u-occ2', title: '占位二', dayOfWeek: 1, startMin: 19 * 60, durationMin: 120, weeks: [4] },
  ];
  const slots = {
    intent: 'create', title: '出去玩', certainty: 'exact' as const, priorityHint: 85,
    missing: [], unclear: [], raw: '明天晚上出去玩一小时',
    dateFrom: '2026-09-28', dateTo: '2026-09-28', durationMin: 60,
    window: { fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' },
  } as Parameters<typeof goalToTasks>[0];
  const tasks = goalToTasks(slots, SCHEDULE, '2026-09-27');
  const verdict = checkGoalFeasibility({ slots, schedule: SCHEDULE, profile: null, today: '2026-09-27', tasks: heavy });
  assert.equal(verdict.placedCount, 1, `修完后应当真排上：${verdict.reasons.join('；')}`);
  const plan = await planWeekWithTasks(SCHEDULE, null, 4, [...heavy, ...tasks]);
  assert.ok(plan);
  const goal = plan!.blocks.find((b) => b.title === '出去玩');
  const run = plan!.blocks.find((b) => b.title === '操场跑步');
  assert.ok(goal, '出去玩没落盘');
  assert.ok(run, '操场跑步被挤掉了 —— 同日共存失败');
  assert.ok(goal!.endMin <= 23 * 60, '超出晚上窗（notAfterMin 失效）');
  assert.ok(goal!.dayOfWeek === run!.dayOfWeek, '没在同一天共存');
});


/* ---------------- D7 · replan 协商循环 ---------------- */

test('D7: proposeReplanOptions —— 每个方案过引擎干跑，只出真排得上的编号选项', async () => {
  const { checkGoalFeasibility, goalToTasks, proposeReplanOptions } = await import('@/features/libao/weekPlanForChat');
  type Schedule = import('@/types').Schedule;
  type Course = import('@/types').Course;
  const course = (id: string, day: number, sp: number, ep: number): Course => ({
    id, name: id, credit: 2, category: '公共基础', campus: 'JG516', building: '第一教学楼',
    slots: [{ dayOfWeek: day as Course['slots'][number]['dayOfWeek'], startPeriod: sp, endPeriod: ep, weeks: [4] }],
  });
  const SCHEDULE: Schedule = {
    semesterName: '2026-2027-1', semesterType: 'autumn', termStart: '2026-09-07',
    totalWeeks: 20, source: 'demo', courses: [course('c1', 1, 1, 2)],
  };
  // 明天（周一）晚上被三个块占满 → 目标块一块都落不下
  const heavy = [
    { id: 'u-run', title: '操场跑步', kind: 'activity' as const, dayOfWeek: 1, startMin: 17 * 60 + 55, durationMin: 60, weeks: [4] },
    { id: 'u-occ2', title: '占位二', dayOfWeek: 1, startMin: 19 * 60, durationMin: 120, weeks: [4] },
    { id: 'u-occ3', title: '占位三', dayOfWeek: 1, startMin: 21 * 60, durationMin: 120, weeks: [4] },
  ];
  const slots = {
    intent: 'create', title: '出去玩', certainty: 'exact' as const, priorityHint: 85,
    missing: [], unclear: [], raw: '明天晚上出去玩一小时',
    dateFrom: '2026-09-28', dateTo: '2026-09-28', durationMin: 60,
    when: { text: '明天晚上', kind: 'relative' as const, relativeDays: 1 },
    window: { fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' },
  } as Parameters<typeof goalToTasks>[0];
  const verdict = checkGoalFeasibility({ slots, schedule: SCHEDULE, profile: null, today: '2026-09-27', tasks: heavy });
  assert.equal(verdict.placedCount, 0, '夹具应当是 blocked');
  assert.ok((verdict.blockingBlocks?.length ?? 0) > 0, '应当扫出挡路块');

  // 反向：把「干跑过滤」删掉（全部方向直接呈现）→ 本用例红
  const options = proposeReplanOptions({ slots, verdict, schedule: SCHEDULE, profile: null, tasks: heavy, today: '2026-09-27' });
  assert.ok(options.length >= 1 && options.length <= 3, `应有 1-3 条可行方案，实际 ${options.length}`);
  assert.ok(options.some((o) => o.id.startsWith('swap:') || o.id === 'move_next_week'), '至少一条互换/顺延');
  // 干跑语义自洽：每个选项按其 id 复跑干跑都必须真的排得上
  for (const o of options) {
    const v = checkGoalFeasibility({
      slots: { ...o.slots, missing: [] }, schedule: SCHEDULE, profile: null, today: '2026-09-27',
      tasks: heavy,
      ...(o.id.startsWith('swap:') ? { excludeBlockIds: [o.id.slice(5)] } : {}),
    });
    assert.ok(v.kind === 'ok' || v.kind === 'tight', `选项 ${o.id} 干跑未通过：${v.kind}`);
  }
  // ok 的 verdict 不产生协商方案（没有协商的必要）
  const okVerdict = checkGoalFeasibility({ slots: { ...slots, dateTo: '2026-10-04' }, schedule: SCHEDULE, profile: null, today: '2026-09-27', tasks: [] });
  if (okVerdict.kind === 'ok' || okVerdict.kind === 'tight') {
    assert.deepEqual(proposeReplanOptions({ slots, verdict: okVerdict, schedule: SCHEDULE, profile: null, today: '2026-09-27' }), []);
  }
});

/* ---------------- 白天终验修复（2026-09-28） ---------------- */

test('终验修复: WeekPlanView 挂载/重排时同步跨页 undo 深度（↩ 按钮不再恒禁用）', () => {
  const wv = src('/src/features/week/WeekPlanView.tsx');
  // 反向：删掉挂载同步行 → 本用例红。背景：梨宝确认落盘压栈后，周计划页
  // undoDepthState 初始 0 不跨页感知，按钮恒禁用而 Ctrl+Z 可用。
  assert.match(wv, /setUndoDepth\(undoDepth\(\)\);\n\s+const onReplanDepth = \(\) => setUndoDepth\(undoDepth\(\)\);/,
    '挂载 + 重排广播双路同步在位');
});
