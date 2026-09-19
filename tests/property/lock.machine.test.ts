/**
 * 锁闭环状态机属性（P0，2026-09-19 · 究极测评体系 L6）
 * ============================================================
 * 性质：任意「排 → 锁 → 其它块被扰动 → 再应用锁」序列里，被锁块**要么回到快照位置、
 * 要么如实报冲突 —— 绝不静默漂移**。这是 `applyLockedPlacements` 的立身之本
 * （solver.ts §二·五：锁的意义就是「可预期」，一次静默违背用户就再也不信它）。
 *
 * ⚠️ 反向验证（已实测）：把 `solver.ts::applyLockedPlacements` 里
 *    `const next: TimeBlock = { ...block, startMin: snap.startMin, endMin: snap.endMin };`
 *    改回 `{ ...block }`（不写回快照）→ 本文件立即变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { applyLockedPlacements } from '@/lib/planner/solver.ts';
import type { LockLevel, TimeBlock, WeekPlan } from '@/types';

/** 手工构造的最小可行周计划：1 个待锁 study 块 + 2 个 free 软块，同日互不重叠。 */
function mkPlan(): WeekPlan {
  const mk = (id: string, startMin: number, place?: string): TimeBlock => ({
    id, kind: 'study', dayOfWeek: 1, startMin, endMin: startMin + 60,
    title: `t-${id}`, place, source: 'template',
  });
  return {
    weekNo: 4,
    blocks: [
      mk('lock-1', 540, '第一教学楼'),
      mk('free-1', 610, '第三教学楼'),
      mk('free-2', 680, '第三教学楼'),
    ],
    stats: { courseMin: 0, studyMin: 180, blankMin: 0, blockCount: 3 },
    issues: [],
  };
}

const PLACEMENTS = { 'lock-1': { dayOfWeek: 1, startMin: 540, endMin: 600, place: '第一教学楼', title: 't-lock-1' } };
const LOCKS: Record<string, LockLevel> = { 'lock-1': 'hard' };

test('prop: 任意扰动后应用锁，被锁块回到快照位置且不引入重叠', () => {
  fc.assert(fc.property(
    fc.integer({ min: 5, max: 120 }),      // 全体块的漂移量（只会把别的块推得更晚）
    fc.integer({ min: 0, max: 60 }),       // 两个 free 块各自额外的错位
    (drift, jitter) => {
      const plan = mkPlan();
      const drifted: TimeBlock[] = plan.blocks.map((b, i) => {
        const d = drift + (i > 0 ? jitter * i : 0);
        return { ...b, startMin: b.startMin + d, endMin: b.endMin + d };
      });
      const res = applyLockedPlacements(
        { ...plan, blocks: drifted, issues: [] }, PLACEMENTS, LOCKS);

      const locked = res.plan.blocks.find((b) => b.id === 'lock-1');
      assert.ok(locked, '被锁块凭空消失');
      // 要么被写回快照位置（restored），要么如实报冲突 —— 二者必居其一
      if (locked.startMin === 540) {
        assert.ok(res.restored.includes('lock-1'), '位置回去了却没记入 restored');
        const others = res.plan.blocks.filter((b) => b.id !== 'lock-1');
        for (const o of others) {
          const clash = o.dayOfWeek === locked.dayOfWeek
            && o.startMin < locked.endMin && locked.startMin < o.endMin;
          assert.ok(!clash, `恢复锁块时引入了与 ${o.id} 的重叠`);
        }
      } else {
        assert.ok(res.conflicts.some((c) => c.id === 'lock-1'),
          `锁块漂移到 ${locked.startMin} 却没有报 lock-conflict（静默违背）`);
      }
    },
  ), { numRuns: 100 });
});

test('prop: 对照组 —— 不传 lockLevels 时漂移被保留（证明上面的性质真能抓锁失效）', () => {
  fc.assert(fc.property(fc.integer({ min: 5, max: 120 }), (drift) => {
    const plan = mkPlan();
    const drifted = plan.blocks.map((b) => ({ ...b, startMin: b.startMin + drift, endMin: b.endMin + drift }));
    const res = applyLockedPlacements(
      { ...plan, blocks: drifted, issues: [] }, PLACEMENTS, {});   // 空 lockLevels = 没锁
    const locked = res.plan.blocks.find((b) => b.id === 'lock-1');
    assert.equal(locked?.startMin, 540 + drift, '无锁时块不该被拉回快照位置');
  }), { numRuns: 50 });
});
