/**
 * 网页端 · 顶栏账号 chip（S1a · 2026-10-07）
 * ============================================================
 * CY 反馈④：「账号位置之前不一直在左上角吗」—— 合流/换肤时把顶栏账号入口丢了
 * （此前 CloudAccountCard 只挂在 Welcome footer 与「我的画像」页底）。
 *
 * 本组件 = 顶栏**唯一**账号入口：
 *  · 未登录：小 chip「连接手机端」；
 *  · 已登录：小 chip「✓ 用户名」；
 *  · 点击展开 CloudAccountCard（popover，点外部关闭）。
 * 卡片本体（CloudAccountCard）一字不动 —— cloud-* 锚点零改动，不碰既有 E2E。
 * 位置单点可移：换位置只需动 App.tsx 里 <AccountChip /> 那一个 DOM 节点。
 */
import { useState } from 'react';
import CloudAccountCard from '@/features/cloudSync/CloudAccountCard';
import type { MobileIdentity } from '@/lib/cloudAccount';

interface Props {
  identity: MobileIdentity | null;
  onIdentityChange: (id: MobileIdentity | null) => void;
}

export default function AccountChip({ identity, onIdentityChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-testid={identity ? 'header-account-chip' : 'header-account-login'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ring-1 transition-colors ${
          identity
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
            : 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'
        }`}
      >
        {identity ? <>✓ {identity.username}</> : '连接手机端'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-2 w-[320px] max-w-[calc(100vw-2rem)]">
            <CloudAccountCard identity={identity} onIdentityChange={onIdentityChange} />
          </div>
        </>
      )}
    </div>
  );
}
