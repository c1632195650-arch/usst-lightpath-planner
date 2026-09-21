/**
 * 校区词表 SSOT 一致性（2026-09-19）—— 「三套词表零校验」这个漂移风险不许回来。
 *
 * 背景：同一个「校区」概念此前在**四处各写一遍、彼此零机器校验**：
 *   server/campus.py::_CAMPUS_CN｜server/campus_network.py::_WALK_GROUP
 *   src/constants/campus.ts::CampusId + BUILDING_CAMPUS_MAP｜src/lib/planner/templates.ts::CampusName
 * 后果**不是报错而是静默算错**。活样本（本次实测）：
 *   scheduler.test.ts 断言 `campusOfPlace('第四食堂') === 'JG334'`，
 *   而 data/campus_map.json 与 scripts/test_campus.py 都说是 `1100` ——
 *   **两套测试同时是绿的**（因为没有任何一处在比对另一端）。
 *
 * 现状设计（见 data/campus_vocab.json 的 _meta.how）：
 *   Python 侧运行时导入；TS 侧**保持硬编码**（places.ts 明令不 import JSON，
 *   Node 测试环境加载不了），由**本文件**读同一份 JSON 逐条比对 —— 镜像被机器校验。
 *
 * 反向验证：把 campus_vocab.json 里 codes['580'].label_to_id 改成 'JG1100'，
 * 或删掉 frontend_only.YINGKOU，本文件必须变红（证明 TS 侧镜像真的在比对）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CAMPUSES } from '@/constants/campus.ts';
import { campusFromLabel } from '@/lib/planner/places.ts';
import { campusOfName } from '@/lib/planner/schedule.ts';
import { CAMPUS_TRANSFER_MIN } from '@/types';

interface VocabCode {
  cn: string;
  walk_group: string;
  label_to_id: string;
  in_scope: boolean;
}

const VOCAB = JSON.parse(
  readFileSync(new URL('../data/campus_vocab.json', import.meta.url), 'utf8'),
) as {
  codes: Record<string, VocabCode>;
  frontend_only: Record<string, { nature: string }>;
  frontend_ids: string[];
};

const FRONTEND_IDS = [...VOCAB.frontend_ids].sort();

test('A：前端 CampusId 全集与 CAMPUSES / CAMPUS_TRANSFER_MIN 的键完全一致', () => {
  assert.deepEqual(Object.keys(CAMPUSES).sort(), FRONTEND_IDS);
  assert.deepEqual(Object.keys(CAMPUS_TRANSFER_MIN).sort(), FRONTEND_IDS);
});

test('B：每个后端 campus 码经 campusFromLabel 落到词表声明的那个 CampusId', () => {
  for (const [code, v] of Object.entries(VOCAB.codes)) {
    assert.equal(
      campusFromLabel(code), v.label_to_id,
      `码『${code}』的两个端映射漂移：places.ts 给 ${campusFromLabel(code)}，词表声明 ${v.label_to_id}`,
    );
  }
});

test('B2：前端 CampusId 无悬空 —— 每个都「有后端映射」或「已声明为前端独有」', () => {
  const covered = new Set(Object.values(VOCAB.codes).map((v) => v.label_to_id));
  for (const id of Object.keys(VOCAB.frontend_only)) covered.add(id);
  const dangling = VOCAB.frontend_ids.filter((i) => !covered.has(i));
  assert.deepEqual(
    dangling, [],
    `悬空的 CampusId（既无后端码对应、也没被声明）：${dangling.join('、')}`
    + ' —— 这正是营口路当初的状态，要么给它后端映射，要么在 frontend_only 里声明',
  );
});

test('B3：声明为「前端独有」的 CampusId 必须真的可达（不是死值占位）', () => {
  assert.equal(campusOfName('营口路'), 'YINGKOU');
  assert.equal(campusOfName('复兴中路'), 'FUXING');
  for (const id of Object.keys(VOCAB.frontend_only)) {
    assert.ok(id in VOCAB.frontend_only, `${id} 未登记`);
  }
});

test('C：范围外的校区码不得被映射成「本地图有数据」（否则前端会以为有地图）', () => {
  for (const [code, v] of Object.entries(VOCAB.codes)) {
    if (v.in_scope) continue;
    assert.equal(
      campusFromLabel(code), 'UNKNOWN',
      `范围外的『${code}』被映射成了 ${campusFromLabel(code)} —— ` +
      '前端会以为本地图有该校区数据（它在 SCOPE_OUT 里）',
    );
  }
});
