/**
 * F3 批 A1 · 偏好学习 v1 验收（2026-10-24）
 * ============================================================
 * 覆盖四块：
 *   · 纯函数   —— learnPrefs 三条规则（R1 时段跳过 / R2 档位完成 / R3 估时偏差），
 *                各自的「触发 / 不触发 / 样本不足」三态 + 窗口过滤 + 确定性
 *   · 存储层   —— usst.preflearn-v1 读写、采纳幂等、坏数据回落、清除
 *   · 状态叠加 —— withStatus（未处置的 status 键缺席，不假装"未决定"）
 *   · behaviorLog 小改 —— startMin/place 可选字段的透传与校验放宽（只增不改）
 *
 * Node 里没有 localStorage，用内存垫片（同 feedback.test.ts；被测模块只在
 * 函数内访问它，垫片赋值与 import 顺序不影响结果）。
 * 零依赖：只用 node:test / node:assert，符合项目纪律（禁 tsx / ts-node）。
 *
 * 反向验证锚点（RV，改实现必红）：
 *   F3-RV1 ← learnRoutine 把 R1 触发门槛短路（`if (rate < R1_SKIP_RATE) continue;`
 *            改成无条件 continue）→ 「R1 触发」用例红
 *   F3-RV2 ← learnTier 把 R2 门槛短路 → 「R2 触发」用例红
 *   F3-RV3 ← learnEstimate 把 R3 门槛短路 → 「R3 触发」用例红
 *   F3-RV4 ← inWindow 去掉 d < WINDOW_DAYS 上界 → 「窗口外旧记录」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- localStorage 内存垫片 ---------- */
class MemStorage {
  _m: Map<string, string> = new Map();
  get length(): number { return this._m.size; }
  clear(): void { this._m.clear(); }
  getItem(k: string): string | null { return this._m.has(k) ? (this._m.get(k) as string) : null; }
  key(i: number): string | null { return [...this._m.keys()][i] ?? null; }
  removeItem(k: string): void { this._m.delete(k); }
  setItem(k: string, v: string): void { this._m.set(k, String(v)); }
}
globalThis.localStorage = new MemStorage();

import {
  loadRecords, markBlock, type BehaviorRecord,
} from '@/lib/behaviorLog';
import {
  BUCKET_LABELS, PREF_LEARN_KEY, R1_SKIP_RATE, R2_TIER_MIN, WINDOW_DAYS,
  bucketOf, clearPrefLearn, defaultPrefLearnState, inWindow, learnPrefs,
  loadPrefLearnState, median, recordDay, setPrefLearnEnabled,
  setSuggestionStatus, withStatus,
} from '@/lib/prefLearn';

/** 统一「今天」：所有窗口用例共用，避免用真时钟（纯函数纪律） */
const NOW = '2026-10-24';

/** 造一条记录（缺省：晚间自习、窗口内、done） */
let seq = 0;
function rec(over: Partial<BehaviorRecord> = {}): BehaviorRecord {
  seq += 1;
  return {
    id: `blk${seq}@2026-10-20`,
    blockId: `blk${seq}`,
    date: '2026-10-20',
    weekNo: 8,
    kind: 'study',
    title: '深度学习',
    plannedMin: 60,
    status: 'done',
    startMin: 1200, // 20:00 → 晚桶
    at: '2026-10-20T21:00:00.000Z',
    ...over,
  };
}

/* ============================================================
 * 一、R1 时段跳过
 * ========================================================== */

test('R1 触发: 晚桶 n=10 跳过 7（70% ≥ 60%，n ≥ 6）→ 一条 routine-evening 建议', () => {
  const records = Array.from({ length: 10 }, (_, i) =>
    rec({ id: `e${i}`, blockId: `e${i}`, status: i < 7 ? 'skipped' : 'done' }));
  const out = learnPrefs(records, NOW);
  const r1 = out.filter((s) => s.kind === 'routine');
  assert.equal(r1.length, 1, `只该有一条 R1，实际 ${r1.length} 条：${out.map((s) => s.id).join(',')}`);
  assert.equal(r1[0].id, 'routine-evening');
  assert.ok(r1[0].text.includes('晚间'), `文案应点名时段：${r1[0].text}`);
  assert.ok(r1[0].text.includes('70%'), `文案应含跳过率：${r1[0].text}`);
  assert.ok(r1[0].text.includes('挪到下午'), `晚桶建议应给方向（对齐工作单示例）：${r1[0].text}`);
  assert.ok(r1[0].evidence.includes('n=10'), `证据应含样本量：${r1[0].evidence}`);
});

