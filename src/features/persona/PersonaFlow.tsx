import { useMemo, useState } from 'react';
import type { AnswerEntry, AnswerMap } from '@/types';
import { PERSONA_ITEMS, SECTION_META } from '@/data/personaBank';
import { isAnswered } from '@/lib/persona';

interface Props {
  answers: AnswerMap;
  onAnswer: (id: string, value: AnswerEntry) => void;
  onComplete: () => void;
  onExit: () => void;
}

/** 五级题的端点文字，数字本身保持为快速扫读锚点。 */
const L5_LABELS = ['完全不像我', '不太像', '一般', '比较像', '非常像我'];

/** 分段轨道只展示真实的问卷结构，不引入新的评价维度。 */
const SECTION_LABELS: Record<string, string> = {
  A: '性格内核',
  B: '价值与动机',
  C: '认知与决策',
  D: '行为倾向',
  E: '校园场景',
};

/** 将 35 道画像题组织为单一、可回看的决策流程。 */
export function PersonaFlow({ answers, onAnswer, onComplete, onExit }: Props) {
  const items = useMemo(() => [...PERSONA_ITEMS].sort((a, b) => a.order - b.order), []);
  const [idx, setIdx] = useState(0);
  const [sortPick, setSortPick] = useState<string[]>(() => {
    const saved = answers.B05;
    return Array.isArray(saved) ? (saved as string[]) : [];
  });

  const item = items[idx];
  const isLast = idx === items.length - 1;
  const total = items.length;
  const answered = isAnswered(answers, item.id);
  const section = SECTION_META[item.section];
  const sections = Object.entries(SECTION_META).map(([id, meta]) => {
    const sectionItems = items.filter((entry) => entry.section === id);
    return {
      id,
      meta,
      total: sectionItems.length,
      complete: sectionItems.filter((entry) => isAnswered(answers, entry.id)).length,
    };
  });
  /** 进度以实际已作答数量计算，返回上一步也不会让完成度倒退。 */
  const answeredTotal = sections.reduce((sum, entry) => sum + entry.complete, 0);
  const progress = Math.round((answeredTotal / total) * 100);

  /** 记录当前题答案；外层负责把答卷持久化到本地。 */
  const answer = (value: AnswerEntry) => onAnswer(item.id, value);

  /** 所有题都由明确操作进入下一步，旧答案不会在页面打开时触发跳题。 */
  const goNext = () => {
    if (isLast) onComplete();
    else setIdx((current) => current + 1);
  };

  /** 依次记录排序题的选择，已选项目保持顺序以明确其优先级。 */
  const handleSortTap = (key: string) => {
    if (sortPick.includes(key)) return;
    const next = [...sortPick, key];
    setSortPick(next);
    onAnswer('B05', next);
  };

  /** 同时清除局部排序和外层答案，避免视觉与保存内容不同步。 */
  const resetSort = () => {
    setSortPick([]);
    onAnswer('B05', []);
  };

  const sortDone = sortPick.length >= 5;

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-ink/10 bg-white/90 backdrop-blur-md lg:sticky lg:top-0 lg:z-20">
        <div className="page-shell flex min-h-16 items-center gap-4 px-4 py-3 sm:px-6">
          <button onClick={onExit} className="min-h-10 text-sm font-medium text-ink-faint transition-colors hover:text-ink">
            ← 退出测评
          </button>
          <div className="hidden h-5 w-px bg-ink/10 sm:block" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-4">
              <p className="truncate text-sm font-semibold text-ink">校园画像 · 你的排程起点</p>
              <p className="shrink-0 text-sm font-medium text-ink-faint tabular-nums">已完成 {answeredTotal} / {total}</p>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-label="测评进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full bg-brand transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </header>

      <main className="page-shell grid gap-8 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-12 lg:py-12">
        <aside className="hidden lg:block">
          <div className="sticky top-28 max-w-[230px]">
            <p className="section-label">QUESTIONNAIRE</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">把日常选择，变成具体安排。</h1>
            <p className="mt-3 text-sm leading-6 text-ink-soft">没有标准答案。你留下的只是自己的节奏，且只存放在此设备。</p>

            <ol className="mt-8 border-y border-ink/10" aria-label="测评分段进度">
              {sections.map((entry) => {
                const active = entry.id === item.section;
                const complete = entry.complete === entry.total;
                return (
                  <li key={entry.id} className={`border-b border-ink/10 last:border-0 ${active ? 'bg-white' : ''}`}>
                    <div className="flex items-center gap-3 px-3 py-3">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-semibold ${
                        active ? 'bg-brand text-white' : complete ? 'bg-ink text-white' : 'bg-paper text-ink-faint'
                      }`}>
                        {complete ? '✓' : entry.id}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-medium ${active ? 'text-ink' : 'text-ink-soft'}`}>{SECTION_LABELS[entry.id]}</div>
                        <div className="mt-0.5 text-xs text-ink-faint tabular-nums">{entry.complete} / {entry.total} 题</div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="hero-surface overflow-hidden rounded-2xl border border-white/10 text-white shadow-[0_18px_44px_rgba(22,35,63,0.18)]">
            <div className="border-b border-white/10 px-5 py-4 sm:px-8 sm:py-5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold text-white">{SECTION_LABELS[item.section]}</p>
                <p className="text-xs text-white/55">{section.hint} · 第 {idx + 1} 题</p>
              </div>
              <div className="mt-3 flex gap-1 lg:hidden" aria-label={`${SECTION_LABELS[item.section]}，第 ${idx + 1} 题`}>
                {sections.map((entry) => (
                  <span key={entry.id} className={`h-1 flex-1 rounded-full ${entry.id === item.section ? 'bg-brand-bright' : entry.complete === entry.total ? 'bg-white/70' : 'bg-white/15'}`} />
                ))}
              </div>
            </div>

            <div className="px-5 pb-5 pt-8 sm:px-8 sm:pb-8 sm:pt-10">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-light">QUESTION {String(idx + 1).padStart(2, '0')}</p>
              <h2 className="mt-4 max-w-3xl text-2xl font-semibold leading-9 tracking-tight text-white sm:text-3xl sm:leading-[1.35]">{item.text}</h2>
              <p className="mt-4 text-sm leading-6 text-white/60">
                {item.type === 'L5' ? '按你通常的状态选择，不需要追求“更好”的答案。' : item.type === 'SORT' ? '按重要程度依次选择；第一次选择会排在最前。' : '选择更接近你第一反应的一项。'}
              </p>

              <div className="mt-8 rounded-2xl bg-white p-3 text-ink sm:p-4">
                {item.type === 'L5' && (
                  <div className="grid gap-2 sm:grid-cols-5 sm:gap-3">
                    {L5_LABELS.map((label, index) => {
                      const value = index + 1;
                      const active = answers[item.id] === value;
                      return (
                        <button
                          key={value}
                          onClick={() => answer(value)}
                          aria-pressed={active}
                          className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors duration-200 ease-out sm:min-h-[132px] sm:flex-col sm:items-center sm:justify-between sm:px-2 sm:text-center ${
                            active ? 'border-brand bg-brand text-white' : 'border-ink/10 bg-paper text-ink hover:border-brand/40 hover:bg-brand-light/45'
                          }`}
                        >
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${active ? 'bg-white/15' : 'bg-white text-ink-soft'}`}>{value}</span>
                          <span className="text-sm leading-5">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {(item.type === 'FC' || item.type === 'MC') && (
                  <div className="grid gap-3">
                    {item.options?.map((option) => {
                      const active = answers[item.id] === option.key;
                      return (
                        <button
                          key={option.key}
                          onClick={() => answer(option.key)}
                          aria-pressed={active}
                          className={`flex min-h-16 items-center gap-4 rounded-xl border px-4 py-3 text-left transition-colors duration-200 ease-out ${
                            active ? 'border-brand bg-brand text-white' : 'border-ink/10 bg-paper text-ink hover:border-brand/40 hover:bg-brand-light/45'
                          }`}
                        >
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-semibold ${
                            active ? 'border-white/35 bg-white/10' : 'border-ink/10 bg-white text-ink-soft'
                          }`}>
                            {option.key}
                          </span>
                          <span className="text-sm font-medium leading-6">{option.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {item.type === 'SORT' && (
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between gap-3 px-1 pb-1 text-sm text-ink-soft">
                      <span>依次点选，最先选的会排在最前。</span>
                      <span className="shrink-0 font-semibold text-ink tabular-nums">{sortPick.length} / 5</span>
                    </div>
                    {item.options?.map((option) => {
                      const rank = sortPick.indexOf(option.key);
                      const picked = rank >= 0;
                      return (
                        <button
                          key={option.key}
                          onClick={() => handleSortTap(option.key)}
                          disabled={picked}
                          aria-pressed={picked}
                          className={`flex min-h-16 items-center gap-4 rounded-xl border px-4 py-3 text-left transition-colors duration-200 ease-out disabled:cursor-default ${
                            picked ? 'border-brand bg-brand text-white' : 'border-ink/10 bg-paper text-ink hover:border-brand/40 hover:bg-brand-light/45'
                          }`}
                        >
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${picked ? 'bg-white/15' : 'bg-white text-ink-soft'}`}>
                            {picked ? rank + 1 : '—'}
                          </span>
                          <span className="flex-1 text-sm font-medium leading-6">{option.text}</span>
                          {picked && <span className="text-xs text-white/70">第 {rank + 1} 位</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 px-5 py-4 sm:px-8">
              {item.type === 'SORT' ? (
                <>
                  <button onClick={resetSort} disabled={sortPick.length === 0} className="min-h-10 px-2 text-sm font-medium text-white/60 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-35">
                    清空排序
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={goNext}
                    disabled={!sortDone}
                    className="button-on-dark"
                  >
                    {isLast ? '生成我的画像' : '下一步'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={goNext} className="min-h-10 px-2 text-sm font-medium text-white/60 transition-colors hover:text-white">
                    暂时跳过
                  </button>
                  <div className="flex-1" />
                  {idx > 0 && (
                    <button onClick={() => setIdx((current) => current - 1)} className="min-h-10 px-2 text-sm font-medium text-white/75 transition-colors hover:text-white">
                      上一题
                    </button>
                  )}
                  <button onClick={goNext} disabled={!answered} className="button-on-dark">
                    {isLast ? '生成我的画像' : '下一题'}
                  </button>
                </>
              )}
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
