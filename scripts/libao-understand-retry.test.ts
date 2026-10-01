/**
 * 批 1.5 · perWeek 幻觉防护 + understand 端点单次重试
 * ============================================================
 * 两个实测发现（2026-10-02）：
 *   ① 探针实录：「这学期我想养成晨跑的习惯」（没说频率）被 LLM 幻觉出 perWeek=7，
 *      默认 21 天窗口 × 每天 = 21 块，静默压缩了「一学期」的意图；
 *   ② 在线金标评测 25/67 次端点调用 ok:false（服务端 8s 超时），规则先行口径下
 *      规则层接不住的动作句整句漏判（FN 7 条曾长期存在）。
 * 修复：mergeLlmPrimary 的 perWeekCount patch 只在「规则层已有 或 原话有频率词」
 * 时采纳；planUnderstand 的 intent 场景在「网络异常 / 服务端超时」时重试一次。
 *
 * ⚠️ 反向验证：还原 mergeLlmPrimary 的无条件采纳 / 还原 planUnderstand 单次调用，
 *    用例逐组变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLlmPrimary, parseIntentSlots } from '@/features/libao/libaoIntent';
import { planUnderstand } from '@/lib/api';

const TODAY = '2026-10-02';

/* ── perWeek 幻觉防护 ── */

test('perWeek 幻觉防护：原话没有频率词 → LLM patch 的 perWeekCount 被拒', () => {
  const rule = parseIntentSlots('这学期我想养成晨跑的习惯', TODAY);
  assert.equal(rule.perWeekCount, undefined, '前提：规则层本来就没抽到频率');
  const merged = mergeLlmPrimary(rule, { perWeekCount: 7 }, TODAY);
  assert.equal(merged.perWeekCount, undefined, '幻觉出的「每天」必须被拒');
  assert.ok(merged.unclear.length > 0, '拒了要说，不能静默');
});

test('perWeek 有证据：原话含频率词 → patch 采纳', () => {
  const rule = parseIntentSlots('我想晨跑，每周三次', TODAY);
  assert.equal(rule.perWeekCount, 3);
  const merged = mergeLlmPrimary(rule, { perWeekCount: 7 }, TODAY);
  assert.equal(merged.perWeekCount, 7, '原话有频率词 → LLM 主理解成立');
});

test('perWeek 有证据：规则层已抽到（每天）→ patch 采纳', () => {
  const rule = parseIntentSlots('下周开始每天背单词', TODAY);
  assert.equal(rule.perWeekCount, 7);
  const merged = mergeLlmPrimary(rule, { perWeekCount: 3 }, TODAY);
  assert.equal(merged.perWeekCount, 3, 'LLM 主理解修正规则值是被允许的（有证据在）');
});

/* ── understand 端点单次重试 ── */

/** 可编程 fetch 桩：按脚本依次返回 */
function stubFetch(script: Array<() => { status: number; body: unknown }>): { calls: () => number; restore: () => void } {
  const orig = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async () => {
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    const { status, body } = step();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls: () => i, restore: () => { globalThis.fetch = orig; } };
}

test('重试：intent 场景第一次服务端超时（ok:false+timeout），第二次成功', async () => {
  const stub = stubFetch([
    () => ({ status: 200, body: { ok: false, reason: 'LLM request timed out after 8s' } }),
    () => ({ status: 200, body: { ok: true, action: true, intent: 'create', patch: { title: '复习' } } }),
  ]);
  try {
    const r = await planUnderstand({ scene: 'intent', q: '帮我安排复习' });
    assert.equal(r.ok, true, '重试后应成功');
    assert.equal(stub.calls(), 2, '应恰好调用两次');
  } finally {
    stub.restore();
  }
});

test('重试：两次都超时 → 返回最后一次 ok:false，不抛错', async () => {
  const stub = stubFetch([
    () => ({ status: 200, body: { ok: false, reason: 'LLM request timed out after 8s' } }),
  ]);
  try {
    const r = await planUnderstand({ scene: 'intent', q: '帮我安排复习' });
    assert.equal(r.ok, false);
    assert.match(String(r.reason), /timed?\s*out|timeout/i);
    assert.equal(stub.calls(), 2);
  } finally {
    stub.restore();
  }
});

test('不重试：answer / dialog 场景维持单次（各有兜底链）', async () => {
  const stub = stubFetch([
    () => ({ status: 200, body: { ok: false, reason: 'LLM request timed out after 8s' } }),
  ]);
  try {
    const r = await planUnderstand({ scene: 'answer', q: '每周三次', asked: ['effort: 投入多少'] });
    assert.equal(r.ok, false);
    assert.equal(stub.calls(), 1, 'answer 场景不重试');
  } finally {
    stub.restore();
  }
});

test('不重试：ok:false 但 reason 与超时无关（如 no_key）', async () => {
  const stub = stubFetch([
    () => ({ status: 200, body: { ok: false, reason: 'no_key' } }),
  ]);
  try {
    const r = await planUnderstand({ scene: 'intent', q: '帮我安排复习' });
    assert.equal(r.ok, false);
    assert.equal(stub.calls(), 1, 'no_key 重试也不会好，不浪费一轮');
  } finally {
    stub.restore();
  }
});
