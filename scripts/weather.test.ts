/**
 * 天气 → 任务 的确定性测试
 * ============================================================
 * 这里**不测 `fetchWeather`**（要起后端、要外网），只测纯函数部分：
 * 判定规则、边界、周次过滤、id 稳定性。
 *
 * 阈值一律引用 `WEATHER_RULES` 而不是抄数字 —— 抄一遍的话，
 * 日后调阈值时测试仍然「通过」，等于没测。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEATHER_RULES, judgeDay, weatherHints, weatherToTasks,
} from '@/features/weather/weather';
import type { WeatherDay, WeatherPeriod, WeatherReport } from '@/features/weather/weather';

/** 2026-08-31 是周一 → 第 1 周。2026-09-14 起是第 3 周，故 09-15 = 第 3 周周二。 */
const TERM_START = '2026-08-31';
const W3 = 3;

function day(over: Partial<WeatherDay> & { date: string }): WeatherDay {
  return {
    code: 0, text: '晴', tMax: 24, tMin: 18,
    rainProb: 0, rainMm: 0, windMax: 10, periods: {},
    ...over,
  };
}

function period(over: Partial<WeatherPeriod> = {}): WeatherPeriod {
  return { code: 0, text: '晴', rainProb: 0, tMax: 24, tMin: 18, ...over };
}

/** 一份「下午有雨」的完整报告，供周次/id 类断言复用 */
function rainyReport(): WeatherReport {
  return {
    ok: true, place: '测试', lat: 0, lon: 0, source: 'test',
    days: [
      day({ date: '2026-09-15', text: '小雨', rainProb: 80, rainMm: 3.2,
            periods: { am: period({ rainProb: 20 }), pm: period({ rainProb: 80, text: '小雨' }) } }),
    ],
  };
}

/* ---------------- 基础：不刷屏 ---------------- */

test('晴朗温和的天气不产生任何提醒', () => {
  assert.equal(judgeDay(day({ date: '2026-09-15' })), null);
});

test('空报告与空 termStart 都安全返回空数组', () => {
  assert.deepEqual(weatherToTasks(null, TERM_START, W3), []);
  assert.deepEqual(weatherToTasks(rainyReport(), '', W3), []);
  assert.deepEqual(weatherHints(null), []);
});

/* ---------------- 降水 ---------------- */

test('降水达标 → 提醒带伞，并指名具体时段', () => {
  const a = judgeDay(day({
    date: '2026-09-15', text: '小雨', rainProb: 78, rainMm: 3.2,
    periods: { am: period({ rainProb: 20 }), pm: period({ rainProb: 78, text: '小雨' }) },
  }));
  assert.equal(a?.kind, 'rain');
  assert.equal(a?.dayOfWeek, 2);          // 2026-09-15 是周二
  assert.match(a!.detail, /下午/);         // 提醒落在有雨的那个时段，不是笼统「今天」
  assert.equal(a?.severity, 'warn');
});

test('降水概率恰好等于阈值即提醒（边界含等号）', () => {
  const p = WEATHER_RULES.rainProb;
  assert.equal(
    judgeDay(day({ date: '2026-09-15', rainProb: p, periods: { pm: period({ rainProb: p }) } }))?.kind,
    'rain',
  );
});

test('降水概率低于阈值不提醒', () => {
  const p = WEATHER_RULES.rainProb - 1;
  assert.equal(
    judgeDay(day({ date: '2026-09-15', rainProb: p, periods: { pm: period({ rainProb: p }) } })),
    null,
  );
});

/* ---------------- 温度与风 ---------------- */

test('高温 / 低温 / 大风各自命中', () => {
  assert.equal(judgeDay(day({ date: '2026-09-15', tMax: WEATHER_RULES.heatMax }))?.kind, 'heat');
  assert.equal(judgeDay(day({ date: '2026-09-15', tMin: WEATHER_RULES.coldMin }))?.kind, 'cold');
  assert.equal(judgeDay(day({ date: '2026-09-15', windMax: WEATHER_RULES.windMax }))?.kind, 'wind');
});

