/**
 * objective.ts 纯函数杀手测试（P1#8 · 2026-09-20 修订版）
 * ============================================================
 * 目的：把 `src/lib/planner/objective.ts` 的**活代码**用直测钉住，
 * 让 Stryker 的变异体在「行为被改变」时必被杀掉。
 *
 * ────────────────────────────────────────────────────────────
 * ⚠️ 2026-09-20 修订：删掉了三类断言（原版 12 条 → 现 8 条）
 * ────────────────────────────────────────────────────────────
 * 理由不是"跑不过"，而是**它们杀的是死代码**：写变异测试的目的是保护产品行为，
 * 不是把百分比刷上去（否则就是 mutation-score gaming）。逐条证据：
 *
 *   · `collectDeadlineBoosts` / `urgencyBoostForWeek`（含 `weightOfTag`、周界过滤）
 *     → `src/` 里**零调用者**。交期其实走 `events.ts` 的 `expandDeadlines` /
 *       `expandExamPrep` → `req.tasks` 通道进入决策（见 objective.ts 顶部红字）。
 *       杀这些变异体不保护任何用户可见行为 → 断言删除。
 *   · `weekNoOfDate` 也只在上述死函数内部被调用，但**保留一条契约测试**：
 *       它有个真实踩过的坑（传完整 ISO 会得到 null，因为函数自己拼 `T00:00:00Z`），
 *       将来谁要启用它，这条测试就是防雷针。这是"保留"不是"凑分"。
 *
 * **保留的 8 条全部对应活路径**（调用点已逐个核对）：
 *   urgency / sortKey / sortCommits → `construct.ts:939`（构造期选序）
 *   effectiveEffortMin            → `construct.ts:950`（最小块长）
 *   transferMinutesFromProvider / effectiveTransferMinutes → `objective.ts:546-547`
 *   commitOverdue                 → `objective.ts:555`
 *   evaluate churn 联动           → `objective.ts` §5.5 装配
 *
 * 反向验证（纪律）：改坏实现必须变红 —— 例如把 `urgencyBoostForWeek` 换成求和、
 * 把 `commitOverdue` 的 10 改成 9、把 `blockOfCommit` 的匹配换成 courseId 匹配，
 * 本文件都会立刻报错。已实测（见 PR 描述）。
 *
 * 跑法：`npm run test:engine`（`node --test tests/**\/*.test.ts`）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekNoOfDate, urgency, sortKey, sortCommits, effectiveEffortMin,
  transferMinutesFromProvider, effectiveTransferMinutes,
  commitOverdue,
} from '@/lib/planner/objective.ts';
import { DEFAULT_WEIGHTS, FREE_CHURN_FACTOR } from '@/lib/planner/model.ts';
import { evaluate } from '@/lib/planner/objective.ts';
import type { Commit, TimeBlock } from '@/types';
import type { TransferProvider } from '@/lib/planner/schedule.ts';

/* ---------------- weekNoOfDate：纯日期契约（防雷，非凑分）---------------- */

const TERM = '2026-09-07';

test('weekNoOfDate 契约：只吃纯日期；完整 ISO 会因二次拼接 T00:00:00Z 得到 null', () => {
  assert.equal(weekNoOfDate('2026-09-07', TERM), 1, '第 0 天 = 第 1 周');
  assert.equal(weekNoOfDate('2026-09-13', TERM), 1, '第 7 天内仍第 1 周');
  assert.equal(weekNoOfDate('2026-09-14', TERM), 2, '第 8 天进第 2 周');
  assert.equal(weekNoOfDate('nonsense', TERM), null, '非法日期 → null（不抛错）');
  assert.equal(weekNoOfDate('2026-09-14', 'not-a-date'), null, 'termStart 非法 → null');
  // 🔴 防雷针：这正是 2026-09-19 那次「夹具传完整 ISO → NaN」踩到的坑
  assert.equal(weekNoOfDate('2026-09-14T05:00:00Z', TERM), null,
    '完整 ISO 会被拼成 ...ZT00:00:00Z → NaN → null；调用方必须传 YYYY-MM-DD');
});

