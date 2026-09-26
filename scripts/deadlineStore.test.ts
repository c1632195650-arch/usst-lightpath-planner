/**
 * WP11 重要日体系 —— deadlineStore 合并/展开 + add_deadline 意图
 * ============================================================
 * 铁律（WP11）：重要日增补**不自动重排，只出问询** —— 所以这里只测
 * 「合并 → 展开数据链」与「意图 → 提案」的纯函数行为，不测重排触发。
 *
 * ⚠️ 反向验证（记录见 docs/wp-ledger-v2.md §WP11）：
 *   RV1 ← mergeDeadlines 还原成「只返回静态」→ 合并/展开两条用例红
 *   RV2 ← INTENT_PATTERNS 删 add_deadline 条目 → 口令用例红
 *   RV3 ← deadlineProposal 在缺日期时猜默认值 → 「缺 date 必追问」用例红
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  addUserDeadline,
  loadUserDeadlines,
  mergeDeadlines,
  removeUserDeadline,
  upcomingDeadlines,
  userDeadlineToDeadline,
} from '@/features/calendar/deadlineStore';
import { expandDeadlines } from '@/lib/planner/events';
import { DEADLINES } from '@/data/usst';
import { deadlineProposal, detectIntent, parseIntentSlots } from '@/features/libao/libaoIntent';

function installStorageStub() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  installStorageStub();
});

/* ---------------- 合并：去重键 title+date，用户版优先 ---------------- */

test('WP11: mergeDeadlines 去重 title+date，用户条目优先，静态其余保留', () => {
  // 反向：mergeDeadlines 还原成「只返回静态列表」→ 本用例红
  const user = [{
    id: 'ud-1', title: '光电杯报名截止', date: '2026-09-28',
    leadDays: 5, blockMin: 60, prepHours: 4, source: 'user' as const,
  }];
  const merged = mergeDeadlines(DEADLINES, user);
  const mine = merged.filter((d) => d.id === 'ud-1');
  assert.equal(mine.length, 1, '用户条目要进合并表');
  const stale = merged.filter((d) => d.title === '光电杯报名截止');
  assert.equal(stale.length, 1, '同 title+date 的静态条目必须被去重');
  assert.ok(merged.some((d) => d.id === 'midterm'), '静态其他节点保留');
  // 有序性：按日期升序（确定性）
  const dates = merged.map((d) => d.date);
  assert.deepEqual(dates, [...dates].sort());
});

/* ---------------- expandDeadlines 吃 user 条目 ---------------- */

test('WP11: expandDeadlines 吃合并后的用户条目（产生准备块）', () => {
  // 反向：调用方还原成 expandDeadlines(DEADLINES)（只吃静态）→ 本用例红
  const user = [{
    id: 'ud-99', title: '高数期中', date: '2026-11-20',
    leadDays: 7, blockMin: 60, prepHours: 6, source: 'user' as const,
  }];
  const tasks = expandDeadlines(mergeDeadlines(DEADLINES, user), '2026-08-31', 20);
  const mine = tasks.filter((t) => t.fromEventId === 'ud-99');
  assert.ok(mine.length > 0, '用户重要日的准备块必须被展开出来');
  assert.ok(mine.every((t) => t.title === '高数期中·准备'), '准备块标题来自用户节点');
});

test('WP11: 没给准备参数的重要日 = 纯提醒（不产生准备块）', () => {
  const d = userDeadlineToDeadline({ id: 'ud-2', title: '家人生日', date: '2026-10-01', source: 'user' });
  assert.equal(d.prep, undefined, '没填 leadDays/blockMin 就不该编出准备块');
});

/* ---------------- 存储闭环 ---------------- */

test('WP11: deadlineStore 记/读/删闭环；重复 title+date 不重复记', () => {
  addUserDeadline({ title: ' 四六级笔试 ', date: '2026-12-19', leadDays: 10, blockMin: 45, prepHours: 6 });
  addUserDeadline({ title: '四六级笔试', date: '2026-12-19' }); // 重复 → 忽略
  const list = loadUserDeadlines();
  assert.equal(list.filter((d) => d.title.trim() === '四六级笔试').length, 1);
  // 空 date 形状不合法 → 不该写进表
  addUserDeadline({ title: '坏数据', date: '2026/12/19' } as never);
  assert.equal(loadUserDeadlines().some((d) => d.title === '坏数据'), false);
  removeUserDeadline(list[0].id);
  assert.equal(loadUserDeadlines().length, 0);
});

