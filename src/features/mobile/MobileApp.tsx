/**
 * 光溯移动端 · 入口（登录态分流，方案 §7.1）
 */
import { useState } from 'react';
import type { MobileIdentity } from './lib/auth.ts';
import { loadIdentity } from './lib/auth.ts';
import LoginPage from './LoginPage.tsx';
import TodayPage from './TodayPage.tsx';

export default function MobileApp() {
  const [identity, setIdentity] = useState<MobileIdentity | null>(() => loadIdentity());

  return identity
    ? <TodayPage identity={identity} onLogout={() => setIdentity(null)} />
    : <LoginPage onDone={setIdentity} />;
}
