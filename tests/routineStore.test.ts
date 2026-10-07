/**
 * Q1a 作息边界验收（问卷规格书 §2.5 / §6.2 / AC-9）
 * ============================================================
 * 验三件事：
 *   ① `routineStore` 纯函数：空值 / 坏数据逐字段回落 / 往返持久化；
 *   ② `routineToDayWindow()` 翻译规则（不猜纪律：任一未采集或 wake ≥ sleep → null）；
 *   ③ 引擎窗口（AC-9 口径，直接构造 `PlanRequest` 调引擎、不依赖 UI）：
 *      · `dayStart` / `dayEnd` → **引擎自己挑时间的块**必须整个落在窗口内；
 *      · 课表既成事实（课 / 通勤 / 用户自己钉死时间的块）**豁免** —— 见 `isFactBlock`。
 *
 * ⚠️ P2-3 收紧记录（原断言是弱的，且其中一条是空转的）：
 *   · 原 `dayStart='09:00' → 无 08:00 之前的块` 用硬编码阈值近似窗口语义，
 *     漏掉「08:00–08:59 的块」（真按 09:00 收窗口时它们才是违规的）；
 *   · 原 `dayEnd='22:00' → 无 22:00 之后的块` **在语料上是空转**：
 *     默认口径下最晚的块 20:45 就结束了，dayEnd 被完全忽略也照样绿。
 *     现改为「窗口内零越窗 + 对照组证明窗口真的在拉」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcOf = (rel: string) =>
  readFileSync(join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');

class MemStorage {
  _m = new Map();
  get length() { return this._m.size; }
  clear() { this._m.clear(); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  key(i) { return [...this._m.keys()][i] ?? null; }
  removeItem(k) { this._m.delete(k); }
  setItem(k, v) { this._m.set(k, String(v)); }
}
globalThis.localStorage = new MemStorage();

import {
  clearRoutine, emptyRoutine, loadRoutine, minutesToHHMM, normalizeRoutine,
  routineFromHHMM, routineToDayWindow, ROUTINE_SCHEMA_VERSION, saveRoutine, STORAGE_KEY,
} from '@/features/week/routineStore';
import { planWeekV2 } from '@/lib/planner/index.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';

/* ============================================================
 * 一、store 纯函数
 * ========================================================== */

test('Q1a: 空作息设置结构正确（全 null，不猜）', () => {
  const e = emptyRoutine();
  assert.equal(e.schemaVersion, ROUTINE_SCHEMA_VERSION);
  assert.equal(e.wakeMin, null);
  assert.equal(e.sleepMin, null);
  assert.equal(e.weekdayDiffMin, null);
  assert.equal(e.napMin, null);
});

test('Q1a: minutesToHHMM 格式化', () => {
  assert.equal(minutesToHHMM(450), '07:30');
  assert.equal(minutesToHHMM(1410), '23:30');
  assert.equal(minutesToHHMM(0), '00:00');
});

/* ---------- Q1b：界面草稿 → 设置（采集 UI 的取值口）---------- */

test('Q1b: routineFromHHMM 合法输入 → 可存设置，且能翻出正确的引擎窗口（闭环）', () => {
  const res = routineFromHHMM('09:30', '23:30');
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.routine.wakeMin, 9 * 60 + 30);
  assert.equal(res.routine.sleepMin, 23 * 60 + 30);
  // 闭环：这一步是关键 —— 采到的值必须真能翻成引擎读得懂的窗口
  assert.deepEqual(routineToDayWindow(res.routine), { dayStart: '09:30', dayEnd: '23:30' });
});

test('Q1b: 一位数小时也接受（0:00 / 7:30），归一化交给 toMinutes', () => {
  const a = routineFromHHMM('7:30', '23:00');
  assert.equal(a.ok, true);
  if (a.ok) assert.equal(routineToDayWindow(a.routine)?.dayStart, '07:30');
  const b = routineFromHHMM('0:00', '23:59');
  assert.equal(b.ok, true);
  if (b.ok) assert.equal(routineToDayWindow(b.routine)?.dayStart, '00:00');
});

