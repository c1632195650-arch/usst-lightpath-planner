/**
 * 地点表覆盖 —— 课表用到的建筑，要么能解析，要么**在这张已知缺口清单里**
 * 跑法：npm run test:engine
 *
 * 为什么值得单独立一组：`campusOfPlace()` 查不到会**返回 null（承认不知道）**，
 * 这是刻意的设计（不猜）。但「返回 null」在成本函数里表现为一个**静默的未知计数器** ——
 * 它不产生任何成本、不报错、不告警（见 `objective.ts` 的 `unknownCampusBlocks`）。
 * 于是「课表里加了一栋楼、地点表忘了补」这种缺口可以潜伏很久。
 * 这组测试就是那个告警：**不许出现新的缺口**。
 *
 * ⚠️ 与 `tests/places-buildings.test.ts` 的分工：
 *   那个文件管「硬编码表 vs 上游 campus_map.json 的**教学楼**是否逐条一致」；
 *   本文件管「**课表实际用到的**建筑是否都解析得出」—— 两者互补，不重复。
 *
 * ── 已知缺口（2026-09-19 实测，棘轮式登记）──────────────────────────────
 * 真实课表上有两个地名解析不出校区，涉及 3 个课程块：
 *   「光电学院楼」（电路分析基础 ×2）｜「田径场」（大学体育（篮球）×1）
 *
 * **为什么不直接补进 places.ts**：上游 `CAMPUS_BUILDINGS` 是
 * `campus_map.json` 里 `type === '教学楼'` 地标的**逐条镜像**（硬约束，
 * 由 `places-buildings.test.ts` 双向校验）。而这两个名字在上游分别属于
 * `学院楼`（对应「光电楼」）与 `运动`（对应「运动场」）—— **不在镜像范围内**，
 * 硬塞进去会破坏那条防漂移不变量（本次第一版就是这么被测试拦下的）。
 *
 * **要真正修掉，得走数据治理流程**（改动面跨上游数据与他的测试，留给 B 定夺）：
 *   ① 上游 `campus_map.json`：「光电学院楼」作为「光电楼」的别名、
 *      「田径场」补为独立地标（`type: '运动'`，`verified: false` 如实标注未核实）；
 *   ② 把 `places.ts` 的镜像范围从「教学楼」扩到「**可能上课/活动的建筑类**」
 *      （教学楼 + 学院楼 + 运动），并同步扩 `places-buildings.test.ts` 的筛选口径；
 *   ③ 若新增地标，记得重跑 `scripts/build_pinyin_index.py` 更新检索四件套。
 *
 * 影响面（别高估）：这 3 个块**不产生任何成本**（`unknownCampusBlocks` 恒不罚），
 * 真实影响是「这几段路的转场只能退化成估算」。所以它是**记录在案的缺口**，
 * 不是发布阻断项 —— 但也不该被忘掉。
 * ─────────────────────────────────────────────────────────────────
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { campusOfPlace, resolvePlace, BUILTIN_PLACES } from '@/lib/planner/places.ts';
import { MOCK_SCHEDULE } from '@/data/usst';
import { GOLDEN_INPUTS } from './golden-inputs.ts';

/**
 * 棘轮：**已登记**的缺口。新增缺口会让下面的测试变红；
 * 修好之后也要**主动**把它从这里删掉（那时测试同样会红，提醒你更新）。
 */
const KNOWN_GAPS: readonly string[] = ['光电学院楼', '田径场'];

/** 收集所有语料里出现过的 `Course.building` */
function buildingsInUse(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (b: string | undefined, from: string) => {
    if (!b) return;
    out.set(b, [...(out.get(b) ?? []), from]);
  };
  for (const c of MOCK_SCHEDULE.courses) add(c.building, 'MOCK_SCHEDULE');
  for (const g of GOLDEN_INPUTS) {
    for (const c of g.schedule.courses) add(c.building, g.name);
  }
  return out;
}

function unresolved(): string[] {
  return [...buildingsInUse().entries()]
    .filter(([name]) => campusOfPlace(name) == null)
    .map(([name]) => name)
    .sort();
}

test('课表用到的建筑：要么能解析，要么恰好是已登记的那几个缺口', () => {
  const got = unresolved();
  assert.deepEqual(
    got, [...KNOWN_GAPS].sort(),
    '解析不出的建筑集合变了：\n'
    + `  实际：${got.join('、') || '（无）'}\n`
    + `  登记：${[...KNOWN_GAPS].sort().join('、') || '（无）'}\n`
    + '  · 出现**新**的解析不出 → 课表加了楼但地点表没跟上，请补上游数据；\n'
    + '  · 缺口**变少** → 已修好，请把 `KNOWN_GAPS` 里对应项删掉（别让棘轮空转）。',
  );
});

test('能解析的那部分必须解析得对（不是随便给了个校区）', () => {
  assert.equal(campusOfPlace('第一教学楼'), 'JG516');
  assert.equal(campusOfPlace('第三教学楼'), 'JG516');
  assert.equal(campusOfPlace('综合楼'), 'JG516');
  assert.equal(campusOfPlace('大礼堂'), 'JG516');
  assert.equal(campusOfPlace('国合楼'), 'JG334', '国合楼在南校 —— 这条钉住跨校区判定');
  assert.equal(campusOfPlace('卓越楼'), 'JG334');
});

test('查不到的地方仍然返回 null（「不猜」的纪律没有为了覆盖率被牺牲）', () => {
  assert.equal(campusOfPlace('霍格沃茨教学楼'), null);
  assert.equal(campusOfPlace(''), null);
  assert.equal(resolvePlace('不存在的楼'), null);
});

test('地点表没有重名条目（同名会在建索引时互相覆盖，是数据问题的前兆）', () => {
  const names = BUILTIN_PLACES.map((p) => p.name);
  const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  assert.deepEqual(dup, [], `地点表存在重名：${dup.join('、')}`);
});
