/**
 * 光溯移动端 · 今日页（新任务三 §3.1 三区信息架构）
 * ============================================================
 * 本文件只承担**渲染**；数据/同步/覆盖层/待办仓/通知决策全在 lib/useTodayData.ts
 * 与各纯函数模块（硬指标：本文件 ≤260 行，禁止回填逻辑）。
 *
 * 三区（竖持单手，重要性递减）：
 *   ① 目标待办卡（≈4s 淡出 / 逾期转常驻）② 当前块 NowBlock（燃烧条+大按钮+tips 插槽）
 *   ③ 接下来 + 当日时间轴（上下滑 = 只看当天）
 * 底部：通知状态 / 梨宝抽屉 / ICS / 白名单（P6-2 降级折叠）/ 评估区（任务二）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TimeBlock } from '@/types';
import type { MobileIdentity } from './lib/auth.ts';
import { clearIdentity } from './lib/auth.ts';
import { applyLayerToBlocks, minutesOfDay } from './lib/sync.ts';
import { nowTipForBlock } from './lib/nowTip.ts';
import { useNow } from './lib/useNow.ts';
import { memoNeedsAttention } from './lib/memoStore.ts';
import { useTodayData } from './lib/useTodayData.ts';
import BlockCard from './BlockCard.tsx';
import EditSheet, { type EditAction } from './EditSheet.tsx';
import TomorrowPreview from './TomorrowPreview.tsx';
import WeekBoard from './WeekBoard.tsx';
import NowBlock from './NowBlock.tsx';
import NextList from './NextList.tsx';
import GoalTodoCard from './GoalTodoCard.tsx';
import QuickBar from './QuickBar.tsx';
import NotifyStatus from './NotifyStatus.tsx';
import LbaoDrawer from './LbaoDrawer.tsx';
import EvalSection from './EvalSection.tsx';
import IcsGuide from './IcsGuide.tsx';
import WhitelistGuide from './WhitelistGuide.tsx';

export default function TodayPage({ identity, onLogout }: { identity: MobileIdentity; onLogout: () => void }) {
  const now = useNow(30_000);
  const nowMin = minutesOfDay(now);
  const d = useTodayData(identity, now);

  const [sheetBlock, setSheetBlock] = useState<TimeBlock | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /** 今日视图 = 重算计划 ∘ 覆盖层（excluded / moves / done） */
  const displayed = useMemo(
    () => (d.plan && d.weekNo ? applyLayerToBlocks(d.plan, d.layer, d.weekNo, d.dow) : null),
    [d.plan, d.layer, d.weekNo, d.dow],
  );
  // 同步成功后的通知重排、通知动作按钮都吃这份视图（钩子经 ref 读取）
  d.displayedRef.current = displayed;

  const onAction = useCallback((b: TimeBlock, a: EditAction) => {
    d.onAction(b, a);
    setSheetBlock(null);
  }, [d]);

  /* ---------- 渲染 ---------- */
  const current = displayed?.blocks.find((b) => b.startMin <= nowMin && nowMin < b.endMin && !displayed.doneIds.has(b.id)) ?? null;
  const next = displayed ? displayed.blocks
    .filter((b) => b.endMin > nowMin && !displayed.doneIds.has(b.id))
    .sort((a, b) => a.startMin - b.startMin)[0] ?? null : null;
  const doneIds = displayed?.doneIds ?? new Set<string>();
  const attention = memoNeedsAttention(d.memo, d.todayKey);

  return (
    <div className="min-h-screen w-full bg-paper pb-10">
      <header className="sticky top-0 z-30 bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-ink">光溯 · 今天</h1>
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            {d.weekNo && <span data-testid="m-weekno">第 {d.weekNo} 周</span>}
            <span data-testid="m-sync-status">
              {d.syncStatus === 'syncing' && '同步中…'}
              {d.syncStatus === 'saved' && '已同步 ✓'}
              {d.syncStatus === 'error' && '同步失败'}
            </span>
            <button type="button" onClick={() => { clearIdentity(); onLogout(); }} className="underline">退出</button>
          </div>
        </div>
        <p className="text-xs text-ink-faint">{identity.username} · 懂上理的智能决策伙伴</p>
      </header>

      <main className="mx-auto w-full max-w-md space-y-3 px-4">
        {d.changed && (
          <div data-testid="m-changed-banner" className="rounded-xl bg-accent-light px-4 py-2.5 text-sm text-ink">
            今天的安排有更新 —— 以这里显示的为准。
            <button type="button" className="ml-2 underline" onClick={() => d.setChanged(false)}>知道了</button>
          </div>
        )}
        {d.updateUrl && (
          <div data-testid="m-update" className="rounded-xl bg-brand-light px-4 py-2.5 text-sm text-ink">
            有新版本。<a className="ml-2 underline" href={d.updateUrl}>下载更新 APK</a>
          </div>
        )}
        {d.permDenied && (
          <div data-testid="m-perm-banner" className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            通知没开，提醒收不到 —— 去系统设置打开通知权限，回来点「重排提醒」。
          </div>
        )}

        {d.phase === 'loading' && <p data-testid="m-loading" className="py-16 text-center text-sm text-ink-faint">同步中…</p>}
        {d.phase === 'error' && (
          <div className="py-16 text-center">
            <p className="text-sm text-danger">{d.errMsg}</p>
            <button type="button" onClick={() => void d.retry()} className="mt-3 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">重试</button>
          </div>
        )}
        {d.phase === 'empty-cloud' && (
          <div data-testid="m-empty-cloud" className="rounded-card bg-paper-card p-6 text-center shadow-sm">
            <p className="text-base font-semibold text-ink">云端还没有你的计划</p>
            <p className="mt-2 text-sm leading-6 text-ink-soft">先去网页端导入课表、生成周计划，回来点一下同步，这里就能看了。</p>
            <button type="button" onClick={() => void d.retry()} className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">我排好了，刷新</button>
          </div>
        )}

        {d.phase === 'ready' && (
          <>
            {/* 区① 目标 + 待办（CY：首屏浮现，作用类似欢迎页 —— 无数据也渲染出引导与记录入口；
                逾期转常驻由卡内淡出逻辑承担） */}
            <GoalTodoCard data={d.memo} attention={attention} syncError={d.syncStatus === 'error'} h={d.memoHandlers} />

            {/* 区② 当前块（绝对核心）｜ 区③ 接下来（次级·小） */}
            {current ? (
              <>
                <NowBlock
                  block={current} nowMin={nowMin} done={doneIds.has(current.id)}
                  /* 任务一 P2-1 交付的 tips 接口（经 nowTip 适配层）：无匹配 → 插槽整块不渲染 */
                  tip={nowTipForBlock(current)}
                  onToggleDone={() => onAction(current, { type: 'toggleDone' })}
                  onShift15={() => onAction(current, { type: 'shift', deltaMin: 15 })}
                />
                {next && <NextList next={next} nowMin={nowMin} />}
              </>
            ) : (
              <NextList next={next} nowMin={nowMin} />
            )}

            <QuickBar displayed={displayed} nowMin={nowMin} onShift={(b) => onAction(b, { type: 'shift', deltaMin: 15 })} />

            {/* 当日时间轴（上下滑 = 只看当天） */}
            <section className="space-y-2" data-testid="m-today-list">
              {displayed && displayed.blocks.length === 0 && (
                <div data-testid="m-empty" className="rounded-card bg-paper-card p-6 text-center shadow-sm">
                  <p className="text-base font-semibold text-ink">今天还没有安排</p>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">去网页端「周计划」把今天排上，或者把手机上的偏好告诉梨宝。</p>
                </div>
              )}
              {displayed?.blocks.map((b) => (
                <BlockCard key={b.id} block={b} nowMin={nowMin} done={doneIds.has(b.id)}
                  isCurrent={current?.id === b.id} onOpen={setSheetBlock} />
              ))}
            </section>

            <TomorrowPreview blocks={d.tomorrow.blocks} tomorrowDow={d.tomorrowDow} loading={d.tomorrow.loading} />
            {/* M3（CY 反馈⑧a）：本周视图 —— 周切换/回到现在/点天展开（替换只读 WeekGlance，S4-3） */}
            <WeekBoard plan={d.plan} layer={d.layer} weekNo={d.weekNo ?? 0} todayDow={d.dow} serverState={d.serverState} />

            <NotifyStatus blocks={displayed?.blocks ?? []} nowMin={nowMin} dateKey={d.todayKey} />

            {/* 梨宝抽屉（A1）+ 底部折叠（P6-2 降级） */}
            <div className="flex gap-2">
              <button type="button" data-testid="m-lbao-toggle" onClick={() => setDrawerOpen(true)}
                className="h-11 flex-1 rounded-xl bg-brand text-sm font-bold text-white">☎ 问梨宝</button>
              <button type="button" data-testid="m-more-toggle" onClick={() => setMoreOpen((v) => !v)}
                className="h-11 flex-1 rounded-xl border border-ink/10 bg-paper-card text-sm font-semibold text-ink-soft">
                提醒与帮助 {moreOpen ? '▴' : '▾'}
              </button>
            </div>
            {moreOpen && (
              <div className="space-y-3 rounded-card border border-ink/5 bg-paper-card p-4 shadow-sm">
                <IcsGuide icsToken={identity.icsToken} />
                <WhitelistGuide />
              </div>
            )}

            {/* 任务二 · 执行力评估（折叠面板 + 每日采集弹窗，副作用在组件内） */}
            <EvalSection
              plan={d.plan} serverState={d.serverState} layer={d.layer} phase={d.phase}
              todayKey={d.todayKey} behaviorEvents={d.behaviorEvents}
            />
          </>
        )}
      </main>

      <EditSheet
        block={sheetBlock}
        done={sheetBlock ? doneIds.has(sheetBlock.id) : false}
        onClose={() => setSheetBlock(null)}
        onAction={onAction}
      />
      <LbaoDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} userId={identity.username} />
    </div>
  );
}
