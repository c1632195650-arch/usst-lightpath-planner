import { readRaw, writeRaw, removeRaw } from '@/lib/persistence';
import { useEffect, useState } from 'react';
import type { AnswerEntry, AppState, Schedule } from '@/types';
import { MOCK_SCHEDULE } from '@/data/usst';
import { buildProfile } from '@/lib/persona';
import { useAppState, saveState } from '@/lib/storage';
import { currentWeekNo, mondayOf, todayISO } from '@/lib/date';
import { hashOf, parseRoute, TAB_LABEL, type MainTab, type Route } from '@/lib/route';
import { Logo120 } from '@/components/Logo120';
import { Welcome } from '@/features/welcome/Welcome';
import { BasicInfoStep } from '@/features/welcome/BasicInfoStep';
import { ImportScheduleStep } from '@/features/welcome/ImportScheduleStep';
import { initialView } from '@/features/welcome/basicInfo';
import { loadBasicInfo } from '@/lib/identity';
import { PersonaFlow } from '@/features/persona/PersonaFlow';
import { PersonaResult } from '@/features/persona/PersonaResult';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { GoalsPage } from '@/features/activity/GoalsPage';
import { addGoal, loadGoals, saveGoals, type Goal } from '@/features/activity/goalStore';
import { InterestAskDialog, INTEREST_ASK_DISMISSED_KEY } from '@/features/activity/InterestAskDialog';
import { interestAskHit } from '@/features/activity/goalTemplates';
import { WeekPlanPage } from '@/features/week/WeekPlanPage';
import { OnboardingSetup } from '@/features/week/OnboardingSetup';
// 「作息与住处」卡（2026-10-07 从周计划页工具面板搬到「我的画像」页）
import { HardBoundaryCard } from '@/features/week/HardBoundaryCard';
import { LbaoChat } from '@/features/libao/LbaoChat';
import { ImportTester } from '@/features/import/ImportTester';
import { fetchMe, type AuthStatus } from '@/lib/auth';
import { AccountMenu } from '@/features/auth/AccountMenu';
import { LoginPage } from '@/features/auth/LoginPage';
import { PersonaLab } from '@/lab/PersonaLab';

/**
 * onboarding 的五个阶段：
 * 欢迎 → **个人信息（含住处 / 作息）** → **导入课表（可跳过）** → 问卷 → 画像结果 → 主界面。
 *
 * · `basicinfo` 放在问卷之前：年级决定出卷范围（`buildPersonaSequence(grade)`，
 *   WP2 题库分层），所以必须先有基础信息；
 * · 「导入课表」跟在基础信息后面（2026-10-07 RAY：别等进主界面看到样例后才
 *   能导）：课表不依赖画像，越早进来，画像结果页 / 今天页 / 周计划就越早围绕
 *   真实上课时间安排。整步**可跳过不阻塞**（弹窗三纪律同款），跳过之后随时在
 *   「课表」页 / dev 的「导入课表」页补导；
 * · 「住处 + 作息」原本是问卷之后的一个独立阶段（旧 `RoutineSetup`）。2026-09-28
 *   按拍板**合并成一步**：它们跟「你是谁」一样都是硬边界事实，没理由让用户分两次填 ——
 *   于是收进 `basicinfo` 同一张卡（`<BasicInfoStep>{children}</BasicInfoStep>`，
 *   子块由 week 域提供，避免 welcome → week 跨域 import）。
 * · 住处/作息都**不进画像**（问卷规格书 §6.1 禁语义污染），只是各存一份独立 store。
 */
type View = 'welcome' | 'basicinfo' | 'import' | 'persona' | 'result' | 'main';

/** 课表导入联调页只在开发环境出现，正式构建里 nav 不会有这个入口 */
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

