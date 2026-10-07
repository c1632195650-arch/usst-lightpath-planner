/**
 * 网页端 · 云账号卡片（2026-10-06「假联通」修复 · 必修 2/3 的 UI 面）
 * ============================================================
 * 审计断点 ①/②/⑤：网页端没有登录入口、上传开关默认关且不可见、
 * 钩子拿不到 token 只能静默 no-op。本卡片补齐三件事：
 *   · 登录/注册 —— 复用移动端 api.ts 的同一组端点与 auth.ts 的同一组存储键；
 *   · 登录成功即自动打开云同步开关（applyLoginSuccess，必修 3）；
 *   · 已登录态显式展示「已连接手机端」+ 开关 + 退出登录（不做隐形魔法）。
 *
 * 纯逻辑全部在 `@/lib/cloudAccount.ts`（node --test 直测）；本组件只做呈现与回调。
 * 身份变化经 onIdentityChange 上抛，由 App 重装 webSync 钩子 ——
 * 修复审计断点 ⑤ 的隐藏坑：钩子原来是挂载时快照 token，登录后仍拿空 token。
 */
import { useState, type FormEvent } from 'react';
import { apiLogin, apiRegister } from '@/features/mobile/lib/api';
import { errText } from '@/features/mobile/LoginPage';
import {
  applyLoginSuccess, logout, readCloudSyncOn, setCloudSync,
  type MobileIdentity,
} from '@/lib/cloudAccount';

interface Props {
  identity: MobileIdentity | null;
  onIdentityChange: (id: MobileIdentity | null) => void;
}

export default function CloudAccountCard({ identity, onIdentityChange }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncOn, setSyncOn] = useState(() => readCloudSyncOn());

  async function submit(mode: 'login' | 'register', e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = mode === 'login'
        ? await apiLogin(username.trim(), password)
        : await apiRegister(username.trim(), password);
      onIdentityChange(applyLoginSuccess(res, username.trim()));
      setSyncOn(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (identity) {
    return (
      <div
        data-testid="cloud-account-card"
        className="rounded-xl border border-ink/10 bg-white px-4 py-3 text-[13px] text-ink-soft"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            已连接账号：<b className="text-ink">{identity.username}</b>
            <span className="ml-2 text-ink-faint">网页端 ⇄ 手机端同一份计划</span>
          </span>
          <button
            type="button"
            data-testid="cloud-account-logout"
            onClick={() => { logout(); onIdentityChange(null); }}
            className="rounded-lg px-2 py-1 text-[12px] font-medium text-ink-soft ring-1 ring-ink/15 transition-colors hover:bg-paper"
          >
            退出登录
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            data-testid="cloud-sync-switch"
            checked={syncOn}
            onChange={(e) => { setCloudSync(e.target.checked); setSyncOn(e.target.checked); }}
          />
          云同步（排程 / 待办 / 画像 自动上行，手机端打开即见）
        </label>
      </div>
    );
  }

  return (
    <div
      data-testid="cloud-account-card"
      className="rounded-xl border border-ink/10 bg-white px-4 py-3"
    >
      <div className="font-display text-[13px] font-semibold text-ink">连接手机端</div>
      <p className="mt-1 text-[12px] leading-5 text-ink-soft">
        注册一个昵称+密码，网页端排好的计划、待办和画像会自动同步到手机（同一账号即可）。
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => submit('login', e)}>
        <label className="flex-1 min-w-[140px]">
          <span className="text-[11px] text-ink-faint">昵称</span>
          <input
            data-testid="web-login-user"
            className="mt-0.5 w-full rounded-lg border border-ink/10 bg-paper-card px-2.5 py-2 text-[13px] text-ink outline-none focus:border-brand"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            maxLength={24}
            placeholder="2~24 位"
          />
        </label>
        <label className="flex-1 min-w-[140px]">
          <span className="text-[11px] text-ink-faint">密码</span>
          <input
            data-testid="web-login-pass"
            type="password"
            className="mt-0.5 w-full rounded-lg border border-ink/10 bg-paper-card px-2.5 py-2 text-[13px] text-ink outline-none focus:border-brand"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            maxLength={64}
            placeholder="至少 6 位"
          />
        </label>
        <button
          type="submit"
          data-testid="web-login-submit"
          disabled={busy || !username.trim() || !password}
          className="min-h-11 rounded-lg bg-brand px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? '…' : '登录'}
        </button>
        <button
          type="button"
          data-testid="web-register-submit"
          disabled={busy || !username.trim() || !password}
          onClick={(e) => submit('register', e)}
          className="min-h-11 rounded-lg border border-ink/10 bg-paper-card px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-40"
        >
          注册
        </button>
      </form>
      {error && <p data-testid="web-login-error" className="mt-2 text-[12px] text-danger-text">{error}</p>}
    </div>
  );
}
