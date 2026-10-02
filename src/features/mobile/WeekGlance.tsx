/**
 * 光溯移动端 · 本周剩余概览（F10：只读）
 */
import type { WeekPlan } from '@/types';
import type { UserPlanLayer } from '@/features/week/userPlanStore';
import { applyLayerToBlocks } from './lib/sync.ts';

const DOW_CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function WeekGlance({
  plan,
  layer,
  weekNo,
  todayDow,
}: {
  plan: WeekPlan | null;
  layer: UserPlanLayer;
  weekNo: number;
  todayDow: number;
}) {
  if (!plan) return null;
  const rows = [];
  for (let d = todayDow; d <= 7; d++) {
    const { blocks, doneIds } = applyLayerToBlocks(plan, layer, weekNo, d);
    const left = blocks.filter((b) => !doneIds.has(b.id)).length;
    rows.push(
      <div key={d} className="flex items-center justify-between py-1.5">
        <span className="text-sm text-ink-soft">{d === todayDow ? '今天' : DOW_CN[d]}</span>
        <span className="text-sm font-semibold text-ink" data-testid={`m-glance-d${d}`}>
          {d === todayDow ? `剩 ${left} 件` : `${left} 件`}
        </span>
      </div>,
    );
  }
  return (
    <section data-testid="m-week-glance" className="rounded-card bg-paper-card p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-ink-soft">本周剩余（只读）</h3>
      <div className="mt-1 divide-y divide-ink/5">{rows}</div>
    </section>
  );
}