test('R1 不触发: 跳过率 50% < 60% 门槛 → 无 routine 建议', () => {
  const records = Array.from({ length: 10 }, (_, i) =>
    rec({ id: `f${i}`, blockId: `f${i}`, status: i < 5 ? 'skipped' : 'done' }));
  assert.deepEqual(learnPrefs(records, NOW).filter((s) => s.kind === 'routine'), []);
});

test('R1 样本不足: n=5（哪怕全跳过）→ 不出建议（宁可不说话）', () => {
  const records = Array.from({ length: 5 }, (_, i) =>
    rec({ id: `g${i}`, blockId: `g${i}`, status: 'skipped' }));
  const out = learnPrefs(records, NOW);
  assert.equal(out.filter((s) => s.kind === 'routine').length, 0);
  assert.equal(out.filter((s) => s.kind === 'tier').length, 0, '全跳过时 R2 也不该有话（done 率 0 是一条建议，但 n 不足）');
});

test('R1 窗口外: 同样的触发数据但记录在 5 周前 → 不出建议', () => {
  const old = '2026-09-10T21:00:00.000Z'; // 距 NOW 44 天 > 28
  const records = Array.from({ length: 10 }, (_, i) =>
    rec({ id: `o${i}`, blockId: `o${i}`, status: 'skipped', date: '2026-09-10', at: old }));
  assert.equal(learnPrefs(records, NOW).length, 0);
});

