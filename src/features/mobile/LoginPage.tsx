/**
 * 光溯移动端 · 登录页（F1：注册/登录，最小账号 —— 昵称+密码）
 * ============================================================
 * UI v2 改版（2026-10-07）：品牌符号头部（断线棱镜 plate + 字标 display 栈）
 * + 批次 C 组件（Button loading 宽高不变 / Input 外置 label+错误态）。
 * 移动端与网页端复用同一套组件库与令牌；testid 全保留（m-login-*）。
 */
import { useState, type FormEvent } from 'react';
import { apiLogin, apiRegister, ApiFailure } from './lib/api.ts';
import { saveIdentity, type MobileIdentity } from './lib/auth.ts';
import { LightpathMark } from '@/components/LightpathMark';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/FormControls';

const ERR_TEXT: Record<string, string> = {
  username_taken: '这个名字已经被注册了，换一个试试',
  bad_credentials: '昵称或密码不对，再想想？',
  invalid_username: '昵称要 2~24 位（中文/字母/数字/下划线）',
  invalid_password: '密码至少 6 位',
  network_error: '连不上服务器，检查一下网络？',
};

/** 网页端账号卡（CloudAccountCard）复用同一套文案 —— 错误口径两端一致 */
export function errText(e: unknown): string {
  if (e instanceof ApiFailure && ERR_TEXT[e.code]) return ERR_TEXT[e.code];
  return '出错了，稍后再试';
}

export default function LoginPage({ onDone }: { onDone: (id: MobileIdentity) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(mode: 'login' | 'register', e?: FormEvent) {
    e?.preventDefault();
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
    <div className="flex min-h-screen w-full flex-col bg-paper px-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      {/* 品牌头部：深色短条（hero-surface-flat 只取光谱冷端）+ plate 符号 + 字标 */}
      <header className="hero-surface-flat -mx-6 flex flex-col items-center gap-3 px-6 pb-10 pt-[calc(3rem+env(safe-area-inset-top))] text-white">
        <LightpathMark tone="plate" size={44} />
        <div className="text-center">
          <h1 className="font-display text-2xl font-semibold tracking-[0.01em]">光溯</h1>
          <p className="mt-1 text-[11px] font-medium tracking-[0.28em] text-white/55">USST · LIGHTPATH</p>
        </div>
        <p className="text-xs leading-5 text-white/65">懂上理的智能决策伙伴 · 移动版</p>
      </header>

      <div className="mx-auto -mt-6 w-full max-w-sm rounded-2xl border border-ink/[0.07] bg-white p-5 shadow-card">
        <form className="space-y-4" onSubmit={(e) => submit('login', e)}>
          <Input
            label="昵称"
            name="username"
            testId="m-login-user"
            autoComplete="username"
            maxLength={24}
            placeholder="2~24 位，中英文都行"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={error.includes('昵称')}
            hint={error.includes('昵称') ? error : undefined}
          />
          <Input
            label="密码"
            name="password"
            type="password"
            testId="m-login-pass"
            autoComplete="current-password"
            maxLength={64}
            placeholder="至少 6 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error.length > 0 && !error.includes('昵称')}
            hint={error.length > 0 && !error.includes('昵称') ? undefined : undefined}
          />

          {error && (
            <p data-testid="m-login-error" role="alert" className="text-sm text-[#B0402F]">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              testId="m-login-submit"
              disabled={!username.trim() || !password}
              loading={busy}
              full
            >
              {busy ? '' : '登录'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              testId="m-register-submit"
              disabled={busy || !username.trim() || !password}
              onClick={() => { void submit('register'); }}
              full
            >
              注册
            </Button>
          </div>
        </form>
      </div>

      <p className="mx-auto mt-5 w-full max-w-sm text-xs leading-5 text-ink-faint">
        只存昵称和密码（加密保存），不收手机号，不碰教务账号。
        排好的计划在网页端做完，来这里同步看。
      </p>
    </div>
  );
}
