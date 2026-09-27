import { useEffect, useState } from 'react';
import type { AnswerEntry, AppState, Schedule } from '@/types';
import { MOCK_SCHEDULE, normalizeLifeMode } from '@/data/usst';
import { buildProfile } from '@/lib/persona';
import { useAppState, saveState } from '@/lib/storage';
import { currentWeekNo, mondayOf, shiftWeekMonday, todayISO } from '@/lib/date';
import { Logo120 } from '@/components/Logo120';
import { Welcome } from '@/features/welcome/Welcome';
import { BasicInfoStep } from '@/features/welcome/BasicInfoStep';
import { initialView } from '@/features/welcome/basicInfo';
import { ModeSetupDialog } from '@/features/libao/ModeSetupDialog';
import { addTimetableFacts } from '@/lib/api';
import { OnboardingChecklist } from '@/features/onboarding/OnboardingChecklist';
import { loadUserDeadlines } from '@/features/calendar/deadlineStore';
import { getUserId } from '@/lib/identity';
import { PersonaFlow } from '@/features/persona/PersonaFlow';
import { PersonaResult } from '@/features/persona/PersonaResult';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { WeekView } from '@/features/week/WeekView';
import { WeekPlanView } from '@/features/week/WeekPlanView';
import { LbaoChat } from '@/features/libao/LbaoChat';
import { ImportTester } from '@/features/import/ImportTester';

type View = 'welcome' | 'basicinfo' | 'persona' | 'result' | 'main';
type MainTab = 'calendar' | 'libao' | 'profile' | 'import';
/** 周视图子模式：课表网格 vs 排程计划时间轴 */
type WeekSubTab = 'timetable' | 'plan';

