/**
 * weekEditActions —— 周视图编辑动作编排（从 WeekPlanView 下沉，D2，r5，2026-10-24）
 * ============================================================
 * 来历：撤销/重做栈本体早已在 store（userPlanStore 的 undoLayer/redoLayer），
 * 但"栈操作 + Toast 回执 + 键盘绑定"这层**编排**仍长在 1341 行的视图文件里。
 * 本模块把它收拢：视图只拿 { handleUndo, handleRedo, undoAction }，
 * 键盘判定抽成纯函数 weekKeyToAction（可直测）。
 *
 * 纪律：行为逐字节等价搬运（含注释）；Toast 文案是既有口径
 * （「已撤销上一步改动」「已重做」），由 scripts/weekEditActions.test.ts 锁住。
 */
import { useCallback, useEffect } from 'react';
import type { ToastItem, ToastKind } from './toast';

/** 编排依赖（视图注入：store 的栈操作 + Toast 通道）。 */
export interface WeekEditDeps {
  undoLayer: () => boolean;
  redoLayer: () => boolean;
  notify: (kind: ToastKind, message: string, action?: ToastItem['action']) => void;
}

/**
 * 键盘事件 → 编辑动作（纯函数）。
 * 判定顺序与旧实现逐条一致：无 Ctrl/Cmd → null；输入框聚焦 → null（打字不拦截）；
 * z+Shift / y → redo；z → undo。
 */
export function weekKeyToAction(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
  target: EventTarget | null;
}): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  const onInput = (() => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  })();
  if (onInput) return null;
  const k = e.key.toLowerCase();
  if (k === 'z' && e.shiftKey) return 'redo';
  if (k === 'z') return 'undo';
  if (k === 'y') return 'redo';
  return null;
}

/**
 * 撤销/重做/删除回执的统一编排（Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 与顶栏按钮共用）。
 * 撤销后界面通过 `shownPlan` 立即反映（moves/excluded 都在显示口径里），不需要强制重排。
 */
export function useWeekEditActions({ undoLayer, redoLayer, notify }: WeekEditDeps) {
  // 撤销/重做的栈操作与落库都在 store（useWeekPlanStore）；这里只管提示
  const handleUndo = useCallback(() => {
    if (undoLayer()) notify('info', '已撤销上一步改动');
  }, [notify, undoLayer]);

  /** 重做（Ctrl+Shift+Z / Ctrl+Y）—— 与撤销互为逆操作 */
  const handleRedo = useCallback(() => {
    if (redoLayer()) notify('info', '已重做');
  }, [notify, redoLayer]);

  /** 删除类 Toast 的「撤销」按钮 —— 一键恢复到删除前 */
  const undoAction = useCallback((): ToastItem['action'] => {
    return { label: '撤销', run: () => handleUndo() };
  }, [handleUndo]);

  // Ctrl+Z（Cmd+Z）撤销 / Ctrl+Shift+Z 与 Ctrl+Y 重做 —— 输入框里打字时不拦截
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const act = weekKeyToAction(e);
      if (act) {
        e.preventDefault();
        if (act === 'undo') handleUndo();
        else handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  return { handleUndo, handleRedo, undoAction };
}