test('Q1b: 格式不合法 → unparsable（界面据此提示「时间没看懂」）', () => {
  // 空的 / 缺分钟 / 越界 —— 这些都必须落到「格式」而不是「顺序」，
  // 否则界面会指错地方（把「格式没看懂」说成「起床晚于入睡」）
  for (const [w, s] of [
    ['', '23:00'], ['07', '23:00'], ['07:00', ''], ['24:00', '23:00'],
    ['23:60', '23:59'], ['晚上七点', '23:00'], ['7:5', '23:00'],
  ] as Array<[string, string]>) {
    const res = routineFromHHMM(w, s);
    assert.equal(res.ok, false, `「${w}」/「${s}」应被拒`);
    if (!res.ok) assert.equal(res.reason, 'unparsable', `「${w}」/「${s}」的拒绝原因应为格式`);
  }
});

test('Q1b: 起床 ≥ 入睡 → order（跨午夜作息本版表达不了，不猜）', () => {
  for (const [w, s] of [['23:00', '07:00'], ['08:00', '08:00'], ['22:00', '06:00']] as Array<[string, string]>) {
    const res = routineFromHHMM(w, s);
    assert.equal(res.ok, false, `「${w}」/「${s}」应被拒`);
    if (!res.ok) assert.equal(res.reason, 'order');
  }
  // 反空转对照：把上面第一组调成合法顺序就该通过 —— 证明确实是「顺序」判据在起作用
  assert.equal(routineFromHHMM('07:00', '23:00').ok, true);
});

test('Q1b: 未采集的两个预留字段保持 null（不擅自接进引擎）', () => {
  const res = routineFromHHMM('08:00', '23:00');
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.routine.weekdayDiffMin, null, 'weekdayDiffMin 消费口径未定，不该被采集');
  assert.equal(res.routine.napMin, null, 'napMin 消费口径未定，不该被采集');
  assert.equal(res.routine.schemaVersion, ROUTINE_SCHEMA_VERSION);
});

test('Q1a: 未采集 / wake ≥ sleep → 翻译为 null（不猜窗口）', () => {
  assert.equal(routineToDayWindow(null), null);
  assert.equal(routineToDayWindow(emptyRoutine()), null, '全 null 不该产出窗口');
  assert.equal(
    routineToDayWindow({ ...emptyRoutine(), wakeMin: 540 }),
    null,
    '只采集了起床 → null',
  );
  assert.equal(
    routineToDayWindow({ ...emptyRoutine(), wakeMin: 900, sleepMin: 540 }),
    null,
    'wake ≥ sleep（跨午夜表达不了）→ null，绝不猜纠正值',
  );
  assert.equal(
    routineToDayWindow({ ...emptyRoutine(), wakeMin: 540.5, sleepMin: 1380 }),
    null,
    '非整数分钟 → null',
  );
});

test('Q1a: 合法作息 → dayStart/dayEnd 的 HH:MM', () => {
  const w = routineToDayWindow({ ...emptyRoutine(), wakeMin: 450, sleepMin: 1410 });
  assert.deepEqual(w, { dayStart: '07:30', dayEnd: '23:30' });
});

test('Q1a: normalize 坏数据逐字段回落，不连累整份设置', () => {
  const n = normalizeRoutine({
    schemaVersion: 1,
    wakeMin: 450,
    sleepMin: '23:30',       // 类型错 → null
    weekdayDiffMin: -5,      // 越界 → null
    napMin: 9999,            // 越界 → null
  });
  assert.ok(n);
  assert.equal(n.wakeMin, 450);
  assert.equal(n.sleepMin, null);
  assert.equal(n.weekdayDiffMin, null);
  assert.equal(n.napMin, null);
});

test('Q1a: 版本不符 / 非对象 → null（按未采集处理）', () => {
  assert.equal(normalizeRoutine({ schemaVersion: 99, wakeMin: 450 }), null);
  assert.equal(normalizeRoutine('garbage'), null);
  assert.equal(normalizeRoutine(null), null);
});

/* ============================================================
 * 二、存储往返（Node 内存垫片）
 * ========================================================== */

test('Q1a: save → load 往返一致；坏 JSON 落空；clear 生效', () => {
  saveRoutine({ ...emptyRoutine(), wakeMin: 450, sleepMin: 1410 });
  const loaded = loadRoutine();
  assert.equal(loaded.wakeMin, 450);
  assert.equal(loaded.sleepMin, 1410);

  localStorage.setItem(STORAGE_KEY, '{broken json');
  assert.deepEqual(loadRoutine(), emptyRoutine(), '坏 JSON → 空设置，不抛');

  clearRoutine();
  assert.deepEqual(loadRoutine(), emptyRoutine());
});