/* ---------------- 「接下来」横排数据源 ---------------- */

test('WP11: upcomingDeadlines 过去日剔除、升序取前 3、算准剩余天数', () => {
  const today = '2026-09-27';
  const list = [
    { id: 'a', date: '2026-10-10', title: 'A', emoji: '🎉', tag: 'x', color: '#000' },
    { id: 'b', date: '2026-09-28', title: 'B', emoji: '🎉', tag: 'x', color: '#000' },
    { id: 'past', date: '2026-09-01', title: '过去', emoji: '🎉', tag: 'x', color: '#000' },
    { id: 'c', date: '2026-09-29', title: 'C', emoji: '🎉', tag: 'x', color: '#000' },
    { id: 'd', date: '2026-09-30', title: 'D', emoji: '🎉', tag: 'x', color: '#000' },
  ];
  const up = upcomingDeadlines(list, today, 3);
  assert.deepEqual(up.map((u) => u.deadline.id), ['b', 'c', 'd']);
  assert.equal(up[0].daysLeft, 1);
});

/* ---------------- add_deadline 意图（≥3 条新口令） ---------------- */

test('WP11: 三条口令命中 add_deadline；既有意图优先级不被动摇', () => {
  // 反向：INTENT_PATTERNS 删掉 add_deadline 条目 → 本用例红
  assert.equal(detectIntent('我下周要比赛'), 'add_deadline', '口令①要比赛');
  assert.equal(detectIntent('十二月要考四六级'), 'add_deadline', '口令②要考');
  assert.equal(detectIntent('光电杯报名快截止了'), 'add_deadline', '口令③截止');
  assert.equal(detectIntent('我想备赛数学建模'), 'add_deadline', '口令④备赛');
  // 既有意图不被新触发词抢走
  assert.equal(detectIntent('取消备赛安排'), 'cancel');
  assert.equal(detectIntent('把备赛挪到周五'), 'reschedule');
  // 带排程动词/投入信号的「备赛」是 create（排准备块），不是记节点（WP11 守门）
  assert.equal(detectIntent('帮我安排数学建模备赛'), 'create');
  assert.equal(parseIntentSlots('10月中旬帮我安排数学建模备赛，一共18小时，每次2小时', '2026-09-27').intent, 'create');
  assert.equal(parseIntentSlots('我下周要比赛', '2026-09-27').intent, 'add_deadline');
});

test('WP11: 口令句能过 looksLikeAction 动作闸（走草稿通路而不是 RAG）', async () => {
  const { looksLikeAction } = await import('@/features/libao/libaoIntent');
  assert.ok(looksLikeAction('十二月要考四六级'));
  assert.ok(looksLikeAction('光电杯报名快截止了'));
  assert.ok(!looksLikeAction('怎么备赛数学建模'), '「怎么备赛」是求方法 → 交 RAG');
});

test('WP11: 提案卡 —— 有日期出建议卡文案；缺 date 必追问不硬猜', () => {
  // 反向：deadlineProposal 缺日期时返回猜测值 → 本用例红
  const s1 = parseIntentSlots('十二月十五号要考四六级', '2026-09-27');
  assert.equal(s1.intent, 'add_deadline');
  const p1 = deadlineProposal(s1);
  assert.ok(!('needDate' in p1), '给了明确日期就该出提案');
  if (!('needDate' in p1)) {
    assert.match(p1.message, /要不要按 \d{2}\.\d{2} 建立「.+」重要日？我会提前 \d+ 天开始帮你安排准备/);
    assert.ok(p1.prepDays >= 3 && p1.prepDays <= 14);
  }
  // 缺日期：明说没定 → 必须追问
  const s2 = parseIntentSlots('我要参加比赛，时间没定', '2026-09-27');
  const p2 = deadlineProposal(s2);
  assert.ok('needDate' in p2, '没日期不许猜');
  // 完全没提时间 → 同样追问
  const s3 = parseIntentSlots('我要参加比赛', '2026-09-27');
  assert.ok('needDate' in deadlineProposal(s3));
});
