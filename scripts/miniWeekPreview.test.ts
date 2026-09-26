/**
 * WP8-mini MiniWeekPreview —— 纯视图模型测试
 * ============================================================
 * 组件只做 模型 → JSX 的薄映射；「同 props 同输出 / 只渲染不交互 /
 * 紧凑模式 / 空态」全部在模型层验收（node --test 跑不了 JSX，见模型头注）。
 *
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §WP8）：把排序还原成引擎原始顺序
 *    （不做 天→时刻→id 排序）→ 排序用例红；compact 分支删掉 → 紧凑用例红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { miniWeekViewModel } from '@/features/week/miniWeekPreviewModel';
import type { TimeBlock, WeekPlan } from '@/types';

const block = (id: string, day: number, start: number, title: string, kind = 'study'): TimeBlock =>
  ({ id, kind: kind as TimeBlock['kind'], dayOfWeek: day, startMin: start, endMin: start + 60, title } as TimeBlock);

const plan = (blocks: TimeBlock[]): WeekPlan =>
  ({ weekNo: 5, blocks, stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length } } as WeekPlan);

test('WP8: null / 空计划 → 空态，caption 保留', () => {
  for (const d of [null, plan([])]) {
    const vm = miniWeekViewModel(d, false, '草稿 · 未落盘');
    assert.equal(vm.empty, true);
    assert.equal(vm.totalBlocks, 0);
    assert.equal(vm.caption, '草稿 · 未落盘');
  }
});

test('WP8: 同 props 同输出（确定性）——不读时钟、不随机', () => {
  const d = plan([block('b2', 2, 600, '自习'), block('b1', 1, 480, '早课', 'course')]);
  assert.deepEqual(miniWeekViewModel(d, false, 'x'), miniWeekViewModel(d, false, 'x'));
});

test('WP8: 按天分组、组内按起始时间排序；跨天升序', () => {
  // 反向：还原成「引擎原始顺序不排序」→ 本用例红
  const d = plan([
    block('late', 1, 840, '下午的事'),
    block('early', 2, 480, '早课', 'course'),
    block('first', 1, 480, '早读'),
  ]);
  const vm = miniWeekViewModel(d, false);
  assert.deepEqual(vm.days.map((c) => c.day), [1, 2]);
  assert.deepEqual(vm.days[0].blocks.map((b) => b.id), ['first', 'late'], '同天内按起始时刻升序');
  assert.equal(vm.totalBlocks, 3);
});

test('WP8: 紧凑模式仍在模型中体现（每天只留计数语义），完整模式带时间', () => {
  // 反向：删掉 compact 分支 → 本用例红
  const d = plan([block('a', 3, 480, '块A'), block('b', 3, 600, '块B')]);
  const full = miniWeekViewModel(d, false);
  const compact = miniWeekViewModel(d, true);
  assert.equal(full.days[0].blocks.length, 2);
  assert.equal(compact.days[0].blocks.length, 2);
  assert.match(full.days[0].blocks[0].start, /^\d{2}:\d{2}$/);
  assert.match(full.days[0].blocks[0].end, /^\d{2}:\d{2}$/);
});

test('WP8: 模型不含交互形态（只渲染不交互的机械化表述）', () => {
  // 模型层没有 handler 字段位；这里钉住形状，防止将来把交互混进预览卡
  const vm = miniWeekViewModel(plan([block('a', 1, 480, '块A')]), false);
  const json = JSON.stringify(vm);
  assert.ok(!/onDrag|onClick|handler/i.test(json), '预览模型不得携带交互句柄');
});
