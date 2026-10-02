import { readRaw, writeRaw } from '@/lib/persistence';
import { useEffect, useState, useCallback } from 'react';
import type { AnswerEntry, AppState, Schedule } from '@/types';
import { MOCK_SCHEDULE, normalizeLifeMode } from '@/data/usst';
import { buildProfile } from '@/lib/persona';
import { useAppState, saveState } from '@/lib/storage';
import { currentWeekNo, mondayOf, shiftWeekMonday, todayISO } from '@/lib/date';
import { hashOf, parseRoute, TAB_LABEL, type MainTab, type Route } from '@/lib/route';
import { Logo120 } from '@/components/Logo120';
import { Welcome } from '@/features/welcome/Welcome';
import { BasicInfoStep } from '@/features/welcome/BasicInfoStep';
import { initialView } from '@/features/welcome/basicInfo';
import { ModeSetupDialog } from '@/features/libao/ModeSetupDialog';
import { addTimetableFacts } from '@/lib/api';
import { OnboardingChecklist } from '@/features/onboarding/OnboardingChecklist';
import { loadUserDeadlines } from '@/features/calendar/deadlineStore';
import { loadBasicInfo, setAuthedUserId, getUserId, getDeviceUserId } from '@/lib/identity';
import { PersonaFlow } from '@/features/persona/PersonaFlow';
import { PersonaResult } from '@/features/persona/PersonaResult';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { GoalsPage } from '@/features/activity/GoalsPage';
import { addGoal, loadGoals, saveGoals, type Goal } from '@/features/activity/goalStore';
import { InterestAskDialog, INTEREST_ASK_DISMISSED_KEY } from '@/features/activity/InterestAskDialog';
import { interestAskHit } from '@/features/activity/goalTemplates';
import { WeekView } from '@/features/week/WeekView';
import { WeekPlanView } from '@/features/week/WeekPlanView';
import { OnboardingSetup } from '@/features/week/OnboardingSetup';
import { LbaoChat } from '@/features/libao/LbaoChat';
import { ImportTester } from '@/features/import/ImportTester';
import { fetchMe, migrateMemoryLedger, type AuthStatus } from '@/lib/auth';
import { AccountMenu, AccountOfflineMenu } from '@/features/auth/AccountMenu';
import { LoginPage } from '@/features/auth/LoginPage';
import { PersonaLab } from '@/lab/PersonaLab';

/**
 * onboarding 与主界面的视图层（三线融合 2026-10-01，裁决③）：
 * 欢迎 → **个人信息（含住处 / 作息）** → 问卷 → 画像结果 → 主界面（未导入课表先落导入页）。
 *
 * · 动线 = Ray 基础信息表单（住处三级联选 + 作息轮盘，`<BasicInfoStep>{children}</BasicInfoStep>`）
 *   → beta-v2 ModeSetupDialog（导入课表完成后自动弹出）→ beta-v2 画像 35 题；
 * · `basicinfo` 放在问卷之前：年级决定出卷范围（`buildPersonaSequence(grade)`）；
 * · 住处/作息都**不进画像**（问卷规格书 §6.1 禁语义污染），只是各存一份独立 store。
 */
type View = 'welcome' | 'basicinfo' | 'persona' | 'result' | 'main' | 'import';

/** WP12-H7：导入入口正式化 —— 正式构建也常驻（解析服务缺席时 ImportTester 自带降级提示，不白屏） */
const SHOW_IMPORT = true;

/**
 * P2-1（任务收口计划书 R3）：路由的纯函数层已抽到 `@/lib/route`
 * （`parseRoute` / `hashOf` / `Route` / `MainTab` / `TAB_LABEL`），抽出的目的是**可单测**
 * —— 本仓无 jsdom，只有把「读 hash」从「解析 hash」里剥出来，路由才测得了。
 *
 * 本组件自此只当**环境适配层**：读 `location.hash` 与 DEV 标志注入纯函数，
 * 再把 `hashchange` 回流成 state。**路由规则改在 `@/lib/route` 改，别在这儿加判断。**
 * （`tests/route.test.ts` 静态守着这一条：本文件里出现 `function parseRoute` 即红灯。）
 */
const readRoute = (): Route => parseRoute(window.location.hash, { showImport: SHOW_IMPORT });

/**
 * 是否提交过基础信息 —— 必填四项（称呼/年级/学院/校区）齐全才算数。
 * `loadBasicInfo()` 已做逐字段白名单校验，坏数据读出来就是空对象，天然判否。
 */
function hasBasicInfo(): boolean {
  const info = loadBasicInfo();
  return Boolean(info.nickname && info.grade && info.college && info.campus);
}

