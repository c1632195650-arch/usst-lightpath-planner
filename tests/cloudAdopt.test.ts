/**
 * 网页端「登录后以云端为准」采纳测试（2026-10-08 · cloudAdopt.ts）
 * ============================================================
 * 判据：
 *   ① 本地脚手架态（示例课表 / 无状态）→ 拉云端并写盘（主状态账号字段 + 覆盖层）；
 *   ② 本地已有真实数据 → **不采纳**（零请求，本地照常上推的路径不被改变）；
 *   ③ 云端为空 / 网络失败 → 什么都不写（不打断登录，下次再试）；
 *   ④ 覆盖层写入时 schemaVersion 归一为本地版本（否则 userPlanStore 整层丢弃）。
 *
 * 反向验证锚点（RV，删实现必红）：
 *   CA-RV1 ← 删掉 `isScaffoldedState` / `not-scaffolded` 分支 → 用例②红（本地真实态被云端覆盖）
 *   CA-RV2 ← 删掉 `cloud-empty` 判定 → 用例③红（空云端也会写盘）
 *   CA-RV3 ← 去掉层 schemaVersion 归一 → 用例①红（写入的层版本落后，网页端静默失效）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptCloudStateIfScaffolded, isScaffoldedState, type AdoptCloudDeps,
} from '@/features/cloudSync/cloudAdopt.ts';
import { WEB_STATE_KEY, WEB_LAYER_KEY } from '@/features/mobile/lib/webSync.ts';

const CLOUD_STATE = {
  persona: { archetype: { primary: { name: '提前一点的人' } } },
  schedule: {
    semesterName: '2026-2027学年 第一学期', termStart: '2026-09-14', source: 'pdf',
    courses: [{ id: 'c1', name: '高等数学 A2', building: '第一教学楼', slots: [] }],
  },
  planState: { version: 1, locks: {}, rolling: { loadByDow: [0, 130, 145, 215, 175, 120, 80, 60], throughWeek: 3 } },
  userOverrides: {
    schemaVersion: 1, tasks: [{ id: 't-meeting', title: '辅导员例会', dayOfWeek: 3, startMin: 840 }],
    excluded: [], moves: [], slots: [], courseOverrides: [], mealPlaces: {}, assignments: [],
  },
};

const SCAFFOLD_RAW = JSON.stringify({
  version: 4, onboarded: true, schedule: { termStart: '2026-08-31', source: 'demo', courses: [{ id: 'c' }] },
});
const REAL_RAW = JSON.stringify({
  version: 4, onboarded: true, schedule: { termStart: '2026-09-14', source: 'pdf', courses: [{ id: 'c1' }] },
});

function makeDeps(over: {
  raw?: string | null; token?: string;
  cloud?: unknown; status?: number; fail?: boolean;
} = {}) {
  const store = new Map<string, string>();
  if (over.raw !== null && over.raw !== undefined) store.set(WEB_STATE_KEY, over.raw);
  const calls: string[] = [];
  const deps: AdoptCloudDeps = {
    read: (k) => store.get(k) ?? null,
    write: (k, v) => void store.set(k, v),
    fetchImpl: (async (url: unknown) => {
      calls.push(String(url));
      if (over.fail) throw new TypeError('network down');
      return new Response(
        JSON.stringify(over.cloud ?? { found: true, state: CLOUD_STATE }),
        { status: over.status ?? 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch,
    token: over.token ?? 'tok',
  };
  return { deps, calls, store };
}

test('isScaffoldedState：无键 / 坏 JSON / demo → true；真实课表 → false', () => {
  assert.equal(isScaffoldedState(null), true);
  assert.equal(isScaffoldedState('{oops'), true);
  assert.equal(isScaffoldedState(SCAFFOLD_RAW), true);
  assert.equal(isScaffoldedState(JSON.stringify({ schedule: { source: 'pdf' } })), true, '有 source 但没课');
  assert.equal(isScaffoldedState(REAL_RAW), false);
});

test('① 脚手架态 → 采纳云端：主状态写入账号字段、保留本地键，覆盖层 schemaVersion 归一', async () => {
  const { deps, calls, store } = makeDeps({ raw: SCAFFOLD_RAW });
  const r = await adoptCloudStateIfScaffolded(deps);
  assert.equal(r.adopted, true);
  assert.equal(r.reason, 'adopted');
  assert.deepEqual(calls, ['/api/sync/state']);

  const next = JSON.parse(store.get(WEB_STATE_KEY) as string) as Record<string, unknown>;
  assert.equal((next.schedule as { source?: string }).source, 'pdf', '示例课表被云端真实课表替换');
  assert.equal((next.planState as { rolling?: unknown }).rolling !== undefined, true, '滚动视野随行（降档话术的素材）');
  assert.equal(next.version, 4, '本地既有键保留');
  assert.equal(next.onboarded, true);

  const layer = JSON.parse(store.get(WEB_LAYER_KEY) as string) as { schemaVersion: number; tasks: unknown[] };
  assert.equal(layer.schemaVersion, 2, 'CA-RV3：归一到本地当前版本，否则 userPlanStore 整层丢弃');
  assert.equal(layer.tasks.length, 1, '覆盖层随行（辅导员例会）');
});

test('② 本地已有真实数据 → 不采纳、零请求（本地照常上推的路径不变）', async () => {
  const { deps, calls, store } = makeDeps({ raw: REAL_RAW });
  const r = await adoptCloudStateIfScaffolded(deps);
  assert.equal(r.adopted, false);
  assert.equal(r.reason, 'not-scaffolded', 'CA-RV1：没有 scaffold 判定 → 此处会红（真实态被覆盖）');
  assert.equal(calls.length, 0);
  assert.equal(store.get(WEB_STATE_KEY), REAL_RAW, '本地一个字节都不动');
});

test('③ 云端为空 / 网络失败 / 无 token → 都不写盘', async () => {
  const empty = makeDeps({ raw: SCAFFOLD_RAW, cloud: { found: false, state: null } });
  assert.equal((await adoptCloudStateIfScaffolded(empty.deps)).reason, 'cloud-empty');
  assert.equal(empty.store.get(WEB_STATE_KEY), SCAFFOLD_RAW, 'CA-RV2：空云端也会写盘 → 此处会红');

  const down = makeDeps({ raw: SCAFFOLD_RAW, fail: true });
  assert.equal((await adoptCloudStateIfScaffolded(down.deps)).reason, 'network-error');
  assert.equal(down.store.get(WEB_STATE_KEY), SCAFFOLD_RAW);

  const noTok = makeDeps({ raw: SCAFFOLD_RAW, token: '' });
  assert.equal((await adoptCloudStateIfScaffolded(noTok.deps)).reason, 'no-token');
  assert.equal(noTok.calls.length, 0);
});

test('①b 采纳后内容即“可再上推”的真实态：source 非 demo（guard 放行）', async () => {
  const { deps, store } = makeDeps({ raw: SCAFFOLD_RAW });
  await adoptCloudStateIfScaffolded(deps);
  const next = JSON.parse(store.get(WEB_STATE_KEY) as string) as { schedule: { source: string } };
  assert.notEqual(next.schedule.source, 'demo', '采纳后本地不再是示例态 —— webSync 的 demo guard 不会拦它');
});
