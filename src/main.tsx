import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import { installGlobalErrorHandlers } from '@/lib/globalErrors';
import './index.css';

// 维护批 P1-2（2026-10-11）：白屏 → 可读降级页；错误进本地环形缓冲（零上报）
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