export default function App() {
  const { state, setState } = useAppState();
  // F1（§4.1「刷新停在当前页」）：已 onboard 的老用户刷新直接进主界面，
  // 当前页由 hash 路由决定；首次用户仍从欢迎页开始（onboarding 不进路由）。
  // 旧实况是刷新永远落欢迎页 —— 与「刷新停在当前页」冲突，按规格书修。
  // 判定抽到 `features/welcome/basicInfo.ts` 的 `initialView()`（纯函数，可单测），
  // 本组件只做组合根该做的事（读 state + 读基础信息 → 注入两个布尔）。
  //
  // 2026-10-01：闸门从「只看 onboarded」改成「onboarded + 是否填过基础信息」。
  // 起因：注册 / 并入新账号后 `onboarded=true`，但基础信息那一步在旧数据里
  // 根本不存在（它是后加的），于是落点被直接判成 main —— 基础信息界面再也见不到。
  const [view, setView] = useState<View>(() =>
    initialView({ onboarded: state.onboarded, hasBasicInfo: hasBasicInfo() }),
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
  useEffect(() => {
    void fetchMe().then(setAuth);
  }, []);

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
    navigate('goals');
  };
  const handleInterestSkip = () => {
    try { writeRaw(INTEREST_ASK_DISMISSED_KEY, '1'); } catch { /* 存不了就算了 */ }
    setInterestAsk(false);
  };

  /** 今天页 → 周计划页（定位到某一周） */
  const openWeek = (iso: string) => {
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
    const monday = mondayOf(todayISO());
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

  /** onboarding 完成后的落点 = `#/today`（§2.1：欢迎页/问卷/结果不进路由，落 today） */
  const enterMain = () => {
    setView('main');
    navigate('today');
  };

  /**
   * 🧪 临时诊断界面：画像 → 排程 的影响沙盒（**仅 DEV**，且只在 hash 精确等于
   * `#persona-lab` 时启用）。存在的唯一理由是「让画像改了什么肉眼可见」，
   * 验收完请连同 `src/lab/PersonaLab.tsx` 一起删除 —— 本处是全仓唯一的挂载点。
   *
   * 为什么绕开路由（`lib/route.ts` / `MainTab`）：它是 dev 工具，不该进产品的
   * 穷尽映射表，也不该出现在任何导航里。放在这里 = 一个可整块摘除的开关。
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
        onLoggedIn={(u) => setAuth({ status: 'logged-in', username: u })}
      />
    );
  }

  if (view === 'welcome') {
    return (
      <Welcome
        onStart={() => setView('basicinfo')}
        onSkip={enterMain}
      />
    );
  }

  /**
   * WP1：基础信息前置（客观事实：称呼/年级/学院/专业/校区 + **住处 + 作息**）。
   * 「住处 + 作息」由 `OnboardingSetup`（week 域）提供，经 children 注入同一张卡 ——
   * 本组件是**组合根**，本来就在 import `features/week/**`，这么接不会新增跨域依赖。
   *
   * 年级在这里收集，是因为它决定问卷出卷范围（WP2 题库分层）。
   */
  if (view === 'basicinfo') {
    return (
      <BasicInfoStep
        // 老账号只是「补齐基础信息」（画像已在）→ 存完直接回主界面，不让人重答一遍问卷；
        // 全新用户 → 先给一次导入课表的机会（可跳过），再进问卷。
        onComplete={() => (state.onboarded ? enterMain() : setView('import'))}
        onBack={() => setView('welcome')}
      >
        <OnboardingSetup />
      </BasicInfoStep>
    );
  }

  /**
   * 导入课表（2026-10-07 新增引导步，RAY：「一开始就在个人信息后提供导入窗口」）。
   * 可跳过 —— 跳过与完成同去问卷；解析服务不在时界面明说 + 保留跳过出口。
   * 已有真实课表时重导 = 覆盖，组件内会提前一句话告知。
   */
  if (view === 'import') {
    return (
      <ImportScheduleStep
        existingCourseCount={
          state.schedule && state.schedule.source !== 'demo' ? state.schedule.courses.length : 0
        }
        onApply={(s) => patchState({ schedule: s })}
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
        // 问卷答完即出画像并落 onboarded（「住处/作息」已在前一步 basicinfo 采过）
        onComplete={handleComplete}
        onExit={() => setView('welcome')}
        /*
         * 「暂时跳过测评」= **跳过整份问卷**，直接进入 App（RAY 2026-10-07 拍板）。
         *
         * 🔴 必须**落 `onboarded`**，不能只 `enterMain()`：
         *    冷启动闸门 `initialView` 是 `!onboarded → 'welcome'`，而 `onboarded`
         *    原先只有答完问卷（`handleComplete`）才置真 ⟹ 只切视图的话，
         *    **刷新一次就被弹回欢迎页**，用户会以为"跳过根本没生效"。
         *    （欢迎页那颗「先浏览应用」就是这种「不落盘」的写法，同一个坑的另一半。）
         *
         * 画像**留空**（`state.persona` 保持 null）—— 引擎本就支持：
         * `buildPhases.applyPersona` 在没有画像时给保守默认值，并在理由里写明
         * 「还没有画像，先用保守的默认值」。之后随时可在「我的画像」页
         * （`state.persona` 为 null 时渲染的那张卡）用「开始画像测评」补测。
         *
         * 已答的题**保留**在 `state.answers` 里（不清空）—— "暂时"跳过，回来能接着答。
         * 不新增存储字段：`types.ts` 契约锁死，`onboarded` 语义本就是"引导流程结束"。
         */
        onSkipAll={() => { patchState({ onboarded: true }); enterMain(); }}
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

  // 主界面
  /** 梨宝对话固定在视口内，只让消息列表承担滚动。 */
  const isLbaoTab = route.tab === 'libao';
  const navTabs: MainTab[] = SHOW_IMPORT
    ? ['today', 'week', 'goals', 'profile', 'libao', 'import']
    : ['today', 'week', 'goals', 'profile', 'libao'];

  return (
    <div className={`flex flex-col bg-paper ${isLbaoTab ? 'h-dvh overflow-hidden' : 'min-h-screen'}`}>
      {/* 紧凑导航把主要空间留给日程与对话内容。 */}
      {/*
        顶栏（「今天 / 周计划 / 目标 / 我的画像 / 梨宝」）—— 应用外壳，必须**盖住一切页面内容**。
        🔴 z 从 `z-20` 抬到 `z-[38]`（2026-10-08 修 RAY：「下滑后 周一~周日 那行把顶栏遮掉」）：
           周计划时间轴的**吸顶列头带**是 `sticky top-0 z-[35]`（它还必须在块 hover 的
           `z-30` 之上，否则块会盖住它）—— 而顶栏只有 `z-20` ⟹ 页面下滑、时间轴面板
           钻到顶栏下方时，**列头带反而盖在了顶栏上**。
           z 阶梯（本仓约定，改动前先看这张表）：
             z-10/20 页面内容 · z-30 块 hover · **z-[35] 时间轴吸顶列头带**
             · **z-[38] 顶栏** · z-40 对话框 · z-50 块浮卡/右键菜单 · z-[60] toast
           所以顶栏落在 35 与 40 之间：盖住列头带，又被对话框和 toast 盖住。
      */}
      <header className="sticky top-0 z-[38] shrink-0 border-b border-ink/[0.07] bg-paper/85 backdrop-blur-xl">
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
                onClick={() => navigate(t)}
                aria-current={route.tab === t ? 'page' : undefined}
                className={`nav-item whitespace-nowrap ${route.tab === t ? 'nav-item-active' : ''}`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
            </div>
          </nav>
          {auth.status === 'logged-in' && auth.username && (
            <AccountMenu
              username={auth.username}
              onLoggedOut={() => setAuth({ status: 'logged-out', username: null })}
            />
          )}
        </div>
      </header>

      <main className={`page-shell flex-1 px-4 sm:px-6 ${isLbaoTab ? 'flex min-h-0 flex-col py-4' : 'py-6 sm:py-8'}`}>
        {route.tab === 'import' ? (
          <ImportTester onApply={(s) => patchState({ schedule: s })} />
        ) : route.tab === 'libao' ? (
          <LbaoChat
            profile={state.persona}
            schedule={schedule}
            onGoProfile={() => setView('persona')}
          />
        ) : route.tab === 'profile' ? (
          state.persona ? (
            <div className="space-y-3">
              <PersonaResult
                profile={state.persona}
                onEnter={() => navigate('today')}
                onRetake={() => setView('persona')}
              >
                {/* 「作息与住处」修改入口（2026-10-07 自周计划页搬来）：
                    由**组合根**注入，避免 persona → week 跨域 import（AC-6·R5 只许缩短）。
                    手法与下面 basicinfo 分支注入 OnboardingSetup 完全一致。 */}
                <HardBoundaryCard />
              </PersonaResult>
              {/*
                引导重看入口（WP1 落地时补，设计取自 beta-v2 的 V0-1）：
                已 onboard 的用户 `initialView` 直接进 main，**新加的「个人信息」这一步
                会被 onboarded 永久藏起来** —— 没有这个入口，新流程对老用户不可达，
                验收时也会误判成「改了没效果」。
                点它 = 把 onboarded 置回 false 并回到欢迎页，完整重走
                欢迎 → 个人信息（含住处/作息） → 问卷 → 结果。
              */}
              <div className="flex justify-end">
                <button
                  type="button"
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
        ) : route.tab === 'goals' ? (
          <GoalsPage schedule={schedule} />
        ) : route.tab === 'week' ? (
          // weekMonday 的所有权在周计划页（§2.2）；路由只镜像 `#/week/<ISO>` 供深链/前进后退
          <WeekPlanPage
            schedule={schedule}
            weekMonday={route.weekMonday}
            onWeekMondayChange={(m) => navigate('week', m)}
            persona={state.persona}
            planState={state.planState}
            onPlanStateChange={(ps) => patchState({ planState: ps })}
            selectedDays={state.selectedDays}
            onToggleDay={toggleDay}
            onSelectWholeWeek={selectWholeWeek}
            onClearDays={() => patchState({ selectedDays: [] })}
            // 「画像影响排程 → 去改画像」：路由由组合根持有，组件不自己碰
            onGoProfile={() => setView('persona')}
          />
        ) : (
          <OverviewPage
            schedule={schedule}
            weekNo={currentWeekNo(schedule.termStart)}
            todayIso={todayISO()}
            persona={state.persona}
            planState={state.planState}
            goals={loadGoals()}
            onOpenWeek={openWeek}
            onStartPersona={() => setView('persona')}
          />
        )}
      </main>

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
