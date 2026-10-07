import { useEffect, useMemo, useState } from 'react';
import type { DayOfWeek, PlanIssue, TimeBlock } from '@/types';
import { toHHmm, humanizeMinutes } from '@/constants/time';
import {
  agendaBlocksForDay, confirmedOverlaps, findDayGaps, nowlineProgress, overlapMinByBlock, overlapTotalMin,
} from './agendaModel';

/**
 * 当日流水（UI v2 批次 D1，设计总成 §11 /week 双层视图第一层）
 * ============================================================
 * 挂 `SCHEDULE_VIEW_V2` 开关（localStorage `usst.scheduleViewV2`，默认关），
 * 由 WeekPlanView 在「日程视图」分段里切换到本层。
 *
 * 视觉规则（设计稿）：
 *   空档 = 虚线降透明；真冲突 = 各占 50% 并排 + 1.5px 警告描边 + 顶部「重叠 X 分钟」行
 *   （数据全部来自 PlanIssue 机器码，不匹配文案）；
 *   nowline = 2px 上理红 + 8px 圆点，60s 定时刷新、不做平滑动画、reduced-motion 下静止。
 */

const DAY_START = 8 * 60;
const DAY_END = 22 * 60;
const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

interface Props {
  blocks: TimeBlock[];
  issues: PlanIssue[];
  /** 当前高亮天（默认今天） */
  todayDow: DayOfWeek;
  /** 受控选中天（WeekBoard 点卡下潜时由父层给定；不传 = 内部自管） */
  day?: DayOfWeek;
  onDayChange?: (d: DayOfWeek) => void;
  /** 点块 → 既有详情抽屉（改时间路径与周网格同一条，WCAG 2.5.7 替代路径） */
  onOpenDetail: (b: TimeBlock) => void;
}

