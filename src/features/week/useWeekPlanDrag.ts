/**
 * 周计划页拖拽逻辑（F2d/A5 从 WeekPlanView 拆出的 hook）
 * ============================================================
 * 收拢 R1 拖拽的全部**纯前端**状态与逻辑：拖拽源 id、实时预览（影子）、
 * 落位（`dragTo` 纯函数）、删除投放区悬停态、拖拽期间的自动滚屏与兜底清理。
 *
 * 🔴 铁律（前端架构规格书三层状态模型）：这些是**第②层交互态** ——
 *    必须与排程管线（`useWeekPlan`）完全隔离。改动这里**绝不触发重排**；
 *    「攒着改、点一次重排」的既定语义由 `updateLayer`（T3 攒批）承担。
 *
 * 纯逻辑依赖 `shownPlan`（屏幕上正显示的一版）—— 预览与松手同一基准，
 * 所见即所得。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimeBlock, WeekPlan } from '@/types';
import { dragTo } from '@/lib/planner/ripple';
import { upsertMove, type UserPlanLayer } from './userPlanStore';
import { toHHmm } from '@/constants/time';
import { DAY_LABELS } from './weekViewUtils';
import type { DragPreview } from './WeekDayColumn';

/** 删除类 Toast 的「撤销」动作形状（避免 hook 依赖 toast 组件内部） */
export interface UndoAction {
  label: string;
  run: () => void;
}

export interface UseWeekPlanDragInput {
  /** 屏幕上正显示的那一版计划（含未生效的手动改动）—— 预览与落位的共同基准 */
  shownPlan: WeekPlan | null;
  weekNo: number;
  updateLayer: (fn: (prev: UserPlanLayer) => UserPlanLayer) => void;
  notify: (kind: 'add' | 'delete' | 'move' | 'info', message: string, action?: UndoAction) => void;
  /** 「🗑 删除」同通道回调（投放区与块上按钮走同一条 excluded 通道） */
  handleExcludeBlock: (block: TimeBlock) => void;
}

