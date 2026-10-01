/**
 * 日列（F2d/A5 拆出的第 ② 个纯展示子组件 · 前端架构规格书 §8.1）
 * ============================================================
 * 从 `WeekPlanView.tsx` 原样搬出：一周里「某一天」的整列 ——
 * 列头（星期/日期/今天强调/自习时长）+ 天气条 + 卡片流（块 + 空闲块 + 拖拽影子）。
 * 纯展示：不取数、不落库；拖拽中间态仍由视图持有（🔴 不触发重排的既定语义），
 * 本组件只接收中间态快照与回调。
 */
import type { PlanPersistState, TimeBlock } from '@/types';
import type { WeatherAdvice, WeatherDay } from '@/features/weather/weather';
import { humanizeMinutes, toHHmm } from '@/constants/time';
import { freeGapsOf, type TimeGap } from './timeScale';
import { isLockedThisWeek } from '@/features/plan/planLock';
import { BlockCard } from './BlockCard';

/** 拖拽实时预览的形状（原 WeekPlanView 组件内声明，随拆解上提导出） */
export interface DragPreview {
  day: number;
  atMin: number;
  ok: boolean;
  reason?: string;
  /** 影子块（落点）的位置与标题 */
  startMin: number;
  endMin: number;
  title: string;
  /** 被顺延块 → 新位置（渲染时直接画到新位置） */
  displaced: Map<string, { start: number; end: number }>;
}

export interface WeekDayColumnProps {
  day: number;
  name: string;
  /** 整周块（本组件按 `day` 过滤并按时间排序） */
  allBlocks: TimeBlock[];
  /** 今天的 dayOfWeek（1–7）；非本周为 null */
  todayDow: number | null;
  /** 该列的 ISO 日期（供天气索引与 BlockCard 标注） */
  dateISO: string;
  weatherByDate: Map<string, WeatherDay>;
  adviceByDate: Map<string, WeatherAdvice>;
  /** 🆕 新日程标注：刚添加的任务 id（块 id 以 `-{taskId}` 结尾即命中） */
  recentTaskIds: string[];
  onDismissNew: (taskId: string) => void;
  planState: PlanPersistState | null;
  weekNo: number;
  /** courseId → 本周作业分钟 */
  assignmentByCourse: Map<string, number>;
  editedBlockIds: ReadonlySet<string>;
  /* ── 拖拽中间态（第②层，仍在视图持有）与操作回调 ── */
  draggingId: string | null;
  preview: DragPreview | null;
  setDraggingId: (id: string | null) => void;
  updatePreview: (day: number, atMin: number, coord: string) => void;
  clearPreview: () => void;
  handleDrop: (blockId: string, day: number, atMin: number) => void;
  /* BlockCard 的操作回调（视图层 handler 原样透传） */
  onToggleLock: (block: TimeBlock) => void;
  onExclude: (block: TimeBlock) => void;
  onSetAssignment: (courseId: string, courseTitle: string, minutes: number) => void;
  onClearAssignment: (courseId: string) => void;
  onEditBlock: (block: TimeBlock, next: { startMin: number; endMin: number; place?: string }) => void;
  onRevertEdit: (block: TimeBlock) => void;
}

