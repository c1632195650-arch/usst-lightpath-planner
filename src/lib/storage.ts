import { useCallback, useState } from 'react';
import { DEFAULT_APP_STATE, type AppState } from '@/types';

/**
 * 本地优先存储层 —— 数据一律不出用户设备。
 * 课表能定位一个人在特定时间的物理位置，属个人信息；不上传 = 合规友好。
 */

const STORAGE_KEY = 'usst-life-assistant-v2';

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_APP_STATE);
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return { ...structuredClone(DEFAULT_APP_STATE), ...parsed };
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
