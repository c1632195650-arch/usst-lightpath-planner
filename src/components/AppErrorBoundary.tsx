/**
 * 应用级错误边界（维护批 P1-2，2026-10-11）
 * ==========================================
 * 此前 src/main.tsx 与 src/features/mobile/main.tsx 都是裸 createRoot ——
 * 任何单个组件抛错即整站白屏（维护计划 §2.4）。本边界把白屏变成可读的降级页。
 *
 * 设计约束：
 *   · 只接错、只显示，**不吞错不重试业务** —— 刷新是唯一恢复动作（诚实降级）；
 *   · 错误进 globalErrors 环形缓冲 + console，不做外部上报（隐私主张不变）；
 *   · 纯逻辑（errorCopy）拆出来供 node --test 直测，类壳保持最薄。
 */
import React from 'react';
import { recordError } from '@/lib/globalErrors';
import { errorCopy } from './errorCopy';

interface State {
  error: Error | null;
}

/** 兜底错误边界：包住两个入口（main.tsx / mobile/main.tsx）的根组件。 */
export default class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    recordError('error', `boundary: ${error.message}`);
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      const { title, detail } = errorCopy(this.state.error);
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
          <div style={{ opacity: 0.7, maxWidth: 480, wordBreak: 'break-all' }}>{detail}</div>
          <button type="button" onClick={() => window.location.reload()}>刷新页面</button>
        </div>
      );
    }
    return this.props.children;
  }
}
