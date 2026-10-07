/**
 * 周计划视图工具 · 纯函数护栏（P2-2；F2d 抽出的 `features/week/weekViewUtils.ts`）
 * ============================================================
 * 覆盖 `sameRolling` / `localizedDaysFor` / `nowMinutes` / `DAY_LABELS`。
 *
 * 📌 `DAY_LABELS` 的**真源已搬到 `lib/date.ts`**（2026-09-21 P2-5 去重），
 *    `weekViewUtils.ts` 只是 `export { DAY_LABELS } from '@/lib/date'` 转发。
 *    本文件仍从 `./weekViewUtils` 取它，顺带把「转发没断」也一并验了；
 *    **定义点唯一性**由 `tests/arch-guards.test.ts` 的 R6 三条守卫负责。
 *
 * ⚠️ **执行 P2-2 时才发现的前情**：这三个函数原本在仓里有**两份逐字节相同的拷贝**
 * —— `useWeekPlan.ts` 的私有副本 + `weekViewUtils.ts` 的导出，而且
 * `weekViewUtils` 的 `sameRolling` / `localizedDaysFor` / `nowMinutes`
 * **没有任何调用方**（只有 `DAY_LABELS` 被拖拽 hook 与视图用到）。
 * 也就是说：只给 `weekViewUtils` 写测试，测的是**死的那份**，真正跑在排程管线里的是私有副本。
 * 已按 P2-2 先做去重（`useWeekPlan.ts` 改为 `import ... from './weekViewUtils'`），
 * 本文件的断言因此落在**真实路径**上；文件末尾的静态守卫禁止再次长出副本。
 *
 * `nowMinutes` 读系统时钟：本文件**不做注入改造**（改签名会牵动调用点，且属运行时代码改动），
 * 改用「另一个独立时钟读数」当参照物来验「5 分钟取整」这一语义，见该用例注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DAY_LABELS, localizedDaysFor, nowMinutes, sameRolling } from '@/features/week/weekViewUtils.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', 'src');

/** 造一份合法的滚动状态；`over` 只覆盖需要变的那几个字段 */
const rolling = (over: Record<string, unknown> = {}) => ({
  recentLoad: [120, 300, 240],
  loadByDow: [0, 60, 90, 120, 150, 180, 210, 240],
  upcoming: [
    { id: 'a', title: '作业一', dueAtWeek: 5, urgency: 0.4 },
    { id: 'b', title: '作业二', dueAtWeek: 6, urgency: 0.7 },
  ],
  ...over,
});

/* ============================================================
 * sameRolling：等价判定（决定要不要多写一次 localStorage）
 * ========================================================== */

test('sameRolling：内容相同但是不同对象 → 等价（这正是不能用引用比较的原因）', () => {
  assert.equal(sameRolling(rolling(), rolling()), true);
});

test('sameRolling：逐字段不同 → 不等价', () => {
  const base = rolling();
  // 长度不同
  assert.equal(sameRolling(base, rolling({ recentLoad: [120, 300] })), false);
  assert.equal(sameRolling(base, rolling({ loadByDow: [0, 60, 90] })), false);
  assert.equal(sameRolling(base, rolling({ upcoming: [] })), false);
  // 元素不同（最近负荷 / 按星期负荷）
  assert.equal(sameRolling(base, rolling({ recentLoad: [120, 300, 241] })), false);
  assert.equal(sameRolling(base, rolling({ loadByDow: [0, 60, 90, 120, 150, 180, 210, 241] })), false);
  // upcoming 的三个比较字段逐个验
  const withUpcoming = (patch: Record<string, unknown>) =>
    rolling({ upcoming: [{ id: 'a', title: '作业一', dueAtWeek: 5, urgency: 0.4, ...patch }] });
  assert.equal(sameRolling(rolling({ upcoming: [base.upcoming[0]] }), withUpcoming({ id: 'z' })), false);
  assert.equal(sameRolling(rolling({ upcoming: [base.upcoming[0]] }), withUpcoming({ dueAtWeek: 9 })), false);
  assert.equal(sameRolling(rolling({ upcoming: [base.upcoming[0]] }), withUpcoming({ urgency: 0.9 })), false);
  // title 不参与比较 —— 只影响展示，改标题不该被当成「状态变了」而多写一次存储
  assert.equal(sameRolling(rolling({ upcoming: [base.upcoming[0]] }), withUpcoming({ title: '改个名' })), true);
});

