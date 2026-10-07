/**
 * 光溯移动端 · 今日页宿主（新任务三 §3.1 三区信息架构；2026-10-08 底部导航批次重构）
 * ============================================================
 * 本文件只承担**宿主**职责（硬指标：≤260 行，禁止回填业务逻辑）：
 *   · 单一 useTodayData 实例（数据/同步/覆盖层/待办仓/通知决策全在 lib/）；
 *   · 页签状态（今天/本周/待办/我的）+ 编辑抽屉/梨宝抽屉开合；
 *   · 内容区按页签渲染四个小页签组件（TodayTab/WeekTab/TodoTab/MeTab），
 *     今日视图 displayed 与 displayedRef 回写在本层算一次、向子页传。
 * 底部：BottomNav（含梨宝中键 → LbaoDrawer；m-lbao-toggle 锚点保留）。
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
import TodayTab from './TodayTab.tsx';
import WeekTab from './WeekTab.tsx';
import TodoTab from './TodoTab.tsx';
import MeTab from './MeTab.tsx';

const TAB_LABEL: Record<MobileTab, string> = {
  today: '今天', week: '本周', todo: '待办', me: '我的',
};

export default function TodayPage({ identity, onLogout }: { identity: MobileIdentity; onLogout: () => void }) {
  const now = useNow(30_000);
  const nowMin = minutesOfDay(now);
  const d = useTodayData(identity, now);

  const [tab, setTab] = useState<MobileTab>('today');
  const [sheetBlock, setSheetBlock] = useState<TimeBlock | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /** 今日视图 = 重算计划 ∘ 覆盖层（excluded / moves / done）；在宿主算一次，四页共用 */
  const displayed = useMemo(
    () => (d.plan && d.weekNo ? applyLayerToBlocks(d.plan, d.layer, d.weekNo, d.dow) : null),
    [d.plan, d.layer, d.weekNo, d.dow],
  );
  // 同步成功后的通知重排、通知动作按钮都吃这份视图（钩子经 ref 读取）
  d.displayedRef.current = displayed;

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

      <main className="mx-auto w-full max-w-md space-y-3 px-4">
        {tab === 'today' && <TodayTab d={d} displayed={displayed} nowMin={nowMin} onOpenBlock={setSheetBlock} />}
        {tab === 'week' && <WeekTab d={d} />}
        {tab === 'todo' && <TodoTab d={d} />}
        {tab === 'me' && <MeTab d={d} displayed={displayed} nowMin={nowMin} identity={identity} onLogout={handleLogout} />}
      </main>

      <BottomNav tab={tab} onTab={setTab} onLbao={() => setDrawerOpen(true)} />

      <EditSheet
        block={sheetBlock}
        done={sheetBlock ? (displayed?.doneIds.has(sheetBlock.id) ?? false) : false}
        onClose={() => setSheetBlock(null)}
        onAction={onAction}
      />
      <LbaoDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} userId={identity.username} />
    </div>
  );
}
