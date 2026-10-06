/**
 * API 基址唯一解析点（W4/P1-3a · 2026-10-07）
 * ============================================================
 * 修的坑（10-06 P1-3 实测）：`src/lib/api.ts`（梨宝/memo 云通道）默认写死
 * `http://127.0.0.1:8000`，而 `features/mobile/lib/api.ts`（登录/云同步）是
 * 「env → 包内兜底 → 同源相对路径」—— dev 里登录跑到 8001、待办跑到 8000，
 * 症状「登录了但待办存不进去，且毫无提示」。
 *
 * 现在两端都调用 `resolveApiBase()`，优先级：
 *   VITE_MOBILE_API_BASE → VITE_API_BASE → 包内兜底 → 同源相对路径 ''。
 *
 * ⚠️ P1-3b（默认值从写死 8000 改同源）是**行为变更**，需 CY 拍板（BLOCKERS 已记）；
 *    本文件只提供统一解析，`src/lib/api.ts` 的调用侧默认值**暂维持现状**
 *    （见 P1-3b 裁决项，拍板后只需改这里一处）。
 */

/** 包内模式兜底的后端地址（与 capacitor.config.ts 的 server.url 一致） */
const INLINE_API_FALLBACK = 'http://101.35.253.143';

/** 是否跑在 Capacitor 包内（origin = https://localhost） */
export function isInlinePackage(): boolean {
  try {
    return typeof location !== 'undefined'
      && location.protocol === 'https:'
      && location.hostname === 'localhost';
  } catch {
    return false;
  }
}

/** 两个 VITE_ 基址（Vite 会在构建期内联；node 直测环境下读不到 → undefined） */
function envBase(name: string): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name];
  } catch {
    return undefined;
  }
}

/** 唯一基址解析：双端统一走这里，任何一处不得再自己拼默认地址 */
export function resolveApiBase(): string {
  return envBase('VITE_MOBILE_API_BASE')
    ?? envBase('VITE_API_BASE')
    ?? (isInlinePackage() ? INLINE_API_FALLBACK : '');
}
