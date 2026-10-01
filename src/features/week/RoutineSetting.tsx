/**
 * 「我的作息」设置（Q1b / 问卷规格书 §2.5、§4-L1 第 1 条、§6.2）
 * ============================================================
 * 要解决的问题（规格书原话：「本次改版里性价比最高的一件事」）：
 * 引擎**早就支持**自定义每日窗口（`PlanRequest.dayStart` / `dayEnd` 是正式契约字段，
 * `construct.ts` 里 `?? '07:00'` / `?? '23:00'`），但 **UI 从未传过、问卷从未采过**
 * → 「四六级真题被排到 07:00 还没起床」那类问题的根因。
 *
 * ── 为什么独立成块，而不是塞进画像轴 ────────────────────────────
 * 规格书 §6.1 明令：不许把「几点起」塞进 0–100 的画像轴（语义污染）。
 * 语义上**性格是软倾向、作息是硬边界**，两者通道不同（§6.2 独立 store + 组装层翻译）。
 * 本组件与「🏠 我的住处」并列 —— 同样是「独立配置的硬边界」
 * （住处决定宿舍类块的地点，作息决定一天的起止），同一形制、同一位置。
 *
 * ── 两个入口，同一份数据 ───────────────────────────────────────
 * ① 首次设置「个人信息」那一步（`OnboardingSetup` 注入 `BasicInfoStep` 的选填字段）；
 * ② 周计划页工具面板（老用户随时改）。
 * 两处都渲染本组件，存储只走本组件的 `saveRoutine` —— 不会出现两个真源。
 *
 * ── 两种形态（2026-10-01）────────────────────────────────────
 *  · `embedded`：首次设置表单里的**一个字段**（标签 + 轮盘，无卡片外框/折叠开关），
 *    样式与同表其它字段同源（`@/components/ui/field`）；
 *  · 默认：周计划页工具面板里的可折叠卡片 —— 保持原样。
 *
 * ── 只收「起床 / 入睡」两条 ──────────────────────────────────
 * `routineStore` 里的 `weekdayDiffMin`（周末差）与 `napMin`（午休）是**预留字段**，
 * 消费口径尚未定（store 注释：「等 Q1b 上线后与 RAY 定 —— 不猜、不擅自接进引擎」）。
 * 采一个没人读、语义也没定的数，只会制造「填了没用」的困惑 ⟹ 保持 null，等口径定了再补 UI。
 *
 * ── 生效时机（不自动重排）────────────────────────────────────
 * 本组件只写 store，**不触发重排** —— 与「手动改完攒着、点『重新排一遍』」同一口径。
 * 组装层（`useWeekPlan`）在手动重排 / 重新挂载时重读 store，界面下方明说这一点。
 */
import { useState } from 'react';
import { TimeWheelPicker } from './TimeWheelPicker';
import { FIELD_HINT, FIELD_LABEL } from '@/components/ui/field';
import {
  clearRoutine, emptyRoutine, loadRoutine, minutesToHHMM,
  routineFromHHMM, routineToDayWindow, saveRoutine,
  type RoutineSettings,
} from './routineStore';

/** 未采集时界面上显示的缺省值 —— 与引擎 `construct.ts` 的 `?? '07:00' / ?? '23:00'` 同一口径 */
export const DEFAULT_WAKE = '07:00';
export const DEFAULT_SLEEP = '23:00';

/** 分钟数 → 展示用 `HH:mm`；未采集 → 缺省值 */
const asHHMM = (min: number | null, fallback: string): string =>
  min == null ? fallback : minutesToHHMM(min);

/** 拒绝原因 → 人话。**必须说清「为什么没保存」**，静默丢弃正是本特性要消灭的问题。 */
const PROBLEM_TEXT: Record<string, string> = {
  unparsable: '时间没看懂，这次没有保存。请用「小时:分钟」的样子，例如 07:30。',
  order: '起床时间得早于入睡时间，所以这次没有保存 —— 跨午夜的作息本版还表达不了，我不替你猜。',
};

