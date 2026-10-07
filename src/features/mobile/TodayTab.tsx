/**
 * 光溯移动端 · 今天页签（2026-10-08 从 TodayPage 拆出，宿主 = TodayPage，单钩子实例）
 * ============================================================
 * 内容（重要性递减）：页内提醒横幅 → 当前块（+接下来）→ 快捷条 → 当日时间轴 → 明日预览。
 * 「目标待办卡」已移「待办」页签、「通知/帮助/评估」移「我的」页签 —— 今天页只留今天。
 * 数据/推导全部来自宿主传入的 d（useTodayData）与 displayed（宿主算好的今日视图）。
 */
import type { TimeBlock } from '@/types';
import { applyLayerToBlocks, fmtMin } from './lib/sync.ts';
import { nowTipForBlock } from './lib/nowTip.ts';
import { bannerBlock } from './lib/notifyStatus.ts';
import type { TodayData } from './lib/useTodayData.ts';
import BlockCard from './BlockCard.tsx';
import NowBlock from './NowBlock.tsx';
import NextList from './NextList.tsx';
import QuickBar from './QuickBar.tsx';
import TomorrowPreview from './TomorrowPreview.tsx';
import { Icon } from '@/components/icons/Icon';

/** 宿主算好的「今日视图」= 重算计划 ∘ 覆盖层（excluded / moves / done） */
export type Displayed = ReturnType<typeof applyLayerToBlocks>;

export default function TodayTab({ d, displayed, nowMin, onOpenBlock, viewDow, isTodayView = true }: {
  d: TodayData;
  displayed: Displayed | null;
  nowMin: number;
  /** 点块 → 打开编辑抽屉（状态归宿主） */
  onOpenBlock: (b: TimeBlock) => void;
  /** 日期条选中的星期（1–7），仅用于文案与空态。 */
  viewDow?: number;
  /** 选中的就是今天 —— 「当前块 / 接下来 / 页内提醒 / 明日预览」这些「此刻」概念只在今天成立。 */
  isTodayView?: boolean;
}) {
  const current = isTodayView
    ? displayed?.blocks.find((b) => b.startMin <= nowMin && nowMin < b.endMin && !displayed.doneIds.has(b.id)) ?? null
    : null;
  const next = isTodayView && displayed ? displayed.blocks
    .filter((b) => b.endMin > nowMin && !displayed.doneIds.has(b.id))
    .sort((a, b) => a.startMin - b.startMin)[0] ?? null : null;
  const doneIds = displayed?.doneIds ?? new Set<string>();
  // M5b：块开始前 10 分钟 → 页内横幅（useNow(30s) 驱动）—— 只在今天有意义
  const banner = isTodayView ? bannerBlock(displayed?.blocks ?? [], nowMin, doneIds) : null;
  const DOW_CN = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <>
      {isTodayView && d.changed && (
        <div data-testid="m-changed-banner" className="rounded-xl bg-accent-light px-4 py-2.5 text-sm text-ink">
          今天的安排有更新 —— 以这里显示的为准。
          <button type="button" className="ml-2 underline" onClick={() => d.setChanged(false)}>知道了</button>
        </div>
      )}
      {isTodayView && d.updateUrl && (
        <div data-testid="m-update" className="rounded-xl bg-brand-light px-4 py-2.5 text-sm text-ink">
          有新版本。<a className="ml-2 underline" href={d.updateUrl}>下载更新 APK</a>
        </div>
      )}
      {isTodayView && d.permDenied && (
        <div data-testid="m-perm-banner" className="rounded-xl bg-warn-light px-4 py-2.5 text-sm text-warn-text">
          通知没开，提醒收不到 —— 去「我的」页查看提醒与帮助。
        </div>
      )}
      {/* M5b：Web 页内横幅（真实通道，非只有文案）—— 块开始前 10 分钟弹，30s 轮询驱动 */}
      {banner && (
        <div data-testid="m-inpage-banner" className="flex items-center gap-2 rounded-xl bg-brand-light px-4 py-2.5 text-sm text-ink">
          <Icon name="bell" size="sm" className="shrink-0 text-brand" />
          「{banner.title}」{fmtMin(banner.startMin)} 开始 —— 还有 {banner.startMin - nowMin} 分钟
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
          <p className="font-display text-base font-semibold text-ink">云端还没有你的计划</p>
          <p className="mt-2 text-sm leading-6 text-ink-soft">先去网页端导入课表、生成周计划，回来点一下同步，这里就能看了。</p>
          <button type="button" onClick={() => void d.retry()} className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">我排好了，刷新</button>
        </div>
      )}

      {d.phase === 'ready' && (
        <>
          {/* 当前块（绝对核心）｜ 接下来（次级·小）—— 只在今天 */}
          {isTodayView && (current ? (
            <>
              <NowBlock
                block={current} nowMin={nowMin} done={doneIds.has(current.id)}
                /* 任务一 P2-1 交付的 tips 接口（经 nowTip 适配层）：无匹配 → 插槽整块不渲染 */
                tip={nowTipForBlock(current)}
                onToggleDone={() => d.onAction(current, { type: 'toggleDone' })}
                onShift15={() => d.onAction(current, { type: 'shift', deltaMin: 15 })}
              />
              {next && <NextList next={next} nowMin={nowMin} />}
            </>
          ) : (
            <NextList next={next} nowMin={nowMin} />
          ))}

          {isTodayView && (
            <QuickBar displayed={displayed} nowMin={nowMin} onShift={(b) => d.onAction(b, { type: 'shift', deltaMin: 15 })} />
          )}

          {/* 时间轴（上下滑 = 只看选中那一天） */}
          <section className="space-y-2" data-testid="m-today-list">
            {!isTodayView && (
              <p className="px-1 text-xs font-medium text-ink-faint">
                正在看 周{DOW_CN[(viewDow ?? 1) - 1]} —— 点上方日期条切回今天
              </p>
            )}
            {displayed && displayed.blocks.length === 0 && (
              <div data-testid="m-empty" className="rounded-card bg-paper-card p-6 text-center shadow-sm">
                <p className="font-display text-base font-semibold text-ink">
                  {isTodayView ? '今天还没有安排' : `周${DOW_CN[(viewDow ?? 1) - 1]}没有安排`}
                </p>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  {isTodayView
                    ? '去网页端「周计划」把今天排上，或者把手机上的偏好告诉梨宝。'
                    : '这一天是空的 —— 留白也是安排。去网页端可以把它排上。'}
                </p>
              </div>
            )}
            {displayed?.blocks.map((b) => (
              <BlockCard key={b.id} block={b} nowMin={nowMin} done={doneIds.has(b.id)}
                isCurrent={current?.id === b.id} onOpen={onOpenBlock} />
            ))}
          </section>

          {isTodayView && <TomorrowPreview blocks={d.tomorrow.blocks} tomorrowDow={d.tomorrowDow} loading={d.tomorrow.loading} />}
        </>
      )}
    </>
  );
}
