/**
 * 右键空档加一件事 · 纯函数测试（2026-10-07）
 * 对应 src/features/week/gapAdd.ts：开始时间（含 20 分钟转场缓冲）、
 * 空档容量封顶、类型自动判断。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAP_ADD_BUFFER_MIN,
  durationChoices,
  gapCapacityMin,
  guessTaskKind,
  resolveGapStart,
} from '../src/features/week/gapAdd.ts';

test('无前块（空档从日界 7:00 开始）：不缓冲，按点击吸附', () => {
  const gap = { startMin: 7 * 60, endMin: 8 * 60 + 30 };
  assert.equal(resolveGapStart(gap, 7 * 60 + 13), 7 * 60 + 10);
  assert.equal(resolveGapStart(gap, 7 * 60 + 1), 7 * 60);
});

test('有前块：点击点在前块结束后 20 分钟缓冲内 → 后撤到 前块结束+20', () => {
  // 前块 12:00 结束（= gap.startMin），点在 12:05 → 12:20
  const gap = { startMin: 12 * 60, endMin: 14 * 60 };
  assert.equal(resolveGapStart(gap, 12 * 60 + 5), 12 * 60 + GAP_ADD_BUFFER_MIN);
  // 点在 12:19 也一样（缓冲是硬底线）
  assert.equal(resolveGapStart(gap, 12 * 60 + 19), 12 * 60 + GAP_ADD_BUFFER_MIN);
  // 点在 12:21 → 吸附到 12:20
  assert.equal(resolveGapStart(gap, 12 * 60 + 21), 12 * 60 + 20);
});

test('点在空档深处：不受缓冲影响，按点击吸附', () => {
  const gap = { startMin: 13 * 60, endMin: 18 * 60 };
  assert.equal(resolveGapStart(gap, 15 * 60 + 47), 15 * 60 + 50);
});

test('点击越界（贴着空档尾）：夹回空档尾（容量归零，由调用方判放不下）', () => {
  const gap = { startMin: 12 * 60, endMin: 13 * 60 };
  assert.equal(resolveGapStart(gap, 13 * 60 - 1), 13 * 60);
});

test('容量与时长选项：前后各留 20 分钟缓冲，档位之外追加容量本身（可填满空档）', () => {
  const gap = { startMin: 12 * 60, endMin: 13 * 60 + 30 };
  // 12:20 起，末尾再留 20 分钟 ⟹ 90 − 20 − 20 = 50
  assert.equal(gapCapacityMin(gap, 12 * 60 + 20), 50);
  assert.deepEqual(durationChoices(50), [15, 30, 45, 50]);
  assert.deepEqual(durationChoices(14), []);
  assert.deepEqual(durationChoices(120), [15, 30, 45, 60, 90, 120]);
  assert.deepEqual(durationChoices(400), [15, 30, 45, 60, 90, 120, 400]);
  // RAY 的拍板算例：两小时空档点开头 ⟹ 80 分钟可选；四小时 ⟹ 200
  assert.equal(gapCapacityMin({ startMin: 12 * 60, endMin: 14 * 60 }, 12 * 60 + 20), 80);
  assert.equal(gapCapacityMin({ startMin: 12 * 60, endMin: 16 * 60 }, 12 * 60 + 20), 200);
});

test('类型自动判断：用餐 / 自习 / 活动兜底', () => {
  assert.equal(guessTaskKind('午餐'), 'meal');
  assert.equal(guessTaskKind('去食堂'), 'meal');
  assert.equal(guessTaskKind('背单词'), 'study');
  assert.equal(guessTaskKind('写实验报告'), 'study');
  assert.equal(guessTaskKind('跑步'), 'activity');
  assert.equal(guessTaskKind('拿快递'), 'activity');
  assert.equal(guessTaskKind(''), 'activity');
});
