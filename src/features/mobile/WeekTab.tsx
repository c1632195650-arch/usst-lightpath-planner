/**
 * 光溯移动端 · 本周页签（2026-10-08 底部导航批次拆出）
 * ============================================================
 * 内容：WeekBoard（M3：周切换 ‹ › / 回到现在 / 点天展开）。
 * 数据全部来自宿主传入的 d；本文件只渲染。
 */
import type { TodayData } from './lib/useTodayData.ts';
import WeekBoard from './WeekBoard.tsx';

export default function WeekTab({ d }: { d: TodayData }) {
  return (
    <>
      {d.phase === 'ready' && (
        <WeekBoard plan={d.plan} layer={d.layer} weekNo={d.weekNo ?? 0} todayDow={d.dow} serverState={d.serverState} />
      )}
      {d.phase !== 'ready' && (
        <p className="py-16 text-center text-sm text-ink-faint">
          {d.phase === 'loading' ? '同步中…' : d.phase === 'error' ? d.errMsg : '云端还没有你的计划 —— 先去网页端排一版。'}
        </p>
      )}
    </>
  );
}
