import { useEffect, useState } from 'react';
import type { AnswerEntry, AppState, DayOfWeek, Schedule } from '@/types';
import { MOCK_SCHEDULE, normalizeLifeMode } from '@/data/usst';
import { buildProfile } from '@/lib/persona';
import { useAppState, saveState } from '@/lib/storage';
import { currentWeekNo, diffDays, mondayOf, shiftWeekMonday, todayISO } from '@/lib/date';
import { LightpathMark, LightpathWordmark } from '@/components/LightpathMark';
import { Icon } from '@/components/icons/Icon';
import type { IconName } from '@/components/icons/Icon';
import { Welcome } from '@/features/welcome/Welcome';
import { BasicInfoStep } from '@/features/welcome/BasicInfoStep';
import { ImportScheduleStep } from '@/features/welcome/ImportScheduleStep';
import { initialView } from '@/features/welcome/basicInfo';
import { ModeSetupDialog } from '@/features/libao/ModeSetupDialog';
import { addTimetableFacts } from '@/lib/api';
import { OnboardingChecklist } from '@/features/onboarding/OnboardingChecklist';
import { loadUserDeadlines } from '@/features/calendar/deadlineStore';
import { getUserId } from '@/lib/identity';
import { installWebSyncHook } from '@/features/mobile/lib/webSync';
import { loadIdentity, type MobileIdentity } from '@/features/mobile/lib/auth';
import CloudAccountCard from '@/features/cloudSync/CloudAccountCard';
import AccountChip from '@/features/cloudSync/AccountChip';
import { PersonaFlow } from '@/features/persona/PersonaFlow';
import { PersonaResult } from '@/features/persona/PersonaResult';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { WeekPlanView } from '@/features/week/WeekPlanView';
import { FocusDaysPanel } from '@/features/week/FocusDaysPanel';
import { WeekTimetable } from '@/features/week/WeekTimetable';
import { HardBoundaryCard } from '@/features/week/HardBoundaryCard';
import { LbaoChat } from '@/features/libao/LbaoChat';
import { LbaoLauncher } from '@/features/libao/LbaoLauncher';
import { ImportTester } from '@/features/import/ImportTester';
import { GoalsPage } from '@/features/activity/GoalsPage';
import MemoPanel from '@/features/memo/MemoPanel';
import { SettingsPanel } from '@/features/settings/SettingsPanel';

type View = 'welcome' | 'basicinfo' | 'import' | 'persona' | 'result' | 'main';
type MainTab = 'calendar' | 'libao' | 'memo' | 'goals' | 'profile' | 'import';

/** WP12-H7：导入入口正式化 —— 正式构建也常驻（解析服务缺席时 ImportTester 自带降级提示，不白屏） */
const SHOW_IMPORT = true;

/** Navigation copy stays close to the shell so development-only entries cannot drift from their labels. */
const TAB_LABEL: Record<MainTab, string> = {
  calendar: '总览',
  libao: '梨宝',
  memo: '待办',
  goals: '目标',
  profile: '我的画像',
  import: '课表',
};

