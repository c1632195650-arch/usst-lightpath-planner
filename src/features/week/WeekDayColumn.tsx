/**
 * 日列泳道（T3 七列时间轴 · 2026-10-07 重写）
 * ============================================================
 * 从「卡片流」改为「真实时间轴泳道」：块按 startMin 绝对定位于 06:00–24:00
 * 的纵向坐标上，块高 = 时长 × PPM（严格守时；装不下的内容由 BlockCard 的
 * 块内滚动承担）。跨列可直接比高低 —— 这是周视图唯一不可替代的能力。
 *
 * 列头（星期/日期/自习/天气）已上移到 `WeekTimelineGrid`（列头必须是一条
 * 跨七列严格对齐的 sticky 带，单个泳道组件承担不了）。本组件负责：
 * 泳道背景 + 小时网格线 + 空档 + 块 + 拖拽影子 + 「现在」高亮判定。
 *
 * 🔴 拖拽落位换算（与原卡片流的唯一语义差异）：
 *   原实现「悬停在哪 → 放到哪」靠顺序推导（列末尾 = tailMin + 10）；
 *   时间轴里改为**按鼠标 Y 反算时刻**（`yToMin` + `snap10`）：鼠标指到 14:00
 *   那条线附近，松手就是 14:00 —— 更精确，且影子严格画在松手结果上
 *   （与 `dragTo` 同一基准，所见即所得）。越界值不做 clamp，交给 `dragTo`
 *   的 day 区间判定（显示「放不下」比偷偷吸附到边界更诚实）。
 *   ⚠️ 块级/空档级不再各自拦截 dragover/drop（旧实现的 stopPropagation
 *   优先级逻辑随顺序推导一起废弃）—— 全部走泳道这一个入口。
 */
import { useRef } from 'react';
import type { PlanPersistState, TimeBlock } from '@/types';
import { humanizeMinutes, toHHmm } from '@/constants/time';
import { freeGapsOf, snap10, type TimeGap } from './timeScale';
import { AXIS_HEIGHT, hourRules, minToY, spanToH, yToMin } from './timeAxis';
import { isLockedThisWeek } from '@/features/plan/planLock';
import { nowMinutes, TODAY_COL_BG } from './weekViewUtils';
import { Icon } from '@/components/icons/Icon';
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
  /** 整周块（本组件按 `day` 过滤并按时间排序） */
  allBlocks: TimeBlock[];
  /** 今天的 dayOfWeek（1–7）；非本周为 null */
  todayDow: number | null;
  /** 该列的 ISO 日期（供天气索引与 BlockCard 标注） */
  dateISO: string;
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
  /**
   * 右键空档 → 「加一件事」（2026-10-07）：gap = 被点的空档；clickedMin =
   * 右键点的分钟（泳道 Y 反算，未吸附 —— 缓冲/吸附由 WeekPlanView 的纯函数定）。
   * pos = 右键光标的视口坐标（弹窗定位用）。
   */
  onGapContextMenu: (gap: TimeGap, clickedMin: number, pos: { x: number; y: number }) => void;
  /* BlockCard 的操作回调（视图层 handler 原样透传） */
  onToggleLock: (block: TimeBlock) => void;
  onExclude: (block: TimeBlock) => void;
  onSetAssignment: (courseId: string, courseTitle: string, minutes: number) => void;
  onClearAssignment: (courseId: string) => void;
  onEditBlock: (block: TimeBlock, next: { startMin: number; endMin: number; place?: string }) => void;
  /** WP7-E5（本树）：浏览态=false —— 块不可拖、空档右键不弹（透传给 BlockCard） */
  allowEdit?: boolean;
  onRevertEdit: (block: TimeBlock) => void;
}

/** 小时网格线（两档深浅，模块级常量 —— 七列共用，不随渲染重算） */
const RULES = hourRules();