export function useWeekPlanDrag({
  shownPlan, weekNo, updateLayer, notify, handleExcludeBlock,
}: UseWeekPlanDragInput) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragNote, setDragNote] = useState<string | null>(null);

  /**
   * **拖拽实时预览**（2026-09-19 交互改版）。
   *
   * 用户原话：「拖动过程中需要看到它会被放到哪个位置，以低透明度显示，
   * 同时显示其他日程向后延的新位置」—— 松手前就能看到结局，不再盲拖。
   *
   * 实现：`onDragOver` 时调 `dragTo()`（纯函数，毫秒级）算出「如果现在松手」
   * 的完整结果，画成影子 —— 落点是半透明虚线块，被顺延的块**直接画在它们的
   * 新位置**（整列呈现的就是未来布局）；放不下/撞课时影子变红色禁止样式。
   * 松手时 `handleDrop` 走同一条纯函数 —— **所见即所得**。
   *
   * 节流：只在悬停目标（天:时刻）变化时重算，不是 dragOver 的每一帧。
   */
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const previewKeyRef = useRef('');

  const updatePreview = useCallback((day: number, atMin: number, coord: string) => {
    if (!draggingId || !shownPlan) return;
    // 🔴 去重 key 必须是**鼠标坐标 + 滚动位置**而不是落点时刻：
    //    预览会重排布局 → 鼠标底下的块变了 → 落点变了 → key 变了 → 再重算 →
    //    无限震荡（块在新旧位置来回跳）。坐标不动就不重算 —— 布局冻结在当前预览。
    //    加 scrollY：自动滚屏时鼠标 clientY 不变但页面内容移动了，必须让 key 变化。
    const key = `${coord}:${window.scrollY}`;
    if (previewKeyRef.current === key) return;
    previewKeyRef.current = key;

    const src = shownPlan.blocks.find((b) => b.id === draggingId);
    if (!src) { setPreview(null); return; }
    const dur = src.endMin - src.startMin;
    const res = dragTo(shownPlan.blocks, draggingId, day, atMin, {
      // 与 handleDrop 完全同口径 —— 预览必须严格等于松手结果
      dayStartMin: 7 * 60,
      dayEndMin: 23 * 60,
    });
    const snapped = Math.round(atMin / 10) * 10;
    // ok 时影子画在真实落点；被拒时画在悬停处并标红（用户得知道「这里不行」）
    const dragRec = res.records.find((r) => r.source === 'drag');
    const ghost = dragRec
      ? { startMin: dragRec.startMin, endMin: dragRec.endMin }
      : { startMin: snapped, endMin: snapped + dur };
    const displaced = new Map<string, { start: number; end: number }>();
    if (res.ok) {
      for (const r of res.records) {
        if (r.source === 'ripple') displaced.set(r.blockId, { start: r.startMin, end: r.endMin });
      }
    }
    setPreview({
      day, atMin, ok: res.ok, reason: res.reason, title: src.title,
      startMin: ghost.startMin, endMin: ghost.endMin, displaced,
    });
  }, [draggingId, shownPlan]);

  const clearPreview = useCallback(() => {
    previewKeyRef.current = '';
    setPreview(null);
  }, []);

  /**
   * 🔴 拖拽结束的**兜底清理**（挂在 window 上，不依赖源元素还活着）。
   */
  useEffect(() => {
    if (!draggingId) return;
    const onEnd = () => {
      setDraggingId(null);
      clearPreview();
    };
    window.addEventListener('dragend', onEnd);
    window.addEventListener('drop', onEnd);
    return () => {
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('drop', onEnd);
    };
  }, [draggingId, clearPreview]);

  /**
   * **拖拽期间的页面滚动**（2026-09-20，用户报告：页面下方的课程拖不进去）。
   *
   * 浏览器在 HTML5 拖拽期间禁用滚轮、也不做自动滚屏 —— 页面下方的列永远够不着。
   * 两套补偿，都只挂在「拖动进行中」：
   *   1. **边缘自动滚屏**：鼠标进入视口上/下 90px 时，按靠近程度持续滚动
   *      （rAF 驱动；滚动改变内容位置 → dragover 继续触发 → 影子随之更新）；
   *   2. **滚轮补偿**：DnD 吞掉滚轮的默认滚动，手动 `scrollBy` 补回来。
   */
  useEffect(() => {
    if (!draggingId) return;
    let lastClientY: number | null = null;
    let raf = 0;
    const EDGE = 90;       // 边缘触发区（px）
    const MAX_SPEED = 18;  // 最大滚动速度（px/帧）

    const step = () => {
      if (lastClientY != null) {
        const vh = window.innerHeight;
        // 🔴 上滑判定线 = sticky 导航条的**底边**（2026-09-20 用户纠正）：
        //    「上理生活助手」导航条不属于周计划板块 —— 光标停在它上面或刚过它下缘
        //    就该开始上滑，而不是要顶进视口最顶端。
        const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        if (lastClientY < headerBottom + EDGE) {
          // 光标在导航条内 = 已顶到头 → 全速上滑；刚过导航条下缘 → 缓慢上滑
          const depth = Math.max(0, lastClientY - headerBottom);
          window.scrollBy(0, -Math.ceil((1 - Math.min(depth / EDGE, 1)) * MAX_SPEED));
        } else if (lastClientY > vh - EDGE) {
          window.scrollBy(0, Math.ceil((1 - (vh - lastClientY) / EDGE) * MAX_SPEED));
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    const onDragOver = (e: DragEvent) => { lastClientY = e.clientY; };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); window.scrollBy(0, e.deltaY); };
    window.addEventListener('dragover', onDragOver);
    // capture 阶段：防止事件被页内滚动容器吃掉导致 window 收不到
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('wheel', onWheel, { capture: true });
      lastClientY = null;
    };
  }, [draggingId]);

  /**
   * 落位计算（R1）—— 把某一块送到「星期几 + 起点」。
   *
   * 关键三点：
   *   · **blockId 不重写**：跨天后 id 仍带旧的 `d` 段，`dayOfWeek` 字段单独记录。
   *     写回 id 会让引擎认成「删一个 + 新增一个」→ churn 虚高、锁失效（R1.3）。
   *   · **顺延**：占到的软块自动往后排（`makeRoom`），被挪的记成 `ripple`（soft），
   *     拖的那块是 `drag`（hard）—— 用户明确表达的位置，重排不许动。
   *   · **放不下就告知**，绝不制造重叠（硬约束 H1 是验收基准）。
   */
  const handleDrop = useCallback((blockId: string, day: number, atMin: number) => {
    if (!shownPlan) return;
    const res = dragTo(shownPlan.blocks, blockId, day, atMin, {
      // 天的可用区间与引擎同口径（`construct` 里 `'07:00'` / `'23:00'` 是默认值）
      dayStartMin: 7 * 60,
      dayEndMin: 23 * 60,
    });
    clearPreview();
    if (!res.ok) {
      setDragNote(res.reason ?? '放不下');
      return;
    }
    setDragNote(null);
    const moved = shownPlan.blocks.find((b) => b.id === blockId);
    updateLayer((prev) => {
      let moves = prev.moves;
      for (const r of res.records) {
        moves = upsertMove(moves, {
          weekNo, blockId: r.blockId, dayOfWeek: r.dayOfWeek,
          startMin: r.startMin, endMin: r.endMin, source: r.source,
        });
      }
      return { ...prev, moves };
    });
    if (moved) {
      notify('move', `已移动「${moved.title}」→ ${DAY_LABELS[day - 1]} ${toHHmm(res.records[0].startMin)} · Ctrl+Z 撤销`);
    }
  }, [shownPlan, clearPreview, updateLayer, weekNo, notify]);

  /**
   * **拖拽删除投放区**（2026-09-19）：拖动时屏幕右侧浮现「🗑 拖到这里删除」，
   * 松手到它上面 → 该块进删除通道（与块上的「🗑 删除」按钮走**同一个** `excluded`
   * 通道，可用顶部的「全部恢复」一键撤销 —— 撤销比确认轻，所以不做二次弹窗）。
   */
  const [deleteHover, setDeleteHover] = useState(false);
  const handleDropToDelete = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDeleteHover(false);
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    setDraggingId(null);
    clearPreview();
    if (!id || !shownPlan) return;
    const block = shownPlan.blocks.find((b) => b.id === id);
    if (!block) return;
    if (block.kind === 'course' || block.source === 'course') {
      setDragNote('课程不能删除 —— 要改课程时间请用「调课」');
      return;
    }
    // 与「🗑 删除」按钮同一条通道 —— 删除后同样弹「空档怎么处理」
    handleExcludeBlock(block);
  }, [draggingId, shownPlan, handleExcludeBlock, clearPreview]);

  return {
    draggingId, setDraggingId, dragNote, preview,
    updatePreview, clearPreview, deleteHover, setDeleteHover,
    handleDrop, handleDropToDelete,
  };
}
