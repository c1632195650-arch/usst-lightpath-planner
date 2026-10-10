import React from 'react';
import ReactDOM from 'react-dom/client';
import MobileApp from './MobileApp';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import { installGlobalErrorHandlers } from '@/lib/globalErrors';
import '@/index.css';

// 移动端独立入口（m.html → #mobile-root）：与主站 index.html / App.tsx 零耦合。
// 无路由库 —— 就一个今日页 + 登录分流，独立入口最干净（方案 §7.1）。
// 维护批 P1-2（2026-10-11）：错误边界 + 全局监听（与主站同一套，白屏 → 降级页）。
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('mobile-root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <MobileApp />
    </AppErrorBoundary>
  </React.StrictMode>,
);
