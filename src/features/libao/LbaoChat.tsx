import { useEffect, useRef, useState } from 'react';
import type { PersonaProfile, Schedule } from '@/types';
import { lbaoRecommend, type LbaoPlan } from '@/lib/lbao';
import { LbaoPlanView } from '@/features/libao/LbaoPlanView';
import { mondayOf, weekDates, todayISO } from '@/lib/date';
import { lbaoChat, lbaoHealth, type RagSource } from '@/lib/api';

interface Msg {
  role: 'user' | 'lbao';
  text: string;
  sources?: RagSource[];
  mode?: string;
  plan?: LbaoPlan;
  needProfile?: boolean;
}

/** 常见问法，避免第一次进入对话没有入口。 */
const QUICK = ['四六级什么时候报名', '怎么选课和重修', '帮我安排这周', '这学期放假安排'];

/** 对话初始说明，明确问答与排程两个能力。 */
const GREETING = '我是梨宝，咱上理的校园助手。你可以问四六级、选课、放假、报到等校园问题，也可以说「帮我安排这周」，我会结合你的画像和课表给出建议。';

/** 推荐意图识别：安排/规划类走本地规则，其余走 RAG 问答 */
function isRecommendIntent(q: string): boolean {
  const s = q.trim();
  if (/(安排|规划|计划一下|怎么过|排一下|帮我排|给我排)/.test(s)) return true;
  if (/(这周|本周|今天|明天|后天|周末)/.test(s) && /(怎么|干嘛|做啥|干点|过|安排)/.test(s)) return true;
  return false;
}

export function LbaoChat({ profile, schedule, onGoProfile }: {
  profile: PersonaProfile | null;
  schedule: Schedule;
  onGoProfile?: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([{ role: 'lbao', text: GREETING }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lbaoHealth()
      .then((h) => setOnline(h.ok))
      .catch(() => setOnline(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  /** 发送提问；排程意图在本地处理，其余交给校园资料问答。 */
  const send = async (raw?: string) => {
    const q = (raw ?? input).trim();
    if (!q || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setLoading(true);

    // —— 推荐意图：本地规则生成方案，不经过后端 ——
    if (isRecommendIntent(q)) {
      if (!profile) {
        setMessages((m) => [...m, {
          role: 'lbao',
          text: '我还不了解你的作息偏好。完成画像后，就能按你的情况安排这一周。',
          needProfile: true,
        }]);
      } else {
        const days = weekDates(mondayOf(todayISO()));
        const plan = lbaoRecommend(profile, schedule, days);
        setMessages((m) => [...m, { role: 'lbao', text: '梨宝掐指一算，给你安排好啦，你懂我意思吧？', plan }]);
      }
      setLoading(false);
      return;
    }

    // —— 问答意图：走后端 RAG ——
    try {
      const r = await lbaoChat(q);
      setMessages((m) => [...m, { role: 'lbao', text: r.answer, sources: r.sources, mode: r.mode }]);
      setOnline(true);
    } catch {
      setOnline(false);
      setMessages((m) => [
        ...m,
        { role: 'lbao', text: '校园资料服务暂时未连接。启动 server/app.py 后，我就可以继续查询资料。' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-120px)] min-h-[480px] flex-col rounded-2xl border border-ink/10 bg-white/70 p-3 shadow-sm sm:p-4">
      {online === false && (
        <div className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-brand/20 bg-brand-light/40 px-3 py-2 text-center text-xs text-ink-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          服务未连接 · 启动 <code className="font-semibold text-ink">python server/app.py</code> 后可查询校园资料
        </div>
      )}

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto pr-1">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`flex max-w-[86%] flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              {m.role === 'lbao' && (
                <div className="flex items-center gap-2 pl-1">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-brand text-[10px] font-bold text-white" aria-hidden="true">梨</span>
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-faint">梨宝{m.mode === 'llm' ? ' · AI' : ''}</span>
                </div>
              )}
              <div
                className={`rounded-xl border px-3.5 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user' ? 'border-brand bg-brand text-white' : 'border-ink/10 bg-white text-ink shadow-sm'
                }`}
              >
                {m.text}
              </div>

              {/* 去测画像按钮 */}
              {m.needProfile && onGoProfile && (
                <button
                  onClick={onGoProfile}
                  className="button-primary ml-1 px-3 py-2 text-xs"
                >
                  完成画像
                </button>
              )}

              {/* 推荐方案卡片 */}
              {m.plan && <LbaoPlanView plan={m.plan} />}

              {/* 来源卡片 */}
              {m.sources && m.sources.length > 0 && (
                <div className="flex w-full flex-col gap-2 pl-1">
                  {m.sources.slice(0, 3).map((s, j) => (
                    <a
                      key={j}
                      href={s.url || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg border border-ink/10 bg-white/80 px-3 py-2.5 transition-colors hover:border-brand/25 hover:bg-brand-light/30"
                    >
                      <div className="text-[12px] font-bold text-ink leading-snug line-clamp-1">{s.title}</div>
                      <div className="text-[10.5px] text-ink-faint mt-0.5">{s.account} · {s.pub_time}</div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-3 shadow-sm">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-brand text-[10px] font-bold text-white animate-pulse" aria-hidden="true">梨</span>
              <span className="text-[12.5px] text-ink-soft">梨宝掐指一算中…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-3">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            disabled={loading}
            className="shrink-0 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-brand/25 hover:bg-brand-light hover:text-brand disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-ink/10 pt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="问梨宝 / 或说「帮我安排这周」…"
          className="flex-1 rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/10"
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          className="button-primary shrink-0 px-4 py-2.5 text-[13.5px] disabled:cursor-not-allowed disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}
