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
 *
 * 2026-10-08（组件层批次四 · 收口）：五个控件全部换成组件库既有件 ——
 *   · 昵称/密码 → `ui/FormControls` 的 `Input`（外置 label 双保险、占位符 #6E7688、
 *     `#7A8292` 控件描边、聚焦双环、44px 命中区）；
 *   · 「云同步」勾选框 → `ui/Switch`：**这是规范要求的语义修正** —— §10.2.4 写明
 *     「开关 = 立即生效（拨一下就保存）；复选 = 攒着一起提交」，这个勾选框本来就是
 *     一拨即写 `setCloudSync`，所以它该是开关而不是复选；顺带拿回 `role="switch"`；
 *   · 登录/注册按钮 → `ui/Button`：把原先的 `…` 占位换成规范 loading（15px spinner，
 *     **宽高不变**，§10.1 态 7）。
 * data-testid 全部保留（含 `cloud-sync-switch`，落在原生 checkbox 上，`.check()` 仍可用）。
 */
import { useState } from 'react';
import { apiLogin, apiRegister } from '@/features/mobile/lib/api';
import { errText } from '@/features/mobile/LoginPage';
import { adoptCloudStateIfScaffolded } from '@/features/cloudSync/cloudAdopt';
import { fetchCloudMemo, writeCachedMemo } from '@/features/memo/webMemo';
import {
  applyLoginSuccess, logout, readCloudSyncOn, setCloudSync,
  type MobileIdentity,
} from '@/lib/cloudAccount';
import { Input } from '@/components/ui/FormControls';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';

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

  async function submit(mode: 'login' | 'register') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = mode === 'login'
        ? await apiLogin(username.trim(), password)
        : await apiRegister(username.trim(), password);
      onIdentityChange(applyLoginSuccess(res, username.trim()));
      setSyncOn(true);
      /* 2026-10-08（录前补洞）：待办/目标不在 AppState 里（memoStore 独立键），
         登录若不拉取，全新浏览器上「待办 / 目标」页会是空的 —— 云端明明有数据。
         这里按 id 并集拉一次并写本地缓存（先于下面的可能刷新）；失败静默不阻塞登录。 */
      try {
        const memo = await fetchCloudMemo(res.token);
        writeCachedMemo(memo.data);
      } catch { /* 拉取失败：待办页按本地/离线态展示，不打断登录 */ }
      /* 2026-10-08：本地还是脚手架态（示例课表）→ 先采纳云端数据再刷新。
         否则登录即上推（开关已自动打开），会把账号云端的真实态覆盖成示例数据
         —— 详见 cloudAdopt.ts 文件头的实测记录。本地已有真实数据时本调用是 no-op。 */
      const adopted = await adoptCloudStateIfScaffolded({
        read: (k) => localStorage.getItem(k),
        write: (k, v) => {
          try {
            localStorage.setItem(k, v);
          } catch { /* 配额满：不打断登录流程 */ }
        },
        fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
        token: res.token,
      });
      if (adopted.adopted) {
        window.location.reload();
        return; // 刷新后本组件不再渲染
      }
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
        <div className="mt-2">
          <Switch
            testId="cloud-sync-switch"
            checked={syncOn}
            onChange={(next) => { setCloudSync(next); setSyncOn(next); }}
            label="云同步（排程 / 待办 / 画像 自动上行，手机端打开即见）"
          />
        </div>
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
      <form className="mt-3 flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); void submit('login'); }}>
        <Input
          label="昵称"
          testId="web-login-user"
          wrapClassName="flex-1 min-w-[140px]"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          maxLength={24}
          placeholder="2~24 位"
        />
        <Input
          label="密码"
          testId="web-login-pass"
          type="password"
          wrapClassName="flex-1 min-w-[140px]"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          maxLength={64}
          placeholder="至少 6 位"
        />
        {/* 按钮与输入框底部对齐：外层裹一层 pt 抵消 FieldShell 的 label 高度差 */}
        <Button
          type="submit"
          variant="primary"
          testId="web-login-submit"
          disabled={busy || !username.trim() || !password}
          loading={busy}
        >
          登录
        </Button>
        <Button
          type="button"
          variant="secondary"
          testId="web-register-submit"
          disabled={busy || !username.trim() || !password}
          loading={busy}
          onClick={() => void submit('register')}
        >
          注册
        </Button>
      </form>
      {error && (
        <p data-testid="web-login-error" role="alert" className="mt-2 text-[12px] text-danger-text">{error}</p>
      )}
    </div>
  );
}
