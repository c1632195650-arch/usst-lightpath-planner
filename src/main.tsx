import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { bootstrapSync } from '@/lib/persistence';

/**
 * 渲染前先与云端对账一次（持久化与账号系统实施规格书 §三 3.3）：
 * 云端新数据写回 localStorage，保证 App 首帧读到的就是合并后的状态。
 * 最坏情形（serve.py 没开）= offline，秒回，行为与改造前完全一致。
 */
bootstrapSync().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