/** WP12-H7：导入入口正式化 —— 正式构建也常驻（解析服务缺席时 ImportTester 自带降级提示，不白屏） */
const SHOW_IMPORT = true;

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
  const [view, setView] = useState<View>(() => initialView(state.onboarded));
  const [mainTab, setMainTab] = useState<MainTab>('calendar');
  const [weekMonday, setWeekMonday] = useState<string | null>(null);
  // 默认落在「周计划」：这是感受测试的主体（课表网格是既有功能，随时可切回）
  const [weekSubTab, setWeekSubTab] = useState<WeekSubTab>('plan');
  // H2：模式问询窗口（导入课表完成 / 周计划「换个节奏」打开）
  const [modeSetupOpen, setModeSetupOpen] = useState(false);
  // V0-3：checklist「加个重要日」→ 跳梨宝并预填提示（nonce 作 key，只在进入时注入一次）
  const [libaoSeed, setLibaoSeed] = useState<{ text: string; nonce: number } | null>(null);
  useEffect(() => {
    if (mainTab !== 'libao' && libaoSeed) setLibaoSeed(null); // 离开梨宝 tab 即清，防重挂载反复预填
  }, [mainTab, libaoSeed]);

  const schedule = state.schedule ?? MOCK_SCHEDULE;

  // 优先加载本机真实课表 my_schedule.json（public/ 下 Vite 自动 serve；文件已 gitignore）。
  // ⚠️ 关键：localStorage 里可能残留演示课表（source='demo'），那种情况**也必须**用真实课表覆盖，
  //    否则真实课表永远进不来（曾因 `if (state.schedule) return` 踩此坑 —— 用户看到的还是假课表）。
  useEffect(() => {
    if (state.schedule && state.schedule.source !== 'demo') return; // 已是真实课表，不覆盖
    fetch('/my_schedule.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Schedule | null) => {
        if (data && Array.isArray(data.courses) && data.courses.length > 0) {
          setState((prev) => ({ ...prev, schedule: data }));
        } else if (!state.schedule) {
          setState((prev) => ({ ...prev, schedule: MOCK_SCHEDULE }));
        }
      })
      .catch(() => {
        if (!state.schedule) setState((prev) => ({ ...prev, schedule: MOCK_SCHEDULE }));
      });
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
      const next = { ...prev, persona: profile };
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
        onStart={() => setView('basicinfo')}
        onSkip={() => { setView('main'); setMainTab('calendar'); }}
      />
    );
  }

  if (view === 'basicinfo') {
    return <BasicInfoStep onBack={() => setView('welcome')} onComplete={() => setView('persona')} />;
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
        onEnter={() => {
          // V0-2：首落点动线 —— 没导入过课表 → 直达「课表」tab（导入完成自动弹模式窗）；老用户维持「总览」
          patchState({ onboarded: true });
          setView('main');
          setMainTab(state.schedule ? 'calendar' : 'import');
        }}
        onRetake={() => setView('persona')}
      />
    );
  }

  // 主界面
  const weekNo = weekMonday ? currentWeekNo(schedule.termStart, weekMonday) : currentWeekNo(schedule.termStart);
  /** 梨宝对话固定在视口内，只让消息列表承担滚动。 */
  const isLbaoTab = mainTab === 'libao';

  return (
    <div className={`flex flex-col bg-paper ${isLbaoTab ? 'h-dvh overflow-hidden' : 'min-h-screen'}`}>
      {/* 紧凑导航把主要空间留给日程与对话内容。 */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-ink/[0.07] bg-paper/85 backdrop-blur-xl">
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

      <main className={`page-shell flex-1 px-4 sm:px-6 ${isLbaoTab ? 'flex min-h-0 flex-col py-4' : 'py-6 sm:py-8'}`}>
        {mainTab === 'import' ? (
          <ImportTester onApply={(s) => {
            patchState({ schedule: s });
            setModeSetupOpen(true);
            // WP12-C2：课表事实回写（pending 态，MemoryPanel 可拒）；失败静默 —— 不挡导入主流程
            addTimetableFacts(s, getUserId()).catch(() => { /* 回写是锦上添花 */ });
          }} />
        ) : mainTab === 'libao' ? (
          <LbaoChat
            key={libaoSeed?.nonce ?? 'chat'}
            profile={state.persona}
            schedule={schedule}
            onGoProfile={() => setView('persona')}
            seedQuestion={libaoSeed?.text}
          />
        ) : mainTab === 'profile' ? (
          state.persona ? (
            <div className="space-y-3">
              <PersonaResult
                profile={state.persona}
                onEnter={() => setMainTab('calendar')}
                onRetake={() => setView('persona')}
              />
              {/* V0-1：重看引导 —— 完整重走 标题→基本信息→问卷→结果→导入→模式（新旅程不再被 onboarded 藏起来） */}
              <div className="flex justify-end px-4 sm:px-6">
                <button
                  type="button"
                  data-testid="replay-onboarding"
                  onClick={() => { patchState({ onboarded: false }); setView('welcome'); }}
                  className="rounded-xl bg-white px-3 py-1.5 text-[12px] font-medium text-ink-soft ring-1 ring-ink/15 transition-colors hover:bg-slate-50"
                >
                  重看引导
                </button>
              </div>
            </div>
          ) : (
            <div className="content-shell panel px-6 py-16 text-center sm:px-10">
              <p className="section-label">PROFILE</p>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">让推荐更贴近你的节奏</h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-soft">完成画像后，梨宝会根据你的习惯提供更合适的学习、吃饭与休息建议。</p>
              <button onClick={() => setView('persona')} className="button-primary mt-7 px-6">开始画像测评</button>
            </div>
          )
        ) : weekMonday ? (
          <div className="space-y-3">
            {/* 课表 / 周计划 切换 */}
            <div className="flex items-center gap-1 rounded-xl border border-ink/10 bg-white p-1 w-fit">
              <button
                onClick={() => setWeekSubTab('timetable')}
                className={`nav-item whitespace-nowrap ${weekSubTab === 'timetable' ? 'nav-item-active' : ''}`}
              >
                课表
              </button>
              <button
                onClick={() => setWeekSubTab('plan')}
                className={`nav-item whitespace-nowrap ${weekSubTab === 'plan' ? 'nav-item-active' : ''}`}
              >
                周计划
              </button>
            </div>
            {weekSubTab === 'plan' ? (
              <WeekPlanView
                schedule={schedule}
                weekNo={weekNo}
                persona={state.persona}
                planState={state.planState}
                onPlanStateChange={(ps) => patchState({ planState: ps })}
                // 阶段 D：生活模式此前只影响配色，现在会真正改变排程强度
                // WP5：旧模式 id 在读取口归一（localStorage 里可能还存着 slack/food…）
                lifeMode={normalizeLifeMode(state.lifeMode)}
                onOpenModeSetup={() => setModeSetupOpen(true)}
              />
            ) : (
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
            )}
          </div>
        ) : (
          <OverviewPage
            schedule={schedule}
            weekNo={weekNo}
            todayIso={todayISO()}
            persona={state.persona}
            selectedDate={state.selectedDays[state.selectedDays.length - 1]}
            onOpenWeek={openWeek}
            onStartPersona={() => setView('persona')}
            onboardingCard={(
              <OnboardingChecklist
                hasSchedule={!!state.schedule}
                lifeMode={state.lifeMode}
                userDeadlineCount={loadUserDeadlines().length}
                onGotoImport={() => setMainTab('import')}
                onOpenModeSetup={() => setModeSetupOpen(true)}
                onGotoLibao={() => {
                  setLibaoSeed({ text: '帮我记一个重要日：', nonce: Date.now() });
                  setMainTab('libao');
                }}
              />
            )}
          />
        )}
      </main>

      {/* H2：模式问询窗口（确认 → patchState({ lifeMode })，buildPhases 链自动重排） */}
      {modeSetupOpen && (
        <ModeSetupDialog
          schedule={schedule}
          profile={state.persona}
          weekNo={weekNo}
          currentMode={state.lifeMode}
          onConfirm={(id) => { patchState({ lifeMode: id }); setModeSetupOpen(false); }}
          onClose={() => setModeSetupOpen(false)}
        />
      )}

      {!isLbaoTab && (
        <footer className="page-shell px-4 pb-8 pt-2 text-center text-[11px] font-medium tracking-[0.12em] text-ink-faint sm:px-6">
          UNIVERSITY OF SHANGHAI FOR SCIENCE AND TECHNOLOGY · 1906–2026
        </footer>
      )}
    </div>
  );
}