/** §9.6 B 组：导航每项配图标（md 档），当前项随激活态同色。 */
const TAB_ICON: Record<MainTab, IconName> = {
  calendar: 'dashboard',
  libao: 'sparkle',
  memo: 'inbox',
  goals: 'target',
  profile: 'user-round',
  import: 'calendar-days',
};

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function App() {
  const { state, setState } = useAppState();
  const [view, setView] = useState<View>(() => initialView(state.onboarded));
  const [mainTab, setMainTab] = useState<MainTab>('calendar');
  const [weekMonday, setWeekMonday] = useState<string | null>(null);
  // W3/P1-5d：总览点某天 → 进「日程」并高亮该天；点「总览」tab 清掉
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  // H2：模式问询窗口（导入课表完成 / 周计划「换个节奏」打开）
  const [modeSetupOpen, setModeSetupOpen] = useState(false);
  // V0-3：checklist「加个重要日」→ 跳梨宝并预填提示（nonce 作 key，只在进入时注入一次）
  const [libaoSeed, setLibaoSeed] = useState<{ text: string; nonce: number } | null>(null);
  useEffect(() => {
    if (mainTab !== 'libao' && libaoSeed) setLibaoSeed(null); // 离开梨宝 tab 即清，防重挂载反复预填
  }, [mainTab, libaoSeed]);

  // F8 网页端云同步观察者（BLOCKERS#3 白天接线）：开关默认关（usst.mobile.cloudSync!=='1'
  // 时零网络，tests/syncContract.test.ts 有锁），登录后由移动页写入开关与身份。
  // 2026-10-06 假联通修复：identity 进 state —— 登录/登出会重装钩子，修掉「挂载时
  // 快照 token、后登录永远 no-token」的静默断点（审计断点⑤）。
  const [identity, setIdentity] = useState<MobileIdentity | null>(() => loadIdentity());
  useEffect(() => installWebSyncHook({ identity }), [identity]);

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
    setFocusedDay(iso); // P1-5d：点的那天要被看见
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
        // 必修 2：onboarding 阶段就给登录入口（不登录也完全不影响本地使用）
        footer={<CloudAccountCard identity={identity} onIdentityChange={setIdentity} />}
      />
    );
  }

  if (view === 'basicinfo') {
    // 全新用户 → 先给一次导入课表的机会（可跳过），再进问卷（2026-10-07 RAY 新增引导步）。
    return <BasicInfoStep onBack={() => setView('welcome')} onComplete={() => setView('import')} />;
  }

  /**
   * 导入课表（2026-10-07 RAY 新增引导步，本树接入）。
   * 位置 = 基础信息之后、问卷之前 —— 课表不依赖画像，越早进来，
   * 画像结果页 / 总览 / 周计划就越早围绕真实上课时间安排（原先要进主界面
   * 看到样例后才能绕到「课表」页）。整步**可跳过不阻塞**：跳过与完成同去问卷；
   * 解析服务不在时界面明说 + 保留跳过出口（ImportScheduleStep 内部处理）。
   */
  if (view === 'import') {
    return (
      <ImportScheduleStep
        existingCourseCount={
          state.schedule && state.schedule.source !== 'demo' ? state.schedule.courses.length : 0
        }
        onApply={(s) => {
          patchState({ schedule: s });
          // WP12-C2：课表事实回写（与「课表」页导入同一条通道）；失败静默 —— 不挡引导流
          addTimetableFacts(s, getUserId()).catch(() => { /* 回写是锦上添花 */ });
        }}
        onNext={() => setView('persona')}
        onBack={() => setView('basicinfo')}
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
        // 「暂时跳过测评」= **跳过整份问卷**，直接进入 App（2026-10-07 RAY 拍板）。
        // 必须**落 `onboarded`**：冷启动闸门 `initialView` 在 !onboarded 时永远回欢迎页，
        // 只切视图的话刷新一次就被弹回去（用户会以为"跳过根本没生效"）。
        // 画像留空 —— 引擎本就支持（保守默认值），画像页随时可用「开始画像测评」补测。
        onSkipAll={() => {
          patchState({ onboarded: true });
          setView('main');
          setMainTab(state.schedule && state.schedule !== MOCK_SCHEDULE ? 'calendar' : 'import');
        }}
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
          // V0-2（验收修正 2026-09-27）：MOCK 演示兜底不算「已有课表」——
          // state.schedule 会被 :76 的 effect 按引用种入 MOCK_SCHEDULE，
          // 只比真值会让「首落点=导入」与 checklist 的导入项永远误判为已完成。
          setMainTab(state.schedule && state.schedule !== MOCK_SCHEDULE ? 'calendar' : 'import');
        }}
        onRetake={() => setView('persona')}
      />
    );
  }

  // 主界面
  const weekNo = weekMonday ? currentWeekNo(schedule.termStart, weekMonday) : currentWeekNo(schedule.termStart);
  // W6-A（CY 拍板「A 硬约束」）：FOCUS DAYS 从「只上色」变成真约束 ——
  // 选中日（ISO）∩ 当前查看周 → 星期几 1-7 传引擎；本周外的日期不误伤（S3）。
  // 空选中 = 无约束（整周照常，S1）。
  const focusDays: DayOfWeek[] = weekMonday
    ? [...new Set(state.selectedDays
        .map((iso) => diffDays(weekMonday, iso) + 1)
        .filter((n): n is DayOfWeek => n >= 1 && n <= 7))]
    : [];
  /** 梨宝对话固定在视口内，只让消息列表承担滚动。 */
  const isLbaoTab = mainTab === 'libao';

  return (
    <div className={`flex flex-col bg-paper ${isLbaoTab ? 'h-dvh overflow-hidden' : 'min-h-screen'}`}>
      {/* 紧凑导航把主要空间留给日程与对话内容。 */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-ink/[0.07] bg-paper/85 backdrop-blur-xl">
        <div className="page-shell flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:flex-nowrap sm:px-6">
          {/* UI v2 收口（设计总成 §00 根问题 / §1.4 字标）：顶栏此前只有产品描述名，
              全站唯一的品牌署名位置看不到「光溯」。此处换成字标 —— 与移动端欢迎页
              （MobileWelcome h1「光溯」）、欢迎页 kicker「USST · LIGHTPATH」同一套口径。 */}
          <LightpathMark tone="plate" size={32} />
          {/* S1a：账号 chip 在 Logo 右侧标题行（左上角区域，CY 反馈④）；窄屏 flex-wrap 自然换行 */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 leading-tight">
            <LightpathWordmark tone="ink" size="sm" />
            <AccountChip identity={identity} onIdentityChange={setIdentity} />
          </div>
          <nav className="order-3 -mx-4 flex w-[calc(100%+2rem)] overflow-x-auto border-t border-ink/10 px-4 pt-3 sm:order-none sm:mx-0 sm:w-auto sm:border-0 sm:p-0" aria-label="主导航">
            <div className="flex min-w-max items-center gap-1 rounded-xl border border-ink/10 bg-white p-1">
            {((SHOW_IMPORT ? ['calendar', 'libao', 'memo', 'goals', 'profile', 'import'] : ['calendar', 'libao', 'memo', 'goals', 'profile']) as MainTab[]).map((t) => (
              <button
                key={t}
                // 验收修正（2026-09-27）：「总览」tab 回归字面语义 —— 进入过周计划后
                // 点「总览」必须能回总览页（onboarding checklist 卡在那里），否则卡被
                // 周计划劫持埋掉（E2E 走查抓到）。周计划从总览页「打开本周安排」再进。
                onClick={() => {
                  setMainTab(t);
                  // 总览 tab 回归字面语义（见下）；进总览/画像时清周定位
                  if (t === 'calendar') { setWeekMonday(null); setFocusedDay(null); }
                  else if (t === 'profile') setWeekMonday(null);
                }}
                className={`nav-item inline-flex items-center gap-1.5 whitespace-nowrap ${mainTab === t ? 'nav-item-active' : ''}`}
              >
                <Icon name={TAB_ICON[t]} size="md" className="shrink-0" />
                {TAB_LABEL[t]}
              </button>
            ))}
            </div>
          </nav>
        </div>
      </header>

      {/* §5.4 同级切换：Tab 之间淡入 + 8px 位移（220ms ease-out）。
          key 只跟 mainTab 走 —— Tab 内容本来就是条件渲染（切 Tab 必然重挂载），
          加 key 不会额外重置任何状态；换周/换视图不走这里，避免打断周计划的会话状态。 */}
      <main
        key={mainTab}
        className={`page-shell view-enter flex-1 px-4 sm:px-6 ${isLbaoTab ? 'flex min-h-0 flex-col py-4' : 'py-6 sm:py-8'}`}
      >
        {/* 批 4.2（8B）：示例课表横幅 —— 新用户首启看到的是演示课表，必须告知与引导；
            导入成功（source 变更）后自然消失 */}
        {schedule.source === 'demo' && (
          <div
            data-testid="demo-schedule-banner"
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/30 bg-warn-light px-4 py-2.5 text-[12px] text-warn-text"
          >
            <span>你现在的课表是<b>示例数据</b>，不是你的真实课表 —— 排程会按它来。</span>
            <button
              type="button"
              data-testid="demo-schedule-goto-import"
              onClick={() => setMainTab('import')}
              className="rounded-lg bg-white px-3 py-1 font-medium text-warn-text ring-1 ring-warn/30 transition-colors hover:bg-warn-light"
            >
              去「课表」页导入 →
            </button>
          </div>
        )}
        {mainTab === 'memo' ? (
          // 任务四（2026-10-06）：网页端待办工作区 —— 云同步数据与移动端共库（逐项 LWW）
          // S3b：传排程锚点 + 「日程」页出口，待办→日程的闭环可见（CY 反馈③）
          <MemoPanel
            planAnchor={{ termStart: schedule.termStart, weekNo: currentWeekNo(schedule.termStart) }}
            onGotoPlan={() => openWeek(todayISO())}
          />
        ) : mainTab === 'import' ? (
          <ImportTester onApply={(s) => {
            patchState({ schedule: s });
            setModeSetupOpen(true);
            // WP12-C2：课表事实回写（pending 态，MemoryPanel 可拒）；失败静默 —— 不挡导入主流程
            addTimetableFacts(s, getUserId()).catch(() => { /* 回写是锦上添花 */ });
          }} />
        ) : mainTab === 'goals' ? (
          /* 目标页（Ray c5295b9 批次落点）：一句话输入 + 目标卡片 + 后补截止日期（分段输入）
             + 里程碑/监控/优先级 + 成就统计。本树此前无目标管理页，随批接入。 */
          <GoalsPage schedule={schedule} />
        ) : mainTab === 'libao' ? (
          <LbaoChat
            key={libaoSeed?.nonce ?? 'chat'}
            profile={state.persona}
            schedule={schedule}
            onGoProfile={() => setView('persona')}
            seedQuestion={libaoSeed?.text}
          />
        ) : mainTab === 'profile' ? (
          // S1b（CY 反馈④⑤）：画像页底部那份 CloudAccountCard 已删 —— 账号入口唯一化到顶栏
          // chip（S1a）；Welcome footer 那份保留（onboarding 阶段没有顶栏）。
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
                  className="rounded-xl bg-white px-3 py-1.5 text-[12px] font-medium text-ink-soft ring-1 ring-ink/15 transition-colors hover:bg-paper"
                >
                  重看引导
                </button>
              </div>
              {/* 2026-10-08：硬边界卡（我的作息）——从周页迁来（Ray 40a57ea 设计） */}
              <HardBoundaryCard />
              {/* UI v2 D5：设置面板（分组列表行上直显当前值；真实状态源，无占位行） */}
              <div className="px-4 pb-4 sm:px-6">
                <SettingsPanel />
              </div>
            </div>
          ) : (
            <div className="content-shell space-y-3">
              <div className="panel px-6 py-16 text-center sm:px-10">
                <p className="section-label">PROFILE</p>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">让推荐更贴近你的节奏</h1>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-soft">完成画像后，梨宝会根据你的习惯提供更合适的学习、吃饭与休息建议。</p>
                <button onClick={() => setView('persona')} className="button-primary mt-7 px-6">
                  <span className="inline-flex items-center gap-1.5">
                    开始画像测评
                    <Icon name="arrow-right" size="sm" />
                  </span>
                </button>
              </div>
              {/* 2026-10-08：硬边界卡（我的作息）——不依赖画像，未完成画像时同样可设 */}
              <HardBoundaryCard />
              {/* UI v2 D5：画像未完成时设置同样可达（真实状态源不依赖画像） */}
              <SettingsPanel />
            </div>
          )
        ) : weekMonday ? (
          <div className="space-y-3">
            {/* W3/P1-5a（CY 反馈③/S4-1）：课表/周计划两个并列窗口收敛为单一「日程」页 ——
                子标签已删；FOCUS DAYS 置顶（P1-5b.1），课表降为底部默认折叠的只读块（P1-5b.3）。 */}
            <FocusDaysPanel
              weekMonday={weekMonday}
              selectedDays={state.selectedDays}
              focusedDay={focusedDay}
              onToggleDay={toggleDay}
              onSelectWholeWeek={selectWholeWeek}
              onClearDays={() => patchState({ selectedDays: [] })}
            />
            <WeekPlanView
              schedule={schedule}
              weekNo={weekNo}
              persona={state.persona}
              planState={state.planState}
              onPlanStateChange={(ps) => patchState({ planState: ps })}
              // 阶段 D：生活模式此前只影响配色，现在会真正改变排程强度
              // WP5：旧模式 id 在读取口归一（localStorage 里可能还存着 slack/food…）
              lifeMode={normalizeLifeMode(state.lifeMode)}
              onShiftWeek={shiftWeekBy}
              /* 2026-10-08（CY 截图裁决）：操作条按 Ray 设计收敛 —— 返回总览由顶栏
                 「总览」tab 承担；「换个节奏」入口保留在总览 checklist 与导入完成弹窗。 */
              onGoToToday={() => setWeekMonday(null)}
              activeDays={focusDays}
            />
            {/* P1-5b.3：本块是单点可删的 —— CY 若说连折叠块也不要，删这一个 <details> 即可 */}
            <details data-testid="week-timetable-details" className="panel px-4 py-3 sm:px-5">
              <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">本周课表（只读）</summary>
              <div className="mt-3">
                <WeekTimetable schedule={schedule} weekNo={weekNo} />
              </div>
            </details>
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
                hasSchedule={!!state.schedule && state.schedule !== MOCK_SCHEDULE}
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
          {/* B2 彩蛋：校训小字，装饰性、纯事实（上理校训），可整体拔掉 */}
          <span className="mt-1 block text-[11px] font-normal tracking-[0.18em] text-ink-faint">
            信义勤爱 · 思学志远
          </span>
        </footer>
      )}

      {/* UI v2 D6：梨宝常驻呼出（主界面任意 Tab 右下角；点击 = 切梨宝 Tab=全屏态，
          复用既有对话壳；梨宝 Tab 自身不显示 launcher——已在全屏态） */}
      {isLbaoTab ? null : <LbaoLauncher onClick={() => setMainTab('libao')} />}
    </div>
  );
}
