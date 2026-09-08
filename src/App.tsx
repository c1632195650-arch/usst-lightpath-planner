import { useEffect, useState } from 'react';
import type { AnswerEntry, AppState } from '@/types';
import { MOCK_SCHEDULE, MOCK_TERM_START, CAL_EVENTS } from '@/data/usst';
import { buildProfile } from '@/lib/persona';
import { useAppState, saveState } from '@/lib/storage';
import { currentWeekNo, mondayOf, todayISO } from '@/lib/date';
import { Logo120 } from '@/components/Logo120';
import { Welcome } from '@/features/welcome/Welcome';
import { PersonaFlow } from '@/features/persona/PersonaFlow';
import { PersonaResult } from '@/features/persona/PersonaResult';
import { MonthCalendar } from '@/features/calendar/MonthCalendar';
import { DeadlineBoard } from '@/features/calendar/DeadlineBoard';
import { WeekView } from '@/features/week/WeekView';
import { LbaoChat } from '@/features/libao/LbaoChat';

type View = 'welcome' | 'persona' | 'result' | 'main';
type MainTab = 'calendar' | 'libao' | 'profile';

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

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b-2 border-paper-line">
        <div className="page-shell px-5 py-3 flex items-center gap-3">
          <Logo120 size={34} className="animate-float-y" />
          <div className="flex-1 leading-tight">
            <div className="font-bold text-[14px] text-ink">
              <span className="text-brand">U</span>gh-<span className="text-brand">S</span>tudy-<span className="text-brand">S</span>aps-<span className="text-brand">T</span>ime
            </div>
            <div className="text-[10.5px] text-ink-faint tracking-wide">上理生活助手 · USST 🍐</div>
          </div>
          <nav className="flex items-center gap-1">
            {(['calendar', 'libao', 'profile'] as MainTab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setMainTab(t); if (t === 'profile') setWeekMonday(null); }}
                className={`px-3 py-1.5 rounded-full text-[13px] font-bold transition-all ${
                  mainTab === t ? 'bg-brand text-white shadow-sticker' : 'text-ink-soft hover:bg-white'
                }`}
              >
                {t === 'calendar' ? '月历' : t === 'libao' ? '梨宝' : '画像'}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="page-shell px-5 py-5">
        {mainTab === 'libao' ? (
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
            <div className="text-center py-20">
              <div className="text-5xl mb-3 animate-bounce-soft">🧭</div>
              <p className="text-ink-soft mb-4">还没有画像，先测一测让梨宝更懂你</p>
              <button onClick={() => setView('persona')} className="px-6 py-2.5 rounded-full bg-brand text-white font-bold shadow-sticker-brand">去测画像</button>
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
            onShiftWeek={(d) => {
              const base = weekMonday;
              const nd = new Date(base);
              nd.setDate(nd.getDate() + d * 7);
              setWeekMonday(isoOf(nd));
            }}
          />
        ) : (
          <div className="flex flex-col gap-5">
            <section className="sticker p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-brand-light grid place-items-center text-[22px] shadow-sticker">🍐</div>
              <div className="flex-1 text-[13.5px] text-ink-soft leading-snug">
                {state.persona
                  ? <>梨宝已认识你（更接近「{state.persona.archetype.primary?.name ?? '——'}」）。点月历里任意一天，进入那周的安排。</>
                  : <>先完成画像，梨宝才能为你安排<strong className="text-ink">学习 · 吃饭 · 娱乐</strong>。</>}
              </div>
              {!state.persona && (
                <button onClick={() => setView('persona')} className="shrink-0 px-4 py-2 rounded-full bg-brand text-white text-[13px] font-bold shadow-sticker-brand">去测</button>
              )}
            </section>

            <DeadlineBoard />

            <section className="sticker p-4">
              <MonthCalendar
                events={CAL_EVENTS}
                selectedDate={state.selectedDays[state.selectedDays.length - 1]}
                onSelectDate={openWeek}
              />
            </section>

            <button
              onClick={() => openWeek(todayISO())}
              className="py-3 rounded-full bg-white border-2 border-brand/25 text-brand font-bold text-[14px] shadow-sticker hover:-translate-y-0.5 transition-all"
            >
              回到本周 →
            </button>
          </div>
        )}
      </main>

      <footer className="text-center text-[11px] text-ink-faint pb-8 pt-2">
        信义勤爱 · 思学志远 · 1906–2026 · 上理生活助手 Demo 🍐
      </footer>
    </div>
  );
}
