/**
 * Toast 纯逻辑（UI v2 §10.4.1 三规矩）——与组件分离，供零依赖测试 runner 直接导入。
 *   ① 自动消失 2.4s，但带操作按钮的必须等用户点（不自动退）；
 *   ② 一次最多 1 条，第 2 条排队而不是堆叠；
 *   ③ 队列硬顶防内存涨。
 */

export type ToastTone = 'info' | 'ok' | 'error';

export interface ToastItem {
  id: number;
  text: string;
  tone?: ToastTone;
  /** 带操作按钮：永不自动退场（规矩①） */
  actionLabel?: string;
  onAction?: () => void;
  createdAt: number;
}

/** 规矩①：自动退场 2.4s */
export const TOAST_AUTO_MS = 2400;

/** 队列硬顶（规矩③的兜底） */
export const TOAST_QUEUE_CAP = 8;

let nextId = 1;

/** 入队：排队而非替换；超出硬顶时丢最老的。 */
export function pushToast(queue: ToastItem[], t: Omit<ToastItem, 'id' | 'createdAt'>, now: number): ToastItem[] {
  const next = [...queue, { ...t, id: nextId++, createdAt: now }];
  return next.length > TOAST_QUEUE_CAP ? next.slice(next.length - TOAST_QUEUE_CAP) : next;
}

/** 清扫：超 2.4s 且无操作按钮的出队（带按钮的等用户点）。 */
export function sweepToasts(queue: ToastItem[], now: number): ToastItem[] {
  return queue.filter((t) => (t.actionLabel != null) || now - t.createdAt < TOAST_AUTO_MS);
}

/** 只露队首一条（一次最多 1 条）。 */
export function visibleToast(queue: ToastItem[]): ToastItem | null {
  return queue[0] ?? null;
}
