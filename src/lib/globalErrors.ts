/**
 * 全局错误监听与错误环形缓冲（维护批 P1-2，2026-10-11）
 * ======================================================
 * 此前两个入口（web/mobile）都没有 window.onerror / unhandledrejection 监听，
 * 白屏/静默异常发生后没有任何痕迹可查（维护计划 §2.4/§3.2）。
 *
 * 设计（与 telemetry「本地优先、零上报」同一隐私主张）：
 *   · 错误只进**进程内环形缓冲**（≤20 条）与 console —— 不做任何外部上报；
 *   · `installGlobalErrorHandlers()` 幂等（重复安装不重复挂监听）；
 *   · AppErrorBoundary 的 componentDidCatch 也走 recordError，错误出口统一。
 */

export type ErrorKind = 'error' | 'unhandledrejection';

export interface ErrorRecord {
  at: number;
  kind: ErrorKind;
  message: string;
}

const RING_MAX = 20;
const ring: ErrorRecord[] = [];

/** 记一条错误进环形缓冲（超限挤掉最旧）。测试与 ErrorBoundary 共用这一个出口。 */
export function recordError(kind: ErrorKind, message: string): void {
  ring.push({ at: Date.now(), kind, message: String(message ?? '').slice(0, 200) });
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

/** 只读视图（调试/测试用）。 */
export function getErrorRing(): ErrorRecord[] {
  return [...ring];
}

/** 测试专用：清空缓冲。 */
export function resetErrorRing(): void {
  ring.length = 0;
}

let installed = false;

/** 安装 window 级 error / unhandledrejection 监听。幂等；非浏览器环境静默跳过。 */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return;
  }
  installed = true;
  window.addEventListener('error', (e: Event) => {
    const err = e as ErrorEvent;
    recordError('error', err.message || String(err.error || 'unknown error event'));
  });
  window.addEventListener('unhandledrejection', (e: Event) => {
    const reason = (e as PromiseRejectionEvent).reason;
    recordError('unhandledrejection', reason instanceof Error ? reason.message : String(reason ?? 'unknown rejection'));
  });
}
