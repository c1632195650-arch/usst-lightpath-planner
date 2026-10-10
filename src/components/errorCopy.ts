/**
 * 错误边界纯逻辑（维护批 P1-2，2026-10-11）
 * ==========================================
 * 从 AppErrorBoundary.tsx 拆出的纯函数 —— 拆的原因：node 原生 TS 剥离器
 * 不支持 JSX（scripts/*.test.ts 的零依赖测试跑不了 .tsx），
 * 纯逻辑放 .ts 才能被 node --test 直测（同 tests/ 既有惯例）。
 */

/** 错误 → 降级页文案（纯函数；detail 截断，不给堆栈只给一句话原因）。 */
export function errorCopy(error: unknown): { title: string; detail: string } {
  let msg: string;
  if (error instanceof Error) {
    msg = error.message;
  } else if (error === undefined || error === null || error === '') {
    msg = '未知错误';
  } else {
    msg = String(error);
  }
  return {
    title: '页面出了点小问题',
    detail: msg.slice(0, 160),
  };
}
