/**
 * r2 · libaoIntent 时间解析拆分的守护测试（D1-批1，2026-10-24）
 * ============================================================
 * 背景：时间表达式解析族已逐字节搬运到 features/libao/timeParse.ts，
 * libaoIntent.ts 按原名 re-export（import 面零变化）。这里守两件事：
 *
 *   ① re-export 同一性源码锁：任何一个搬走的符号从 re-export 清单里消失
 *      （比如有人"顺手清理"）→ 既有 import 它的文件全炸。锁字面，删一个就红。
 *      RV：从 libaoIntent 的 export 块删任一符号名 → 本组恰红（实测留痕）。
 *   ② 行为锚：直接从 timeParse 取函数断真实输出（期望值与既有
 *      libao-intent-clock/weekno 等测试的口径一致），防止搬运过程被改写。
 *      RV：改 spanDurationMin 的 ×60 → 行为锚红（实测留痕）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  extractClockRange,
  extractReplanDays,
  resolveWhen,
  spanDurationMin,
} from '@/features/libao/timeParse';

const here = dirname(fileURLToPath(import.meta.url));

test('r2 · re-export 同一性：13 个搬走的公开函数都在 libaoIntent 的 re-export 清单里', () => {
  const src = readFileSync(join(here, '../src/features/libao/libaoIntent.ts'), 'utf8');
  const m = src.match(/export \{([\s\S]*?)\} from '\.\/timeParse';/);
  assert.ok(m, 'libaoIntent.ts 缺少从 ./timeParse 的具名 re-export 块（防 export * 被换回）');
  const names = m[1].split(/[,\s]+/).filter(Boolean);
  for (const fn of [
    'clockChannelOn', 'extractClockRange', 'extractEffort', 'extractFrequency',
    'extractPlace', 'extractReplanDays', 'extractTarget', 'extractTargetWhen',
    'extractWhen', 'extractWindow', 'resolveWhen', 'spanDurationMin', 'termAnchorsFrom',
  ]) {
    assert.ok(names.includes(fn), `re-export 清单缺 ${fn} —— 既有 import 面会断`);
  }
  // P1 加固（2026-10-24 验收 #4 发现的盲区）：`x as y` 改名可骗过上面的词元 includes 检查 —— 一律拒绝
  assert.equal(/\bas\b/.test(m[1]), false, 're-export 块不允许 as 改名（别名会绕过词元检查）');
});

test('r2 · re-export 同一性：6 个搬走的类型也都在（types 块）', () => {
  const src = readFileSync(join(here, '../src/features/libao/libaoIntent.ts'), 'utf8');
  const m = src.match(/export type \{([\s\S]*?)\} from '\.\/timeParse';/);
  assert.ok(m, 'libaoIntent.ts 缺少 types re-export 块');
  const names = m[1].split(/[,\s]+/).filter(Boolean);
  for (const t of ['ClockHint', 'ResolveTermOpts', 'TermCalendarLike', 'TimeCertainty', 'TimeWindow', 'WhenHint']) {
    assert.ok(names.includes(t), `types re-export 清单缺 ${t}`);
  }
});

test('r2 · 行为锚：钟点区间（语境提升，晚上 6→8 点 = 1080/1200，无歧义标注）', () => {
  const r = extractClockRange('晚上6点到8点');
  assert.deepEqual(
    r && { startMin: r.startMin, endMin: r.endMin, ambig: r.ambig },
    { startMin: 18 * 60, endMin: 20 * 60, ambig: undefined },
  );
  assert.equal(r?.text, '6点到8点');   // text 是钟点切片（语境词「晚上」不进来），与实现口径一致
});

test('r2 · 行为锚：单日重排目标天（「重排周四和周五」= [4,5]）', () => {
  assert.deepEqual(extractReplanDays('重排周四和周五'), [4, 5]);
  assert.equal(extractReplanDays('帮我看看这周'), undefined);
});

test('r2 · 行为锚：钟点区间折时长（「6点到7点」= 60 分钟）', () => {
  assert.equal(spanDurationMin('6点到7点'), 60);
  assert.equal(spanDurationMin('六点半到八点'), 90);
});

test('r2 · 行为锚：resolveWhen 相对周换算（基准 2026-10-24 周六 →「下周三」= 2026-10-28）', () => {
  const r = resolveWhen({ text: '下周三', kind: 'relative', relativeWeeks: 1, weekday: 3 }, '2026-10-24');
  assert.deepEqual({ from: r.from, to: r.to, certainty: r.certainty }, {
    from: '2026-10-28', to: '2026-10-28', certainty: 'exact',
  });
});
