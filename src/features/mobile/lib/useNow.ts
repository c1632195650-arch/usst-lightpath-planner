/**
 * 光溯移动端 · 「现在」时钟 hook（F5）
 * ============================================================
 * 页内「现在」横幅：当前块 + 剩余分钟，30s tick（方案 §7.4）。
 * interval 只在挂载期活 —— 卸载即清，不留给后台。
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
