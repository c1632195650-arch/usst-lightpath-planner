/**
 * 引擎切换的 React 绑定（2026-10-06）
 * ============================================================
 * 把 `lib/engineMode.ts` 的纯存储接成可订阅的 hook。
 * 放在 `features/week/` 而不是 `lib/`：`lib/**` 不许 import react（架构规格书 §4.1 规则 1）。
 */
import { useSyncExternalStore } from 'react';
import {
  getEngineMode,
  setEngineMode,
  subscribeEngineMode,
  type EngineMode,
} from '@/lib/engineMode';

/**
 * `[当前引擎, 切换函数]`。
 *
 * 用 `useSyncExternalStore` 而不是 `useState`：引擎开关是**全局单例状态**，
 * 可能有多个组件同时读（工具栏按钮 + 周计划管线），必须共享同一份真源，
 * 否则会出现"按钮显示 CY、管线还在跑本地"的割裂。
 */
export function useEngineMode(): [EngineMode, (next: EngineMode) => void] {
  const mode = useSyncExternalStore(subscribeEngineMode, getEngineMode, getEngineMode);
  return [mode, setEngineMode];
}
