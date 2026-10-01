/**
 * LoginPage.tsx —— 未登录时的第一屏（注册 / 登录二合一）
 * ============================================================
 * 由 App.tsx（组合根）在 auth 状态 = logged-out 时渲染。
 * 登录成功后做「首次登录数据并入」检测：本机 localStorage 有已登记数据
 * 且该账号云端 kv 为空 → 弹一次性确认框（规格书 §五 5.4）。
 *
 * 账号隔离（§5.5，2026-10-01 补）：无论走哪条路，登录成功后都必须把本机缓存
 * **过户**给该账号 —— 归属不同则清空重建，绝不让上一个账号的画像/日程漏进新账号。
 * 清空或重建后本机内存里的各 store 仍是旧数据，故**整页重载**让它们重新装载。
 */

import { useState } from 'react';
import { Logo120 } from '@/components/Logo120';
import { hasLocalData, login, register, serverDataEmpty, uploadLocalSnapshot } from '@/lib/auth';
import { adoptAccount, clearLocalCache, setLocalOwner } from '@/lib/persistence';

interface Props {
  /** 登录成功（含数据并入流程走完）后回调，App 切回主应用 */
  onLoggedIn: (username: string) => void;
}

export function LoginPage({ onLoggedIn }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 登录成功后若命中「本机有数据 + 云端为空」，先问一次再并入 */
  const [mergeAsk, setMergeAsk] = useState(false);
  const [pendingUsername, setPendingUsername] = useState('');

  const submit = async () => {
    setError(null);
    if (!username.trim() || !password) {
      setError('请填写账号和密码');
      return;
    }
    if (mode === 'register') {
      if (password !== password2) {
        setError('两次输入的密码不一致');
        return;
      }
      if (password.length < 6) {
        setError('密码至少 6 位');
        return;
      }
    }
    setBusy(true);
    const res = mode === 'login' ? await login(username.trim(), password) : await register(username.trim(), password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error === 'offline' ? '连不上本地服务：请在仓库根运行 python serve.py' : (res.error ?? '操作失败'));
      return;
    }
    const u = username.trim();
    // 首次登录数据并入检测（本地有数据 + 云端为空才问，天然只弹一次）
    if (hasLocalData() && (await serverDataEmpty())) {
      setPendingUsername(u);
      setMergeAsk(true);
      return;
    }
    // 无弹窗路径：把本机缓存过户给该账号（换账号 → 清空重建；同账号 → 保持本地胜）
    if (await adoptAccount(u)) {
      window.location.reload(); // 缓存被重置 → 整页重载，让各 store 重新装载
      return;
    }
    onLoggedIn(u);
  };

  /** 选择「并入此账号」：本机快照整包上云 → 缓存归该账号 → 之后同账号本地胜 */
  const doMerge = async () => {
    setBusy(true);
    await uploadLocalSnapshot();
    setLocalOwner(pendingUsername);
    setBusy(false);
    onLoggedIn(pendingUsername);
  };

  /** 选择「不并入」：走纯新账号 —— 清掉本机旧账号残留，云端为空即干净初始态 */
  const declineMerge = () => {
    clearLocalCache();
    setLocalOwner(pendingUsername);
    window.location.reload();
  };

  if (mergeAsk) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold tracking-tight text-ink">检测到本机已有数据</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          这个浏览器里存有之前的日程、课表与画像数据，而账号「{pendingUsername}」的云端还是空的。
          要把它们并入这个账号吗？
        </p>
        <p className="mt-2 text-xs leading-5 text-ink-faint">
          并入 → 这些数据存进数据库，换浏览器也不丢；不并入 → 清掉本机旧数据，用这个账号从头开始。
        </p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => void doMerge()} disabled={busy} className="button-primary px-6 disabled:opacity-50">
            {busy ? '并入中…' : '并入此账号'}
          </button>
          <button onClick={declineMerge} disabled={busy} className="button-ghost px-6 disabled:opacity-50">
            不并入，进入新账号
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {mode === 'login' ? '登录你的账号' : '注册新账号'}
      </h1>
      <div className="mt-5 space-y-3 text-left">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="账号"
          autoComplete="username"
          className="input w-full"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder="密码"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          className="input w-full"
        />
        {mode === 'register' && (
          <input
            type="password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="确认密码"
            autoComplete="new-password"
            className="input w-full"
          />
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button onClick={() => void submit()} disabled={busy} className="button-primary mt-5 w-full px-6 disabled:opacity-50">
        {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
      </button>
      <button
        onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
        className="mt-3 text-sm font-medium text-brand hover:text-brand-dark"
      >
        {mode === 'login' ? '没有账号？注册一个' : '已有账号？去登录'}
      </button>
    </Shell>
  );
}

/** 登录页外壳：居中卡片（与 Welcome 同一气质） */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex flex-col items-center">
          <Logo120 size={56} />
          <div className="mt-3 text-sm font-semibold tracking-tight text-ink">上理生活助手</div>
          <div className="mt-0.5 text-[11px] font-medium tracking-[0.14em] text-ink-faint">USST · STUDENT LIFE</div>
        </div>
        <div className="panel mt-6 px-6 py-7 text-center">{children}</div>
      </div>
    </div>
  );
}
