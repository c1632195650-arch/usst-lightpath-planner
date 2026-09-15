/**
 * 交互埋点的纯函数与隐私不变量测试
 * ============================================================
 * 这个文件真正要守住的是**三条不变量**，不是覆盖率：
 *   1. **零上报** —— `track()` 全程不碰网络（用 fetch 桩证明，不是靠读代码）
 *   2. **不落用户原话** —— `id` 传了中文/空格/超长一律丢掉，但记录本身要留下
 *   3. **「没有数据」不等于 0** —— 空记录时 `degradeRate` 必须是 `null`
 *      （0 会被读成「一次都没降级」，含义完全相反；与 behaviorLog 同一条原则）
 *
 * 用内存 storage 桩替代 localStorage：纯函数与存储层因此都能在 node 里跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SUMMARY, append, dayOf, isSafeId, normalize, summarize,
  loadEvents, saveEvents, clearEvents, track, exportJSON,
} from '@/lib/telemetry';
import type { TelemetryRecord } from '@/lib/telemetry';

const AT = '2026-09-15T10:00:00.000Z';

function rec(over: Partial<TelemetryRecord> & { ev: TelemetryRecord['ev'] }): TelemetryRecord {
  return { t: AT, ...over };
}

/** 内存 localStorage 桩。`fail` 为真时模拟隐私模式（写入抛异常）。 */
function stubStorage(fail = false) {
  const map = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      if (fail) throw new Error('QuotaExceededError（模拟隐私模式）');
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
  (globalThis as { localStorage?: unknown }).localStorage = ls;
  return map;
}

/* ---------------- 1. 隐私：不落用户原话 ---------------- */

test('isSafeId 只放行 ASCII 标识符，中文/空格/超长一律拒绝', () => {
  assert.equal(isSafeId('canteen1'), true);
  assert.equal(isSafeId('rag-offline'), true);
  assert.equal(isSafeId('gate580'), true);

  assert.equal(isSafeId('怎么取快递'), false);      // 中文 = 用户原话
  assert.equal(isSafeId('图书馆 自习'), false);      // 带空格
  assert.equal(isSafeId('a'.repeat(33)), false);    // 超长
  assert.equal(isSafeId(''), false);
  assert.equal(isSafeId(undefined), false);
  assert.equal(isSafeId(123), false);
});

test('id 不安全时丢掉 id，但记录本身必须留下', () => {
  const n = normalize(rec({ ev: 'search', id: '宿舍几点门禁', ok: true }));
  assert.equal('id' in n, false);                   // 原话没进来
  assert.equal(n.ev, 'search');                     // 但这一次交互不能丢
  assert.equal(n.ok, true);
});

test('normalize 只保留白名单字段 —— 调用方多传的键不会落盘', () => {
  const raw = {
    t: AT, ev: 'search', id: 'canteen1', n: 3,
    query: '宿舍几点门禁',          // 有人手滑把原句塞进来了
    userText: '我叫张三',            // 更糟的情况
  } as unknown as TelemetryRecord;
  const n = normalize(raw) as Record<string, unknown>;
  assert.deepEqual(Object.keys(n).sort(), ['ev', 'id', 'n', 't']);
  assert.equal(JSON.stringify(n).includes('门禁'), false);
  assert.equal(JSON.stringify(n).includes('张三'), false);
});

/* ---------------- 2. 零上报 ---------------- */

test('track 全程不发任何网络请求（fetch 桩证明）', () => {
  stubStorage();
  let called = 0;
  const origFetch = (globalThis as { fetch?: unknown }).fetch;
  (globalThis as { fetch?: unknown }).fetch = () => { called += 1; return Promise.resolve(); };
  try {
    track('search', { n: 3 });
    track('poi_view', { id: 'canteen1' });
    track('degrade', { id: 'rag-offline' });
    assert.equal(called, 0, '埋点绝不能有上报请求');
  } finally {
    (globalThis as { fetch?: unknown }).fetch = origFetch;
  }
});

/* ---------------- 3. 环形上限 ---------------- */

test('超过 500 条时丢掉最旧的，保留最近的', () => {
  let list: TelemetryRecord[] = [];
  for (let i = 0; i < 505; i++) list = append(list, rec({ ev: 'search', id: `p${i}` }));
  assert.equal(list.length, 500);
  assert.equal(list[0].id, 'p5');                    // 最旧的 5 条被裁掉
  assert.equal(list[list.length - 1].id, 'p504');
});

test('未超上限时追加且不改动已有顺序', () => {
  const a = rec({ ev: 'search', id: 'p1' });
  const out = append([a], rec({ ev: 'search', id: 'p2' }));
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'p1');
});

/* ---------------- 4. 按天分桶 ---------------- */

test('dayOf 按**本地**时区分桶（用 UTC 会让晚上的记录掉到第二天）', () => {
  const d = new Date('2026-09-15T23:30:00');
  assert.equal(dayOf(d.toISOString()), '2026-09-15');
  assert.equal(dayOf('不是时间'), '');
});

