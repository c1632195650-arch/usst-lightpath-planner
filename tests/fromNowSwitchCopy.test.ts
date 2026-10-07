/**
 * 「从此刻开始排」切换反馈的文案（纯函数）
 * ============================================================
 * 起因（RAY 2026-10-08 00:19）：切了这个开关之后**没有重排按钮、也没有任何反馈**。
 * 真相：它走**立即生效**通道（`fromNowOn` 在引擎重算依赖里），没有按钮是对的；
 *       缺的是"我生效了"的信号 —— 尤其**凌晨**切换时
 *       `softFloor = max(07:00, 现在)` 等于没变（实测块数 94→94），
 *       没有说明就必然被当成 bug。
 * 本文件钉住三档文案的存在性与关键措辞。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromNowSwitchCopy } from '@/features/week/weekViewUtils';

test('关闭开关 → 说清「今天恢复完整安排」', () => {
  const s = fromNowSwitchCopy(false, 10 * 60);
  assert.match(s, /完整排满这一周/);
  assert.match(s, /恢复/);
});

test('打开且已过今天的起点 → 文案带上「从几点开始不再安排」', () => {
  const s = fromNowSwitchCopy(true, 14 * 60 + 30);
  assert.match(s, /只排剩下的时间/);
  assert.match(s, /14:30/, '必须报出被砍的界点，否则用户无法判断效果');
  assert.match(s, /其余六天/, '要说清影响范围 —— 否则会被误以为整周都变了');
});

test('打开但还没到今天的起点（凌晨）→ **必须说明"暂时没有可砍的时段"**', () => {
  const s = fromNowSwitchCopy(true, 15);
  assert.match(s, /还没到今天的起点/, '这是本条修复的核心：凌晨切换计划不会变，必须解释');
  assert.match(s, /07:00/, '要点明起点是几点，用户才知道什么时候再来切');
});

test('边界：正好 07:00 算「已过起点」，走正常那一档', () => {
  const s = fromNowSwitchCopy(true, 7 * 60);
  assert.match(s, /07:00/);
  assert.doesNotMatch(s, /还没到今天的起点/);
});
