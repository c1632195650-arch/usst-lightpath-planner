import type { PersonaProfile, Schedule } from '@/types';
import { dailySlotCounts } from '@/lib/today';
import { summarizeWeek, loadRecords } from '@/lib/behaviorLog';
import { readCachedMemo } from '@/features/memo/webMemo';
import { groupTodosForBoard } from '@/features/memo/memoLogic';
import { weekdayOf } from '@/lib/date';
import { Icon, type IconName } from '@/components/icons/Icon';

interface Props {
  schedule: Schedule;
  weekNo: number;
  todayIso: string;
  persona: PersonaProfile | null;
  onGotoTodos?: () => void;
  onGotoGoals?: () => void;
  onGotoProfile?: () => void;
}

/**
 * 总览 · Bento 数字区（设计总成 §11.3 第 ③④ 条）
 * ============================================================
 * 版式按升级案 HTML §11.3 的 12 列 Bento 对齐：
 *   第一行  span 4 本周课时 ｜ span 4 待办 ｜ span 4 连续记录
 *   第二行  span 8 一周节奏（WeekStrip，由 OverviewPage 放置）｜ span 4 状态
 * 三张数字卡自己写好 `lg:col-span-4` —— 它们是 12 列栅格的**直接子元素**，
 * 父容器只负责开栅格（避免「父写跨度、子写卡片」两头对不上）。
 *
 * ③ 每张卡配 26px 的 `.dz` 迷你示意，且示意必须**与数字同源**
 *   （§11.3 的反例是「纯数字卡堆叠 —— 数字不配视觉＝读者要自己算」）。
 *   升级案 HTML 里 `.dz` 是一块纯色示意砖；这里填成同源迷你图（逐日课时柱 / 进度条）——
 *   同一块 26px 的位，能读出形状比一块纯色更有用。
 *
 * ④ 每张卡可下钻：给了 handler 才渲染成可点（配 chevron-right）；没给就只读，
 *   不摆一个点了没反应的箭头（本仓「不给假按钮」的既有纪律）。
 *
 * 诚实口径：没有数据时显示 `—` 而不是 `0`（沿用 behaviorLog 的约定 ——
 * 「一个都没做」和「还没有数据」对用户的暗示完全不同）。
 */
