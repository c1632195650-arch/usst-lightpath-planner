/**
 * 批次 1（交互升级方案 2026-10-02）· 解析层：钟点时刻通道 + 时长推导 + 频率互斥
 * ============================================================
 * 修的三个真机问题：
 *   ① 「周六晚上大概6点左右；大概打到8点」→ 仍重问「大概占多久？」
 *      （钟点时刻通道整体缺失：WhenHint 只有日粒度，spanDurationMin 只折时长）
 *   ② 「周五下午；每天两小时」→ 草稿出现「频率：每周 7 次」
 *      （extractFrequency 的「每天」无条件全句命中）
 *   ③ 用户点明 6-8 点，块却被泛排到别的时段（钟点丢失后只剩 window 泛排）
 *
 * 设计约束（方案 §〇.2 加法通道）：
 *   · 句子里没有钟点词 → clock 不产出 → 后续路径与批次 0 锚逐位一致；
 *   · 频率互斥只拦「每天+时长单位」，「每周N次」「每天都来（无时长）」不变；
 *   · 逃生门 LIBAO_CLOCK=0 → 钟点通道整体关闭，回到批次 0 行为。
 *
 * ⚠️ 反向验证（reversed-verified）：
 *   · 删 parseIntentSlots 的时长推导 → 「…6点到8点」重现 effort 追问 → 本文件红；
 *   · 删 extractFrequency 互斥 → 「每天两小时」重现 perWeekCount=7 → 本文件红；
 *   · 删 goalToTasks 的 clock 收窄 → notBeforeMin 回退 window/默认 → 本文件红。
 *   三处删改的实测红记录见 commit message。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Schedule } from '@/types';
import {
  extractClockRange,
  mergeLlmPrimary,
  parseIntentSlots,
} from '@/features/libao/libaoIntent';
import { goalToTasks, checkGoalFeasibility } from '@/features/libao/weekPlanForChat';

const TODAY = '2026-09-07'; // 周一

/* ============================================================
 * 一、extractClockRange：钟点起止解析（分钟 0-1440）
 * ========================================================== */

test('钟点 · 「周六晚上大概6点左右；大概打到8点」→ 18:00-20:00', () => {
  const c = extractClockRange('周六晚上大概6点左右；大概打到8点');
  assert.ok(c, '应产出 clock');
  assert.equal(c!.startMin, 18 * 60);
  assert.equal(c!.endMin, 20 * 60);
});

test('钟点 · 「晚上6点到8点」数字形态', () => {
  const c = extractClockRange('晚上6点到8点');
  assert.equal(c!.startMin, 1080);
  assert.equal(c!.endMin, 1200);
});

test('钟点 · 「六点半到八点」中文数字 + 点半', () => {
  const c = extractClockRange('六点半到八点');
  assert.equal(c!.startMin, 6 * 60 + 30);
  assert.equal(c!.endMin, 8 * 60);
  // 无时段语境 → 24 小时歧义要标注（按上午口径落，草稿卡如实说明）
  assert.equal(c!.ambig, true);
});

test('钟点 · 「明天下午3点到5点」语境提升 下午→15:00/17:00', () => {
  const c = extractClockRange('明天下午3点到5点');
  assert.equal(c!.startMin, 15 * 60);
  assert.equal(c!.endMin, 17 * 60);
  assert.equal(c!.ambig, undefined);
});

test('钟点 · 单端点：只给 end（「打到8点」）/ 只给 start（「晚上6点」）', () => {
  const end = extractClockRange('晚上打到8点');
  assert.equal(end!.endMin, 20 * 60);
  assert.equal(end!.startMin, undefined);

  const start = extractClockRange('晚上6点开始');
  assert.equal(start!.startMin, 1080);
  assert.equal(start!.endMin, undefined);
});

