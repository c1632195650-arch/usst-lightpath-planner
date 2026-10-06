/**
 * 光溯移动端 · ICS 订阅引导（F6）
 * ============================================================
 * ICS = 唯一全机型免备案的系统级提醒通道（调研事实 F5）：
 * iOS / 鸿蒙 / 小米等系统日历都能订阅；安卓可选 ICSx⁵（GPL-3.0 ——
 * **仅作为用户侧推荐组件口头提及，一行代码/资源不进本仓**，防 GPL 传染）。
 */
import { useState } from 'react';

export default function IcsGuide({ icsToken }: { icsToken: string | null }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const url = icsToken ? `${window.location.origin}/api/sync/plan.ics?token=${icsToken}` : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // http 裸跑下 clipboard API 可能被禁 → 退回选中文本，让用户手动复制
      const el = document.getElementById('m-ics-url');
      if (el && el instanceof HTMLInputElement) {
        el.focus();
        el.select();
      }
      setCopied(false);
    }
  }

  return (
    <section data-testid="m-ics" className="rounded-card bg-paper-card p-4 shadow-sm">
      <button type="button" className="flex w-full items-center justify-between" onClick={() => setOpen(!open)}>
        <h3 className="text-sm font-semibold text-ink-soft">系统日历订阅（不装 App 也有提醒）</h3>
        <span className="text-ink-faint">{open ? '收起' : '展开'}</span>
      </button>
      {open && !icsToken && (
        /* P6-2 缺口补提示（2026-10-06 验收缺陷②）：web-only 用户第一次要靠移动页
           同步一次才有 ICS 副本 —— 空值不许静默不渲染，要告诉用户怎么把链接变出来。 */
        <p data-testid="m-ics-empty" className="mt-2 text-[11px] leading-5 text-ink-faint">
          还没有订阅链接 —— 先去网页端排好计划，然后在手机上点一次同步
          （顶栏「已同步 ✓」就行），这里就会生成你的日历订阅链接。
        </p>
      )}
      {open && icsToken && (
        <div className="mt-2">
          <input
            id="m-ics-url"
            data-testid="m-ics-url"
            readOnly
            value={url}
            className="w-full rounded-lg border border-ink/10 bg-paper-sunken px-3 py-2 text-xs text-ink-soft"
          />
          <button
            type="button"
            data-testid="m-ics-copy"
            onClick={copy}
            className="mt-2 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white"
          >
            {copied ? '已复制 ✓' : '复制订阅链接'}
          </button>
          <p className="mt-2 text-[11px] leading-5 text-ink-faint">
            系统日历 → 添加账户/订阅日历 → 粘贴这个链接。课表有变会自动跟着更新。
            安卓没自带订阅的话，可以装开源的 ICSx⁵ 再粘进去。
          </p>
        </div>
      )}
    </section>
  );
}
