/**
 * AccountMenu.tsx —— 右上角账号菜单（当前用户名 + 退出登录 + 注销账号）
 * ============================================================
 * 由 App.tsx（组合根）在已登录状态渲染。退出后回登录页（= 换账号入口，
 * 单机场景下「切换账号」与「退出登录」是同一条路，故只留一个按钮）。
 *
 * 「注销账号」（2026-10-01 补）：永久删除账号及其全部数据，不可恢复。
 * 因破坏性且无密码找回（规格书 §1.3），点它必须二次确认 + 重新输入密码。
 */

import { useState } from 'react';
import { deleteAccount, logout } from '@/lib/auth';
import { clearLocalCache, clearLocalOwner } from '@/lib/persistence';

/**
 * R批 P1-2（R1.1/R1.3）· offline 态账号占位入口
 * ============================================================
 * AccountMenu 早已存在，但挂载条件是「已登录」—— serve.py 未启动时
 * fetchMe() 返回 offline（设计为「跳过登录照常运行」），菜单就不渲染，
 * 用户以为「右上没有账号菜单」（CY 走查实录）。这类「功能做了但用户
 * 以为没做」必须消除：offline 也保留账号位，点开说清单机模式语义
 * （数据仅存本机、记忆不与账号同步），并给「重试连接」。
 */
export function AccountOfflineMenu({ onRetry }: { onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const retry = () => {
    setRetrying(true);
    try {
      onRetry();
    } finally {
      // 探测是异步的：这里只恢复按钮文案，连接结果由 App 的账号门状态呈现
      setTimeout(() => setRetrying(false), 1500);
    }
  };

  return (
    <div className="relative" data-testid="account-offline">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-xl border border-ink/10 bg-white px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper"
        title="账号服务未连接"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs" aria-hidden>⛽</span>
        <span className="max-w-[9rem] truncate">未连接账号服务</span>
        <span aria-hidden className="text-[10px] text-ink-faint">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-ink/10 bg-white p-3 shadow-lg"
        >
          <p className="text-[12px] leading-5 text-ink-soft">
            当前是<b className="text-ink">单机模式</b>：数据仅保存在本机，梨宝的记忆与画像
            <b className="text-ink">不与账号同步</b>。启动本地服务后即可登录并同步。
          </p>
          <button
            onClick={retry}
            data-testid="account-retry"
            disabled={retrying}
            role="menuitem"
            className="mt-2 w-full rounded-lg bg-ink px-3 py-2 text-left text-sm font-medium text-white transition-colors hover:bg-ink/85 disabled:opacity-50"
          >
            {retrying ? '重试中…' : '重试连接'}
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  username: string;
  /** 退出成功后回调（App 会切到登录页） */
  onLoggedOut: () => void;
}

export function AccountMenu({ username, onLoggedOut }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 注销确认弹窗（破坏性操作，单独一步） */
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const signOut = async () => {
    setBusy(true);
    await logout();
    setBusy(false);
    setOpen(false);
    onLoggedOut();
  };

  const openDelete = () => {
    setOpen(false);
    setPassword('');
    setErr(null);
    setConfirming(true);
  };

  const doDelete = async () => {
    if (!password) {
      setErr('请输入密码');
      return;
    }
    setBusy(true);
    const res = await deleteAccount(password);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error === 'offline' ? '连不上本地服务：请确认 serve.py 在运行' : (res.error ?? '注销失败'));
      return;
    }
    // 账号与其云端数据已删：清掉本机残留（缓存 + 归属标记），回登录页
    clearLocalCache();
    clearLocalOwner();
    setConfirming(false);
    window.location.reload();
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex h-9 items-center gap-2 rounded-xl border border-ink/10 bg-white px-3 text-sm font-medium text-ink transition-colors hover:bg-paper"
          title="账号"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
            {username.slice(0, 1).toUpperCase()}
          </span>
          <span className="max-w-[8rem] truncate">{username}</span>
          <span aria-hidden className="text-[10px] text-ink-faint">{open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 top-11 z-30 w-52 rounded-xl border border-ink/10 bg-white p-1 shadow-lg"
          >
            <button
              onClick={() => void signOut()}
              disabled={busy}
              role="menuitem"
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-paper disabled:opacity-50"
            >
              {busy ? '退出中…' : '退出登录'}
            </button>
            <div className="px-3 py-1.5 text-[11px] leading-4 text-ink-faint">
              退出后可用其它账号登录，数据按账号隔离
            </div>
            <div className="my-1 h-px bg-ink/10" />
            <button
              onClick={openDelete}
              role="menuitem"
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              注销账号
            </button>
            <div className="px-3 py-1.5 text-[11px] leading-4 text-ink-faint">
              永久删除账号与全部数据，不可恢复
            </div>
          </div>
        )}
      </div>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="注销账号"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-ink/10 bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold tracking-tight text-ink">注销账号</h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              这会<strong className="font-semibold text-ink">永久删除</strong>账号「{username}」及其全部数据
              （画像、课表、日程、目标…），
              <span className="font-medium text-red-600">删除后无法恢复</span>，本系统也没有密码找回。
            </p>
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => { setPassword(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void doDelete(); }}
              placeholder="输入密码以确认"
              autoComplete="current-password"
              className="input mt-4 w-full"
            />
            {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="button-ghost px-4 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => void doDelete()}
                disabled={busy}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? '注销中…' : '确认注销'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
