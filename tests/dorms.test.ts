/**
 * 宿舍清单投影守卫（`src/data/dorms.ts` ↔ `data/campus_map.json`）
 * ============================================================
 * 「我的住处」三级联选（校区 → 公寓/宿舍 → 楼）的选项来自 `src/data/dorms.ts`，
 * 而那份文件是校园图谱 `data/campus_map.json` 的**投影**。投影最容易出的问题是
 * **悄悄跑偏**：在 TS 里手改一条、图谱更新了没跟、分类规则偷偷改了 ——
 * 运行时都不报错，只是「选不到自己住的那栋」或者「选到一栋不存在的楼」。
 *
 * 所以这里把「投影 = 图谱」钉成集合相等断言：
 *   · 名字集合**逐字**相等（多一个少一个都不行）；
 *   · 每条的 campus / verified **逐条**对齐；
 *   · 分类严格由 `categoryOf()` 从正式名推出（不另立一套规则）。
 *
 * 判定口径必须与 `src/data/dorms.ts` 文件头写的一致：
 * `landmarks` 里 `type === '宿舍'` 且 `campus ∈ {北校, 南校}`。
 * （1100 的 A/B/C 区宿舍图谱里没有 ⟹ 本轮按拍板不做，见该文件「已知缺口」。）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DORMS,
  DORM_CAMPUSES,
  DORM_CATEGORIES,
  categoryOf,
  dormByName,
  dormCategories,
  dormsOf,
  type DormCampus,
} from '@/data/dorms';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

interface GraphDorm {
  name: string;
  campus: string;
  verified: boolean;
}

/** 从校园图谱里按**与投影相同的口径**取出宿舍条目 */
function graphDorms(): GraphDorm[] {
  const raw = JSON.parse(readFileSync(join(REPO, 'data', 'campus_map.json'), 'utf8')) as {
    landmarks?: Array<Record<string, unknown>>;
  };
  return (raw.landmarks ?? [])
    .filter((p) => p.type === '宿舍' && (p.campus === '北校' || p.campus === '南校'))
    .map((p) => ({
      name: String(p.name ?? '').trim(),
      campus: String(p.campus ?? '').trim(),
      verified: Boolean(p.verified),
    }));
}

const graph = graphDorms();

test('dorms：投影的名字集合与校园图谱逐字相等（多一个/少一个都算跑偏）', () => {
  const fromGraph = graph.map((d) => d.name).sort();
  const fromProjection = DORMS.map((d) => d.name).sort();
  assert.deepEqual(
    fromProjection,
    fromGraph,
    'src/data/dorms.ts 与 data/campus_map.json 的宿舍名单不一致 —— 请改图谱，别手改投影',
  );
  assert.ok(fromGraph.length > 0, '图谱里一条宿舍都没有？判定口径或数据文件出了问题');
});

test('dorms：每条与图谱的 campus / verified 逐条对齐', () => {
  for (const d of DORMS) {
    const g = graph.find((x) => x.name === d.name);
    assert.ok(g, `图谱里找不到「${d.name}」，但投影里有`);
    assert.equal(d.campus, g.campus, `「${d.name}」的校区与图谱不一致`);
    assert.equal(d.verified, g.verified, `「${d.name}」的 verified 与图谱不一致`);
  }
});

test('dorms：分类严格由正式名推出（公寓 / 宿舍两分类，不另立规则）', () => {
  // 反向：把 categoryOf 改成恒返回 '宿舍' → 前两条断言红
  assert.equal(categoryOf('第二学生公寓'), '公寓');
  assert.equal(categoryOf('北校区第三宿舍'), '宿舍');
  for (const d of DORMS) {
    assert.equal(d.category, categoryOf(d.name), `「${d.name}」的分类与 categoryOf 规则不符`);
  }
  // 分类值域收口在 DORM_CATEGORIES 里
  for (const d of DORMS) assert.ok(DORM_CATEGORIES.includes(d.category));
});

test('dorms：没有重名（重名会让联选出现两个一模一样的选项）', () => {
  const names = DORMS.map((d) => d.name);
  assert.equal(new Set(names).size, names.length, '清单里出现了重名');
});

test('dorms：dormsOf / dormCategories 与全量清单自洽', () => {
  for (const campus of DORM_CAMPUSES) {
    const cats = dormCategories(campus);
    assert.ok(cats.length > 0, `${campus} 一个分类都没有 —— 联选第一步选完就没东西可选了`);
    let sum = 0;
    for (const cat of cats) {
      const rows = dormsOf(campus, cat);
      assert.ok(rows.length > 0, `${campus} / ${cat} 是空列表 —— 不该出现在分类里`);
      for (const r of rows) {
        assert.equal(r.campus, campus);
        assert.equal(r.category, cat);
      }
      sum += rows.length;
    }
    assert.equal(sum, DORMS.filter((d) => d.campus === campus).length, `${campus} 的楼被漏掉了`);
  }
  // 反向：所有楼的校区都必须在 DORM_CAMPUSES 里（否则永远选不到）
  for (const d of DORMS) {
    assert.ok(DORM_CAMPUSES.includes(d.campus as DormCampus), `「${d.name}」的校区不在联选范围里`);
  }
});

test('dorms：dormByName 能回填已存的值，查不到时返回 undefined（不猜）', () => {
  const first = DORMS[0];
  assert.equal(dormByName(first.name)?.name, first.name);
  assert.equal(dormByName('不存在的大楼'), undefined);
  assert.equal(dormByName(''), undefined);
  assert.equal(dormByName(null), undefined);
});