export function OverviewStats({ schedule, weekNo, todayIso, onGotoTodos, onGotoGoals }: Props) {
  // 本周课时：与周概览密度卡同源（dailySlotCounts）
  const counts = dailySlotCounts(schedule, weekNo);
  const lessonsTotal = counts.reduce((n, c) => n + c, 0);
  const peak = Math.max(1, ...counts);

  // 待办：与待办页同源（同一份缓存 + 同一个分组纯函数），口径不另立
  let todoDone = 0;
  let todoOpen = 0;
  try {
    const todos = readCachedMemo().todos;
    const dow = (() => { const w = weekdayOf(todayIso); return w === 0 ? 7 : w; })();
    const groups = groupTodosForBoard(todos, dow, todayIso);
    todoDone = groups.done.length;
    todoOpen = todos.length - todoDone;
  } catch { /* 隐私模式等读不到缓存 → 走占位渲染 */ }

  // 连续记录：从今天往回数「有已做标记」的连续天数（与投入卡同一份记录，不另立算法）
  const streak = (() => {
    try {
      const doneDates = new Set(loadRecords().filter((r) => r.status === 'done').map((r) => r.date));
      const cursor = new Date(todayIso);
      let n = 0;
      while (n < 400) {
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        if (!doneDates.has(iso)) break;
        n += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return n;
    } catch { return 0; }
  })();

  // 本周投入：已标记块的计划时长（done 才算负荷 —— 与引擎同口径）
  let investMin: number | null = null;
  try { investMin = summarizeWeek(loadRecords(), weekNo).doneMin; } catch { /* 同上 */ }

  const todoTotal = todoDone + todoOpen;

  return (
    <>
      <StatCard
        icon="calendar-days"
        label="本周课时"
        value={`${lessonsTotal}`}
        unit="节"
        hint={`${counts.filter((c) => c > 0).length} 天有课`}
        dz={<DzBars values={counts.map((c) => c / peak)} />}
      />
      <StatCard
        icon="inbox"
        label="待办"
        value={todoTotal === 0 ? '—' : `${todoDone} / ${todoTotal}`}
        hint={todoTotal === 0 ? '还没有待办' : todoOpen === 0 ? '全部办完' : `还差 ${todoOpen} 条`}
        dz={<DzProgress value={todoTotal === 0 ? 0 : todoDone / todoTotal} />}
        onClick={onGotoTodos}
      />
      <StatCard
        icon="flame"
        label="连续记录"
        value={streak === 0 ? '—' : `${streak}`}
        unit={streak === 0 ? undefined : '天'}
        hint={
          streak === 0
            ? '还没有标记'
            : investMin
              ? `本周已投入 ${(investMin / 60).toFixed(1)} 小时`
              : '按已标记「做了」的天算'
        }
        dz={<DzProgress value={Math.min(1, streak / 21)} tone="gold" />}
        onClick={onGotoGoals}
      />
    </>
  );
}

/** 状态卡（§11.3 第二行 span 4）：画像维度 + 「点击进画像」。 */
export function PersonaStatusCard({ persona, onGotoProfile }: { persona: PersonaProfile | null; onGotoProfile?: () => void }) {
  const axes = persona?.axes;
  const dims = axes ? Object.values(axes).map((v) => Math.min(1, (Number(v) || 0) / 100)) : [];
  /** 焦点卡原先那句「当前建议参考「X」的节奏」搬到这里 —— 一句提醒放在它真正相关的那张卡上，
      顺手把焦点卡省下一整行（一屏仪表盘的高度预算很紧）。 */
  const archetype = persona?.archetype.primary?.name;
  return (
    <StatCard
      icon="radar"
      label="状态"
      value={dims.length ? `${dims.length}` : '—'}
      unit={dims.length ? '维' : undefined}
      hint={dims.length ? (archetype ? `参考「${archetype}」的节奏 · 点击进画像` : '点击进画像') : '还没做画像'}
      dz={<DzBars values={dims.length ? dims : [0.25, 0.25, 0.25, 0.25]} />}
      onClick={onGotoProfile}
    />
  );
}

/** 数字卡（§11.3 ③）：一个数 + 一条 26px 迷你示意；给了 onClick 才是可点卡。 */
function StatCard({
  icon, label, value, unit, hint, dz, onClick,
}: {
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
  hint: string;
  dz: React.ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-faint">
        <Icon name={icon} size="xs" className="shrink-0" />
        {label}
        {/* §11.3 ④：可下钻的卡配 chevron-right（不然就只读，不给假箭头） */}
        {onClick && <Icon name="chevron-right" size="xs" className="ml-auto shrink-0 opacity-70" />}
      </span>
      <span className="mt-1 flex items-baseline gap-1">
        <b className="font-mono text-[22px] font-semibold leading-none tracking-tight text-ink">{value}</b>
        {unit && <span className="text-[11px] text-ink-soft">{unit}</span>}
      </span>
      {/* `.dz` 迷你示意：与数字同源，不是装饰。**可伸缩区** —— 卡片被行高拉高时，
          多出来的高度由它吃掉（图形变高，而不是卡内留白）。下限 26px（§11.3 的档位）。 */}
      <span className="mt-2 block min-h-[26px] flex-1" aria-hidden="true">{dz}</span>
      <span className="mt-1 block truncate text-[11px] text-ink-faint">{hint}</span>
    </>
  );

  const base = 'panel flex flex-col p-3 text-left lg:col-span-2';
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      /* 可点卡给一个**自足的**无障碍名：卡片正文是「数字 + 迷你图 + 提示」，
         单念一遍不成句；而且总览页现在会出现与主导航同名的按钮（导航「待办」vs
         本卡「待办」）—— 名字带上数值与去向，读屏才分得清是哪一个。 */
      aria-label={`${label}：${value}${unit ?? ''}，${hint}。点击进入`}
      className={`${base} lift transition-colors duration-fast hover:border-brand/30 focus-visible:outline-none`}
    >
      {body}
    </button>
  );
}

/** 迷你柱：课时逐日 7 根 / 画像各轴一根。 */
function DzBars({ values }: { values: number[] }) {
  return (
    <span className="flex h-full min-h-[26px] items-end gap-1">
      {values.map((v, i) => (
        <span
          key={i}
          className="min-h-[3px] flex-1 rounded-[3px] bg-brand/30"
          style={{ height: `${Math.max(8, Math.min(100, v * 100))}%` }}
        />
      ))}
    </span>
  );
}

/** 迷你条：单条进度（待办完成度 / 连续记录）。 */
function DzProgress({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'gold' }) {
  return (
    <span className="flex h-full items-center">
      {/* 量表**不随卡高长粗**：上限 28px —— 试过 72px，值又是 0 时会变成一块空灰板。
          多出来的高度留给上方空气（视觉上仍是 KPI 卡，不是进度条特写）。 */}
      <span className="h-full max-h-[28px] min-h-[9px] w-full overflow-hidden rounded-xl bg-paper-sunken">
        <span
          className={`block h-full rounded-xl ${tone === 'gold' ? 'bg-gold' : 'bg-brand'}`}
          style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
        />
      </span>
    </span>
  );
}
