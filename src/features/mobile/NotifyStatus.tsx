/**
 * 光溯移动端 · 通知可见性面板（新任务三 Wave 2 · C1 的展示面）
 * ============================================================
 * 「已排 N 条提醒 + 下一条几点」+ 一键重排（幂等）+ 权限/重启恢复提示条。
 * 文案纪律（红线 8 诚实口径）：重启恢复说「打开一次以恢复」/「点重排立即恢复」，
 * 不说「已恢复」——重排真的跑过才算数。Web 环境诚实显示「页内提醒」。
 */
import { useEffect, useState } from 'react';
import type { TimeBlock } from '@/types';
import { fmtMin } from './lib/sync.ts';
import { planTodayNotifications, isNative, rescheduleToday } from './lib/notifyBridge.ts';
import { needsRecoveryPrompt, nextNotifyLabel, notifyCountdown } from './lib/notifyStatus.ts';
// M4c：dev 样例通道 —— 输入样例 + 真函数现算（APK 内同源路径），见 demoInput 头注释
import { DEMO_DAY_BLOCKS, DEMO_NOW_MIN } from './eval/demoInput.ts';

const RECOVERY_SHOWN_KEY = 'usst.mobile.recoveryPromptShown';

export default function NotifyStatus({ blocks, nowMin, dateKey, permDenied }: {
  blocks: readonly TimeBlock[];
  nowMin: number;
  dateKey: string;
  /** M5a：APK 通知权限被拒 → 诚实告知去系统设置（权限引导本体在 WhitelistGuide，S4-4） */
  permDenied?: boolean;
}) {
  const [{ native, pending }, setBridge] = useState<{ native: boolean; pending: number | null }>({ native: false, pending: null });
  const [busy, setBusy] = useState(false);
  const remaining = blocks.filter((b) => b.endMin > nowMin).length;
  const { count, next } = notifyCountdown(blocks, nowMin, dateKey);
  const recovery = needsRecoveryPrompt(
    remaining,
    pending,
    (() => {
      try {
        return localStorage.getItem(RECOVERY_SHOWN_KEY) === '1';
      } catch {
        return false;
      }
    })(),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await isNative())) return;
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const p = await LocalNotifications.getPending();
        if (!cancelled) setBridge({ native: true, pending: p.notifications.length });
      } catch {
        if (!cancelled) setBridge({ native: true, pending: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!recovery) return;
    try {
      localStorage.setItem(RECOVERY_SHOWN_KEY, '1'); // 只提示一次
    } catch { /* 隐私模式：每次都提示也可接受 */ }
  }, [recovery]);

  const reshuffle = async () => {
    setBusy(true);
    await rescheduleToday([...blocks], nowMin);
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const p = await LocalNotifications.getPending();
      setBridge({ native: true, pending: p.notifications.length });
    } catch { /* 显示层容错 */ }
    setBusy(false);
  };

  return (
    <div className="space-y-2" data-testid="m-notify-status">
      {recovery && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          似乎重启过手机 —— 已排提醒丢了，<b>点下面「重排提醒」立即恢复</b>。
        </div>
      )}
      <div className="flex items-center justify-between rounded-xl bg-paper-sunken px-3 py-2">
        <p className="text-xs text-ink-soft" data-testid="m-notify-count">
          {native
            ? (permDenied
              ? '通知没开 → 去系统设置打开，回来点「重排提醒」。'
              : pending === null
                ? '提醒状态未知'
                : `已排 ${pending} 条提醒${nextNotifyLabel(next, fmtMin) ? ` · 下一条 ${nextNotifyLabel(next, fmtMin)}` : ''}`)
            : '当前是网页版：浏览器不发本地通知。到点前 10 分钟会在页内顶部弹一条横幅（下面有预览）。要真·通知需装 APK。'}
        </p>
        <button type="button" data-testid="m-notify-reshuffle" onClick={() => void reshuffle()} disabled={busy}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
          {busy ? '重排中…' : '重排提醒'}
        </button>
      </div>

      {/* M5a（Web）+ M4c：样例通知清单 —— 走**真** planTodayNotifications 现场算（样例输入 + 样例时刻 14:20） */}
      {import.meta.env.DEV && (
        <details data-testid="m-notify-demo" className="rounded-xl border border-ink/10 bg-white px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft">看看通知长什么样（样例数据）</summary>
          <ul className="mt-2 space-y-1.5">
            {planTodayNotifications(DEMO_DAY_BLOCKS, DEMO_NOW_MIN, dateKey).map((n) => (
              <li key={n.id} className="text-[11px] leading-5 text-ink-soft">
                <span className="font-semibold tabular-nums text-ink">{fmtMin(n.atMin)}</span> · {n.title} —— {n.body}
                <span className="ml-1 text-ink-faint">（{n.extra.action === 'before' ? '即将开始' : '现在开始'}）</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-ink-faint">样例输入：一天 6 个块、样例时刻 14:20；清单由上线调度函数现算，非手写。</p>
        </details>
      )}
    </div>
  );
}