interface Props {
  /** 默认展开（onboarding 阶段用得上；周计划页工具面板里默认收起，免得挤占版面） */
  defaultOpen?: boolean;
  /**
   * 表单内嵌形态：当作 `BasicInfoStep` 网格里的一个字段渲染
   * （无卡片外框、无折叠开关、无「当前：…」摘要 —— 轮盘本身就显示当前值）。
   */
  embedded?: boolean;
}

export function RoutineSetting({ defaultOpen = false, embedded = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  /** 已落盘的值 —— 下面那句「当前生效」永远只说**真的生效的那个**，不说草稿 */
  const [saved, setSaved] = useState<RoutineSettings>(() => loadRoutine());
  const [draft, setDraft] = useState(() => {
    const r = loadRoutine();
    return { wake: asHHMM(r.wakeMin, DEFAULT_WAKE), sleep: asHHMM(r.sleepMin, DEFAULT_SLEEP) };
  });
  const [problem, setProblem] = useState<string | null>(null);

  /** 引擎实际会用的窗口；null = 未采集（引擎走缺省） */
  const dayWindow = routineToDayWindow(saved);

  // 内嵌形态是「字段」，永远展开（字段不该需要用户先点一下才出现）
  const expanded = embedded || open;

  /** 改任一格就校验并落盘：合法立即存，不合法**留着草稿 + 说明原因**，store 保持上一个合法值 */
  const apply = (nextWake: string, nextSleep: string) => {
    setDraft({ wake: nextWake, sleep: nextSleep });
    const res = routineFromHHMM(nextWake, nextSleep);
    if (res.ok) {
      saveRoutine(res.routine);
      setSaved(res.routine);
      setProblem(null);
    } else {
      setProblem(PROBLEM_TEXT[res.reason]);
    }
  };

  const reset = () => {
    clearRoutine();
    setSaved(emptyRoutine());
    setDraft({ wake: DEFAULT_WAKE, sleep: DEFAULT_SLEEP });
    setProblem(null);
  };

  return (
    <div className={embedded ? 'block' : 'rounded-xl border border-ink/10 bg-white p-3'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={embedded ? FIELD_LABEL : 'text-[11.5px] font-medium text-ink'}>⏰ 我的作息</span>
        {!embedded && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded bg-white px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50"
          >
            {open ? '收起' : dayWindow ? '修改' : '＋ 设置'}
          </button>
        )}
      </div>

      {/* 卡片形态才需要这行摘要（内嵌形态的当前值由轮盘高亮直接表达） */}
      {!embedded && (
        <div className={FIELD_HINT}>
          {dayWindow ? (
            <>当前：{dayWindow.dayStart} 起床 · {dayWindow.dayEnd} 入睡 —— 引擎只在这段里排块</>
          ) : (
            <>未设置 —— 引擎按缺省 07:00–23:00 排块（早上 7 点被排上东西，多半就是这个原因）</>
          )}
        </div>
      )}

      {expanded && (
        <div className="mt-1.5 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className={embedded ? 'w-10 shrink-0 text-xs text-ink-faint' : 'w-14 shrink-0 text-[11.5px] text-ink-soft'}>起床</span>
            <TimeWheelPicker value={draft.wake} onChange={(v) => apply(v, draft.sleep)} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={embedded ? 'w-10 shrink-0 text-xs text-ink-faint' : 'w-14 shrink-0 text-[11.5px] text-ink-soft'}>入睡</span>
            <TimeWheelPicker value={draft.sleep} onChange={(v) => apply(draft.wake, v)} />
          </div>

          {problem && (
            <div className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-700/20">
              {problem}
            </div>
          )}

          {dayWindow && !problem && (
            <div className="text-[10.5px] leading-relaxed text-ink-faint">
              已保存：{dayWindow.dayStart}–{dayWindow.dayEnd}。改动会在下次「重新排一遍」或重新打开时生效。
            </div>
          )}

          {embedded && (
            <span className={FIELD_HINT}>引擎只在这段里排块；不填按缺省 07:00–23:00</span>
          )}

          <button
            type="button"
            onClick={reset}
            className="text-[10.5px] text-ink-faint hover:text-red-600"
          >
            清除作息（回到未设置）
          </button>
        </div>
      )}
    </div>
  );
}
