/**
 * 光溯移动端 · 通知可见性纯决策（新任务三 Wave 2 / C1）
 * ============================================================
 * 与 Capacitor 解耦的纯函数（Node 单测可跑）；副作用（真实权限请求 / localStorage）
 * 都在 TodayPage 的接线层。
 * 已知限制（诚实登记，不假装解决）：重启后 AlarmManager 排程丢失 —— P2-3 只做
 * 「提示用户打开一次以恢复」的体验缓解，不是根治（根治 = BootReceiver，stretch）。
 */
import type { TimeBlock } from '@/types';
import { planTodayNotifications, type NotifSpec } from './notifyBridge.ts';

/** P2-2 「已排 N 条提醒 + 下一条几点」——与 rescheduleToday 同一纯决策源，天然幂等一致 */
export function notifyCountdown(
  blocks: readonly TimeBlock[],
  nowMin: number,
  dateKey: string,
): { count: number; next: NotifSpec | null } {
  const specs = planTodayNotifications(blocks, nowMin, dateKey);
  if (specs.length === 0) return { count: 0, next: null };
  const next = specs.reduce((a, b) => (b.atMin < a.atMin ? b : a));
  return { count: specs.length, next };
}

/** P2-1 权限前置：拒绝过一次（本安装周期）就不再自动弹 —— 判定纯函数 */
export const PERM_DENIED_KEY = 'usst.mobile.permDenied';

export function shouldAutoRequestPermission(read: (k: string) => string | null): boolean {
  return read(PERM_DENIED_KEY) !== '1';
}

/** 用户拒绝后落档（本安装周期 = localStorage 存活期） */
export function markPermissionDenied(write: (k: string, v: string) => void): void {
  write(PERM_DENIED_KEY, '1');
}

/**
 * P2-1 权限前置的完整编排（副作用集中在此一处）：
 * 首次进入 Today 页就请求（不等排程）；拒绝 → 落档、本安装周期不再自动弹；
 * 已拒绝 / 已授权 / 非 APK → skip 不骚扰。返回终态供横幅渲染。
 */
export async function ensurePermissionOnce(
  kv: { read: (k: string) => string | null; write: (k: string, v: string) => void },
  native: boolean,
): Promise<'granted' | 'denied' | 'skip'> {
  if (!native) return 'skip';
  if (!shouldAutoRequestPermission(kv.read)) return 'skip';
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'granted') return 'granted';
    const req = await LocalNotifications.requestPermissions();
    if (req.display === 'granted') return 'granted';
    markPermissionDenied(kv.write);
    return 'denied';
  } catch {
    return 'skip'; // 桥不可用：页内横幅兜底，不阻塞主流程
  }
}

/** P2-3 重启恢复提示戳 key：只提示一次 */
export const RECOVERY_SHOWN_KEY = 'usst.mobile.recoveryPromptShown';

/**
 * 「本地有今日块，但排程疑似丢了」→ 提示一次：
 *   · pendingCount = null（web / 桥不可用）→ 不提示（查不了就别吓用户）；
 *   · 无剩余块 → 不提示（没东西可恢复）；
 *   · pending 空 + 有剩余块 + 本安装周期没提示过 → 提示。
 * 文案纪律：说「打开一次以恢复」，**不说「已恢复」**——重排要真的跑过才算。
 */
export function needsRecoveryPrompt(
  remainingBlocks: number,
  pendingCount: number | null,
  alreadyShown: boolean,
): boolean {
  if (alreadyShown) return false;
  if (pendingCount === null) return false;
  if (remainingBlocks <= 0) return false;
  return pendingCount === 0;
}

/** 下一条提醒的人类文案（notifyCountdown.next → 「14:50 · 高数」） */
export function nextNotifyLabel(
  next: NotifSpec | null,
  fmt: (min: number) => string,
): string | null {
  if (!next) return null;
  return `${fmt(next.atMin)} · ${next.title}`;
}

/**
 * M5b（2026-10-07）· Web 页内横幅触发判定（纯函数，Node 可测）：
 * 「块开始前 10 分钟内（且未开始、未完成）」→ 返回该块；否则 null。
 * Web 不发本地通知 —— 页内横幅是网页版**真实存在**的提醒通道（不是只有文案）。
 * 与 planTodayNotifications 的「前 10 分钟预告」同一口径（10 分钟提前量）。
 */
export const BANNER_LEAD_MIN = 10;

export function bannerBlock(
  blocks: readonly TimeBlock[],
  nowMin: number,
  doneIds?: ReadonlySet<string>,
): TimeBlock | null {
  let best: TimeBlock | null = null;
  for (const b of blocks) {
    const lead = b.startMin - nowMin;
    if (lead <= 0 || lead > BANNER_LEAD_MIN) continue;
    if (doneIds?.has(b.id)) continue;
    if (best === null || b.startMin < best.startMin) best = b;
  }
  return best;
}
