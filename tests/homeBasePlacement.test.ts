/**
 * 住处 `homeBase` 的作用面（P0-6 定性证据 + 「未设置」分支的显式覆盖）
 * ============================================================
 * **背景**：`tests/golden-inputs.ts` 在 2026-09-20 被加了一行
 * `homeBase: { name: '第二学生公寓', campus: '北校' }`，注释自述「输出与历史快照一致」。
 * 这被登记为 **D6「golden 一变就停」的边界情形**：快照没变（5/5），但**输入语料变了** ——
 * 于是需要一个定性：算「D6 未触发」，还是算「语料变更需登记」？
 * 本文件用**实测**把它定性掉，并补上「未设置住处」那条分支的显式覆盖。
 *
 * ── 实测结论（前两条用例即是证据）────────────────────────────
 * 引擎里 `homeBase` 的**唯一**作用是 `construct.ts:763` 这一行：
 *     place: tpl.place === '第二学生公寓' && args.homeBaseName ? args.homeBaseName : tpl.place
 * 即「只把**宿舍类模板**的 `place` 字符串换掉」—— 不动 id、不动时间、不动块数、不动别的块。
 *
 * golden 给的住处名**恰好等于模板默认值**（`'第二学生公寓'`）⟹ 该替换是 **no-op**，于是：
 *   ① **摘掉 `homeBase` 后输出逐字节相同**（5 份语料实测全相同）；
 *   ② golden 快照**同时**代表「已设置住处」与「未设置住处」两条分支。
 * ⟹ **定性：不是覆盖缩小，是「语料变更，对输出零影响」**（登记见收口计划书 §1.3 / 进度板 §1.1.1）。
 *
 * ⚠️ 这不等于「golden 可以随便改」：**D6 依旧成立**（快照一变就停下问 RAY）。
 * 本文件**不碰任何快照**，只是把 `golden-inputs.ts` 注释里口头声称的等价关系，变成可执行断言。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planWeekV2, stablePlanJson } from '@/lib/planner/index.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

/** 模板层里宿舍类模板的默认地点（`construct.ts:763` 的判据字面量） */
const TEMPLATE_DEFAULT = '第二学生公寓';
/** 一个**不同于**默认值的住处，用来验「替换真的发生」 */
const OTHER_HOME = '东区宿舍';

const resultOf = (input: ReturnType<typeof buildGoldenInput>) => planWeekV2(toPlanRequest(input));
const planOf = (input: ReturnType<typeof buildGoldenInput>) => resultOf(input).plan;

const withoutHomeBase = (input: ReturnType<typeof buildGoldenInput>) => ({
  ...input,
  homeBase: undefined,
});

/** `id → place` 映射：块 id 在计划内唯一，可安全当键 */
const placeById = (blocks: ReadonlyArray<{ id: string; place?: string }>): Map<string, string | undefined> =>
  new Map(blocks.map((b) => [b.id, b.place]));

/* ============================================================
 * 一、P0-6 的定性证据
 * ========================================================== */

test('P0-6 证据：摘掉 homeBase 后输出逐字节相同（5/5 语料）', () => {
  assert.ok(GOLDEN_INPUTS.length > 0, 'golden 语料为空 —— 本用例失去意义');
  for (const g of GOLDEN_INPUTS) {
    const withHB = stablePlanJson(resultOf(buildGoldenInput(g)));
    const noHB = stablePlanJson(resultOf(withoutHomeBase(buildGoldenInput(g))));
    assert.equal(
      withHB,
      noHB,
      `[${g.name}] golden 里设置的住处名改变了输出 —— 那这条语料变更就不是 no-op，必须按 D6 重新定性`,
    );
  }
});

test('P0-6 证据：golden 设置的住处名恰好等于模板默认值（这是 no-op 的根因）', () => {
  for (const g of GOLDEN_INPUTS) {
    const input = buildGoldenInput(g);
    assert.equal(
      input.homeBase?.name,
      TEMPLATE_DEFAULT,
      `[${g.name}] 语料里的住处名不再是模板默认值 —— 那「摘掉 equals 保留」就不再成立，本文件结论须重算`,
    );
  }
});