test('各项都差一点点时不提醒（阈值不含容差）', () => {
  assert.equal(judgeDay(day({
    date: '2026-09-15',
    tMax: WEATHER_RULES.heatMax - 0.1,
    tMin: WEATHER_RULES.coldMin + 0.1,
    windMax: WEATHER_RULES.windMax - 0.1,
  })), null);
});

test('同一天多条命中时，只给破坏力最大的一条', () => {
  const all = day({
    date: '2026-09-15', tMin: 2, tMax: 38, windMax: 40,
    rainProb: 90, periods: { pm: period({ rainProb: 90 }) },
  });
  assert.equal(judgeDay(all)?.kind, 'rain');     // 雨 > 寒 > 热 > 风

  // 去掉雨之后，严寒应该压过高温（冷比热更影响当天）
  const coldOrHeat = day({ date: '2026-09-15', tMin: 2, tMax: 38, windMax: 40 });
  assert.equal(judgeDay(coldOrHeat)?.kind, 'cold');
});

/* ---------------- 周次过滤与 id ---------------- */

test('只有落在目标周的天气才产出任务', () => {
  const report: WeatherReport = {
    ...rainyReport(),
    days: [
      day({ date: '2026-09-15', rainProb: 80, periods: { pm: period({ rainProb: 80 }) } }), // 第 3 周
      day({ date: '2026-09-22', rainProb: 80, periods: { pm: period({ rainProb: 80 }) } }), // 第 4 周
      day({ date: '2026-10-06', rainProb: 80, periods: { pm: period({ rainProb: 80 }) } }), // 第 6 周
    ],
  };
  const tasks = weatherToTasks(report, TERM_START, W3);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].dayOfWeek, 2);
  assert.deepEqual(tasks[0].weeks, [W3]);
});

test('任务 id 稳定且不含时间片段', () => {
  const t = weatherToTasks(rainyReport(), TERM_START, W3)[0];
  assert.equal(t.id, 'wx-2026-09-15-rain');
  // 与 blockId 同一原则：id 只由「日期 + 类型」构成，不含 HHMM 之类的时间信息，
  // 否则块一移动 id 就变，「同一个块」的身份就断了。
  assert.match(t.id, /^wx-\d{4}-\d{2}-\d{2}-[a-z]+$/);
});

test('天气块不设 essential，且优先级低于事件准备块', () => {
  const t = weatherToTasks(rainyReport(), TERM_START, W3)[0];
  assert.notEqual(t.essential, true);              // 不是硬需求：该被挤掉，而不是挤别人
  assert.ok((t.priority ?? 0) < 88, '优先级应低于事件准备块的 88');
});

test('同输入两次结果完全一致（确定性）', () => {
  const a = weatherToTasks(rainyReport(), TERM_START, W3);
  const b = weatherToTasks(rainyReport(), TERM_START, W3);
  assert.deepEqual(a, b);
});

test('weatherHints 汇总全部达标日，且与 weatherToTasks 判定同源', () => {
  const report: WeatherReport = {
    ...rainyReport(),
    days: [
      day({ date: '2026-09-15', rainProb: 80, periods: { pm: period({ rainProb: 80 }) } }),
      day({ date: '2026-09-16' }),                     // 温和 → 无提醒
      day({ date: '2026-09-17', tMax: 35 }),           // 高温
    ],
  };
  const hints = weatherHints(report);
  assert.equal(hints.length, 2);
  assert.deepEqual(hints.map((h) => h.kind), ['rain', 'heat']);
  // weatherToTasks 只覆盖本周，weatherHints 覆盖整份报告 —— 这是刻意不同的粒度
  assert.equal(weatherToTasks(report, TERM_START, W3).length, 2);
});