test('钟点 · 没有钟点词 → undefined（加法通道：路径与批次 0 逐位一致）', () => {
  assert.equal(extractClockRange('周四晚上出去玩一小时'), undefined);
  assert.equal(extractClockRange('帮我排个实验报告'), undefined);
  assert.equal(extractClockRange('下周一开始；一共10小时'), undefined);
});

/* ============================================================
 * 二、parseIntentSlots 接线：clock 产出 + 时长推导（消灭「占多久」重问）
 * ========================================================== */

test('推导 · 「周六晚上大概6点左右；大概打到8点」→ durationMin=120，effort 不再算缺', () => {
  const s = parseIntentSlots('周六晚上大概6点左右；大概打到8点', TODAY);
  assert.deepEqual(s.clock && { startMin: s.clock.startMin, endMin: s.clock.endMin }, { startMin: 1080, endMin: 1200 });
  assert.equal(s.durationMin, 120, '时长应由钟点区间自动推导');
  assert.ok(!s.missing.includes('effort'), `effort 不该被追问，实际 missing=${s.missing.join(',')}`);
});

test('推导 · 「明天下午3点到5点」→ when+effort 一句补齐（单日事件）', () => {
  const s = parseIntentSlots('明天下午3点到5点自习', TODAY);
  assert.equal(s.durationMin, 120);
  assert.equal(s.when?.relativeDays, 1);
  assert.ok(!s.missing.includes('effort'));
  assert.ok(!s.missing.includes('when'));
});

test('歧义 · 「周一6点」无语境 → 按上午口径落 06:00 且 unclear 注记', () => {
  const s = parseIntentSlots('周一6点跑步', TODAY);
  assert.equal(s.clock?.startMin, 360);
  assert.ok(s.unclear.some((u) => u.includes('6点')), `应有 24 小时歧义注记，实际：${s.unclear.join('｜')}`);
});

test('矛盾 · 「下午6点到8点」钟点与时段窗冲突 → 以 clock 为准 + unclear 注记', () => {
  const s = parseIntentSlots('下午6点到8点跑步', TODAY);
  assert.equal(s.clock?.startMin, 1080);
  assert.equal(s.window, undefined, '矛盾时 window 让位');
  assert.ok(s.unclear.some((u) => u.includes('按你说的钟点排')), `应有矛盾注记，实际：${s.unclear.join('｜')}`);
});

/* ============================================================
 * 三、频率互斥：「每天两小时」是节奏描述不是频率承诺
 * ========================================================== */

test('互斥 · 「周五下午；每天两小时」→ durationMin=120 且 perWeekCount 不再是 7', () => {
  const s = parseIntentSlots('周五下午；每天两小时', TODAY);
  assert.equal(s.durationMin, 120);
  assert.equal(s.perWeekCount, undefined);
});

test('互斥 · 「每天两小时」不产频率；「每天+动词+时长」是真每日习惯仍=7（金标 i14 口径）', () => {
  assert.equal(parseIntentSlots('每天两小时', TODAY).perWeekCount, undefined);
  // 金标 i14 同款语序：每天 与 时长单位 之间隔着「晚上背」→ 不是「每天+时长」误产，保持 7
  const i14 = parseIntentSlots('我想每天晚上背半小时单词', TODAY);
  assert.equal(i14.perWeekCount, 7);
  assert.equal(i14.durationMin, 30);
});

/* ============================================================
 * 四、逃生门：LIBAO_CLOCK=0 → 钟点通道整体关闭，回批次 0 行为
 * ========================================================== */

test('逃生门 · LIBAO_CLOCK=0 → clock 不产出、推导不生效', () => {
  process.env.LIBAO_CLOCK = '0';
  try {
    const s = parseIntentSlots('周六晚上大概6点左右；大概打到8点', TODAY);
    assert.equal(s.clock, undefined);
    assert.equal(s.durationMin, undefined, '逃生门下推导一并关闭（时长回到追问路径）');
  } finally {
    delete process.env.LIBAO_CLOCK;
  }
});

