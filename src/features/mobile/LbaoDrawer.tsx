/**
 * 光溯移动端 · 梨宝抽屉（新任务三 Wave 3 · A1 全流式）
 * ============================================================
 * 底部滑入抽屉（max-h 70vh），完整多轮 + 流式渲染 + 历史加载（/api/chat/history）。
 * 🔴 复用服务端同一条管线：POST /api/chat/stream（SSE：meta→delta*→done）；
 *    网络层不支持流式 / 响应不是 event-stream（e2e 桩、老网关）→ 降级一次性 /api/chat。
 * 🔴 排程权已砍：抽屉里**没有**改计划/重排/动课表的入口，只有对话。
 * 键盘适配：visualViewport 高度变化 → 抽屉底距随键盘上移；新消息自动滚到底。
 * 无排程副作用：关闭抽屉不影响 Today 页任何状态。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
}

const API_BASE = (import.meta.env.VITE_MOBILE_API_BASE as string | undefined) ?? '';

export default function LbaoDrawer({ open, onClose, userId }: {
  open: boolean;
  onClose: () => void;
  userId: string;
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
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" data-testid="m-drawer">
      {/* 半透明遮罩：点击 = 关抽屉 */}
      <button type="button" aria-label="关闭梨宝" onClick={onClose} className="flex-1 bg-ink/30" data-testid="m-drawer-mask" />
      <div
        className="mx-auto flex max-h-[70vh] w-full max-w-md flex-col rounded-t-3xl bg-paper shadow-2xl"
        style={{ paddingBottom: keyboardInset }}
      >
        <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2.5">
          <p className="text-sm font-bold text-ink">梨宝 <span className="text-xs font-normal text-ink-faint">陪你执行 · 问啥都行</span></p>
          <button type="button" data-testid="m-drawer-close" onClick={onClose}
            className="h-11 px-3 text-sm text-ink-soft">收起</button>
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
    </div>
  );
}