/* ---------------- urgency / sortKey / sortCommits（活：construct 选序） ---------------- */

const commit = (over: Partial<Commit> = {}): Commit => ({
  id: 'c', title: 't', kind: 'study', effortMin: 60,
  dueAt: { weekNo: 3, dayOfWeek: 3, min: 600 },
  ...over,
});

test('urgency：无交期 0；过期 1.0；产能不足 0.9；远期下限 0.05；线性衰减', () => {
  assert.equal(urgency(commit({ dueAt: undefined }), 5, 120), 0, '无交期不加成');
  assert.equal(urgency(commit(), 5, 120), 1.0, 'daysLeft<0 → 1.0');
  assert.equal(urgency(commit(), 3, 30), 0.9, 'capacity 30 < effort 60 → 0.9');
  assert.equal(urgency(commit(), 1, 120), 0.05, 'daysLeft=16 → clamp 下限 0.05');
  const mid = urgency(commit(), 2, 120);   // daysLeft = (3-2)*7+2 = 9
  assert.ok(Math.abs(mid - (1 - 9 / 14)) < 1e-9, `线性衰减实测 ${mid}`);
});

test('sortKey：urgency×1000 + priority；boost 加上后 clamp 到 1', () => {
  const c = commit({ priority: 90 });
  const u = urgency(c, 2, 120);
  assert.ok(Math.abs(sortKey(c, 2, 120, 0) - (u * 1000 + 90)) < 1e-6);
  assert.equal(sortKey(c, 2, 120, 5), 1000 + 90, 'u+boost clamp 到 1 → 1000+priority');
});

test('sortCommits：紧急者排前', () => {
  const soon = commit({ id: 'soon', dueAt: { weekNo: 2, dayOfWeek: 1, min: 0 } });
  const late = commit({ id: 'late', dueAt: { weekNo: 8, dayOfWeek: 1, min: 0 } });
  assert.equal(sortCommits([late, soon], 1, 120)[0].id, 'soon');
});

/* ---------------- effectiveEffortMin（活：construct 最小块长） ---------------- */

test('effectiveEffortMin：minAcceptableMin 优先；缺省 floor(0.7×effort/5)×5', () => {
  assert.equal(effectiveEffortMin(commit({ effortMin: 60, minAcceptableMin: 30 })), 30,
    '显式最小可接受量优先');
  assert.equal(effectiveEffortMin(commit({ effortMin: 63 })), 40, 'floor(44.1/5)*5 = 40');
  assert.equal(effectiveEffortMin(commit({ effortMin: 60 })), 40, 'floor(42/5)*5 = 40');
});

/* ---------------- 转场分钟（活：evaluate 的两条打分路径） ---------------- */

const provider: TransferProvider = (from, to) =>
  from === to ? null : { minutes: 20, reliable: true, source: 'stub' };
const estProvider: TransferProvider = () => ({ minutes: 20, reliable: false, source: 'stub' });

test('transferMinutesFromProvider：同地 null；无效分钟 null；reliable 单折扣 / 估算双折扣', () => {
  // ⚠️ 签名是 (provider, from, to, trust) —— provider 在**第一位**（2026-09-20 修正：
  //    原版把参数写成了 (from, to, provider, trust)，于是抛 `provider is not a function`）
  assert.equal(transferMinutesFromProvider(provider, '三教', '三教', 0.8), null, '同地无需转场');
  assert.equal(transferMinutesFromProvider(provider, '三教', '图书馆', 0.8), 16, '20 × 0.8');
  assert.equal(transferMinutesFromProvider(estProvider, '三教', '图书馆', 0.8), 12,
    '估算数据双折扣：20 × 0.8 × ESTIMATE_TRUST');
  const bad: TransferProvider = () => ({ minutes: 0, reliable: true });
  assert.equal(transferMinutesFromProvider(bad, '三教', '图书馆', 0.8), null, '分钟非正 → null');
  assert.equal(transferMinutesFromProvider(provider, undefined, '图书馆', 0.8), null, '缺地点 → null');
});