/* ============================================================
 * 五、LLM 通道：understand patch 的 startMin/endMin → clock（fill-if-empty）
 * ========================================================== */

test('mergeLlmPrimary · patch.clock 补空 + 推导；规则层已有 clock 不被覆盖', () => {
  const rule = parseIntentSlots('明天要打球', TODAY);
  const merged = mergeLlmPrimary(rule, { clock: { startMin: 1080, endMin: 1200, text: '6点到8点' } }, TODAY);
  assert.equal(merged.clock?.startMin, 1080);
  assert.equal(merged.durationMin, 120, 'LLM 通道同样吃时长推导');

  const hasClock = parseIntentSlots('晚上6点到8点跑步', TODAY);
  const kept = mergeLlmPrimary(hasClock, { clock: { startMin: 600, endMin: 660, text: '10点到11点' } }, TODAY);
  assert.equal(kept.clock?.startMin, 1080, '规则层从原话抽到的钟点优先');
});

test('源码锁 · mapUnderstandPatch 透传 startMin/endMin 为 clock', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'src', 'features', 'libao', 'LbaoChat.tsx'), 'utf8');
  assert.ok(src.includes('p.startMin'), 'mapUnderstandPatch 应读取 p.startMin');
  assert.ok(src.includes('p.endMin'), 'mapUnderstandPatch 应读取 p.endMin');
  assert.ok(/patch\.clock\s*=/.test(src), '应拼装 patch.clock');
});

/* ============================================================
 * 六、绝对时刻进引擎（零引擎改动）：goalToTasks 用 clock 收窄 notBefore/notAfter
 * ========================================================== */

const SCHEDULE: Schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: '2026-09-07',
  totalWeeks: 20,
  source: 'demo',
  courses: [],
};

function slotsBase() {
  const s = parseIntentSlots('明天要打球', TODAY);
  return mergeLlmPrimary(s, { title: '打球' }, TODAY);
}

test('引擎收窄 · clock 双端点 → notBeforeMin/notAfterMin 按钟点', () => {
  const s = { ...slotsBase(), clock: { startMin: 1080, endMin: 1200, text: '6点到8点' } };
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  assert.ok(tasks.length > 0);
  for (const t of tasks) {
    assert.equal(t.notBeforeMin, 1080);
    assert.equal(t.notAfterMin, 1200);
  }
});

test('引擎收窄 · 单端点 end + window → start 取 window 起点（软偏好哲学不变）', () => {
  const s = {
    ...slotsBase(),
    window: { fromMin: 1080, toMin: 1380, text: '晚上' },
    clock: { startMin: undefined, endMin: 1200, text: '打到8点' },
  };
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  assert.ok(tasks.length > 0);
  assert.equal(tasks[0].notBeforeMin, 1080, 'startMin 缺失 → 退 window 起点');
  assert.equal(tasks[0].notAfterMin, 1200);
});

test('口径说明进草稿卡 · ambig/conflicted → caveats（不许装作听懂）', () => {
  const ambig = { ...slotsBase(), durationMin: 120, missing: [], clock: { startMin: 360, endMin: 480, text: '6点到8点', ambig: true } };
  const v = checkGoalFeasibility({ slots: ambig, schedule: SCHEDULE, profile: null, today: TODAY });
  assert.ok(v.caveats.some((c) => c.includes('上下午')), `应有歧义口径说明，实际：${v.caveats.join('｜')}`);

  const conflicted = { ...slotsBase(), durationMin: 120, missing: [], clock: { startMin: 1080, endMin: 1200, text: '6点到8点', conflicted: '下午' } };
  const v2 = checkGoalFeasibility({ slots: conflicted, schedule: SCHEDULE, profile: null, today: TODAY });
  assert.ok(v2.caveats.some((c) => c.includes('按你说的钟点排')), `应有矛盾改判说明，实际：${v2.caveats.join('｜')}`);
});
