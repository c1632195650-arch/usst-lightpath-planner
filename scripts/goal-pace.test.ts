/**
 * 批 2 · 有截止目标的后程加长（铺块节奏，6C）
 * ============================================================
 * 实测发现（2026-10-02 探针）：goalToTasks 对 30h/10 周的备考目标**均匀取样**，
 * 截止前与开局节奏一样 —— 距考试还有三天和还有十周的人排一样的块长，不像备考。
 * 修复：仅当「给了总量 + 有截止 + 没显式给单次时长」且块数 ≥3 时启用块长阶梯
 * （窗口前 1/3=60 / 中 1/3=90 / 后 1/3=120），总时长守恒由均匀取样的近似保证。
 *
 * ⚠️ 反向验证：把 blockLenFor 还原成恒定 blockMin，②③ 组立刻变红。
 * 手算锚点：10-05→12-12 共 69 天、nBlocks=ceil(1800/90)=20、取样点均匀 ——
 * 前中后三段样本数 7/7/6，总时长 = 7×60+7×90+6×120 = 1770（±90 容差内）。
 */
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) as string : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalToTasks } from '@/features/libao/weekPlanForChat';
import { MOCK_SCHEDULE } from '@/data/usst';

const TODAY = '2026-10-02';
const base = (p: Record<string, unknown>) => ({
  intent: 'create', title: '', certainty: 'unknown', priorityHint: 70,
  missing: [], unclear: [], raw: '（探针构造）', ...p,
}) as Parameters<typeof goalToTasks>[0];

const EXAM_WINDOW = { dateFrom: '2026-10-05', dateTo: '2026-12-12', certainty: 'exact' as const };

test('节奏：30h 备考六级 —— 后 1/3 窗口的块平均时长 > 前 1/3（冲刺形态）', () => {
  const tasks = goalToTasks(base({
    title: '六级真题', essential: true, totalHours: 30, ...EXAM_WINDOW,
    raw: '六级12月12日考，一共准备30小时',
  }), MOCK_SCHEDULE, TODAY);
  assert.ok(tasks.length >= 10, `块数过少：${tasks.length}`);

  const dayOf = (t: { weeks: number[]; dayOfWeek: number }) => (t.weeks[0] - 1) * 7 + t.dayOfWeek;
  const start = 7 + 3; // 2026-10-05 = 第2周周一 → 绝对日 10（第1周周一=1）
  const sorted = [...tasks].sort((a, b) => dayOf(a) - dayOf(b));
  const third = Math.floor(sorted.length / 3);
  const avg = (arr: typeof sorted) => arr.reduce((a, t) => a + t.durationMin, 0) / Math.max(1, arr.length);
  const first = avg(sorted.slice(0, third));
  const last = avg(sorted.slice(-third));
  assert.ok(last > first, `后程均值 ${last} 应大于前段均值 ${first}`);
});

test('节奏：总时长守恒（±90 容差）', () => {
  const tasks = goalToTasks(base({
    title: '六级真题', essential: true, totalHours: 30, ...EXAM_WINDOW,
  }), MOCK_SCHEDULE, TODAY);
  const total = tasks.reduce((a, t) => a + t.durationMin, 0);
  assert.ok(Math.abs(total - 1800) <= 90, `总时长 ${total} 应在 1800±90 内`);
});

test('节奏：确定性 —— 同输入两次完全一致', () => {
  const a = goalToTasks(base({ title: '六级真题', totalHours: 30, ...EXAM_WINDOW }), MOCK_SCHEDULE, TODAY);
  const b = goalToTasks(base({ title: '六级真题', totalHours: 30, ...EXAM_WINDOW }), MOCK_SCHEDULE, TODAY);
  assert.deepEqual(a, b);
});

test('节奏：习惯目标（无总量）不加权 —— 块长保持默认 90', () => {
  const tasks = goalToTasks(base({ title: '晨跑', perWeekCount: 3 }), MOCK_SCHEDULE, TODAY);
  assert.ok(tasks.length > 0);
  for (const t of tasks) assert.equal(t.durationMin, 90, '无截止的习惯目标不该被加长');
});

test('节奏：显式给单次时长 → 尊重用户，不加权', () => {
  const tasks = goalToTasks(base({
    title: '六级真题', totalHours: 30, durationMin: 45, ...EXAM_WINDOW,
  }), MOCK_SCHEDULE, TODAY);
  for (const t of tasks) assert.equal(t.durationMin, 45, '用户说的 45 分钟不许被阶梯覆盖');
});

test('节奏：块数过少（<3）不启用阶梯 —— 「一共 1 小时」仍是单块双保险', () => {
  const tasks = goalToTasks(base({
    title: '小作业', totalHours: 1, ...EXAM_WINDOW,
  }), MOCK_SCHEDULE, TODAY);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].durationMin, 60, '双保险：单块 = 总量 60 分钟');
});

test('节奏：加长时 note 要说出来（诚实纪律）', () => {
  const tasks = goalToTasks(base({
    title: '六级真题', totalHours: 30, ...EXAM_WINDOW,
  }), MOCK_SCHEDULE, TODAY);
  const noted = tasks.some((t) => (t.note ?? '').includes('加长') || (t.note ?? '').includes('临近截止'));
  assert.ok(noted, '阶梯节奏必须写进 note 让用户看见');
});
