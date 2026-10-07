/**
 * 光溯移动端 · 今日页宿主（新任务三 §3.1 三区信息架构；2026-10-08 底部导航批次重构）
 * ============================================================
 * 本文件只承担**宿主**职责（硬指标：≤260 行，禁止回填业务逻辑）：
 *   · 单一 useTodayData 实例（数据/同步/覆盖层/待办仓/通知决策全在 lib/）；
 *   · 页签状态（日程/待办/梨宝/我的）+ 编辑抽屉开合；
 *   · 内容区按页签渲染小页签组件（TodayTab/WeekTab/TodoTab/MeTab），
 *     今日视图 displayed 与 displayedRef 回写在本层算一次、向子页传。
 * 底部：BottomNav（四个页签同形态）；梨宝页签 = **全屏页**（LbaoDrawer `variant="page"`，
 * 2026-10-08 二改：取消中键高光后不再用半屏抽屉）。
 */
import { useCallback, useMemo, useState } from 'react';
import type { TimeBlock } from '@/types';
import type { MobileIdentity } from './lib/auth.ts';
import { clearIdentity } from './lib/auth.ts';
import { applyLayerToBlocks, minutesOfDay } from './lib/sync.ts';
import { useNow } from './lib/useNow.ts';
import { useTodayData } from './lib/useTodayData.ts';
import EditSheet, { type EditAction } from './EditSheet.tsx';
import LbaoDrawer from './LbaoDrawer.tsx';
import BottomNav, { type MobileTab } from './BottomNav.tsx';
import DayStrip, { weekDaysOf } from './DayStrip.tsx';
import TodayTab from './TodayTab.tsx';
import WeekTab from './WeekTab.tsx';
import TodoTab from './TodoTab.tsx';
import MeTab from './MeTab.tsx';

const TAB_LABEL: Record<MobileTab, string> = {
  today: '日程', week: '日程', todo: '待办', me: '我的', lbao: '梨宝',
};

export default function TodayPage({ identity, onLogout }: { identity: MobileIdentity; onLogout: () => void }) {
  const now = useNow(30_000);
  const nowMin = minutesOfDay(now);
  const d = useTodayData(identity, now);

  const [tab, setTab] = useState<MobileTab>('today');
  const [sheetBlock, setSheetBlock] = useState<TimeBlock | null>(null);
  /** 日期条选中的星期（1–7）；null = 跟随今天。 */
  const [selDow, setSelDow] = useState<number | null>(null);

  /** 今日视图 = 重算计划 ∘ 覆盖层（excluded / moves / done）；在宿主算一次。 */
  const todayView = useMemo(
    () => (d.plan && d.weekNo ? applyLayerToBlocks(d.plan, d.layer, d.weekNo, d.dow) : null),
    [d.plan, d.layer, d.weekNo, d.dow],
  );
  // 同步成功后的通知重排、通知动作按钮都吃**今天**这份视图（钩子经 ref 读取）——
  // 日期条切到别的天不能影响提醒（提醒永远关于此刻）。
  d.displayedRef.current = todayView;

  /**
   * 日期条选中的那一天（2026-10-08 页面模板批）：
   * 今天/本周合并为一个「日程」屏 —— 日期条切换要看的那天，正文渲染那天的流水；
   * 选中的就是今天时复用 todayView，不重算。
   */
  const viewDow = selDow ?? d.dow;
  const isTodayView = viewDow === d.dow;
  const viewDisplayed = useMemo(
    () => (isTodayView ? todayView : (d.plan && d.weekNo ? applyLayerToBlocks(d.plan, d.layer, d.weekNo, viewDow) : null)),
    [isTodayView, todayView, d.plan, d.layer, d.weekNo, viewDow],
  );
  /** 本周 7 天（周一 → 周日）：宿主算一次给日期条。termStart 取自同步态（与周次同源）。 */
  const weekDays = useMemo(
    () => (d.weekNo && d.serverState?.termStart ? weekDaysOf(d.serverState.termStart, d.weekNo) : []),
    [d.weekNo, d.serverState?.termStart],
  );

  const handleLogout = useCallback(() => { clearIdentity(); onLogout(); }, [onLogout]);
  const onAction = useCallback((b: TimeBlock, a: EditAction) => {
    d.onAction(b, a);
    setSheetBlock(null);
  }, [d]);

  return (
    /* 底部留白 = 底栏高度 + iOS 安全区（m.html 已 viewport-fit=cover） */
    <div className="min-h-screen w-full bg-paper pb-[calc(4.75rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-ink">光溯 · {TAB_LABEL[tab]}</h1>
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            {d.weekNo && <span data-testid="m-weekno">第 {d.weekNo} 周</span>}
            <span data-testid="m-sync-status">
              {d.syncStatus === 'syncing' && '同步中…'}
              {d.syncStatus === 'saved' && '已同步'}
              {d.syncStatus === 'error' && '同步失败'}
            </span>
          </div>
        </div>
        <p className="text-xs text-ink-faint">{identity.username} · 懂上理的智能决策伙伴</p>
      </header>

      {/* 日期条贴在页头下方：换一天看是这一屏最常用的动作（§11.8 ② 移动端唯一允许横滑区） */}
      {tab === 'today' && weekDays.length === 7 && (
        <div className="sticky top-[68px] z-20 bg-paper/95 px-4 pb-1.5 pt-1.5 backdrop-blur">
          <DayStrip
            days={weekDays}
            selectedDow={viewDow}
            todayDow={d.weekNo ? d.dow : null}
            onSelect={(dow) => setSelDow(dow === d.dow ? null : dow)}
          />
        </div>
      )}

      <main className="mx-auto w-full max-w-md space-y-3 px-4">
        {tab === 'today' && (
          <TodayTab
            d={d}
            displayed={viewDisplayed}
            nowMin={nowMin}
            onOpenBlock={setSheetBlock}
            viewDow={viewDow}
            isTodayView={isTodayView}
          />
        )}
        {tab === 'week' && <WeekTab d={d} />}
        {tab === 'todo' && <TodoTab d={d} />}
        {tab === 'me' && <MeTab d={d} displayed={todayView} nowMin={nowMin} identity={identity} onLogout={handleLogout} />}
        {/* 梨宝页签：全屏页（2026-10-08 二改）——高度 = 视口 − 页头(≈68px) − 底栏留白(4.75rem+safe) */}
        {tab === 'lbao' && (
          <div
            className="flex w-full flex-col"
            style={{ height: 'calc(100dvh - 9.25rem - env(safe-area-inset-bottom))' }}
          >
            <LbaoDrawer open onClose={() => setTab('today')} userId={identity.username} variant="page" />
          </div>
        )}
      </main>

      <BottomNav tab={tab} onTab={setTab} />

      <EditSheet
        block={sheetBlock}
        done={sheetBlock ? (viewDisplayed?.doneIds.has(sheetBlock.id) ?? false) : false}
        onClose={() => setSheetBlock(null)}
        onAction={onAction}
      />
    </div>
  );
}
