import { useEffect, useState } from 'react';
import type { AnswerEntry, AppState } from '@/types';
import { MOCK_SCHEDULE, CAL_EVENTS } from '@/data/usst';
import { buildProfile } from '@/lib/persona';
import { useAppState, saveState } from '@/lib/storage';
import { currentWeekNo, mondayOf, shiftWeekMonday, todayISO } from '@/lib/date';
import { Logo120 } from '@/components/Logo120';
import { Welcome } from '@/features/welcome/Welcome';
import { PersonaFlow } from '@/features/persona/PersonaFlow';
import { PersonaResult } from '@/features/persona/PersonaResult';
import { MonthCalendar } from '@/features/calendar/MonthCalendar';
import { DeadlineBoard } from '@/features/calendar/DeadlineBoard';
import { WeekView } from '@/features/week/WeekView';
import { LbaoChat } from '@/features/libao/LbaoChat';
import { ImportTester } from '@/features/import/ImportTester';

type View = 'welcome' | 'persona' | 'result' | 'main';
type MainTab = 'calendar' | 'libao' | 'profile' | 'import';

/** 课表导入联调页只在开发环境出现，正式构建里 nav 不会有这个入口 */
const SHOW_IMPORT = import.meta.env.DEV;

/** Navigation copy stays close to the shell so development-only entries cannot drift from their labels. */
const TAB_LABEL: Record<MainTab, string> = {
  calendar: '总览',
  libao: '梨宝',
  profile: '我的画像',
  import: '课表',
};

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function App() {
  const { state, setState } = useAppState();
  const [view, setView] = useState<View>('welcome');
  const [mainTab, setMainTab] = useState<MainTab>('calendar');
  const [weekMonday, setWeekMonday] = useState<string | null>(null);

  const schedule = state.schedule ?? MOCK_SCHEDULE;

  // 进入主界面时若没有课表，加载模拟课表
  useEffect(() => {
    if (!state.schedule) setState((prev) => ({ ...prev, schedule: MOCK_SCHEDULE }));
  }, [state.schedule, setState]);

  /** 平移 delta 周，并限定在 [第1周, 第 totalWeeks 周] 内（边界内停下，不循环）。
   *  鼠标 ‹ › 按钮与键盘左右键共用，保证两者行为一致。 */
  const shiftWeekBy = (d: number) => {
    setWeekMonday((m) => {
      if (!m) return m;
      const next = shiftWeekMonday(m, d);
      const n = currentWeekNo(schedule.termStart, next);
      if (n < 1 || n > schedule.totalWeeks) return m; // 已在首/末周，不越界
      return next;
    });
  };

  // 窗口级键盘：← / → 切换上一周 / 下一周（仅当正在查看周视图时）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // 只在周视图可见时响应（mainTab=calendar 且已进入某一周）
      if (mainTab !== 'calendar' || weekMonday === null) return;
      // 排除输入框 / 文本域 / 可编辑区聚焦（聊天输入、文件选择等不被劫持）
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      e.preventDefault(); // 阻止课程表横向滚动误触
      shiftWeekBy(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, weekMonday, schedule.termStart, schedule.totalWeeks]);

  const setAnswer = (id: string, value: AnswerEntry) => {
    setState((prev) => {
      const next = { ...prev, answers: { ...(prev.answers ?? {}), [id]: value } };
      saveState(next);
      return next;
    });
  };

  const handleComplete = () => {
    const profile = buildProfile(state.answers ?? {});
    setState((prev) => {
      const next = { ...prev, persona: profile, onboarded: true };
      saveState(next);
      return next;
    });
    setView('result');
  };

  const openWeek = (iso: string) => {
    setWeekMonday(mondayOf(iso));
    setMainTab('calendar');
  };

  const toggleDay = (iso: string) => {
    setState((prev) => {
      const has = prev.selectedDays.includes(iso);
      const selectedDays = has ? prev.selectedDays.filter((d) => d !== iso) : [...prev.selectedDays, iso];
      const next = { ...prev, selectedDays };
      saveState(next);
      return next;
    });
  };

  const selectWholeWeek = () => {
    const monday = weekMonday ?? mondayOf(todayISO());
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return isoOf(d);
    });
    setState((prev) => { const n = { ...prev, selectedDays: days }; saveState(n); return n; });
  };

  const patchState = (partial: Partial<AppState>) => {
    setState((prev) => {
      const n = { ...prev, ...partial };
      saveState(n);
      return n;
    });
  };

  if (view === 'welcome') {
    return (
      <Welcome
        onStart={() => setView('persona')}
        onSkip={() => { setView('main'); setMainTab('calendar'); }}
      />
    );
  }

  if (view === 'persona') {
    return (
      <PersonaFlow
        answers={state.answers ?? {}}
        onAnswer={setAnswer}
        onComplete={handleComplete}
        onExit={() => setView('welcome')}
      />
    );
  }

  if (view === 'result' && state.persona) {
    return (
      <PersonaResult
        profile={state.persona}
        onEnter={() => { setView('main'); setMainTab('calendar'); }}
        onRetake={() => setView('persona')}
      />
    );
  }

  // 主界面
  const weekNo = weekMonday ? currentWeekNo(schedule.termStart, weekMonday) : currentWeekNo(schedule.termStart);
  /** 当周真实开课数与节次，只用于总览，不虚构“实时效率”指标。 */
  const activeCourses = schedule.courses.filter((course) =>
    course.slots.some((slot) => slot.weeks.length === 0 || slot.weeks.includes(weekNo)));
  const activeSlots = activeCourses.reduce(
    (count, course) => count + course.slots.filter((slot) => slot.weeks.length === 0 || slot.weeks.includes(weekNo)).length,
    0,
  );

  return (
    <div className="min-h-screen bg-paper">
      {/* The utility header keeps navigation concise so the planning content remains the visual focus. */}
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-paper/85 backdrop-blur-xl">
        <div className="page-shell flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:flex-nowrap sm:px-6">
          <Logo120 size={32} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-sm font-semibold tracking-tight text-ink">上理生活助手</div>
            <div className="mt-0.5 text-[11px] font-medium tracking-[0.14em] text-ink-faint">USST · STUDENT LIFE</div>
          </div>
          <nav className="order-3 -mx-4 flex w-[calc(100%+2rem)] overflow-x-auto border-t border-ink/10 px-4 pt-3 sm:order-none sm:mx-0 sm:w-auto sm:border-0 sm:p-0" aria-label="主导航">
            <div className="flex min-w-max items-center gap-1 rounded-xl border border-ink/10 bg-white p-1">
            {((SHOW_IMPORT ? ['calendar', 'libao', 'profile', 'import'] : ['calendar', 'libao', 'profile']) as MainTab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setMainTab(t); if (t === 'profile') setWeekMonday(null); }}
                className={`nav-item whitespace-nowrap ${mainTab === t ? 'nav-item-active' : ''}`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
            </div>
          </nav>
        </div>
      </header>

      <main className="page-shell px-4 py-6 sm:px-6 sm:py-8">
        {mainTab === 'import' ? (
          <ImportTester onApply={(s) => patchState({ schedule: s })} />
        ) : mainTab === 'libao' ? (
          <LbaoChat
            profile={state.persona}
            schedule={schedule}
            onGoProfile={() => setView('persona')}
          />
        ) : mainTab === 'profile' ? (
          state.persona ? (
            <PersonaResult
              profile={state.persona}
              onEnter={() => setMainTab('calendar')}
              onRetake={() => setView('persona')}
            />
          ) : (
            <div className="content-shell panel px-6 py-16 text-center sm:px-10">
              <p className="section-label">PROFILE</p>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">让推荐更贴近你的节奏</h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-soft">完成画像后，梨宝会根据你的习惯提供更合适的学习、吃饭与休息建议。</p>
              <button onClick={() => setView('persona')} className="button-primary mt-7 px-6">开始画像测评</button>
            </div>
          )
        ) : weekMonday ? (
          <WeekView
            weekMonday={weekMonday}
            weekNo={weekNo}
            schedule={schedule}
            selectedDays={state.selectedDays}
            onToggleDay={toggleDay}
            onSelectWholeWeek={selectWholeWeek}
            onClearDays={() => patchState({ selectedDays: [] })}
            lifeMode={state.lifeMode}
            onSelectMode={(id) => patchState({ lifeMode: id })}
            persona={state.persona}
            onBack={() => setWeekMonday(null)}
            onShiftWeek={shiftWeekBy}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div className="flex flex-col gap-6">
              <section className="overflow-hidden rounded-2xl bg-ink text-white shadow-sm">
                <div className="flex flex-col gap-6 px-5 py-7 sm:px-8 sm:py-8">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">WEEK {String(Math.max(1, weekNo)).padStart(2, '0')} · {todayISO()}</p>
                    <h1 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">今天的安排，要留得出余地。</h1>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-white/65">
                      {state.persona
                        ? `当前建议会参考「${state.persona.archetype.primary?.name ?? '你的画像'}」的节奏，以及这周正在上的课程。`
                        : '先从校历进入本周；完成画像后，安排会更贴近你的习惯。'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => openWeek(todayISO())} className="min-h-11 rounded-xl bg-white px-5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-brand-light">
                      打开本周安排
                    </button>
                    {!state.persona && (
                      <button onClick={() => setView('persona')} className="min-h-11 rounded-xl border border-white/15 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                        完成画像测评
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid border-t border-white/10 sm:grid-cols-3">
                  <div className="px-5 py-4 sm:px-8">
                    <p className="text-xs text-white/45">当前学期</p>
                    <p className="mt-1 text-sm font-semibold text-white">{schedule.semesterName}</p>
                  </div>
                  <div className="border-t border-white/10 px-5 py-4 sm:border-l sm:border-t-0 sm:px-8">
                    <p className="text-xs text-white/45">本周开课</p>
                    <p className="mt-1 text-sm font-semibold text-white tabular-nums">{activeCourses.length} 门 · {activeSlots} 节次</p>
                  </div>
                  <div className="border-t border-white/10 px-5 py-4 sm:border-l sm:border-t-0 sm:px-8">
                    <p className="text-xs text-white/45">已选日期</p>
                    <p className="mt-1 text-sm font-semibold text-white tabular-nums">{state.selectedDays.length} / 7 天</p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-ink/10 bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-6 flex items-end justify-between gap-4">
                  <div>
                    <p className="section-label">CALENDAR</p>
                    <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">从校历选择这一周</h2>
                  </div>
                  <button onClick={() => openWeek(todayISO())} className="shrink-0 text-sm font-semibold text-brand transition-colors hover:text-brand-dark">回到今天</button>
                </div>
                <MonthCalendar
                  events={CAL_EVENTS}
                  selectedDate={state.selectedDays[state.selectedDays.length - 1]}
                  onSelectDate={openWeek}
                />
              </section>
            </div>

            <aside className="flex flex-col gap-6 lg:sticky lg:top-24">
              <DeadlineBoard />
              <section className="border-y border-ink/10 py-5">
                <p className="section-label">PLANNING PRINCIPLE</p>
                <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink">计划不是把时间填满。</h2>
                <p className="mt-3 text-sm leading-6 text-ink-soft">从课表、个人习惯与校园节点出发，给重要的事留空间，也把休息当作日程的一部分。</p>
              </section>
            </aside>
          </div>
        )}
      </main>

      <footer className="page-shell px-4 pb-8 pt-2 text-center text-[11px] font-medium tracking-[0.12em] text-ink-faint sm:px-6">
        UNIVERSITY OF SHANGHAI FOR SCIENCE AND TECHNOLOGY · 1906–2026
      </footer>
    </div>
  );
}
