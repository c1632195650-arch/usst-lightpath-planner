import { useCallback, useState } from 'react';
import { DEFAULT_APP_STATE, type AppState } from '@/types';

/**
 * 本地优先存储层 —— 数据一律不出用户设备。
 * 课表能定位一个人在特定时间的物理位置，属个人信息；不上传 = 合规友好。
 */

const STORAGE_KEY = 'usst-life-assistant-v2';

/** 当前数据版本。`AppState` 形状一改，这里必须跟着动（它取自 DEFAULT_APP_STATE，单一来源）。 */
const CURRENT_VERSION = DEFAULT_APP_STATE.version;

/**
 * 把任意形态的原始数据迁移成当前版本。
 *
 * 为什么要独立成纯函数：迁移是**最容易出错、又最难手工复现**的一段代码 ——
 * 只有纯函数（不碰 localStorage、不读时钟）才能被单测覆盖。
 * `loadState()` 只负责「读出来、交给它」。
 *
 * 三条原则：
 *  · **不丢字段**：用户录了课表、做完了画像，不能因为一次版本升级就清空；
 *  · **不抛异常**：存储层出错不该让页面白屏，一律回落默认值；
 *  · **不认未来版本**：比当前版本更新的数据，里面可能有本代码不认识的形状，
 *    硬读会拿到「半个状态」。宁可回落默认 —— 本地数据可由课表 + 重做画像重建。
 */
export function migrate(raw: unknown): AppState {
  const fallback = (): AppState => structuredClone(DEFAULT_APP_STATE);

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fallback();

  const data = raw as Partial<AppState>;
  const version = typeof data.version === 'number' ? data.version : 0;

  if (version > CURRENT_VERSION) {
    console.warn(`[storage] 数据版本 v${version} 高于当前 v${CURRENT_VERSION}，回落默认状态`);
    return fallback();
  }

  /*
   * 目前**不需要按 version 分支**：
   * v3 → v4 的唯一变化是新增 `planState`（排程持久化状态），而展开默认值
   * 时缺的键会自动补成 null。将来若要重命名 / 搬移既有字段，就在这里加
   * `if (version < N) { ... }` 逐条处理。
   */
  const next: AppState = { ...fallback(), ...data, version: CURRENT_VERSION };

  /*
   * 兜住「键存在但值类型不对」的情况。
   * `{ ...default, ...parsed }` 只能补齐**缺失的键**，补不了错值。
   * 其中数组字段最危险 —— `selectedDays` 若不是数组，UI 里的 `.map()` 会直接炸。
   */
  if (!Array.isArray(next.selectedDays)) next.selectedDays = [];
  if (next.persona === undefined) next.persona = null;
  if (next.answers === undefined) next.answers = null;
  if (next.schedule === undefined) next.schedule = null;
  if (next.semesterPlan === undefined) next.semesterPlan = null;
  if (next.planState === undefined) next.planState = null;

  return next;
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_APP_STATE);
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('[storage] 读取失败，回落默认状态', e);
    return structuredClone(DEFAULT_APP_STATE);
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[storage] 写入失败', e);
  }
}

export function resetState(): AppState {
  const fresh = structuredClone(DEFAULT_APP_STATE);
  saveState(fresh);
  return fresh;
}

/** 全局状态 Hook */
export function useAppState() {
  const [state, setState] = useState<AppState>(() => loadState());

  const patch = useCallback((partial: Partial<AppState>) => {
    setState((prev) => {
      const next = { ...prev, ...partial };
      saveState(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState(resetState());
  }, []);

  return { state, patch, reset, setState };
}
