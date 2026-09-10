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
    <div className="flex min-h-screen flex-col bg-paper">
      {/* The compact progress bar anchors a long questionnaire without adding visual noise. */}
      <header className="sticky top-0 z-10 border-b border-ink/10 bg-paper/80 backdrop-blur-xl">
        <div className="content-shell flex items-center gap-4 px-4 py-4 sm:px-6">
          <button onClick={onExit} className="text-sm font-medium text-ink-faint transition-colors hover:text-ink">退出</button>
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between text-xs text-ink-faint">
              <span className="font-semibold text-brand">{section.name}</span>
              <span className="tabular-nums">{idx + 1} / {total}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full bg-brand transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </header>

      <main className="content-shell flex w-full flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
        <p className="section-label">{section.hint}</p>
        <h2 className="mb-10 mt-4 text-2xl font-semibold leading-9 tracking-tight text-ink sm:text-3xl">{item.text}</h2>

        {item.type === 'L5' && (
          <div className="mt-auto">
            <div className="grid grid-cols-5 gap-2 sm:gap-3">
              {L5_LABELS.map((label, i) => {
                const v = i + 1;
                const active = answers[item.id] === v;
                return (
                  <button
                    key={v}
                    onClick={() => answer(v)}
                    className={`flex flex-col items-center gap-2 rounded-xl border px-1 py-4 text-center transition-all duration-300 ease-in-out ${
                      active ? 'border-brand bg-brand text-white shadow-sm' : 'border-ink/10 bg-white/80 text-ink-soft hover:border-brand/30 hover:bg-brand-light/30'
                    }`}
                  >
                    <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${active ? 'bg-white/15' : 'bg-paper text-ink-faint'}`}>{v}</span>
                    <span className="text-[10px] leading-4 sm:text-xs">{label}</span>
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
                  className={`flex items-center gap-4 rounded-xl border px-4 py-4 text-left transition-all duration-300 ease-in-out ${
                    active ? 'border-brand bg-brand text-white shadow-sm' : 'border-ink/10 bg-white/80 hover:border-brand/30 hover:bg-brand-light/30'
                  }`}
                >
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${active ? 'border-white/40' : 'border-ink/10 text-ink-faint'}`}>
                    {opt.key}
                  </span>
                  <span className="text-sm font-medium">{opt.text}</span>
                </button>
              );
            })}
          </div>
        )}

        {item.type === 'SORT' && (
          <div className="mt-auto">
            <p className="mb-4 text-xs leading-5 text-ink-faint">按重要程度依次点击，第 1 次点击代表最重要。</p>
            <div className="flex flex-col gap-3">
              {item.options?.map((opt) => {
                const rank = sortPick.indexOf(opt.key);
                const picked = rank >= 0;
                return (
                  <button
                    key={opt.key}
                    onClick={() => handleSortTap(opt.key)}
                    className={`flex items-center gap-4 rounded-xl border px-4 py-4 text-left transition-all duration-300 ease-in-out ${
                      picked ? 'border-brand bg-brand text-white shadow-sm' : 'border-ink/10 bg-white/80 hover:border-brand/30 hover:bg-brand-light/30'
                    }`}
                  >
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${picked ? 'bg-white/15' : 'bg-paper text-ink-faint'}`}>
                      {picked ? rank + 1 : '·'}
                    </span>
                    <span className="flex-1 text-sm font-medium">{opt.text}</span>
                    {picked && <span className="text-xs opacity-80">第 {rank + 1} 位</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={() => onAnswer('B05', [])}
                className="text-sm font-medium text-ink-faint transition-colors hover:text-ink"
              >
                重置
              </button>
              <button
                onClick={() => { if (isLast) onComplete(); else setIdx((i) => i + 1); }}
                disabled={!sortDone}
                className="button-primary flex-1"
              >
                下一步
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 底部操作（非 SORT） */}
      {item.type !== 'SORT' && (
        <footer className="content-shell flex w-full items-center gap-3 px-4 pb-6 sm:px-6">
          <button
            onClick={() => onAnswer(item.id, '' as AnswerEntry)}
            className="px-3 py-2 text-sm font-medium text-ink-faint transition-colors hover:text-ink"
          >
            跳过这题
          </button>
          <div className="flex-1" />
          {idx > 0 && (
            <button onClick={() => setIdx((i) => i - 1)} className="px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:text-ink">
              上一题
            </button>
          )}
          {isLast && answered && (
            <button onClick={onComplete} className="button-primary px-5">
              生成我的画像
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