/* ============================================================
 * 三、引擎窗口（AC-9：直接调引擎，不依赖 UI）
 * ========================================================== */

/**
 * 「既成事实」块：时间**不由引擎决定**，所以窗口约束对它们不成立 ——
 *   · `kind === 'course'` —— 导入课表里的课（`commute` 是它衍生的通勤）；
 *   · `source === 'user'` —— 用户自己钉死时间的块。引擎给它标 `locked:true`，
 *     reason 原文「你自己指定的时间，重排时会锁定不动」。
 * 其余块（`source === 'template'` 的 meal / study / activity）时间是引擎挑的，必须落在窗口内。
 *
 * ⚠️ 判据是**实测出来的，不要退回宽松阈值**。用它在 9 种 `dayStart × dayEnd` 组合上实测：
 * 越窗块恒为 0，且引擎自选块的跨度**恰好顶满窗口**（`dayStart=09:00/dayEnd=18:00` 时
 * 全局跨度 = [09:00, 17:50]）—— 说明窗口真的在起作用，不是在空转。
 */
const isFactBlock = (b: { kind: string; source?: string }): boolean =>
  b.kind === 'course' || b.kind === 'commute' || b.source === 'user';

interface BlockLike {
  id: string;
  kind: string;
  source?: string;
  startMin: number;
  endMin: number;
}

/** 越出窗口的「引擎自选块」（既成事实豁免）；返回可读清单便于报错定位 */
function outOfWindow(blocks: readonly BlockLike[], win: { startMin: number; endMin: number }): string[] {
  return blocks
    .filter((b) => !isFactBlock(b) && (b.startMin < win.startMin || b.endMin > win.endMin))
    .map((b) => `${b.kind}:${b.id}@${b.startMin}-${b.endMin}`);
}

/** 引擎自选块的实际跨度 —— 用来做「对照组」，证明窗口断言不是空转 */
function spanOfTemplateBlocks(blocks: readonly BlockLike[]): { minStart: number; maxEnd: number } {
  const fresh = blocks.filter((b) => !isFactBlock(b));
  assert.ok(fresh.length > 0, '一个「引擎自选块」都没有 —— 语料或引擎异常，本组对照失去意义');
  return {
    minStart: Math.min(...fresh.map((b) => b.startMin)),
    maxEnd: Math.max(...fresh.map((b) => b.endMin)),
  };
}

test('AC-9: dayStart=09:00 / dayEnd=18:00 → 引擎自选块必须整个落在窗口内（既成事实豁免）', () => {
  for (const g of GOLDEN_INPUTS) {
    const req = { ...toPlanRequest(buildGoldenInput(g)), dayStart: '09:00', dayEnd: '18:00' };
    const res = planWeekV2(req);
    assert.deepEqual(
      outOfWindow(res.plan.blocks, { startMin: 9 * 60, endMin: 18 * 60 }),
      [],
      `${g.name} 有引擎自选块越出 09:00–18:00`,
    );
  }
});

test('AC-9 对照组：默认窗口(07:00–23:00)下确有引擎自选块落在窗口外 → 上一条不是空转', () => {
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = 0;
  for (const g of GOLDEN_INPUTS) {
    const { minStart: s, maxEnd: e } = spanOfTemplateBlocks(
      planWeekV2(toPlanRequest(buildGoldenInput(g))).plan.blocks,
    );
    minStart = Math.min(minStart, s);
    maxEnd = Math.max(maxEnd, e);
  }
  assert.ok(
    minStart < 9 * 60,
    `默认口径下最早的引擎自选块已是 ${minStart}（≥09:00）—— 收紧后的 dayStart 断言会变成空转`,
  );
  assert.ok(
    maxEnd > 18 * 60,
    `默认口径下最晚的引擎自选块只到 ${maxEnd}（≤18:00）—— 收紧后的 dayEnd 断言会变成空转`,
  );
});

