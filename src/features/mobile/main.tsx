import React from 'react';
import ReactDOM from 'react-dom/client';
import MobileApp from './MobileApp';
import '@/index.css';

// 移动端独立入口（m.html → #mobile-root）：与主站 index.html / App.tsx 零耦合。
// 无路由库 —— 就一个今日页 + 登录分流，独立入口最干净（方案 §7.1）。
ReactDOM.createRoot(document.getElementById('mobile-root')!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
);
