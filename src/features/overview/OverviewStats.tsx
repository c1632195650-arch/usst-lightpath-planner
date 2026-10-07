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
 * 总览 · 数字卡组（设计总成 §11.3 第 ③ 条）
 * ============================================================
 * 规范要求「3–4 个数字卡，每张配 `.dz` 迷你示意」，且**绝不能是纯数字卡堆叠** ——
 * 所以每张卡都是「一个数 + 一条 26px 迷你示意」，示意必须与数字同源（不是装饰）。
 *
 * ④ 每张卡可下钻：能不能点由调用方给的 handler 决定 —— 没给 handler 的卡不渲染
 * 可点样式，避免「看着能点、点了没反应」的假按钮（本仓既有纪律）。
 *
 * 诚实口径（沿用 behaviorLog 的约定）：没有记录时显示 `—` 而不是 `0`
 * ——「一个都没做」和「还没有数据」对用户的暗示完全不同。
 */
export function OverviewStats({ schedule, weekNo, todayIso, persona, onGotoTodos, onGotoGoals, onGotoProfile }: Props) {
  // 本周课时：与周概览密度卡同源（dailySlotCounts）
  const counts = dailySlotCounts(schedule, weekNo);
  const lessonsTotal = counts.reduce((n, c) => n + c, 0);
  const peak = Math.max(1, ...counts);

  // 待办：与待办页同源（同一份缓存 + 同一个分组纯函数），口径不另立
  let todoDone = 0;
  let todoTotal = 0;
  try {
    const todos = readCachedMemo().todos;
    const dow = (() => { const w = weekdayOf(todayIso); return w === 0 ? 7 : w; })();
    const groups = groupTodosForBoard(todos, dow, todayIso);
    todoTotal = todos.filter((t) => t.completion !== 'done').length + groups.done.length;
    todoDone = groups.done.length;
  } catch { /* 隐私模式等读不到缓存：按 0/0 渲染，卡片自己会显示占位 */ }

  // 本周投入：behaviorLog 的已标记块时长（done 才算负荷 —— 与引擎同口径）
  let investMin: number | null = null;
  try {
    investMin = summarizeWeek(loadRecords(), weekNo).doneMin;
  } catch { /* 同上 */ }

  // 画像维度取 axes（四轴 0–100）—— 与画像页雷达图同一数据源
  const axes = persona?.axes;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        label="待办完成"
        value={todoTotal === 0 ? '—' : `${todoDone}/${todoTotal}`}
        hint={todoTotal === 0 ? '还没有待办' : todoTotal === todoDone ? '全部办完' : `还差 ${todoTotal - todoDone} 条`}
        dz={<DzProgress value={todoTotal === 0 ? 0 : todoDone / todoTotal} />}
        onClick={onGotoTodos}
      />
      <StatCard
        icon="hourglass"
        label="本周投入"
        value={investMin == null || investMin === 0 ? '—' : (investMin / 60).toFixed(1)}
        unit={investMin && investMin > 0 ? '小时' : undefined}
        hint={investMin === 0 ? '还没有标记' : '按已标记「做了」的块算'}
        dz={<DzProgress value={investMin ? Math.min(1, investMin / (7 * 120)) : 0} tone="gold" />}
        onClick={onGotoGoals}
      />
      <StatCard
        icon="radar"
        label="画像维度"
        value={axes ? `${Object.keys(axes).length}` : '—'}
        unit={axes ? '维' : undefined}
        hint={axes ? '点击查看画像' : '还没做画像'}
        dz={<DzBars values={axes ? Object.values(axes).map((v) => Math.min(1, (Number(v) || 0) / 100)) : [0.25, 0.25, 0.25, 0.25]} />}
        onClick={onGotoProfile}
      />
    </div>
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
      </span>
      <span className="mt-1 flex items-baseline gap-1">
        <b className="font-mono text-[22px] font-semibold leading-none tracking-tight text-ink">{value}</b>
        {unit && <span className="text-[11px] text-ink-soft">{unit}</span>}
      </span>
      {/* `.dz` 迷你示意：26px 高、radius 7 —— 与数字同源，不是装饰 */}
      <span className="mt-1.5 block h-[26px]" aria-hidden="true">{dz}</span>
      <span className="mt-1 block truncate text-[11px] text-ink-faint">{hint}</span>
    </>
  );

  const base = 'panel flex flex-col p-3 text-left';
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} lift transition-colors duration-fast hover:border-brand/30 focus-visible:outline-none`}
    >
      {body}
    </button>
  );
}

/** 迷你柱：7 根细条（课时/画像维度共用）。 */
function DzBars({ values }: { values: number[] }) {
  return (
    <span className="flex h-full items-end gap-1">
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

/** 迷你条：单条进度（待办/投入共用）。 */
function DzProgress({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'gold' }) {
  return (
    <span className="flex h-full items-center">
      <span className="h-[9px] w-full overflow-hidden rounded-full bg-paper-sunken">
        <span
          className={`block h-full rounded-full ${tone === 'gold' ? 'bg-gold' : 'bg-brand'}`}
          style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
        />
      </span>
    </span>
  );
}
