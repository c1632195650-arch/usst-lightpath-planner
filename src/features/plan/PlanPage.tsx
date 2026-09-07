import { EmptyState } from '@/components/ui/EmptyState';
import type { WeekPlan } from '@/types';

/**
 * 【人 A 负责 · UI】【人 B 负责 · 算法】计划展示
 *
 * ⚠️ 这是两人唯一高耦合的模块，务必按下面的分工边界走：
 *   人 B：实现 src/lib/planner/scheduler.ts，导出 planWeek(...)：WeekPlan
 *   人 A：只消费 WeekPlan，不关心算法内部
 *
 * ── 输入 ──   Schedule + UserProfile + Task[] + 目标周次
 * ── 输出 ──   WeekPlan
 *
 * ── 要做的事（见 docs/features.md M4 / M5）──
 *   1. 阶段时间轴（横向）
 *   2. 周视图（7 天 × 块）
 *   3. 日视图（展开某天）
 *   4. 留白率滑块（核心交互）
 *   5. 「今天不想动」一键重排 ← 差异化卖点，别砍
 *
 * ── 硬性约束 ──
 *   · 排完先自己看一遍合不合理。AI 排出来「一天学 14 小时」它自己觉得没问题。
 *   · 输出不要做成密密麻麻的甘特图。做成「今天 2 件必须做 + 1 件可选 + 其余是休息」。
 *     任务越少，完成率越高 —— 这是本产品的核心指标。
 */
interface Props {
  plan: WeekPlan | null;
}

export default function PlanPage({ plan }: Props) {
  if (plan) {
    return (
      <div className="px-4">
        <EmptyState
          icon="🗓️"
          title={`第 ${plan.weekNo} 周计划`}
          description={`学习 ${Math.round(plan.studyMin / 60)} 小时 · 留白 ${Math.round(plan.actualBlankRate * 100)}%`}
        />
      </div>
    );
  }

  return (
    <div className="px-4">
      <EmptyState
        icon="🌿"
        title="TODO：周 / 日计划视图"
        description="人 A 写 UI，人 B 写 lib/planner/scheduler.ts。先对齐 WeekPlan 结构再动手。"
      />
    </div>
  );
}
