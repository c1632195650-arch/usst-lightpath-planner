/**
 * appFlow —— 引导动线的显式声明表（重构偿债 D3，r6，2026-10-24）
 * ============================================================
 * 来历：App.tsx 的 view 切换此前散在十余处 `setView('…')` 调用里，
 * 动线规则（谁能进哪步、退到哪、缺什么绕哪补）靠读代码反推——历史上
 * 因此出过「新账号绕过课表导入」的 bug（2026-10-08 修复：统一动线
 * `startPersonaOrOnboarding`）。本文件把那次修复的思路推广成**一张表**：
 * 页面顺序、进入条件、统一入口裁决、首落点裁决全部集中声明，
 * App.tsx 只做分发（查表 + setView），动线语义改动只动这里。
 *
 * 纪律：本表是**既有行为的如实转录**，不是重新设计——每条边都与
 * 2026-10-24 的 App.tsx 旧 if 链逐条对照过；tests/v3.test.ts 的动线锁
 * 与新增表驱动锁共同守护。
 */

/** 引导链上的五个视图（main 是链的终点，不属于引导步）。 */
export type OnboardingView = 'welcome' | 'basicinfo' | 'import' | 'persona' | 'result';
export type AppView = OnboardingView | 'main';

/** 动线裁决所需的上下文（App 侧计算，纯数据）。 */
export interface FlowContext {
  /** 有真实课表（非 MOCK 演示兜底）—— 老用户判定 */
  hasRealSchedule: boolean;
  /** 已填过基本信息（昵称在）—— 决定补引导时进 basicinfo 还是 import */
  hasBasicInfo: boolean;
  /** 已有画像结果 —— result 步的进入条件 */
  hasPersona: boolean;
}

/**
 * 引导链声明：每步的 next（正向）与 back（退出/回退）落点。
 * · welcome.back = 'main'：欢迎页「先浏览应用」不置 onboarded（刷新回欢迎页是
 *   正确语义——BLOCKERS 2026-09-27 CY 拍板维持）；
 * · import 是可跳过步：跳过与完成同去 persona（组件内部处理，表只声明正向）；
 * · persona.next = 'result' 由「完成问卷」（handleComplete）触发；onExit 回 welcome。
 */
export const VIEW_FLOW: Record<OnboardingView, { next: AppView; back: AppView }> = {
  welcome: { next: 'basicinfo', back: 'main' },
  basicinfo: { next: 'import', back: 'welcome' },
  import: { next: 'persona', back: 'basicinfo' },
  persona: { next: 'result', back: 'welcome' },
  result: { next: 'main', back: 'persona' },
};

/** 进入条件：result 必须有画像结果（App 旧 if 链 `view==='result' && state.persona` 的表化）。 */
export function canEnter(view: OnboardingView, ctx: FlowContext): boolean {
  if (view === 'result') return ctx.hasPersona;
  return true;
}

/**
 * 「开始画像测评」各入口的统一落点（2026-10-08 修复的表化，语义逐字保留）：
 * 没有真实课表 → 先补引导里缺的那步（无基本信息 → basicinfo；有 → import）；
 * 已有真实课表的老用户 → 直达问卷（重测场景）。
 */
export function startPersonaOrOnboardingView(ctx: FlowContext): OnboardingView {
  if (ctx.hasRealSchedule) return 'persona';
  return ctx.hasBasicInfo ? 'import' : 'basicinfo';
}

/**
 * 进主界面的首落点 tab（persona「跳过测评」与 result「进入应用」两处共用）：
 * 没导入过真实课表 → 直达「课表」tab（导入完成自动弹模式窗）；老用户 → 「总览」。
 * （V0-2 验收修正 2026-09-27：MOCK 演示兜底不算「已有课表」。）
 */
export function firstMainTab(ctx: FlowContext): 'calendar' | 'import' {
  return ctx.hasRealSchedule ? 'calendar' : 'import';
}
