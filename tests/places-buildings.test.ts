/**
 * §13.7 前置修复的回归测试 —— 「课程楼查不到校区」这个缺陷不许回来。
 *
 * 背景：`BUILTIN_PLACES` 原本只从 `templates.ts` 的模块库抽表，而**课程楼不在模块库里**，
 * 于是 `campusOfPlace('国合楼')` 返回 `null`，而 `campusOfName('国合楼')` 返回 `JG334`
 * —— 两套表打架。后果是 `objective::placeMismatch` 会把「在卓越楼/国合楼上课」误判为跨校区加罚。
 *
 * 本测试做两件事：
 *   ① 断言 `data/campus_map.json` 里全部「教学楼」（含**别名**）都能被 `campusOfPlace` 解析，
 *      且校区与上游一致；
 *   ② 断言 `places.ts` 里那张硬编码建筑表**与上游 JSON 逐条一致** —— 上游增删教学楼时本测试会红，
 *      提醒同步（places.ts 明令不 import JSON，只能用「硬编码 + 测试兜底」这对组合防漂移）。
 *
 * 运行（见 tests/README.md）：
 *   node --import ./tests/register.mjs --test
 *
 * ⚠️ 本文件顶部注释里**不能出现**测试 glob 的星号斜杠组合（会提前闭合块注释）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  BUILTIN_PLACES, campusFromLabel, campusOfPlace, placesFromBuildings,
} from '@/lib/planner/places.ts';
import { campusOfName } from '@/lib/planner/schedule.ts';

interface Landmark {
  id?: string;
  name?: string;
  type?: string;
  campus?: string;
  alias?: string[];
}

const CAMPUS_MAP = JSON.parse(
  readFileSync(new URL('../data/campus_map.json', import.meta.url), 'utf8'),
) as { landmarks?: Landmark[] };

const BUILDING_LANDMARKS = (CAMPUS_MAP.landmarks ?? []).filter((x) => x.type === '教学楼');

/** `constants/campus.ts` 与 `schedule.ts::CAMPUS_KEYWORDS` 都认得的三栋楼 —— 两套表必须给同一答案 */
const KEYWORD_TABLE_BUILDINGS = ['卓越楼', '国合楼', '第四教学楼'];

test('上游数据前提：campus_map.json 里存在「教学楼」且都带显式 campus', () => {
  assert.ok(BUILDING_LANDMARKS.length >= 20, `教学楼条目过少：${BUILDING_LANDMARKS.length}`);
  for (const b of BUILDING_LANDMARKS) {
    assert.ok(b.name, '教学楼缺 name');
    assert.ok(b.campus, `${b.name} 缺显式 campus（本表只收显式数据）`);
    assert.notEqual(campusFromLabel(b.campus), 'UNKNOWN', `${b.name} 的 campus 标签无法解析：${b.campus}`);
  }
});

test('每个「教学楼」（含别名）都能由 campusOfPlace 解析出正确校区', () => {
  for (const b of BUILDING_LANDMARKS) {
    const want = campusFromLabel(b.campus);
    assert.equal(campusOfPlace(b.name!), want, `${b.name} 解析不出/解析错校区`);
    for (const a of b.alias ?? []) {
      assert.equal(campusOfPlace(a), want, `别名「${a}」（${b.name}）解析不出/解析错校区`);
    }
  }
});

test('硬编码建筑表与上游 campus_map.json 完全一致（防漂移）', () => {
  const mine = new Map(placesFromBuildings().map((p) => [p.name, p]));
  for (const b of BUILDING_LANDMARKS) {
    const p = mine.get(b.name!);
    assert.ok(p, `places.ts 的 CAMPUS_BUILDINGS 漏了「${b.name}」`);
    assert.equal(p!.campus, campusFromLabel(b.campus), `「${b.name}」校区与上游不一致`);
    assert.deepEqual(
      p!.alias ?? [], b.alias ?? [],
      `「${b.name}」的别名与上游不一致（上游改过 alias 需同步 places.ts）`,
    );
  }
  assert.equal(
    mine.size, BUILDING_LANDMARKS.length,
    `places.ts 的 CAMPUS_BUILDINGS 比上游多出 ${mine.size - BUILDING_LANDMARKS.length} 条（上游已删？）`,
  );
});

test('★ 两套表不打架：campusOfName 认得的楼，campusOfPlace 必须给同一校区', () => {
  for (const name of KEYWORD_TABLE_BUILDINGS) {
    const byKeyword = campusOfName(name);
    assert.notEqual(byKeyword, null, `前置：关键字表本应认得「${name}」`);
    assert.equal(
      campusOfPlace(name), byKeyword,
      `「${name}」两套表打架：campusOfName=${byKeyword} 但 campusOfPlace=${campusOfPlace(name)}`,
    );
  }
});

test('课程楼已进入内置地点表（BUILTIN_PLACES）', () => {
  const names = new Set(BUILTIN_PLACES.map((p) => p.name));
  for (const name of ['卓越楼', '国合楼', '逸兴楼', '第三教学楼', '申一教']) {
    assert.ok(names.has(name), `内置地点表缺「${name}」`);
  }
});

test('别名不影响未登记地点的「不猜」行为（仍返回 null）', () => {
  assert.equal(campusOfPlace('根本不存在的楼'), null);
  assert.equal(campusOfPlace(''), null);
});