test('sameRolling：null 边界（同一引用即等价；一对一 null 不等价）', () => {
  assert.equal(sameRolling(null, null), true);
  assert.equal(sameRolling(undefined, undefined), true);
  assert.equal(sameRolling(null, rolling()), false);
  assert.equal(sameRolling(rolling(), null), false);
});

/* ============================================================
 * localizedDaysFor：定点重排的「受影响的天」
 * ========================================================== */

test('localizedDaysFor：汇总 slots / 本週 moves / tasks 的天，去重并升序', () => {
  const layer = {
    slots: [{ days: [3] }, { days: [1] }],
    moves: [{ weekNo: 5, dayOfWeek: 1 }],
    tasks: [{ dayOfWeek: 7 }, { dayOfWeek: 3 }],
  };
  assert.deepEqual(localizedDaysFor(layer, [], 5), [1, 3, 7]);
});

test('localizedDaysFor：别的周的 moves 不算数（否则会把上周的改动带到本周）', () => {
  const layer = { slots: [{ days: [3] }], moves: [{ weekNo: 6, dayOfWeek: 2 }], tasks: [] };
  assert.deepEqual(localizedDaysFor(layer, [], 5), [3]);
});

test('localizedDaysFor：说不清哪天 → null（整周重排，宁可多排不可漏排）', () => {
  const noDays = { slots: [{}], moves: [], tasks: [] };
  assert.equal(localizedDaysFor(noDays, [], 5), null, 'slot 没写 days = 不定点');
  const emptyDays = { slots: [{ days: [] }], moves: [], tasks: [] };
  assert.equal(localizedDaysFor(emptyDays, [], 5), null, 'days 为空数组 = 不定点');
});

test('localizedDaysFor：空层 → []（既不定点也不整周，等价于「不融合」）', () => {
  const empty = { slots: [], moves: [], tasks: [] };
  assert.deepEqual(localizedDaysFor(empty, [], 5), []);
});

/**
 * 下面两条固化的是 **P2-5 修复后**的行为（修之前这里冻结的是两个洞，现已堵上）。
 *
 * 修复前：`applied` 被 `void` 掉（调用方真在传却不用），且 `if (t.dayOfWeek != null)`
 * 让没写星期的任务被**静默跳过**（既不定点、也不回落整周），与函数头注释直接矛盾。
 */
test('localizedDaysFor：调课/停课**真的**参与定点（修复前 `applied` 被 void 掉）', () => {
  const base = { slots: [], moves: [], tasks: [] };
  // 只停课：受影响 = 那节课原本在的那天
  assert.deepEqual(
    localizedDaysFor(base, [{ id: 'o1', courseName: '高数', day: 2 }], 5),
    [2],
    '停课没进规则集 —— 被停课那天不会被重排，融合后会留下旧块',
  );
  // 跨天调课：原天与目标天**都要**重排
  assert.deepEqual(
    localizedDaysFor(base, [{ id: 'o2', courseName: '英语', day: 1, newDay: 4 }], 5),
    [1, 4],
    '跨天调课只算了一天 —— 另一天会留下旧块',
  );
  // 同天换节次：只有一个天
  assert.deepEqual(localizedDaysFor(base, [{ id: 'o3', courseName: '物理', day: 3, newDay: 3 }], 5), [3]);
  // 与其它来源合并去重
  const layer = { slots: [{ days: [5] }], moves: [], tasks: [] };
  assert.deepEqual(localizedDaysFor(layer, [{ id: 'o4', courseName: '化学', day: 5 }], 5), [5]);
});

