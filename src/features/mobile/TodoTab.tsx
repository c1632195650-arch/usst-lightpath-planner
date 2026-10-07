/**
 * 光溯移动端 · 待办页签（2026-10-08 底部导航批次拆出）
 * ============================================================
 * 内容：目标待办卡（GoalTodoCard，M1a 起不再 4 秒淡出；本页签让它**常驻**——
 * 这正是任务书 M1「待办/目标常驻设置区」的落点）。
 * 数据来自宿主传入的 d（memo/attention/memoHandlers/syncStatus）。
 */
import type { TodayData } from './lib/useTodayData.ts';
import { memoNeedsAttention } from './lib/memoStore.ts';
import GoalTodoCard from './GoalTodoCard.tsx';

export default function TodoTab({ d }: { d: TodayData }) {
  const attention = memoNeedsAttention(d.memo, d.todayKey);
  return (
    <>
      <p className="px-1 text-xs leading-5 text-ink-faint">
        手机随手记，云端自动同步；网页端周计划会围着它们排时间。
      </p>
      <GoalTodoCard data={d.memo} attention={attention} syncError={d.syncStatus === 'error'} h={d.memoHandlers} />
    </>
  );
}