/* ============================================================
 * 二、「未设置住处」分支的显式覆盖（golden 不碰）
 * ========================================================== */

/**
 * ⚠️ `place` 是**可选**字段：实测 meal 块（早/午/晚餐）与部分 course / activity 块
 * 本来就没有地点（`place === undefined`）。所以这里断言的是「**未设置不该改动任何地点**」，
 * 而不是「每个块都得有地点」—— 后者是我第一版写错的假设。
 */
test('未设置 homeBase：place 与「设为模板默认」逐块相同（不清空、也不凭空补）', () => {
  let withPlace = 0;
  let withoutPlace = 0;
  for (const g of GOLDEN_INPUTS) {
    const withDefault = placeById(planOf(buildGoldenInput(g)).blocks);
    const unset = placeById(planOf(withoutHomeBase(buildGoldenInput(g))).blocks);
    assert.deepEqual(
      [...unset],
      [...withDefault],
      `[${g.name}] 未设置住处后 place 发生变化 —— 未设置不该改动任何块的地点`,
    );
    for (const [, p] of withDefault) {
      if (typeof p === 'string' && p.length > 0) withPlace++;
      else withoutPlace++;
    }
  }
  // 反空转对照：两种情形都要真的出现，否则「逐块相同」可能只是两边都空
  assert.ok(withPlace > 0, '没有任何带地点的块 —— 本用例在空转');
  assert.ok(
    withoutPlace > 0,
    '所有块都有地点 —— 说明 place 已变成必填字段，本用例的前提（place 可选）已变',
  );
});

test('homeBase 只改 place：块数与 id+时间序列完全不变', () => {
  for (const g of GOLDEN_INPUTS) {
    const a = planOf(buildGoldenInput(g)).blocks;
    const b = planOf({ ...buildGoldenInput(g), homeBase: { name: OTHER_HOME, campus: '北校' } }).blocks;
    assert.equal(b.length, a.length, `[${g.name}] 改住处名不该增删块`);
    assert.deepEqual(
      b.map((x) => `${x.id}@${x.startMin}-${x.endMin}`),
      a.map((x) => `${x.id}@${x.startMin}-${x.endMin}`),
      `[${g.name}] 改住处名动了 id 或时间 —— 它只该换 place`,
    );
  }
});

test('homeBase 生效：原宿舍块的地点全部跟着改，非宿舍块零改动', () => {
  let totalDormBlocks = 0; // 反空转对照：全局必须真的存在被替换的块
  for (const g of GOLDEN_INPUTS) {
    const a = planOf(buildGoldenInput(g)).blocks;
    const b = planOf({ ...buildGoldenInput(g), homeBase: { name: OTHER_HOME, campus: '北校' } }).blocks;

    const before = placeById(a);
    const after = placeById(b);
    const dormIds = [...before].filter(([, p]) => p === TEMPLATE_DEFAULT).map(([id]) => id);
    totalDormBlocks += dormIds.length;

    // 原宿舍块 → 全部换成新住处名（数量守恒）
    for (const id of dormIds) {
      assert.equal(after.get(id), OTHER_HOME, `[${g.name}] 原宿舍块 ${id} 的地点没跟着住处改`);
    }
    // 非宿舍块 → 一个字都不许变
    for (const [id, place] of before) {
      if (dormIds.includes(id)) continue;
      assert.equal(after.get(id), place, `[${g.name}] 非宿舍块 ${id} 的地点被误改（${place} → ${after.get(id)}）`);
    }
  }
  assert.ok(
    totalDormBlocks > 0,
    '5 份语料里一块宿舍类模板都没排出来 —— 「住处替换」这条路径实际未被执行，本用例在空转',
  );
});
