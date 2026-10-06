/**
 * 光溯移动端 · 登录态存储（方案 §7.1）
 * ============================================================
 * token 存 localStorage `usst.mobile.token`。
 * ⚠️ **不碰 identity.ts**：`getUserId()` 是设备级 ID（记忆/画像用），保持原语义；
 * 移动端账号是另一套（昵称+密码 → 云端 user_id），两套 ID 并存、互不干扰。
 *   ↑ 2026-10-06 更新：网页端登录（假联通修复·必修 2）复用本文件的同组键，
 *     `getUserId()` 改为「账号 ID 优先」——USER_KEY 因此导出为唯一事实来源，
 *     identity.ts 从这里读，禁止第二处硬编码这个键名。
 */
import type { AuthResponse } from './types.ts';

export const TOKEN_KEY = 'usst.mobile.token';
export const USER_KEY = 'usst.mobile.user';
export const ICS_KEY = 'usst.mobile.ics';

export interface MobileIdentity {
  token: string;
  userId: number;
  username: string;
  icsToken: string | null;
}

export function loadIdentity(): MobileIdentity | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const raw = localStorage.getItem(USER_KEY);
    const user = raw ? (JSON.parse(raw) as { userId: number; username: string }) : null;
    if (!user?.userId) return null;
    return {
      token,
      userId: user.userId,
      username: user.username,
      icsToken: localStorage.getItem(ICS_KEY),
    };
  } catch {
    return null; // 隐私模式 / 坏 JSON → 当未登录处理
  }
}

export function saveIdentity(res: AuthResponse, username: string): MobileIdentity {
  const identity: MobileIdentity = {
    token: res.token,
    userId: res.userId,
    username,
    icsToken: res.icsToken ?? null,
  };
  try {
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify({ userId: res.userId, username }));
    if (res.icsToken) localStorage.setItem(ICS_KEY, res.icsToken);
  } catch {
    /* 配额满/隐私模式：登录态只在内存里活到本次会话 */
  }
  return identity;
}

export function clearIdentity(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    // ICS 链接跟着账号走：登出即清（token 泄露面最小化）
    localStorage.removeItem(ICS_KEY);
  } catch {
    /* 同上 */
  }
}
