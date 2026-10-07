/**
 * 光溯移动端 · 梨宝（新任务三 Wave 3 · A1 全流式；2026-10-08 二改加 `page` 变体）
 * ============================================================
 * 两种呈现，同一套会话内核：
 *   · `variant="page"`（缺省用于「梨宝」页签）：**全屏页**，与其它页签同构 ——
 *     页头沿用宿主「光溯 · 梨宝」，无遮罩、无关闭按钮（切页签即离开）；
 *   · `variant="drawer"`（保留给需要半屏弹出的场合）：底部滑入抽屉（max-h 70vh）。
 * 🔴 复用服务端同一条管线：POST /api/chat/stream（SSE：meta→delta*→done）；
 *    网络层不支持流式 / 响应不是 event-stream（e2e 桩、老网关）→ 降级一次性 /api/chat。
 * 🔴 排程权已砍：这里**没有**改计划/重排/动课表的入口，只有对话。
 * 键盘适配：visualViewport 高度变化 → 面板底距随键盘上移；新消息自动滚到底。
 * 无排程副作用：离开梨宝页不影响 Today 页任何状态。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
// 🔴 2026-10-08 修（用户实测「手机端梨宝还是有问题」的根因）：本文件原先自算
// `VITE_MOBILE_API_BASE ?? ''` —— 在 APK 包内模式（origin = https://localhost）里
// 空串会让 fetch('/api/chat/stream') 打到**包内资源**而不是服务器（梨宝全程连不上）。
// 统一走 resolveApiBase()（包内模式自动回落公网地址，与 lib/api.ts 同一解析）。
import { resolveApiBase } from '@/lib/apiBase';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
}

const API_BASE = resolveApiBase();

export default function LbaoDrawer({ open, onClose, userId, variant = 'page' }: {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** page = 全屏页（页签）；drawer = 底部抽屉。缺省 page：全屏是当前唯一入口形态。 */
  variant?: 'drawer' | 'page';
}) {
  const sessionId = `mobile-${userId}`;
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const scrollBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  /* 历史恢复（E8 端点）：抽屉每次打开拉一次，静默失败不影响 */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch(`${API_BASE}/api/chat/history?user_id=${encodeURIComponent(userId)}&session_id=${encodeURIComponent(sessionId)}&limit=30`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body || !Array.isArray(body.messages)) return;
        const restored: ChatMsg[] = body.messages
          .filter((m: { role?: string; content?: string }) => m.role === 'user' || m.role === 'assistant')
          .map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, text: m.content }));
        if (restored.length) setMsgs(restored);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, userId, sessionId]);

  /* 键盘不遮挡：visualViewport 缩小量 = 键盘高度 */
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(Math.round(covered));
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);

  useEffect(scrollBottom, [msgs, scrollBottom]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || streaming) return;
    setInput('');
    setMsgs((prev) => [...prev, { role: 'user', text: q }, { role: 'assistant', text: '' }]);
    setStreaming(true);
    const updateLast = (text: string) => {
      setMsgs((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', text };
        return next;
      });
    };
    try {
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, session_id: sessionId, user_id: userId }),
      });
      const ctype = res.headers.get('content-type') ?? '';
      if (!res.ok || !res.body || !ctype.includes('text/event-stream')) {
        // 降级：一次性 /api/chat（e2e 桩 / 老网关 / 流式不可用）
        let text = '梨宝这会儿连不上，稍后再试试？';
        try {
          const body = ctype.includes('application/json')
            ? await res.json()
            : await (await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q, session_id: sessionId, user_id: userId }),
              })).json();
          text = String(body.answer ?? text);
        } catch { /* 保持兜底文案 */ }
        updateLast(text);
        return;
      }
      // SSE 解析：data: {...} 行流
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data: ')) continue;
          let ev: { type?: string; text?: string };
          try {
            ev = JSON.parse(t.slice(6)) as { type?: string; text?: string };
          } catch {
            continue;
          }
          if (ev.type === 'delta' && typeof ev.text === 'string' && openRef.current) {
            acc += ev.text;
            updateLast(acc);
          }
        }
      }
      if (!acc) updateLast('梨宝没说上话 —— 再问一次试试？');
    } catch {
      updateLast('网络不给力，梨宝暂时够不着服务器。');
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, sessionId, userId]);

  if (!open) return null;
  /* 会话内核（页头 + 消息列表 + 输入行）—— 两种变体共用，只有外壳不同。 */
  const panel = (
    <div
      className={
        variant === 'page'
          ? 'flex h-full min-h-0 w-full flex-col bg-paper'
          : 'mx-auto flex max-h-[70vh] w-full max-w-md flex-col rounded-t-3xl bg-paper shadow-2xl'
      }
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2.5">
        <p className="text-sm font-bold text-ink">梨宝 <span className="text-xs font-normal text-ink-faint">陪你执行 · 问啥都行</span></p>
        {variant === 'drawer' && (
          <button type="button" data-testid="m-drawer-close" onClick={onClose}
            className="h-11 px-3 text-sm text-ink-soft">收起</button>
        )}
      </div>
      <div ref={listRef} className="min-h-[120px] flex-1 space-y-2 overflow-y-auto px-4 py-3" data-testid="m-drawer-msgs">
        {msgs.length === 0 && (
          <p className="py-6 text-center text-xs text-ink-faint">
            问问「为什么总是拖延」「从宿舍到图书馆怎么走」——执行中的事都可以问我
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} data-testid="m-drawer-msg" className={m.role === 'user' ? 'text-right' : ''}>
            <span className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left text-xs leading-5 ${
              m.role === 'user' ? 'bg-brand text-white' : 'bg-paper-sunken text-ink'}`}>
              {m.text || (streaming && i === msgs.length - 1 ? '…' : '')}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2 border-t border-ink/10 px-3 py-2">
        <textarea
          data-testid="m-drawer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder='执行中遇到啥都可以问（回车发送）'
          className="max-h-24 min-h-[44px] flex-1 resize-none rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm"
        />
        <button type="button" data-testid="m-drawer-send" onClick={() => void send()} disabled={streaming || !input.trim()}
          className="h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-40">
          发送
        </button>
      </div>
    </div>
  );

  if (variant === 'page') {
    /* 全屏页：由宿主给出容器高度（页头与底栏之间），不盖页头、不弹遮罩、无关闭按钮 */
    return (
      <div data-testid="m-lbao-page" className="flex h-full min-h-0 w-full flex-col">
        {panel}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" data-testid="m-drawer">
      {/* 半透明遮罩：点击 = 关抽屉 */}
      <button type="button" aria-label="关闭梨宝" onClick={onClose} className="flex-1 bg-ink/30" data-testid="m-drawer-mask" />
      {panel}
    </div>
  );
}
