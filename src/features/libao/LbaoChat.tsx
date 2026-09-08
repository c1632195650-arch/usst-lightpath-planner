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

const QUICK = ['四六级什么时候报名', '怎么选课和重修', '帮我安排这周', '这学期放假安排'];

const GREETING = '害！我是梨宝 🍐 咱上理的一颗「数字闷骚梨」，住服务器里，有点懒但讲义气。你可以问我四六级、选课、放假、报到这些大小事，也可以说「帮我安排这周」，梨宝掐指一算给你排学习·吃饭·娱乐。你懂我意思吧？';

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
          text: '害！梨宝还不认识你，没法给你量身安排嗷～先去测个画像（35 道小选择），我就能按你的作息帮你排这周啦。 [梨宝摊手.jpg]',
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
        { role: 'lbao', text: '呜，梨宝的后端没连上（可能没启动 server/app.py）。宝子先把后端跑起来，我就能查资料啦～ [梨宝叹气.gif]' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-120px)] min-h-[480px]">
      {online === false && (
        <div className="mb-2 text-center text-[11.5px] text-ink-faint bg-white/70 border-2 border-dashed border-brand/30 rounded-xl py-1.5 px-3">
          🔌 后端未连接 · 启动 <code className="font-bold">python server/app.py</code> 后梨宝就能查资料
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[86%] ${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1.5`}>
              {m.role === 'lbao' && (
                <div className="flex items-center gap-1.5 pl-1">
                  <span className="w-6 h-6 rounded-xl bg-brand-light grid place-items-center text-[14px] shadow-sticker">🍐</span>
                  <span className="text-[11px] font-bold text-ink-faint">梨宝{m.mode === 'llm' ? ' · AI' : ''}</span>
                </div>
              )}
              <div
                className={`rounded-2xl border-2 px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap shadow-sticker ${
                  m.role === 'user' ? 'bg-brand text-white border-brand-dark' : 'bg-white text-ink border-paper-line'
                }`}
              >
                {m.text}
              </div>

              {/* 去测画像按钮 */}
              {m.needProfile && onGoProfile && (
                <button
                  onClick={onGoProfile}
                  className="ml-1 px-4 py-1.5 rounded-full bg-brand text-white text-[12.5px] font-bold shadow-sticker-brand hover:-translate-y-0.5 transition-all"
                >
                  🧭 去测画像
                </button>
              )}

              {/* 推荐方案卡片 */}
              {m.plan && <LbaoPlanView plan={m.plan} />}

              {/* 来源卡片 */}
              {m.sources && m.sources.length > 0 && (
                <div className="flex flex-col gap-1.5 pl-1 w-full">
                  {m.sources.slice(0, 3).map((s, j) => (
                    <a
                      key={j}
                      href={s.url || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-xl border-2 border-paper-line bg-white/70 px-3 py-2 hover:-translate-y-0.5 transition-all shadow-sticker"
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
            <div className="flex items-center gap-2 rounded-2xl border-2 border-paper-line bg-white px-3.5 py-2.5 shadow-sticker">
              <span className="w-6 h-6 rounded-xl bg-brand-light grid place-items-center text-[14px] animate-bounce-soft">🍐</span>
              <span className="text-[12.5px] text-ink-soft">梨宝掐指一算中…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 overflow-x-auto py-2.5 -mx-1 px-1">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            disabled={loading}
            className="shrink-0 px-3 py-1.5 rounded-full border-2 border-brand/25 bg-white text-[12px] font-bold text-brand hover:bg-brand hover:text-white transition-all shadow-sticker"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="问梨宝 / 或说「帮我安排这周」…"
          className="flex-1 rounded-full border-2 border-paper-line bg-white px-4 py-2.5 text-[13.5px] text-ink outline-none focus:border-brand/50 transition-colors"
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          className="shrink-0 px-5 py-2.5 rounded-full bg-brand text-white font-bold text-[13.5px] shadow-sticker-brand disabled:opacity-40 hover:-translate-y-0.5 transition-all"
        >
          发送
        </button>
      </div>
    </div>
  );
}