test('localizedDaysFor：没写星期的任务 → 整周重排（修复前是静默跳过）', () => {
  const layer = {
    slots: [{ days: [4] }],
    moves: [],
    tasks: [{ dayOfWeek: null }, { dayOfWeek: undefined }],
  };
  // `UserTask.dayOfWeek` 不给 = 本周每天都可参与 ⟹ 它可能落在任意一天 ⟹ 定不了点
  assert.equal(
    localizedDaysFor(layer, [], 5),
    null,
    'dayOfWeek 缺失的任务被跳过了 —— 那个任务可能落在任何一天，漏排就是漏块',
  );
});

test('localizedDaysFor：`applied` 里的非法天被忽略（不给坏数据放大成错天）', () => {
  const base = { slots: [], moves: [], tasks: [] };
  assert.deepEqual(
    localizedDaysFor(base, [{ id: 'bad1', courseName: 'x', day: 0 }, { id: 'bad2', courseName: 'y', day: 9 }], 5),
    [],
    '越界的天（0 / 9）不该被当成有效天塞进规则集',
  );
  assert.deepEqual(localizedDaysFor(base, [{ id: 'ok', courseName: 'z', newDay: 6 }], 5), [6]);
});

/* ============================================================
 * nowMinutes：读时钟，靠「另一个独立读数」验取整语义
 * ========================================================== */

test('nowMinutes：落在 5 分钟档位上，且与真实时钟同档（误差 < 5 分钟）', () => {
  // 独立参照物：直接用 Date 现算「精确到分」的当前分钟（与实现无关的第二条读数）
  const exact = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
  const before = exact();
  const got = nowMinutes();
  const after = exact();

  assert.equal(got % 5, 0, `nowMinutes()=${got} 不是 5 的倍数 —— 档位对齐失效`);
  assert.ok(got >= 0 && got <= 24 * 60, `nowMinutes()=${got} 越界`);
  // 两次读数把「真值」夹在一个区间里：结果必须是夹住的任一端所在档位
  const lo = Math.floor(before / 5) * 5;
  const hi = Math.floor(after / 5) * 5;
  assert.ok(
    got === lo || got === hi,
    `nowMinutes()=${got} 不在 [${lo}, ${hi}] 的档位上（时钟读数 ${before}→${after}）`,
  );
});

/* ============================================================
 * DAY_LABELS
 * ========================================================== */

test('DAY_LABELS：七天、周一起、下标与 dayOfWeek(1–7) 对齐', () => {
  assert.equal(DAY_LABELS.length, 7);
  assert.equal(DAY_LABELS[0], '周一');
  assert.equal(DAY_LABELS[6], '周日');
  assert.equal(DAY_LABELS[3 - 1], '周三', 'dayOfWeek=3 必须取到周三（下标 d-1 的口径）');
});

/* ============================================================
 * 静态守卫：禁止再长出第二份副本
 * ========================================================== */

test('静态守卫：useWeekPlan.ts 只 import 这四个工具，不再自带私有副本', () => {
  const code = readFileSync(join(SRC_ROOT, 'features', 'week', 'useWeekPlan.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');

  assert.match(
    code,
    /import\s*\{[^}]*\b(sameRolling|localizedDaysFor|nowMinutes|DAY_LABELS)\b[^}]*\}\s*from\s*'\.\/weekViewUtils'/,
    'useWeekPlan.ts 没从 ./weekViewUtils 取工具 —— 去重被改回去了？',
  );
  for (const dup of ['sameRolling', 'localizedDaysFor', 'nowMinutes', 'DAY_LABELS']) {
    assert.ok(
      !new RegExp(`(function|const)\\s+${dup}\\b`).test(code),
      `useWeekPlan.ts 里又出现了本地的 ${dup} —— 两份拷贝会静默分叉，改回 import`,
    );
  }
});