/**
 * 是否导入过**真实课表** —— beta-v2 V0-2（验收修正 2026-09-27）的引用判别口径：
 * `state.schedule` 会被 my_schedule effect 按引用种入 MOCK_SCHEDULE 作演示兜底，
 * 只比真值会让「首落点=导入」与 checklist 的导入项永远误判为已完成。
 * MOCK_SCHEDULE 自此**降级为演示兜底**，不再是默认落点（接线 B，2026-10-01）。
 */
function hasRealSchedule(state: AppState): boolean {
  return Boolean(state.schedule && state.schedule !== MOCK_SCHEDULE);
}

export default function App() {
  const { state, setState } = useAppState();
  // 冷启动落点闸门（`features/welcome/basicInfo.ts::initialView`，纯函数可单测）：
  // onboarded × hasBasicInfo × hasSchedule 三输入；未导入真实课表 → 落「导入课表」页。
  const [view, setView] = useState<View>(() =>
    initialView({
      onboarded: state.onboarded,
      hasBasicInfo: hasBasicInfo(),
      hasSchedule: hasRealSchedule(state),
    }),
  );
  const [route, setRoute] = useState<Route>(readRoute);

  /**
   * 账号门（持久化与账号系统实施规格书 §五）：
   * checking → 探测中；logged-out → 登录页；logged-in → 主应用；
   * offline（serve.py 未启动）→ 跳过登录照常运行（localStorage 模式，AC-4）。
   */
  const [auth, setAuth] = useState<{ status: AuthStatus | 'checking'; username: string | null }>({
    status: 'checking',
    username: null,
  });
  /** R批 P1-2（R1.1）：探测一次「我是谁」。抽成回调供 offline 占位菜单的
   *  「重试连接」复用 —— 重试不翻 checking 全屏（那会把界面闪成加载页），
   *  连接结果直接由账号门状态呈现：登录 → 主应用，未登录 → 登录页。 */
  const probeAuth = useCallback(() => {
    void fetchMe().then((a) => {
      setAuth(a);
      // 接线 A（2026-10-01）：登录态身份注入 —— user_id = 真账号；
      // 未登录 / offline → null，走随机设备 id 的既有降级路径。
      setAuthedUserId(a.status === 'logged-in' ? a.username : null);
    });
  }, []);
  useEffect(() => {
    probeAuth();
  }, [probeAuth]);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /** 导航 = 写 hash（同值赋值不产生历史记录也不触发事件，状态天然一致） */
  const navigate = (tab: MainTab, weekMonday: string | null = null) => {
    window.location.hash = hashOf(tab, weekMonday).slice(1);
  };

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
    const current = route.weekMonday ?? mondayOf(todayISO());
    const next = shiftWeekMonday(current, d);
    const n = currentWeekNo(schedule.termStart, next);
    if (n < 1 || n > schedule.totalWeeks) return; // 已在首/末周，不越界
    navigate('week', next);
  };

  // 窗口级键盘：← / → 切换上一周 / 下一周（仅当正在查看周计划时）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (route.tab !== 'week') return;
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
  }, [route.tab, route.weekMonday, schedule.termStart, schedule.totalWeeks]);

  // V0-3：checklist「加个重要日」→ 跳梨宝并预填提示（nonce 作 key，只在进入时注入一次）
  const [libaoSeed, setLibaoSeed] = useState<{ text: string; nonce: number } | null>(null);
  useEffect(() => {
    if (route.tab !== 'libao' && libaoSeed) setLibaoSeed(null); // 离开梨宝 tab 即清，防重挂载反复预填
  }, [route.tab, libaoSeed]);

  // H2：模式问询窗口（导入课表完成 / checklist「选个节奏」打开）
  const [modeSetupOpen, setModeSetupOpen] = useState(false);

  /** 周计划子视图：课表网格 vs 排程计划时间轴（beta-v2 E 批的呈现层，默认落「周计划」） */
  const [weekSubTab, setWeekSubTab] = useState<'timetable' | 'plan'>('plan');

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
    // 批次 5：画像完成 → 问卷命中比赛/长期目标兴趣 → 弹兴趣追问（可跳过，跳过不再弹）
    if (interestAskHit(state.answers ?? {}) && !readRaw(INTEREST_ASK_DISMISSED_KEY)) {
      setInterestAsk(true);
    }
  };

  /* ── 批次 5：兴趣追问弹窗（画像完成后一次性；模板量化一期） ── */
  const [interestAsk, setInterestAsk] = useState(false);
  const handleInterestConfirm = (g: Goal) => {
    saveGoals(addGoal(loadGoals(), g));
    setInterestAsk(false);
    // N2：兴趣弹窗确认 → 落到目标页（页面与使用逻辑规格书 §七）
    setView('main');
    navigate('goals');
  };
  const handleInterestSkip = () => {
    try { writeRaw(INTEREST_ASK_DISMISSED_KEY, '1'); } catch { /* 存不了就算了 */ }
    setInterestAsk(false);
  };

  /** 今天页 → 周计划页（定位到某一周） */
  const openWeek = (iso: string) => {
    setView('main');
    navigate('week', mondayOf(iso));
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
    const monday = route.weekMonday ?? mondayOf(todayISO());
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

  /** onboarding 完成后的落点（V0-2）：有真实课表 → `#/today`；没有 → `#/import` 引导上传 */
  const enterMain = () => {
    setView('main');
    navigate(hasRealSchedule(state) ? 'today' : 'import');
  };

  const goTab = (tab: MainTab, weekMonday: string | null = null) => {
    setView('main');
    navigate(tab, weekMonday);
  };

  /**
   * 🧪 临时诊断界面：画像 → 排程 的影响沙盒（**仅 DEV**，且只在 hash 精确等于
   * `#persona-lab` 时启用）。存在的唯一理由是「让画像改了什么肉眼可见」，
   * 验收完请连同 `src/lab/PersonaLab.tsx` 一起删除 —— 本处是全仓唯一的挂载点。
   */
  if (import.meta.env.DEV && window.location.hash === '#persona-lab') {
    return <PersonaLab />;
  }

  if (auth.status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-sm text-ink-faint">
        正在检查登录状态…
      </div>
    );
  }
  if (auth.status === 'logged-out') {
    return (
      <LoginPage
        onLoggedIn={(u) => {
          setAuth({ status: 'logged-in', username: u });
          // R7.1（P1-4）：离线期的设备台账 → 账号台账过户（CY 拍板「迁移合并」）。
          // ⚠️ 顺序要紧：**先取设备 id，再注入账号身份** —— setAuthedUserId 之后
          // getUserId 已经是账号名，设备台账就无处可寻了。异步搬梨宝记忆；
          // 失败静默 —— 迁移是尽力而为，绝不能挡住进入应用。
          const deviceId = getDeviceUserId();
          // 接线 A：登录成功即注入真账号身份（等 fetchMe 的下一次探测来不及）
          setAuthedUserId(u);
          if (deviceId) {
            void migrateMemoryLedger(deviceId, u).then((r) => {
              if (r.ok && r.moved > 0) console.info('[R7.1] 梨宝记忆已并入账号', r);
            });
          }
        }}
      />
    );
  }

  if (view === 'welcome') {
    return (
      <Welcome
        onStart={() => setView('basicinfo')}
        onSkip={enterMain}
        // R批 P1-2（R1.2）：引导页给「已有账号？去登录」—— 点击重试探测账号服务
        onRetryAuth={probeAuth}
      />
    );
  }

  /**
   * WP1：基础信息前置（客观事实：称呼/年级/学院/专业/校区 + **住处 + 作息**）。
   * 「住处 + 作息」由 `OnboardingSetup`（week 域）提供，经 children 注入同一张卡 ——
   * 本组件是**组合根**，本来就在 import `features/week/**`，这么接不会新增跨域依赖。
   *
   * 年级在这里收集，是因为它决定问卷出卷范围（裁决②：35 题全年级统一出卷）。
   */
  if (view === 'basicinfo') {
    return (
      <BasicInfoStep
        // 老账号只是「补齐基础信息」（画像已在）→ 存完直接回主界面，不让人重答一遍问卷；
        // 全新用户 → 接着走画像。
        onComplete={() => (state.onboarded ? enterMain() : setView('persona'))}
        onBack={() => setView('welcome')}
      >
        <OnboardingSetup />
      </BasicInfoStep>
    );
  }

  if (view === 'persona') {
    return (
      <PersonaFlow
        answers={state.answers ?? {}}
        onAnswer={setAnswer}
        // 问卷答完即出画像并落 onboarded（「住处/作息」已在前一步 basicinfo 采过）
        onComplete={handleComplete}
        onExit={() => setView('welcome')}
      />
    );
  }

  if (view === 'result' && state.persona) {
    return (
      <>
        <PersonaResult
          profile={state.persona}
          onEnter={enterMain}
          onRetake={() => setView('persona')}
        />
        {interestAsk && (
          <InterestAskDialog onConfirm={handleInterestConfirm} onSkip={handleInterestSkip} />
        )}
      </>
    );
  }

  // 主界面（view = 'main'；'import' 是「未导入课表」的引导落点 —— 同一套壳，强制落在导入页）
  const weekMonday = route.weekMonday ?? mondayOf(todayISO());
  const weekNo = currentWeekNo(schedule.termStart, weekMonday);
  /** 梨宝对话固定在视口内，只让消息列表承担滚动。 */
  const isLbaoTab = route.tab === 'libao';
  const effectiveTab: MainTab = view === 'import' ? 'import' : route.tab;
  const navTabs: MainTab[] = SHOW_IMPORT
    ? ['today', 'week', 'goals', 'profile', 'libao', 'import']
    : ['today', 'week', 'goals', 'profile', 'libao'];

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
            {navTabs.map((t) => (
              <button
                key={t}
                onClick={() => goTab(t)}
                aria-current={effectiveTab === t ? 'page' : undefined}
                className={`nav-item whitespace-nowrap ${effectiveTab === t ? 'nav-item-active' : ''}`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
            </div>
          </nav>
          {auth.status === 'offline' && (
            // R批 P1-2（R1.1/R1.3）：offline 也保留账号位 —— 点开有单机模式说明 + 重试连接。
            // 「功能做了但用户以为没做」的观感必须消除（CY 走查：右上没有账号菜单）。
            <AccountOfflineMenu onRetry={probeAuth} />
          )}
          {auth.status === 'logged-in' && auth.username && (
            <AccountMenu
              username={auth.username}
              onLoggedOut={() => {
                setAuth({ status: 'logged-out', username: null });
                // 接线 A：登出即回到随机设备 id 路径（未登录 = 维持现状）
                setAuthedUserId(null);
              }}
            />
          )}
        </div>
      </header>

      <main className={`page-shell flex-1 px-4 sm:px-6 ${isLbaoTab ? 'flex min-h-0 flex-col py-4' : 'py-6 sm:py-8'}`}>
        {/* 批 4.2（8B）：示例课表横幅 —— 新用户首启看到的是演示课表，必须告知与引导；
            导入成功（source 变更）后自然消失。（融合 2026-10-02：导航 API 取本壳的 goTab） */}
        {schedule.source === 'demo' && (
          <div
            data-testid="demo-schedule-banner"
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800"
          >
            <span>你现在的课表是<b>示例数据</b>，不是你的真实课表 —— 排程会按它来。</span>
            <button
              type="button"
              data-testid="demo-schedule-goto-import"
              onClick={() => goTab('import')}
              className="rounded-lg bg-white px-3 py-1 font-medium text-amber-800 ring-1 ring-amber-300 transition-colors hover:bg-amber-100"
            >
              去「课表」页导入 →
            </button>
          </div>
        )}
        {effectiveTab === 'import' ? (
          <ImportTester onApply={(s) => {
            patchState({ schedule: s });
            // H2（裁决③）：导入完成自动弹模式窗 —— 动线「导入课表 → ModeSetupDialog」
            setModeSetupOpen(true);
            // WP12-C2：课表事实回写（pending 态，MemoryPanel 可拒）；失败静默 —— 不挡导入主流程
            addTimetableFacts(s, getUserId()).catch(() => { /* 回写是锦上添花 */ });
          }} />
        ) : effectiveTab === 'libao' ? (
          <LbaoChat
            key={libaoSeed?.nonce ?? 'chat'}
            profile={state.persona}
            schedule={schedule}
            onGoProfile={() => setView('persona')}
            seedQuestion={libaoSeed?.text}
          />
        ) : effectiveTab === 'profile' ? (
          state.persona ? (
            <div className="space-y-3">
              <PersonaResult
                profile={state.persona}
                onEnter={() => goTab('today')}
                onRetake={() => setView('persona')}
              />
              {/* V0-1：重看引导 —— 完整重走 欢迎→个人信息（含住处/作息）→问卷→结果→导入→模式 */}
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
        ) : effectiveTab === 'goals' ? (
          <GoalsPage schedule={schedule} />
        ) : effectiveTab === 'week' ? (
          <div className="space-y-3">
            {/* 课表 / 周计划 切换（beta-v2 E 批：默认落「周计划」，课表网格随时切回） */}
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
                onShiftWeek={shiftWeekBy}
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
                onBack={() => goTab('today')}
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
            planState={state.planState}
            goals={loadGoals()}
            onOpenWeek={openWeek}
            onStartPersona={() => setView('persona')}
            onboardingCard={(
              <OnboardingChecklist
                hasSchedule={hasRealSchedule(state)}
                lifeMode={state.lifeMode}
                userDeadlineCount={loadUserDeadlines().length}
                onGotoImport={() => goTab('import')}
                onOpenModeSetup={() => setModeSetupOpen(true)}
                onGotoLibao={() => {
                  setLibaoSeed({ text: '帮我记一个重要日：', nonce: Date.now() });
                  goTab('libao');
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

      {interestAsk && (
        <InterestAskDialog onConfirm={handleInterestConfirm} onSkip={handleInterestSkip} />
      )}
    </div>
  );
}

/** 上一版实现里的 isoOf 保留给 selectWholeWeek（原实现原样搬入） */
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