export function WeekDayColumn({
  day, allBlocks, todayDow, dateISO,
  recentTaskIds, onDismissNew,
  planState, weekNo, assignmentByCourse, editedBlockIds,
  draggingId, preview, setDraggingId, updatePreview, clearPreview, handleDrop,
  onGapContextMenu,
  onToggleLock, onExclude, onSetAssignment, onClearAssignment, onEditBlock, onRevertEdit,
  allowEdit = true,
}: WeekDayColumnProps) {
  const baseBlocks = allBlocks
    .filter((b) => b.dayOfWeek === day)
    .sort((a, b) => a.startMin - b.startMin);

  /**
   * 拖拽实时预览（悬停块式）：影子画在泳道上；源块保留原位（不卸载）。
   * 🔴 源块不许卸载：dragend 派发给源元素，卸载则事件丢失（透明度卡死）。
   */
  const dayPreview = preview && preview.day === day ? preview : null;
  const gaps = freeGapsOf(baseBlocks, day);
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
  /** 今天列（2026-09-20）：查看本周时，今天那一列整体强调 */
  const isToday = todayDow === day;
  /**
   * 「现在」—— 只在今天列判定进行中的块（整块高亮，替代横贯七列的红线）。
   * 每次渲染读一次时钟（UI 层读时钟是允许的，见 weekViewUtils.nowMinutes）；
   * 不挂定时器：重渲染时自然刷新，静止页面上高亮不自行走动（可接受的折中）。
   */
  const nowMin = isToday ? nowMinutes() : -1;
  /** 泳道容器 —— 拖拽落点的坐标基准（getBoundingClientRect） */
  const laneRef = useRef<HTMLDivElement | null>(null);

  /** 鼠标 Y → 泳道内时刻（拖拽落位的唯一换算；snap10 吸附到 10 分钟档） */
  const atMinFromEvent = (e: React.DragEvent): number => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect) return 8 * 60; // 理论不可达（调用点必然带着泳道事件）；兜底到 08:00
    return snap10(yToMin(e.clientY - rect.top));
  };

  return (
    <div
      ref={laneRef}
      data-day={day}
      /* 🔴 泳道不设 overflow-hidden：① 块 hover 的阴影/描边可完整溢出到邻列；
         ② BlockCard 的编辑面板浮出块体外（top-full）—— 在轴底附近的块上打开
         时面板会落到泳道外，泳道裁剪会把它整个吃掉。溢出部分计入滚动容器的
         scrollHeight，用户滚一下就能看到。 */
      className="relative"
      style={{ height: AXIS_HEIGHT, backgroundColor: isToday ? TODAY_COL_BG : '#ffffff' }}
      /* 🔴 dragover 不 preventDefault 的话 drop 不会触发（HTML5 铁律）——
         09-19 回退时间轴时漏掉了这里，导致整页没有合法 drop 目标、拖拽失效。 */
      onDragOver={(e) => {
        e.preventDefault();
        if (draggingId) updatePreview(day, atMinFromEvent(e), `${e.clientX}:${e.clientY}`);
      }}
      /* `dragenter` 也 preventDefault（2026-10-07 补）：目标链一旦切换，浏览器会先发
         `dragenter` 再等 `dragover`；把这里也标成"接受"，`drop` 才不会被判为落在
         未接受的目标上而静默丢弃。与上面那条 `pointer-events-none` 是同一次修复的两半。 */
      onDragEnter={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        // 只在真正离开这一列（而不是移进列内某个子元素）时清预览
        if (!e.currentTarget.contains(e.relatedTarget as Node) && preview?.day === day) clearPreview();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain') || draggingId;
        // 有悬停预览时与影子同落点；直接落到空白则按松手位置现算 —— 两者同口径
        const atMin = preview && preview.day === day ? preview.atMin : atMinFromEvent(e);
        if (id) handleDrop(id, day, atMin);
        setDraggingId(null);
        clearPreview();
      }}
    >
      {/* 小时网格线：整点淡线 + 每 3 小时略深；七列同 top ⟹ 视觉连成整周基准 */}
      {RULES.map((r) => (
        <div
          key={r.min}
          className="pointer-events-none absolute inset-x-0 h-px"
          style={{ top: r.y, backgroundColor: r.major ? 'rgba(22,35,63,.07)' : 'rgba(22,35,63,.035)' }}
        />
      ))}

      {/* 空档（≥30 分钟）：不再是「卡片」，而是泳道上的虚线区域 ——
          拖到空档 = 按鼠标位置排进去（沿用 R1 的 dragTo 判定，不另立逻辑）。
          拖拽时事件仍穿透到泳道（dragover 冒泡），右键则归自己：右键空档 =
          「加一件事」入口（2026-10-07），块上的右键菜单不受影响（块后画先收）。 */}
      {gaps.map((g) => (
        <div
          key={`gap-${g.startMin}`}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!allowEdit) return; // 浏览态（WP7-E5）：空档右键不弹「加一件事」
            if (draggingId) return; // 拖拽中不弹（右键本来也轮不到它）
            const lane = laneRef.current?.getBoundingClientRect();
            if (!lane) return;
            onGapContextMenu(g, yToMin(e.clientY - lane.top), { x: e.clientX, y: e.clientY });
          }}
          className={`group absolute inset-x-1 overflow-hidden rounded-md border border-dashed ${
            draggingId ? 'border-brand/40 bg-brand-light/30' : 'border-ink/20 bg-paper/60'
          }`}
          style={{ top: minToY(g.startMin), height: spanToH(g.startMin, g.endMin), cursor: 'context-menu' }}
        >
          <div className="truncate px-1.5 pt-0.5 text-[10px] leading-tight text-ink-faint">
            空闲 {toHHmm(g.startMin)}–{toHHmm(g.endMin)}
          </div>
          <div className="truncate px-1.5 text-[10px] leading-tight text-ink-faint/80">
            {humanizeMinutes(g.endMin - g.startMin)}
            {draggingId && <span className="ml-1 text-brand/70">· 可拖到这里</span>}
            {!draggingId && <span className="ml-1 opacity-0 transition-opacity group-hover:opacity-100">· 右键可加事</span>}
          </div>
        </div>
      ))}

      {/* 块：绝对定位，高 = 时长 × PPM（严格守时）；hover 提 z 让阴影不被邻块压住 */}
      {movedBlocks.map((b) => {
        const newTaskId = recentTaskIds.find((tid) => b.id.endsWith(`-${tid}`));
        const live = isToday && b.startMin <= nowMin && nowMin < b.endMin;
        return (
          <div
            key={b.id}
            /* 🔴 平时**不加 z-index**：一旦有 z（哪怕 z-10）就创建层叠上下文，
               BlockCard 的编辑面板（z-50）会被困在这个上下文里，盖不住相邻块
               （同 z 的后者按 DOM 顺序赢）。无 z 时块按 DOM 顺序正常层叠；
               hover 时才提 z-30，让阴影/描边盖住邻块。 */
            className="absolute inset-x-1 hover:z-30"
            style={{ top: minToY(b.startMin), height: spanToH(b.startMin, b.endMin) }}
          >
            <BlockCard
              block={b}
              date={dateISO}
              weekNo={weekNo}
              locked={isLockedThisWeek(planState, weekNo, b)}
              onToggleLock={onToggleLock}
              onExclude={onExclude}
              assignmentMin={b.courseId ? assignmentByCourse.get(b.courseId) : undefined}
              onSetAssignment={onSetAssignment}
              onClearAssignment={onClearAssignment}
              edited={editedBlockIds.has(b.id)}
              onEditBlock={onEditBlock}
              onRevertEdit={onRevertEdit}
              allowEdit={allowEdit}
              dragging={draggingId === b.id}
              live={live}
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
              /* 悬停详情浮卡弹向：右半周（周四~周日）朝左弹，免得最右列的卡溢出时间轴 */
              floatLeft={day >= 5}
              /* 当天的全部块 —— 供「改这块」面板做碰撞校验（2026-10-07 补） */
              dayBlocks={movedBlocks}
            />
          </div>
        );
      })}

      {/* 拖拽影子：可落位（虚线品牌色）/ 不可落位（红色 + 原因）——
          画在真实落点上（与松手结果同基准，所见即所得） */}
      {ghost && (ghost.ok ? (
        <div
          key="drag-ghost"
          /* 🔴 必须 `pointer-events-none`（2026-10-07 修 RAY「拖不动」）：
             影子是**浮在光标底下**的（它就画在落点上）。若不透明，
             拖拽过程中光标底下的元素会从「泳道」变成「影子」；而影子会随预览移动、
             顺带挪动别的块 ⟹ 浏览器在**原地**补发 `dragenter` 而不是 `dragover`。
             此时松手，Chrome 认为"当前目标没被接受" ⟹ **`drop` 根本不派发** ——
             用户看到预览是对的、松手却毫无反应，也没有任何提示。
             实测事件序列：`dragstart → dragenter/dragover(目标=z-20 影子) → dragend`，
             全程没有 `drop`。加这行后目标链稳定在泳道上，`drop` 必达。
             （顺带修掉影子抢鼠标 hover 的问题。） */
          className="pointer-events-none absolute inset-x-1 z-20 overflow-hidden rounded-lg border-2 border-dashed border-brand/60 bg-brand/5 px-1.5 py-1"
          style={{ top: minToY(ghost.startMin), height: spanToH(ghost.startMin, ghost.endMin) }}
        >
          <div className="truncate text-[11px] font-medium text-brand">📍 {ghost.title}</div>
          <div className="font-mono text-[10px] text-brand/70">
            {toHHmm(ghost.startMin)}–{toHHmm(ghost.endMin)}
          </div>
        </div>
      ) : (
        <div
          key="drag-ghost"
          /* 同上：不可落位的红色影子也必须对指针透明，否则同样会吃掉 `drop` */
          className="pointer-events-none absolute inset-x-1 z-20 overflow-hidden rounded-lg border-2 border-dashed border-red-400 bg-red-50 px-1.5 py-1"
          style={{
            top: minToY(ghost.startMin),
            /* 拒绝提示不守时：至少 36px 高，否则 20 分钟的块放不下这行字 */
            height: Math.max(spanToH(ghost.startMin, ghost.endMin), 36),
          }}
        >
          <div className="flex items-center gap-1 truncate text-[11px] font-medium text-red-700"><Icon name="x-circle" size="xs" className="shrink-0" />{ghost.reason ?? '放不下'}</div>
        </div>
      ))}

      {/* 空列提示：时间轴自带网格，只在真的没安排时说一句（不占交互） */}
      {baseBlocks.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-32 text-center text-[11px] text-ink-faint/70">
          这一天没有安排
        </div>
      )}
    </div>
  );
}