/** 现在几分钟（当天口径）；UI 层读时钟允许（引擎层不许） */
function nowMinNow(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function DayAgenda({ blocks, issues, todayDow, day: dayProp, onDayChange, onOpenDetail }: Props) {
  const [dayInner, setDayInner] = useState<DayOfWeek>(todayDow);
  const day = dayProp ?? dayInner;
  const setDay = (d: DayOfWeek) => { setDayInner(d); onDayChange?.(d); };
  const [nowMin, setNowMin] = useState<number | null>(null);

  // nowline：60s 定时刷新；不做平滑动画（transition: none），reduced-motion 下静止
  useEffect(() => {
    setNowMin(nowMinNow());
    const t = window.setInterval(() => setNowMin(nowMinNow()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const dayBlocks = useMemo(() => agendaBlocksForDay(blocks, day), [blocks, day]);
  const gaps = useMemo(() => findDayGaps(blocks, day, DAY_START, DAY_END), [blocks, day]);
  const overlaps = useMemo(() => confirmedOverlaps(blocks, issues), [blocks, issues]);
  const overlapMin = useMemo(() => overlapMinByBlock(overlaps), [overlaps]);
  const totalOverlap = overlapTotalMin(overlaps.filter((p) => {
    const a = blocks.find((b) => b.id === p.aId);
    return a != null && a.dayOfWeek === day;
  }));
  const nowProgress = day === todayDow ? nowlineProgress(nowMin, DAY_START, DAY_END) : null;

  /** 流水渲染序列：块 + 空档，按时间合入；nowline 按当前位置插行 */
  const items: Array<{ key: string; sort: number; node: React.ReactNode }> = [
    ...dayBlocks.map((b) => ({
      key: b.id,
      sort: b.startMin,
      node: renderBlock(b),
    })),
    ...gaps.map((g) => ({
      key: `gap-${g.startMin}`,
      sort: g.startMin,
      node: (
        <div
          key={`gap-${g.startMin}`}
          data-testid="agenda-gap"
          className="flex items-center gap-3 rounded-xl border border-dashed border-ink/20 px-3.5 py-2 text-xs text-ink-faint opacity-55"
        >
          <span className="font-mono">{toHHmm(g.startMin)}–{toHHmm(g.endMin)}</span>
          <span>空着 {humanizeMinutes(g.endMin - g.startMin)}——留白不是漏排</span>
        </div>
      ),
    })),
  ].sort((a, b) => a.sort - b.sort);

  function renderBlock(b: TimeBlock) {
    const ov = overlapMin.get(b.id) ?? 0;
    const conflicted = ov > 0;
    return (
      <button
        type="button"
        key={b.id}
        data-testid="agenda-block"
        onClick={() => onOpenDetail(b)}
        className={[
          'w-full rounded-xl border px-3.5 py-3 text-left transition-[background-color,border-color] duration-fast ease-out',
          'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
          'hover:border-brand/30 hover:bg-brand-light/30',
          conflicted
            ? 'border-warn bg-warn-light/60 shadow-[inset_0_0_0_1.5px_#B9762A]'
            : 'border-ink/10 bg-white',
        ].join(' ')}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{b.title}</span>
            <span className="mt-0.5 block truncate text-xs text-ink-faint">
              {b.place || b.room || '—'}{b.kind === 'course' ? ' · 课' : ''}
            </span>
          </span>
          <span className="shrink-0 font-mono text-xs text-brand tabular-nums">
            {toHHmm(b.startMin)}–{toHHmm(b.endMin)}
          </span>
        </span>
        {conflicted && (
          <span className="mt-1 block text-[11px] font-medium text-[#965C18]">重叠 {ov} 分钟</span>
        )}
      </button>
    );
  }

  /** nowline 落点：第一条开始时间 ≥ 当前的流水项之前；已是最后一件事后则落在队尾 */
  const nowIdx = nowProgress != null && nowMin != null ? items.findIndex((it) => it.sort >= nowMin) : -1;
  const showTailNowline = nowProgress != null && nowIdx === -1;

  return (
    <div data-testid="day-agenda" className="panel p-4 sm:p-5">
      {/* 顶栏：天切换 + 重叠合计行（真冲突才出现，数字来自机器码背书的几何实值） */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1" role="group" aria-label="选择星期">
          {DAY_LABELS.map((label, i) => {
            const d = (i + 1) as DayOfWeek;
            const active = d === day;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={active}
                onClick={() => setDay(d)}
                className={[
                  'min-h-9 rounded-lg px-2.5 text-xs font-medium transition-colors duration-fast ease-out',
                  'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
                  active ? 'bg-brand text-white' : 'text-ink-soft hover:bg-brand-light hover:text-brand',
                ].join(' ')}
              >
                {label}{d === todayDow ? '·今' : ''}
              </button>
            );
          })}
        </div>
        {totalOverlap > 0 && (
          <span data-testid="agenda-overlap" className="rounded-lg border border-warn/30 bg-warn-light px-2.5 py-1 text-xs font-medium text-[#965C18]">
            重叠 {totalOverlap} 分钟
          </span>
        )}
      </div>

      {/* 流水主体：nowline 插在当前位置；无平滑动画（transition: none） */}
      <div className="relative mt-3 flex flex-col gap-2" style={{ transition: 'none' }}>
        {items.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-faint">这一天还没有安排。</p>
        )}
        {items.map(({ key, node }, i) => (
          <div key={key}>
            {i === nowIdx && nowProgress != null && <NowLine progress={nowProgress} />}
            {node}
          </div>
        ))}
        {showTailNowline && nowProgress != null && <NowLine progress={nowProgress} />}
      </div>
    </div>
  );
}

/** nowline：2px 上理红 + 8px 圆点；不做平滑动画；reduced-motion 全局查询下本就静止 */
function NowLine({ progress }: { progress: number }) {
  return (
    <div
      data-testid="agenda-nowline"
      className="relative z-10 my-1 h-0"
      style={{ borderTop: '2px solid #9E1B32', transition: 'none' }}
      aria-hidden="true"
    >
      <span
        className="absolute -top-[5px] left-0 h-2 w-2 rounded-full"
        style={{ background: '#9E1B32', transition: 'none' }}
      />
      <span className="sr-only">当前时间线</span>
      <span className="hidden" data-progress={progress.toFixed(4)} />
    </div>
  );
}
