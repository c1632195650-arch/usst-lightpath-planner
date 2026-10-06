/**
 * 云账号与云同步开关 —— 网页端统一入口（2026-10-06「假联通」修复 · 必修 2/3）
 * ============================================================
 * 审计结论（docs/双端假联通审计报告-2026-10-06.md）：网页端登录态、云同步开关、
 * getUserId 三件事散在各处导致数据永远不流动。本文件把「登录成功后发生什么」
 * 收敛成纯逻辑（无 React、localStorage 直接走 try/catch，node --test 可直测）：
 *
 *   · 登录/注册成功 → 身份落盘（复用移动端 auth.ts 同一组键，token 键一致）
 *     + 自动打开云同步开关（必修 3「首次登录后自动置 '1'」）；
 *   · 开关显式读写（网页端用户看得见、摸得着，不做隐形魔法）；
 *   · 登出 → 清身份 + 关开关（token 泄露面最小化，与 ICS 同口径）。
 *
 * 反向验证纪律：tests/cloudAccount.test.ts 的每组断言都做过「破坏实现必变红」。
 */
import { saveIdentity, clearIdentity, type MobileIdentity } from '@/features/mobile/lib/auth';
import type { AuthResponse } from '@/features/mobile/lib/types';
import { SWITCH_KEY } from '@/features/mobile/lib/webSync';

export type { MobileIdentity };

/** 云同步开关当前是否打开（缺省/不可读写一律视为关） */
export function readCloudSyncOn(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) === '1';
  } catch {
    return false;
  }
}

/** 显式开关云同步：'1' 开 / '0' 关（不删键，保留用户显式选择的痕迹） */
export function setCloudSync(on: boolean): void {
  try {
    localStorage.setItem(SWITCH_KEY, on ? '1' : '0');
  } catch {
    /* 隐私模式/配额满：登录态还能活在内存里，开关下次再试 */
  }
}

/**
 * 登录/注册成功的统一收口：身份与移动端同键落盘 + 自动开云同步。
 * 返回的 identity 交给调用方（App 据此重装 webSync 钩子，token 立即生效）。
 */
export function applyLoginSuccess(res: AuthResponse, username: string): MobileIdentity {
  setCloudSync(true);
  return saveIdentity(res, username);
}

/** 登出：清身份 + 关开关。identity 变 null 后 App 重装钩子 ⇒ 上传自然停止。 */
export function logout(): void {
  clearIdentity();
  setCloudSync(false);
}