test(`R1 窗口边界: 恰好 ${WINDOW_DAYS - 1} 天前在窗内（触发），${WINDOW_DAYS} 天前在窗外（不触发）`, () => {
  const mk = (iso: string) => Array.from({ length: 6 }, (_, i) =>
    rec({ id: `w${iso}${i}`, blockId: `w${i}`, status: 'skipped', at: iso }));
  const d = (back: number) => {
    const t = new Date(2026, 9, 24);
    t.setDate(t.getDate() - back);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T21:00:00.000Z`;
  };
  assert.equal(learnPrefs(mk(d(27)), NOW).filter((s) => s.kind === 'routine').length, 1, '第 27 天前 = 窗口内（W12 断言漂移申报：按 kind 计数，R1 口径不变）');
  assert.equal(learnPrefs(mk(d(28)), NOW).filter((s) => s.kind === 'routine').length, 0, '第 28 天前 = 窗口外');
});

test('R1 未来记录不统计（只看过去 4 周）', () => {
  const records = Array.from({ length: 8 }, (_, i) =>
    rec({ id: `fu${i}`, blockId: `fu${i}`, status: 'skipped', at: '2026-11-01T21:00:00.000Z' }));
  assert.equal(learnPrefs(records, NOW).length, 0);
});

test('R1 无 startMin 的记录进不了桶（零迁移：旧记录自动跳过）', () => {
  const records = Array.from({ length: 10 }, (_, i) =>
    rec({ id: `ns${i}`, blockId: `ns${i}`, status: 'skipped', startMin: undefined }));
  const out = learnPrefs(records, NOW);
  assert.equal(out.filter((s) => s.kind === 'routine').length, 0);
});

test('R1 只认自习块: 晚间 activity 全跳过不算作息问题（口径不混淆）', () => {
  const records = Array.from({ length: 10 }, (_, i) =>
    rec({ id: `ac${i}`, blockId: `ac${i}`, kind: 'activity', title: '晚间跑步', status: 'skipped' }));
  // W12 断言漂移申报（2026-10-25）：改按 kind 计数——activity 删除是 W-1 的证据
  // 不是 R1 的（原断言 length 0 隐含「无任何建议」，与新增 weights 族冲突）；R1 口径不变
  assert.equal(learnPrefs(records, NOW).filter((s) => s.kind === 'routine').length, 0);
});

test('R1 分桶边界: <720 晨 / 720–1080 午 / >1080 晚（与规格逐字对齐）', () => {
  assert.equal(bucketOf(719), 'morning');
  assert.equal(bucketOf(720), 'afternoon');
  assert.equal(bucketOf(1080), 'afternoon', '1080 = 18:00 整点归午桶（晚桶是严格大于）');
  assert.equal(bucketOf(1081), 'evening');
  assert.ok(BUCKET_LABELS.evening.includes('18:00'), '桶标签要能给人看');
});

/* ============================================================
 * 二、R2 档位完成率
 * ========================================================== */

function tierPair(shortDone: number, longDone: number): BehaviorRecord[] {
  const short = Array.from({ length: 5 }, (_, i) =>
    rec({ id: `s${shortDone}-${i}`, blockId: `s${i}`, plannedMin: 30, status: i < shortDone ? 'done' : 'skipped', startMin: undefined }));
  const long = Array.from({ length: 5 }, (_, i) =>
    rec({ id: `l${longDone}-${i}`, blockId: `l${i}`, plannedMin: 90, status: i < longDone ? 'done' : 'skipped', startMin: undefined }));
  return [...short, ...long];
}

test('R2 触发: 短块完成 20% vs 长块 100%（差 80pct ≥ 25）→ tier-short', () => {
  const out = learnPrefs(tierPair(1, 5), NOW).filter((s) => s.kind === 'tier');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'tier-short');
  assert.ok(out[0].text.includes('20%'), `文案含低档完成率：${out[0].text}`);
  assert.ok(out[0].text.includes('100%'), `文案含高档完成率：${out[0].text}`);
  assert.ok(out[0].evidence.includes(`<${R2_TIER_MIN}min`), '证据交代档位口径');
});

test('R2 反向: 长块完成率低 → tier-long（朝差的那档开口）', () => {
  const out = learnPrefs(tierPair(5, 1), NOW).filter((s) => s.kind === 'tier');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'tier-long');
});

test('R2 不触发: 完成率差 < 25pct → 无 tier 建议', () => {
  // 短 3/5=60% vs 长 4/5=80% → 差 20pct
  assert.deepEqual(learnPrefs(tierPair(3, 4), NOW).filter((s) => s.kind === 'tier'), []);
});

test('R2 样本不足: 任一桶 n<5 → 不出建议（避免单边样本比较）', () => {
  const records = tierPair(0, 5).filter((r) => r.plannedMin >= R2_TIER_MIN); // 只剩长桶
  assert.deepEqual(learnPrefs(records, NOW).filter((s) => s.kind === 'tier'), []);
});

/* ============================================================
 * 三、R3 估时偏差
 * ========================================================== */

test('R3 触发(偏短): 8 条实际/计划=0.5 → estimate，文案含 50%', () => {
  const records = Array.from({ length: 8 }, (_, i) =>
    rec({ id: `es${i}`, blockId: `es${i}`, plannedMin: 60, actualMin: 30, startMin: undefined }));
  const out = learnPrefs(records, NOW).filter((s) => s.kind === 'estimate');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'estimate');
  assert.ok(out[0].text.includes('50%'), `文案含中位比：${out[0].text}`);
  assert.ok(out[0].evidence.includes('n=8'), '证据含样本量');
});

test('R3 触发(偏长): 8 条实际/计划=1.5 → estimate（提示预估放宽）', () => {
  const records = Array.from({ length: 8 }, (_, i) =>
    rec({ id: `el${i}`, blockId: `el${i}`, plannedMin: 60, actualMin: 90, startMin: undefined }));
  const out = learnPrefs(records, NOW).filter((s) => s.kind === 'estimate');
  assert.equal(out.length, 1);
  assert.ok(out[0].text.includes('150%'), `文案含中位比：${out[0].text}`);
});

test('R3 不触发: 中位比 1.0（±30% 内）→ 无 estimate 建议', () => {
  const records = Array.from({ length: 8 }, (_, i) =>
    rec({ id: `en${i}`, blockId: `en${i}`, plannedMin: 60, actualMin: 60, startMin: undefined }));
  assert.deepEqual(learnPrefs(records, NOW).filter((s) => s.kind === 'estimate'), []);
});

test('R3 样本不足: n=7 → 不出建议', () => {
  const records = Array.from({ length: 7 }, (_, i) =>
    rec({ id: `ef${i}`, blockId: `ef${i}`, plannedMin: 60, actualMin: 30, startMin: undefined }));
  assert.equal(learnPrefs(records, NOW).length, 0);
});

test('R3 偶数中位数取中间两数平均（4×0.4 + 4×0.6 → 0.5，仍触发）', () => {
  const records = Array.from({ length: 8 }, (_, i) =>
    rec({ id: `em${i}`, blockId: `em${i}`, plannedMin: 100, actualMin: i < 4 ? 40 : 60, startMin: undefined }));
  assert.equal(median([0.4, 0.4, 0.4, 0.4, 0.6, 0.6, 0.6, 0.6]), 0.5);
  assert.equal(learnPrefs(records, NOW).filter((s) => s.kind === 'estimate').length, 1);
});

/* ============================================================
 * 四、整体口径：确定性 / 空输入 / 多条并存
 * ========================================================== */

test('空记录 / 无任何规则命中 → 返回空数组（不出凑数建议）', () => {
  assert.deepEqual(learnPrefs([], NOW), []);
});

test('确定性: 同输入两次调用逐字相等（含顺序）', () => {
  const records = [
    ...Array.from({ length: 7 }, (_, i) => rec({ id: `d1-${i}`, blockId: `d1${i}`, status: 'skipped' })),
    ...Array.from({ length: 8 }, (_, i) => rec({ id: `d2-${i}`, blockId: `d2${i}`, plannedMin: 60, actualMin: 30, startMin: undefined })),
  ];
  const a = learnPrefs(records, NOW);
  const b = learnPrefs(records, NOW);
  assert.deepEqual(a, b);
  // W12 断言漂移申报：skipped ≥ W2 门槛 → 尾部多 weights-churn；顺序族序不变（R1→R3→W）
  assert.deepEqual(a.map((s) => s.id), ['routine-evening', 'estimate', 'weights-churn'], '顺序固定：R1 → R2 → R3 → W');
});

test('纯函数不填 status（处置状态是存储层的事）', () => {
  const records = Array.from({ length: 6 }, (_, i) => rec({ id: `p${i}`, blockId: `p${i}`, status: 'skipped' }));
  for (const s of learnPrefs(records, NOW)) assert.equal(s.status, undefined);
});

/* ============================================================
 * 五、存储层：usst.preflearn-v1
 * ========================================================== */

test('存储: 没写过 → 默认状态（开 + 空处置表）', () => {
  localStorage.clear();
  assert.deepEqual(loadPrefLearnState(), { version: 1, enabled: true, statuses: {} });
  assert.equal(PREF_LEARN_KEY, 'usst.preflearn-v1', '键名与工作单指定一致');
});

test('存储: 采纳幂等 —— 同 id 同状态写两次，落盘逐字一致', () => {
  localStorage.clear();
  const first = setSuggestionStatus('routine-evening', 'applied');
  const json1 = localStorage.getItem(PREF_LEARN_KEY);
  const second = setSuggestionStatus('routine-evening', 'applied');
  assert.deepEqual(second, first, '第二次写结果与第一次一致');
  assert.equal(localStorage.getItem(PREF_LEARN_KEY), json1, '落盘字节也一致');
  assert.deepEqual(Object.keys(second.statuses), ['routine-evening'], '不产生重复条目');
});

test('存储: 采纳后可改忽略（覆盖语义），不同 id 互不干扰', () => {
  localStorage.clear();
  setSuggestionStatus('routine-evening', 'applied');
  setSuggestionStatus('estimate', 'dismissed');
  setSuggestionStatus('routine-evening', 'dismissed');
  const s = loadPrefLearnState();
  assert.equal(s.statuses['routine-evening'], 'dismissed');
  assert.equal(s.statuses['estimate'], 'dismissed');
  assert.equal(Object.keys(s.statuses).length, 2);
});

test('存储: 总开关翻转 + 清除学习记录（statuses 归零、enabled 保留、不碰 behaviorLog）', () => {
  localStorage.clear();
  setSuggestionStatus('routine-evening', 'applied');
  const off = setPrefLearnEnabled(false);
  assert.equal(off.enabled, false);
  const cleared = clearPrefLearn();
  assert.deepEqual(cleared.statuses, {});
  assert.equal(cleared.enabled, false, '清除只清处置表，不动开关');
  assert.deepEqual(loadRecords(), [], 'behaviorLog 的执行记录不受影响');
});

test('存储: 坏 JSON / 坏形状 → 回落默认（不抛错）', () => {
  localStorage.clear();
  localStorage.setItem(PREF_LEARN_KEY, '{ 这不是合法 JSON');
  assert.deepEqual(loadPrefLearnState(), defaultPrefLearnState());
  localStorage.setItem(PREF_LEARN_KEY, JSON.stringify({ version: 2, enabled: true, statuses: {} }));
  assert.deepEqual(loadPrefLearnState(), defaultPrefLearnState(), '不认未来版本');
  localStorage.setItem(PREF_LEARN_KEY, JSON.stringify({ version: 1, enabled: 'yes', statuses: {} }));
  assert.deepEqual(loadPrefLearnState(), defaultPrefLearnState(), 'enabled 非布尔');
  localStorage.setItem(PREF_LEARN_KEY, JSON.stringify({ version: 1, enabled: true, statuses: { x: '未知状态' } }));
  assert.deepEqual(loadPrefLearnState(), defaultPrefLearnState(), 'status 值不在枚举里');
});

/* ============================================================
 * 六、withStatus：状态叠加
 * ========================================================== */

test('withStatus: 命中的填 status，未处置的**没有** status 键（缺席 ≠ false）', () => {
  const records = [
    ...Array.from({ length: 6 }, (_, i) => rec({ id: `m1-${i}`, blockId: `m1${i}`, status: 'skipped' })),
    ...Array.from({ length: 8 }, (_, i) => rec({ id: `m2-${i}`, blockId: `m2${i}`, plannedMin: 60, actualMin: 30, startMin: undefined })),
  ];
  const sug = learnPrefs(records, NOW);
  // W12 断言漂移申报：6 skipped → weights-churn 也产出（总数 3）；本测聚焦 routine/estimate 的叠加语义
  assert.equal(sug.filter((s) => s.kind !== 'weights').length, 2);
  const merged = withStatus(sug, { estimate: 'dismissed' });
  const routine = merged.find((s) => s.id === 'routine-evening')!;
  const estimate = merged.find((s) => s.id === 'estimate')!;
  assert.ok(!('status' in routine), '未处置不该带 status 键');
  assert.equal(estimate.status, 'dismissed');
  assert.deepEqual(withStatus(sug, {}), sug.map((s) => ({ ...s })), '空表 = 原样（仅浅拷贝）');
});

/* ============================================================
 * 七、窗口与工具函数（边界直接钉死）
 * ========================================================== */

test('recordDay: 取 at 的日期部分；坏时间戳 → null（自动过滤）', () => {
  assert.equal(recordDay(rec({ at: '2026-10-20T21:00:00.000Z' })), '2026-10-20');
  assert.equal(recordDay(rec({ at: '' })), null);
  assert.equal(recordDay(rec({ at: 'not-a-date' })), null);
});

test('inWindow: 窗口内 true；窗外 / 未来 / 坏 now → false', () => {
  const r = rec({});
  assert.equal(inWindow(r, NOW), true);
  assert.equal(inWindow(rec({ at: '2026-09-01T10:00:00.000Z' }), NOW), false);
  assert.equal(inWindow(rec({ at: '2026-11-01T10:00:00.000Z' }), NOW), false);
  assert.equal(inWindow(r, 'garbage'), false, 'now 不可解析 → 宁可全滤也不误报');
});

test('median: 奇数取中位、偶数取平均、空 → NaN', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

/* ============================================================
 * 八、behaviorLog 小改：startMin / place 可选字段（只增不改）
 * ========================================================== */

test('behaviorLog: markBlock 透传 startMin/place → 存储往返保留', () => {
  localStorage.clear();
  markBlock({
    blockId: 'b-x', date: '2026-10-24', weekNo: 8, kind: 'study', title: '深度学习',
    plannedMin: 90, status: 'skipped', startMin: 1200, place: '图书馆',
  });
  const loaded = loadRecords();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].startMin, 1200);
  assert.equal(loaded[0].place, '图书馆');
});

test('behaviorLog: 不传新字段 → 字段**缺席**（不写 undefined，旧形状逐字节不变）', () => {
  localStorage.clear();
  markBlock({
    blockId: 'b-y', date: '2026-10-24', weekNo: 8, kind: 'study', title: '自习',
    plannedMin: 60, status: 'done',
  });
  const loaded = loadRecords();
  assert.equal(loaded.length, 1);
  assert.ok(!('startMin' in loaded[0]), 'startMin 不该出现');
  assert.ok(!('place' in loaded[0]), 'place 不该出现');
  assert.ok(!('actualMin' in loaded[0]), 'actualMin 原语义不变');
});

test('behaviorLog: place 空串视为没传（不给记录塞垃圾空值）', () => {
  localStorage.clear();
  markBlock({
    blockId: 'b-z', date: '2026-10-24', weekNo: 8, kind: 'study', title: '自习',
    plannedMin: 60, status: 'done', place: '  ',
  });
  assert.ok(!('place' in loadRecords()[0]));
});

test('behaviorLog: isRecord 放宽 —— 带新字段的合法记录保留，新字段类型坏则该条被滤', () => {
  localStorage.clear();
  localStorage.setItem('usst-behavior-log-v1', JSON.stringify([
    { id: 'ok1@2026-10-24', blockId: 'ok1', date: '2026-10-24', weekNo: 8, kind: 'study',
      title: '带新字段', plannedMin: 60, status: 'done', startMin: 1200, place: '图书馆', at: '2026-10-24T10:00:00.000Z' },
    { id: 'ok2@2026-10-24', blockId: 'ok2', date: '2026-10-24', weekNo: 8, kind: 'study',
      title: '旧形状', plannedMin: 60, status: 'skipped', at: '2026-10-24T10:00:00.000Z' },
    { id: 'bad1@2026-10-24', blockId: 'bad1', date: '2026-10-24', weekNo: 8, kind: 'study',
      title: 'startMin 不是数', plannedMin: 60, status: 'done', startMin: '20:00', at: '2026-10-24T10:00:00.000Z' },
    { id: 'bad2@2026-10-24', blockId: 'bad2', date: '2026-10-24', weekNo: 8, kind: 'study',
      title: 'place 不是串', plannedMin: 60, status: 'done', place: 42, at: '2026-10-24T10:00:00.000Z' },
  ]));
  const loaded = loadRecords();
  assert.deepEqual(loaded.map((r) => r.id), ['ok1@2026-10-24', 'ok2@2026-10-24'],
    '好条目（含旧形状）保留；新字段类型坏的整条过滤（沿用既有逐条校验口径）');
});

/* ============================================================
 * W12（v1.5，2026-10-25）：两条全局权重规则
 * RV：摘 learnWeights 的门槛（W1/W2_MIN_N）→ 对应触发用例恰红
 * ========================================================== */
import {
  W1_DELETE_MIN_N, W2_REPLAN_MIN_N, W1_BLANK_FACTOR, W2_CHURN_FACTOR,
} from '@/lib/prefLearn';

function wr(id: number, over: Partial<BehaviorRecord>) {
  return { id: 'w' + id, blockId: 'x' + id, at: '2026-10-20T21:00:00.000Z', weekNo: 4,
    status: 'skipped', plannedMin: 60, ...over } as BehaviorRecord;
}

test('W12-① W-1 高频删活动块 → blankDeficit 微降建议（weightsPatch 在场）', () => {
  const recs = Array.from({ length: W1_DELETE_MIN_N }, (_, i) =>
    wr(i, { kind: 'activity' }));
  const out = learnPrefs(recs, '2026-10-25');
  const w = out.find((s) => s.id === 'weights-blank');
  assert.ok(w, '应产出 weights-blank 建议');
  assert.equal(w.kind, 'weights');
  assert.deepEqual(w.weightsPatch, { blankDeficit: Number(W1_BLANK_FACTOR.toFixed(2)) });
  assert.match(w.text, /松一点/);
});

test('W12-② 样本不足（删除 < 门槛）→ W-1 不开口', () => {
  const recs = Array.from({ length: W1_DELETE_MIN_N - 1 }, (_, i) =>
    wr(i, { kind: 'activity' }));
  const out = learnPrefs(recs, '2026-10-25');
  assert.equal(out.find((s) => s.id === 'weights-blank'), undefined);
});

test('W12-③ W-2 高频变动 → churn 微升建议（churn 底数 0.8 × 因子）', () => {
  const recs = Array.from({ length: W2_REPLAN_MIN_N }, (_, i) => wr(i + 50, {}));
  const out = learnPrefs(recs, '2026-10-25');
  const w = out.find((s) => s.id === 'weights-churn');
  assert.ok(w, '应产出 weights-churn 建议');
  assert.deepEqual(w.weightsPatch, { churn: Number((0.8 * W2_CHURN_FACTOR).toFixed(2)) });
});

test('W12-④ 窗口外旧记录不计入 W-1/W-2（窗口过滤同 R1-R3）', () => {
  const old = Array.from({ length: 20 }, (_, i) =>
    wr(i, { kind: 'activity', at: '2026-08-01T21:00:00.000Z', weekNo: 1 }));
  const out = learnPrefs(old, '2026-10-25');
  assert.equal(out.find((s) => s.kind === 'weights'), undefined, '窗口外不应触发任何 weights 建议');
});

test('W12-⑤ 零权重路径：无输入 → 零建议零 weightsPatch（golden 零漂移地基）', () => {
  const out = learnPrefs([], '2026-10-25');
  assert.deepEqual(out, []);
  assert.equal(out.every((s) => !s.weightsPatch), true);
});
