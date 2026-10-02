/**
 * 光溯移动端 · 登录页（F1：注册/登录，最小账号 —— 昵称+密码）
 */
import { useState, type FormEvent } from 'react';
import { apiLogin, apiRegister, ApiFailure } from './lib/api.ts';
import { saveIdentity, type MobileIdentity } from './lib/auth.ts';

const ERR_TEXT: Record<string, string> = {
  username_taken: '这个名字已经被注册了，换一个试试',
  bad_credentials: '昵称或密码不对，再想想？',
  invalid_username: '昵称要 2~24 位（中文/字母/数字/下划线）',
  invalid_password: '密码至少 6 位',
  network_error: '连不上服务器，检查一下网络？',
};

function errText(e: unknown): string {
  if (e instanceof ApiFailure && ERR_TEXT[e.code]) return ERR_TEXT[e.code];
  return '出错了，稍后再试';
}

export default function LoginPage({ onDone }: { onDone: (id: MobileIdentity) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(mode: 'login' | 'register', e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = mode === 'login'
        ? await apiLogin(username.trim(), password)
        : await apiRegister(username.trim(), password);
      onDone(saveIdentity(res, username.trim()));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-paper flex flex-col justify-center px-6">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-bold text-ink">光溯</h1>
        <p className="mt-1 text-sm text-ink-soft">懂上理的智能决策伙伴 · 移动版</p>

        <form className="mt-8 space-y-4" onSubmit={(e) => submit('login', e)}>
          <label className="block">
            <span className="text-xs text-ink-soft">昵称</span>
            <input
              data-testid="m-login-user"
              className="mt-1 w-full rounded-xl border border-ink/10 bg-paper-card px-3 py-3 text-base text-ink outline-none focus:border-brand"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              maxLength={24}
              placeholder="2~24 位，中英文都行"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-soft">密码</span>
            <input
              data-testid="m-login-pass"
              type="password"
              className="mt-1 w-full rounded-xl border border-ink/10 bg-paper-card px-3 py-3 text-base text-ink outline-none focus:border-brand"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={64}
              placeholder="至少 6 位"
            />
          </label>

          {error && (
            <p data-testid="m-login-error" className="text-sm text-danger">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              data-testid="m-login-submit"
              disabled={busy || !username.trim() || !password}
              className="flex-1 rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
            >
              {busy ? '…' : '登录'}
            </button>
            <button
              type="button"
              data-testid="m-register-submit"
              disabled={busy || !username.trim() || !password}
              onClick={(e) => submit('register', e)}
              className="flex-1 rounded-xl border border-ink/10 bg-paper-card px-4 py-3 text-base font-semibold text-ink disabled:opacity-40"
            >
              注册
            </button>
          </div>
        </form>

        <p className="mt-6 text-xs leading-5 text-ink-faint">
          只存昵称和密码（加密保存），不收手机号，不碰教务账号。
          排好的计划在网页端做完，来这里同步看。
        </p>
      </div>
    </div>
  );
}