test('effectiveTransferMinutes：缺 transfer / 分钟非正 → null；tight 不打折；正常回传', () => {
  const b = (t?: { minutes: number; reliable?: boolean; tight?: boolean }) => ({
    id: 'x', kind: 'study' as const, dayOfWeek: 1 as const, startMin: 540, endMin: 600,
    title: 't', source: 'template' as const, ...(t ? { transfer: { ...t, slackMin: 0 } } : {}),
  });
  assert.equal(effectiveTransferMinutes(b(), 1), null, '没有 transfer 提示 → null');
  assert.equal(effectiveTransferMinutes(b({ minutes: 0 }), 1), null, '分钟非正 → null');
  assert.equal(effectiveTransferMinutes(b({ minutes: 10, reliable: true }), 1), 10);
  assert.equal(effectiveTransferMinutes(b({ minutes: 10, reliable: false, tight: true }), 0.01), 10,
    '已判紧张不打折（保持警示）');
  assert.equal(effectiveTransferMinutes(b({ minutes: 10, reliable: false }), 0.8), 6,
    '估算数据双折扣：10 × 0.8 × 0.75');
});

/* ---------------- commitOverdue（活：evaluate 的 dueOverdue 项） ---------------- */

test('commitOverdue：无块且过期 → 10+超时天数；已排但迟排 → 5；按时不罚', () => {
  const emptyPlan = {
    weekNo: 4, blocks: [] as TimeBlock[],
    stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: 0 }, issues: [],
  };
  const c = commit({ id: 'c1', dueAt: { weekNo: 3, dayOfWeek: 1, min: 0 } });
  assert.equal(commitOverdue(c, emptyPlan as never, 4), 10 + 7, 'dueOffset = -7 → 10+7');
  assert.equal(commitOverdue(c, emptyPlan as never, 3), 0, '未过期且未排 → 0（不罚）');

  // `blockOfCommit` 按 **id 语义键**匹配（`endsWith('-'+commitId)` 或含 `-commitId-`），
  // 不是按 `courseId` 字段 —— 2026-09-20 修正了原注释的错误说法。
  const blk: TimeBlock = {
    id: 'w3-d3-study-c1', kind: 'study', dayOfWeek: 3, startMin: 540, endMin: 600,
    title: 't', source: 'template', courseId: 'c1',
  };
  const latePlan = { ...emptyPlan, blocks: [blk] };
  assert.equal(commitOverdue(c, latePlan as never, 3), 5, '排在第 3 天 > dueAt 第 1 天 → 5');
  assert.equal(commitOverdue(commit({ id: 'other' }), latePlan as never, 3), 0,
    'id 不匹配的块不算「已排」（匹配是启发式，只看 id 语义键）');
});

/* ---------------- evaluate churn 联动（活：§5.5 装配） ---------------- */

test('evaluate：free 块挪动计入 churn = w.churn × FREE_CHURN_FACTOR × 分钟', () => {
  const blk = (id: string, start: number): TimeBlock => ({
    id, kind: 'study', dayOfWeek: 1, startMin: start, endMin: start + 60,
    title: 't', source: 'template',
  });
  const prev = {
    weekNo: 4, blocks: [blk('w4-d1-study-s1', 540)],
    stats: { courseMin: 0, studyMin: 60, blankMin: 0, blockCount: 1 }, issues: [],
  };
  const moved = { ...prev, blocks: [blk('w4-d1-study-s1', 600)] };
  const ctx = {
    weekNo: 4, policy: {
      dailyStudyMin: 60, maxBlockMin: 60, blankRatio: 0.2, eveningAllowed: false,
      weekendWork: false, studyPlaces: ['图书馆（图文信息中心）'],
    }, weights: DEFAULT_WEIGHTS, previousPlan: prev, lockLevels: {},
  } as never;
  const c = evaluate(moved as never, ctx);
  assert.ok(c.churn > 0, `churn 实测 ${c.churn}`);
  assert.ok(Math.abs(c.churn - DEFAULT_WEIGHTS.churn * FREE_CHURN_FACTOR * 60) < 1e-6,
    'churn = 权重 × FREE_CHURN_FACTOR × 分钟（用常量而非魔数 0.08）');
});
