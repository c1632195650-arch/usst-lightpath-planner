import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerEntry, AnswerMap, PersonaItem } from '@/types';
import { PERSONA_ITEMS, SECTION_META } from '@/data/personaBank';
import { isAnswered } from '@/lib/persona';

interface Props {
  answers: AnswerMap;
  onAnswer: (id: string, value: AnswerEntry) => void;
  onComplete: () => void;
  onExit: () => void;
}

const L5_LABELS = ['完全不像我', '不太像', '一般', '比较像', '非常像我'];
const L5_EMOJI = ['🙅', '🤔', '😐', '😄', '🤩'];

export function PersonaFlow({ answers, onAnswer, onComplete, onExit }: Props) {
  const items = useMemo(() => [...PERSONA_ITEMS].sort((a, b) => a.order - b.order), []);
  const [idx, setIdx] = useState(0);
  const [sortPick, setSortPick] = useState<string[]>(() => {
    const a = answers.B05;
    return Array.isArray(a) ? (a as string[]) : [];
  });
  const advanceTimer = useRef<number | null>(null);

  const item = items[idx];
  const isLast = idx === items.length - 1;
  const total = items.length;
  const answered = isAnswered(answers, item.id);

  // L5/FC/MC 答完自动前进
  useEffect(() => {
    if (item.type !== 'SORT' && answered && !isLast) {
      advanceTimer.current = window.setTimeout(() => setIdx((i) => i + 1), 280);
    }
    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); };
  }, [answered, item.type, idx, isLast]);

  const answer = (v: AnswerEntry) => onAnswer(item.id, v);

  const handleSortTap = (key: string) => {
    if (sortPick.includes(key)) return;
    const next = [...sortPick, key];
    setSortPick(next);
    onAnswer('B05', next);
  };
  const sortDone = sortPick.length >= 5;

  const progress = Math.round(((idx + (answered ? 1 : 0)) / total) * 100);
  const section = SECTION_META[item.section];

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 bg-paper/90 backdrop-blur border-b-2 border-paper-line">
        <div className="page-shell px-5 py-3 flex items-center gap-3">
          <button onClick={onExit} className="text-ink-faint text-[13px] hover:text-ink">← 退出</button>
          <div className="flex-1">
            <div className="flex items-center justify-between text-[12px] text-ink-faint mb-1.5">
              <span className="font-bold text-brand">{section.name}</span>
              <span className="tabular-nums">{idx + 1} / {total}</span>
            </div>
            <div className="h-2 rounded-full bg-paper-line overflow-hidden border border-ink/5">
              <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </header>

      {/* 题干区 */}
      <main className="flex-1 page-shell w-full px-5 py-8 flex flex-col">
        <p className="text-[12px] text-ink-faint mb-6">{section.hint}</p>
        <h2 className="text-[22px] leading-relaxed font-bold text-ink mb-8">{item.text}</h2>

        {item.type === 'L5' && (
          <div className="mt-auto">
            <div className="grid grid-cols-5 gap-2">
              {L5_LABELS.map((label, i) => {
                const v = i + 1;
                const active = answers[item.id] === v;
                return (
                  <button
                    key={v}
                    onClick={() => answer(v)}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition-all ${
                      active ? 'bg-brand text-white border-brand shadow-sticker-brand -translate-y-1' : 'bg-white border-ink/10 text-ink-soft hover:border-brand/40 hover:-translate-y-0.5'
                    }`}
                  >
                    <span className="text-[20px] leading-none">{L5_EMOJI[i]}</span>
                    <span className={`w-6 h-6 rounded-full text-[13px] font-bold grid place-items-center ${active ? 'bg-white/20' : 'bg-paper'}`}>{v}</span>
                    <span className="text-[10.5px] leading-tight text-center">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(item.type === 'FC' || item.type === 'MC') && (
          <div className="mt-auto flex flex-col gap-3">
            {item.options?.map((opt) => {
              const active = answers[item.id] === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => answer(opt.key)}
                  className={`flex items-center gap-3 px-4 py-4 rounded-2xl border-2 text-left transition-all ${
                    active ? 'bg-brand text-white border-brand shadow-sticker-brand -translate-y-0.5' : 'bg-white border-ink/10 hover:border-brand/40'
                  }`}
                >
                  <span className={`w-7 h-7 shrink-0 rounded-full grid place-items-center text-[13px] font-bold border-2 ${active ? 'border-white/40' : 'border-ink/10 text-ink-faint'}`}>
                    {opt.key}
                  </span>
                  <span className="text-[15px] font-medium">{opt.text}</span>
                </button>
              );
            })}
          </div>
        )}

        {item.type === 'SORT' && (
          <div className="mt-auto">
            <p className="text-[12px] text-ink-faint mb-3">按重要程度依次点击，第 1 次点 = 最重要</p>
            <div className="flex flex-col gap-2.5">
              {item.options?.map((opt) => {
                const rank = sortPick.indexOf(opt.key);
                const picked = rank >= 0;
                return (
                  <button
                    key={opt.key}
                    onClick={() => handleSortTap(opt.key)}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all ${
                      picked ? 'bg-brand text-white border-brand shadow-sticker-brand' : 'bg-white border-ink/10 hover:border-brand/40'
                    }`}
                  >
                    <span className={`w-7 h-7 shrink-0 rounded-full grid place-items-center text-[13px] font-bold ${picked ? 'bg-white/20' : 'bg-paper text-ink-faint'}`}>
                      {picked ? rank + 1 : '·'}
                    </span>
                    <span className="text-[15px] font-medium flex-1">{opt.text}</span>
                    {picked && <span className="text-[12px] opacity-80">第 {rank + 1} 位</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => onAnswer('B05', [])}
                className="text-[13px] text-ink-faint hover:text-ink"
              >
                重置
              </button>
              <button
                onClick={() => { if (isLast) onComplete(); else setIdx((i) => i + 1); }}
                disabled={!sortDone}
                className="flex-1 py-3 rounded-full bg-brand text-white font-bold shadow-sticker-brand disabled:opacity-30 disabled:shadow-none disabled:cursor-not-allowed transition-all active:translate-y-0.5 active:shadow-none"
              >
                下一步
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 底部操作（非 SORT） */}
      {item.type !== 'SORT' && (
        <footer className="page-shell w-full px-5 pb-6 flex items-center gap-3">
          <button
            onClick={() => onAnswer(item.id, '' as AnswerEntry)}
            className="px-4 py-2.5 text-[13px] text-ink-faint hover:text-ink rounded-lg"
          >
            跳过这题
          </button>
          <div className="flex-1" />
          {idx > 0 && (
            <button onClick={() => setIdx((i) => i - 1)} className="px-4 py-2.5 text-[13px] text-ink-soft hover:text-ink">
              上一题
            </button>
          )}
          {isLast && answered && (
            <button onClick={onComplete} className="px-6 py-2.5 rounded-full bg-brand text-white font-bold shadow-sticker-brand active:translate-y-0.5 active:shadow-none">
              生成我的画像
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