test('AC-9: 作息窗口经 routineToDayWindow 翻译后同样生效（组装层同款路径）', () => {
  const g = GOLDEN_INPUTS.find((x) => x.name === 'week-12-crosscampus');
  assert.ok(g);
  const window = routineToDayWindow({ ...emptyRoutine(), wakeMin: 540, sleepMin: 1080 }); // 09:00–18:00
  assert.ok(window, '翻译不应为 null');
  assert.deepEqual(window, { dayStart: '09:00', dayEnd: '18:00' });
  const res = planWeekV2({ ...toPlanRequest(buildGoldenInput(g)), ...window });
  assert.deepEqual(
    outOfWindow(res.plan.blocks, { startMin: 540, endMin: 1080 }),
    [],
    '经 store 翻译的 09:00–18:00 窗口未被引擎遵守',
  );
});

/* ============================================================
 * 四、静态守卫：**「采集 → 组装层 → 引擎」这条链不许被静默剪断**
 * ============================================================
 * 问卷规格书 AC-8 担心的是「字段采到了、引擎却没读到」（漏接）。
 * 作息这条链更长：UI 写 store → 组装层翻译 → 展开进 `PlanRequest` → 引擎读。
 * 任何一环被删掉，**运行时都不会报错** —— 只是又变回「07:00 排出没起床的块」，
 * 而单测全绿（因为它们只验各环自身）。所以这里把三环的存在性钉死。
 */

test('Q1b 守卫：组装层确实把作息窗口展开进了 PlanRequest（否则整条链是死代码）', () => {
  const code = srcOf('src/features/week/useWeekPlan.ts');
  assert.match(
    code,
    /\.\.\.\(dayWindow \?\? \{\}\)/,
    '组装层不再把 dayWindow 展开进 PlanRequest —— 采到的作息不会生效',
  );
  assert.match(code, /loadRoutine\(\)/, '组装层不再读 routineStore —— 界面设了也没用');
  assert.match(
    code,
    /routineToDayWindow\(/,
    '组装层不再做「分钟数 → HH:MM」的翻译 —— 引擎读不懂裸的分钟数',
  );
});

test('Q1b 守卫：采集 UI 的两个入口都还在（我的画像页 + 首次设置）', () => {
  // 2026-10-07：入口从「周计划页工具面板」搬到「我的画像」页 ——
  // 搬到 `HardBoundaryCard`（week 域），由组合根注入 `PersonaResult` 的 children 插槽
  // （不这么做就会新增 `persona → week` 跨域依赖，撞 AC-6·R5）。
  // 本用例的**原意不变**：老用户必须有一个「随时改作息」的入口，谁搬走了就得在守卫里补上。
  const card = srcOf('src/features/week/HardBoundaryCard.tsx');
  assert.match(
    card,
    /<RoutineSetting\b/,
    'HardBoundaryCard 不再挂 RoutineSetting —— 老用户没有改作息的入口了',
  );
  assert.match(
    card,
    /<HomeBaseSetting\b/,
    'HardBoundaryCard 不再挂 HomeBaseSetting —— 老用户没有改住处的入口了',
  );
  const app = srcOf('src/App.tsx');
  assert.match(
    app,
    /<HardBoundaryCard\s*\/>/,
    'App 不再把 HardBoundaryCard 注入「我的画像」页 —— 卡片写了也没人渲染',
  );
  // 2026-09-28：作息从「问卷之后独立一阶段（RoutineSetup）」合并进「个人信息」那一步，
  // 入口变成 week 域的 OnboardingSetup，由组合根注入 BasicInfoStep 的 children。
  assert.match(app, /import \{ OnboardingSetup \}/, 'App 不再引入首次设置的住处/作息采集块');
  assert.match(
    app,
    /<OnboardingSetup\b/,
    'onboarding 里没挂 OnboardingSetup —— 首次用户采不到住处/作息',
  );
});

test('Q1b 守卫：两个采集入口写同一个 store（不许各存一份）', () => {
  // OnboardingSetup 只是 RoutineSetting 的组合外壳 —— 它自己不该再碰 routine store，
  // 否则「面板里看到的」与「首次设置里存的」可能不是同一份数据。
  const setup = srcOf('src/features/week/OnboardingSetup.tsx');
  assert.match(setup, /import \{ RoutineSetting \}/, 'OnboardingSetup 应复用 RoutineSetting');
  for (const forbidden of ['saveRoutine', 'loadRoutine', 'clearRoutine']) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(setup),
      `OnboardingSetup 里出现了 ${forbidden} —— 它应当只做组合外壳，存储统一走 RoutineSetting`,
    );
  }
});
