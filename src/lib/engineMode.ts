/**
 * 引擎选择开关（2026-10-06）
 * ============================================================
 * 背景：本地这条线（`feat/ux-round4`）与 CY 线（`beta-v2`）**无共同祖先**，
 * 引擎在两边各自演化过。为了能直观比较两套算法在同一份输入下的产出，
 * 把 CY 的引擎**原样移植**成 `src/lib/planner-cy/**`（与本地 `src/lib/planner/**`
 * 并存，互不覆盖），再用本开关在前端一键切换。
 *
 * 纪律：
 *   · 本文件是**纯函数 + 一个内存态**，零依赖、零副作用、**不 import react**
 *     （`lib/**` 规则见前端架构规格书 §4.1）；
 *   · 持久化是**本机专属**（`localOnly`）：它是"这台机器上做对比用的调试开关"，
 *     不是用户偏好，上云会变成可同步状态、反而制造串号（同 `usst.local_owner.v1` 的口径）；
 *   · React 侧请用 `features/week/useEngineMode.ts` 的 hook（`useSyncExternalStore`），
 *     不要在这里引 React。
 */

/** `ours` = 本地引擎（`@/lib/planner`）；`cy` = 移植进来的 CY 引擎（`@/lib/planner-cy`） */
export type EngineMode = 'ours' | 'cy';

/** localStorage key（必须是 `usst.…` 前缀且登记在 `lib/storageRegistry.ts`） */
const KEY = 'usst.engine_mode.v1';

/** 读取持久化值；坏值/无 localStorage（Node 测试环境）一律回落 `'ours'` */
function readMode(): EngineMode {
  try {
    return localStorage.getItem(KEY) === 'cy' ? 'cy' : 'ours';
  } catch {
    return 'ours';
  }
}

let mode: EngineMode = readMode();
const listeners = new Set<() => void>();

/** 当前引擎（同步读；供非 React 场景 / 引擎调用点使用） */
export function getEngineMode(): EngineMode {
  return mode;
}

/** 切换引擎；同值不触发通知。写盘失败不影响内存态（存不了也照常切） */
export function setEngineMode(next: EngineMode): void {
  if (next === mode) return;
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* 隐私模式 / 无 localStorage：只在本次会话生效 */
  }
  for (const fn of listeners) fn();
}

/** 订阅（`useSyncExternalStore` 用）；返回退订函数 */
export function subscribeEngineMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 给用户看的中文名 */
export function engineLabel(m: EngineMode): string {
  return m === 'cy' ? 'CY 引擎' : '本地引擎';
}