/* ---------------- 5. 聚合 ---------------- */

test('空记录：degradeRate 是 null 而不是 0', () => {
  const s = summarize([]);
  assert.equal(s.degradeRate, null);                 // 0 会被误读成「一次都没降级」
  assert.equal(s.total, 0);
  assert.equal(s.activeDays, 0);
  assert.deepEqual(s.topPois, []);
});

test('EMPTY_SUMMARY 不可被就地污染（返回的是副本）', () => {
  const s = summarize([]);
  s.byEvent.search = 999;
  assert.equal(EMPTY_SUMMARY.byEvent.search, 0);
});

test('统计检索次数 / 白问次数 / 降级率 / 活跃日', () => {
  const list: TelemetryRecord[] = [
    rec({ t: '2026-09-15T09:00:00', ev: 'search', n: 3 }),
    rec({ t: '2026-09-15T09:05:00', ev: 'search', n: 0 }),      // 白问
    rec({ t: '2026-09-16T09:05:00', ev: 'poi_view', id: 'canteen1' }),
    rec({ t: '2026-09-16T09:06:00', ev: 'poi_view', id: 'canteen1' }),
    rec({ t: '2026-09-16T09:07:00', ev: 'degrade', id: 'rag-offline' }),
  ];
  const s = summarize(list);
  assert.equal(s.total, 5);
  assert.equal(s.activeDays, 2);
  assert.equal(s.searchCount, 2);
  assert.equal(s.searchEmpty, 1);
  assert.equal(s.degradeCount, 1);
  assert.equal(s.degradeRate, 0.2);
  assert.deepEqual(s.topPois, [{ id: 'canteen1', n: 2 }]);
});

test('热门地点同票数时按 id 字典序 —— 同输入必须同输出', () => {
  const list = [
    rec({ ev: 'poi_view', id: 'beta' }),
    rec({ ev: 'poi_view', id: 'alpha' }),
  ];
  const a = summarize(list).topPois;
  const b = summarize([...list].reverse()).topPois;
  assert.deepEqual(a, b);                            // 顺序不影响结果
  assert.deepEqual(a.map((x) => x.id), ['alpha', 'beta']);
});

test('topPois 截断到 topN', () => {
  const list = ['a', 'b', 'c'].map((id) => rec({ ev: 'poi_view', id }));
  assert.equal(summarize(list, 2).topPois.length, 2);
});

/* ---------------- 6. 存储层 ---------------- */

test('track → loadEvents 往返一致；clearEvents 清空', () => {
  stubStorage();
  clearEvents();
  track('plan_result', { ok: true, ms: 123.7, n: 12 });
  const got = loadEvents();
  assert.equal(got.length, 1);
  assert.equal(got[0].ev, 'plan_result');
  assert.equal(got[0].ms, 124);                      // 毫秒取整
  clearEvents();
  assert.deepEqual(loadEvents(), []);
});

test('存储不可用（隐私模式）时 track 不抛异常 —— 埋点坏了不能影响主流程', () => {
  stubStorage(true);
  assert.doesNotThrow(() => track('search', { n: 1 }));
  assert.deepEqual(loadEvents(), []);
});

test('坏数据只丢坏的那条，不让整份记录失效', () => {
  const map = stubStorage();
  map.set('usst.telemetry.v1', JSON.stringify([
    { t: AT, ev: 'search', n: 2 },
    { t: AT, ev: '不存在的类型' },                    // 坏
    '不是对象',                                       // 坏
    { t: AT, ev: 'poi_view', id: 'canteen1' },
  ]));
  const got = loadEvents();
  assert.equal(got.length, 2);
  assert.equal(got[1].id, 'canteen1');
});

test('saveEvents 后 loadEvents 会把越界字段洗掉（存储层二次收敛）', () => {
  const map = stubStorage();
  map.set('usst.telemetry.v1', JSON.stringify([
    { t: AT, ev: 'search', id: 'canteen1', query: '原句不该在' },
  ]));
  const got = loadEvents();
  assert.equal(JSON.stringify(got).includes('原句不该在'), false);
});

/* ---------------- 7. 导出 ---------------- */

test('exportJSON 带免责说明，且导出内容里没有原句', () => {
  stubStorage();
  clearEvents();
  track('search', { id: '宿舍门禁几点', n: 1 });      // id 会被挡掉
  const s = exportJSON();
  assert.equal(s.includes('不含任何输入原文'), true);
  assert.equal(s.includes('宿舍门禁几点'), false);
  assert.equal(JSON.parse(s).events.length, 1);
});

/* ---------------- 8. 确定性 ---------------- */

test('同输入两次聚合结果完全一致', () => {
  const list = [
    rec({ t: '2026-09-15T09:00:00', ev: 'search', n: 1 }),
    rec({ t: '2026-09-16T09:00:00', ev: 'degrade', id: 'x' }),
  ];
  assert.deepEqual(summarize(list), summarize(list));
});
