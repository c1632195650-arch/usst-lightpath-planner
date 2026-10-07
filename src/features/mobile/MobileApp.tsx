/**
 * 光溯移动端 · 入口（登录态分流，方案 §7.1；M-W1 欢迎页 2026-10-07）
 */
import { useState } from 'react';
import type { MobileIdentity } from './lib/auth.ts';
import { loadIdentity } from './lib/auth.ts';
import LoginPage from './LoginPage.tsx';
import TodayPage from './TodayPage.tsx';
import MobileWelcome from './MobileWelcome.tsx';

export default function MobileApp() {
  const [identity, setIdentity] = useState<MobileIdentity | null>(() => loadIdentity());
  /** 首次打开的品牌欢迎页：只在「未看过 && 未登录」时出现；已登录老用户直接进今日页 */
  const [welcomed, setWelcomed] = useState<boolean>(() => {
    try { return localStorage.getItem('usst.mobile.welcomed') === '1'; } catch { return false; }
  });

  if (!welcomed && !identity) {
    return (
      <MobileWelcome
        onStart={() => {
          try { localStorage.setItem('usst.mobile.welcomed', '1'); } catch { /* 隐私模式静默 */ }
          setWelcomed(true);
        }}
      />
    );
  }

  return identity
    ? <TodayPage identity={identity} onLogout={() => setIdentity(null)} />
    : <LoginPage onDone={setIdentity} />;
}