export function WeekDayColumn({
  day, name, allBlocks, todayDow, dateISO,
  weatherByDate, adviceByDate, recentTaskIds, onDismissNew,
  planState, weekNo, assignmentByCourse, editedBlockIds,
  draggingId, preview, setDraggingId, updatePreview, clearPreview, handleDrop,
  onToggleLock, onExclude, onSetAssignment, onClearAssignment, onEditBlock, onRevertEdit,
}: WeekDayColumnProps) {
  const baseBlocks = allBlocks
    .filter((b) => b.dayOfWeek === day)
    .sort((a, b) => a.startMin - b.startMin);
  const study = baseBlocks.filter((b) => b.kind === 'study')
    .reduce((n, b) => n + (b.endMin - b.startMin), 0);

  /**
   * 拖拽实时预览（悬停块式）：影子画在卡片流里；源块保留原位（不卸载）。
   * 🔴 源块不许卸载：dragend 派发给源元素，卸载则事件丢失（透明度卡死）。
   */
  const dayPreview = preview && preview.day === day ? preview : null;
  const gaps = freeGapsOf(baseBlocks, day);
  /** 这一天最后一件事的结束时间 —— 拖到空白处的默认落点 */
  const tailMin = baseBlocks.length ? baseBlocks[baseBlocks.length - 1].endMin : 8 * 60;
  const movedBlocks = dayPreview?.ok
    ? baseBlocks.map((b) => {
        const d = dayPreview.displaced.get(b.id);
        return d ? { ...b, startMin: d.start, endMin: d.end } : b;
      })
    : baseBlocks;
  const ghost = dayPreview
    ? {
        startMin: dayPreview.startMin, endMin: dayPreview.endMin,
        ok: dayPreview.ok, title: dayPreview.title, reason: dayPreview.reason,
      }
    : null;
  /** 渲染序列：块 + 空闲块 + 影子（按时间合并） */
  const renderItems: Array<
    | { kind: 'block'; startMin: number; block: TimeBlock }
    | { kind: 'gap'; startMin: number; gap: TimeGap }
    | { kind: 'ghost'; startMin: number; ghost: NonNullable<typeof ghost> }
  > = [
    ...movedBlocks.map((b) => ({ kind: 'block' as const, startMin: b.startMin, block: b })),
    ...gaps.map((g) => ({ kind: 'gap' as const, startMin: g.startMin, gap: g })),
    ...(ghost ? [{ kind: 'ghost' as const, startMin: ghost.startMin, ghost }] : []),
  ].sort((a, b) => a.startMin - b.startMin);
  /** 今天列（2026-09-20）：查看本周时，今天那一列整体强调、日程块特别着色 */
  const isToday = todayDow === day;
  /** 该列日期的「月/日」显示（用户要求 M/D 形式，不补零） */
  const [mm, dd] = dateISO.slice(5).split('-').map(Number);
  return (
    <div
      key={day}
      data-today-col={isToday ? '' : undefined}
      className="panel p-3"
      style={isToday ? { backgroundColor: '#9fadd0' } : undefined}
      /* 🔴 dragover 不 preventDefault 的话 drop 不会触发（HTML5 铁律）——
         昨晚回退时间轴时漏掉了这里，导致整页没有合法 drop 目标、拖拽失效。 */
      onDragOver={(e) => {
        e.preventDefault();
        if (draggingId) updatePreview(day, tailMin + 10, `${e.clientX}:${e.clientY}`);
      }}
      onDragLeave={(e) => {
        // 只在真正离开这一列（而不是移进列内某个子元素）时清预览
        if (!e.currentTarget.contains(e.relatedTarget as Node) && preview?.day === day) clearPreview();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain') || draggingId;
        // 没有悬停预览时（直接落到空白），退回「列末尾」
        const atMin = preview && preview.day === day ? preview.atMin : tailMin + 10;
        if (id) handleDrop(id, day, atMin);
        setDraggingId(null);
        clearPreview();
      }}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-ink">
          {name}
          <span className={`ml-1.5 font-mono text-[11px] font-normal ${isToday ? 'text-brand' : 'text-ink-faint'}`}>
            {mm}/{dd}
          </span>
          {isToday && (
            <span className="ml-1.5 rounded bg-brand px-1.5 py-0.5 align-middle text-[9.5px] font-semibold text-white">今天</span>
          )}
        </span>
        {study > 0 && (
          <span className="text-[11px] text-ink-faint">自习 {Math.round(study / 60 * 10) / 10}h</span>
        )}
      </div>

      {/* 天气 —— 就在星期名称下面（2026-09-19 改版）。
          有提醒（下雨/高低温/大风）显示带时段的人话提醒，
          平常日子显示一行概况；那天没有数据（过去的日子）就不显示 —— 不猜。 */}
      {(() => {
        const wd = weatherByDate.get(dateISO);
        if (!wd) return null;
        const adv = adviceByDate.get(dateISO);
        const range = wd.tMin != null && wd.tMax != null ? `${wd.tMin}–${wd.tMax}℃` : '';
        if (adv) {
          return (
            <div
              title={adv.detail}
              className={`mb-1.5 rounded border-l-2 px-2 py-1 text-[11px] leading-relaxed ${
                adv.severity === 'warn'
                  ? 'border-amber-400 bg-amber-50 text-amber-900'
                  : 'border-slate-300 bg-slate-50 text-ink-soft'
              }`}
            >
              {adv.emoji} <strong>{adv.label}</strong> · {wd.text} {range}：{adv.detail}
            </div>
          );
        }
        const emoji = wd.rainProb >= 50 ? '🌧️' : wd.rainProb >= 20 ? '⛅' : '☀️';
        return (
          <div className="mb-1.5 rounded bg-slate-50 px-2 py-1 text-[11px] text-ink-soft">
            {emoji} {wd.text} {range}
          </div>
        );
      })()}

      {/* 卡片流 + 空闲块（≥30 分钟）+ 拖拽影子 */}
      <div className="space-y-1.5">
          {renderItems.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink/15 px-3 py-4 text-center text-[12px] text-ink-faint">
              这一天没有安排
            </div>
          )}
          {renderItems.map((item) => {
            // 影子块：拖动预览的落点（半透明虚线）或不可落位警告（红色）
            if (item.kind === 'ghost') {
              const g = item.ghost;
              // 影子上必须拦住 dragover：不拦的话事件冒到列容器，落点会被重算
              const ghostProps = {
                onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); },
              };
              return g.ok ? (
                <div
                  key="drag-ghost"
                  {...ghostProps}
                  className="rounded-lg border-2 border-dashed border-brand/60 bg-brand/5 px-2.5 py-2 text-[12.5px] font-medium text-brand opacity-60"
                >
                  📍 {g.title}
                  <span className="ml-1 font-mono text-[11px]">{toHHmm(g.startMin)}–{toHHmm(g.endMin)}</span>
                  <div className="mt-0.5 text-[10.5px] font-normal text-brand/70">松手放到这里</div>
                </div>
              ) : (
                <div
                  key="drag-ghost"
                  {...ghostProps}
                  className="rounded-lg border-2 border-dashed border-red-400 bg-red-50 px-2.5 py-2 text-[12.5px] font-medium text-red-700"
                >
                  🚫 放不到这里 —— {g.reason ?? '放不下'}
                </div>
              );
            }
            if (item.kind === 'gap') {
              // 空闲块也是 drop 目标：拖到「⬜ 空闲 11:00–13:00」= 排到空档开头
              const gapProps = {
                onDragOver: (e: React.DragEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggingId && draggingId !== '__drag-ghost__') {
                    updatePreview(day, item.gap.startMin, `${e.clientX}:${e.clientY}`);
                  }
                },
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const id = e.dataTransfer.getData('text/plain') || draggingId;
                  const atMin = preview && preview.day === day ? preview.atMin : item.gap.startMin;
                  if (id && id !== '__drag-ghost__') handleDrop(id, day, atMin);
                  setDraggingId(null);
                  clearPreview();
                },
              };
              return (
                <div
                  key={`gap-${item.gap.startMin}`}
                  {...gapProps}
                  className={`rounded-lg border border-dashed px-2.5 py-1.5 text-[11px] text-ink-faint ${
                    draggingId ? 'border-brand/40 bg-brand-light/30' : 'border-ink/20 bg-paper/60'
                  }`}
                >
                  ⬜ 空闲 {toHHmm(item.gap.startMin)}–{toHHmm(item.gap.endMin)}
                  （{humanizeMinutes(item.gap.endMin - item.gap.startMin)}）
                  {draggingId && <span className="ml-1 text-brand/70">· 可拖到这里</span>}
                </div>
              );
            }
            const b = item.block;
            const newTaskId = recentTaskIds.find((tid) => b.id.endsWith(`-${tid}`));
            return (
              /* R1：落在某张卡上 = 放到**这一张的位置**，它之后的软块自动顺延。
                  卡自己也是拖拽源（见 BlockCard），所以这里的 drop 必须先 stopPropagation，
                  否则会把事件继续冒到「列末尾」那条 branches 上，落点变成最后。 */
              <div
                key={`wrap-${b.id}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggingId && draggingId !== b.id) {
                    updatePreview(day, b.startMin, `${e.clientX}:${e.clientY}`);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const id = e.dataTransfer.getData('text/plain') || draggingId;
                  // 与预览同一落点：影子画在哪，就落在哪
                  const atMin = preview && preview.day === day ? preview.atMin : b.startMin;
                  if (id && id !== b.id) handleDrop(id, day, atMin);
                  setDraggingId(null);
                  clearPreview();
                }}
              >
                <BlockCard
                  key={b.id}
                  block={b}
                  date={dateISO}
                  locked={isLockedThisWeek(planState, weekNo, b)}
                  onToggleLock={onToggleLock}
                  onExclude={onExclude}
                  assignmentMin={b.courseId ? assignmentByCourse.get(b.courseId) : undefined}
                  onSetAssignment={onSetAssignment}
                  onClearAssignment={onClearAssignment}
                  edited={editedBlockIds.has(b.id)}
                  onEditBlock={onEditBlock}
                  onRevertEdit={onRevertEdit}
                  dragging={draggingId === b.id}
                  onDragStartCard={(blk) => {
                  // 🔴 setDraggingId 推迟到下一帧（2026-09-20）：
                  //    dragstart 同步帧内的重渲染会让 Chrome 偶发**静默取消拖拽**
                  //    —— 「有时拖不动」的机制②。第一个 dragover 紧随其后，
                  //    状态就位，视觉上无感知差异。
                  window.setTimeout(() => { setDraggingId(blk.id); clearPreview(); }, 0);
                }}
                  onDragEndCard={() => { setDraggingId(null); clearPreview(); }}
                  isNew={!!newTaskId}
                  onDismissNew={newTaskId ? () => onDismissNew(newTaskId) : undefined}
                />
              </div>
            );
          })}
        </div>
    </div>
  );
}
