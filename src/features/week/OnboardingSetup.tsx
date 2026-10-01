/**
 * 首次设置 · 住处与作息（2026-09-28 起并入「个人信息」那一步）
 * ============================================================
 * 位置：「先让梨宝认识你」（`features/welcome/BasicInfoStep.tsx`）那张表单**网格里**，
 * 作为必填事实之后的两个选填字段 —— 走 `BasicInfoStep` 的 `children` 插槽注入。
 *
 * ── 为什么由 App（组合根）注入，而不是 BasicInfoStep 直接 import ─────
 * 住处/作息两个编辑器属 B 侧（`features/week/**`）。若 `features/welcome/**`
 * 反向 import 它，就会新增 `welcome -> week` 的跨域依赖；架构护栏
 * （`tests/arch-guards.test.ts` AC-6·R5）把跨域域对冻结为**只许缩短**。
 * 于是这段组合落在组合根 `App.tsx`（它本来就 import `features/week/WeekPlanPage`）：
 *   `<BasicInfoStep …><OnboardingSetup /></BasicInfoStep>`
 * `BasicInfoStep` 只认得一个 `ReactNode`，对 week 域一无所知。
 *
 * ── 输出的是「网格里的格子」，不是「表单下面的一栏」（2026-10-01 修订）──
 * RAY 原话：「前端需要按统一风格并入，而不是单独的一栏」。
 * 所以本组件返回**一个 fragment**（不是带边框的 `<section>`），里面两项由
 * `embedded` 形态的 `HomeBaseSetting` / `RoutineSetting` 直接充当 `<BasicInfoStep>`
 * 网格的子项 —— 与「称呼」「年级」同宽同款（样式统一由 `@/components/ui/field` 定义）。
 * ⚠️ 依赖 React fragment 不生成 DOM 节点：片段里的两个 `<div>` 会**直接成为网格子项**。
 *
 * ── 与「周计划页工具面板」的关系（两处入口、同一份数据）───────────
 * 住处写 `userPlanStore` 的 `layer.homeBase`；作息写 `routineStore`。
 * 本组件只是 `HomeBaseSetting` / `RoutineSetting` 的组合外壳，自己不碰存储 ——
 * 所以「首次设置里存的」与「面板里改的」必然是同一份（有单测守着）。
 *
 * ── 都可跳过，且跳过是完全安全的 ───────────────────────────────
 * 不填 = 作息走引擎缺省 07:00–23:00、住处留空（宿舍类块不猜地点）。
 * 理由同 `RoutineSetting` 头注：语义上性格是软倾向、作息与住处是硬边界，通道不同。
 */
import { HomeBaseSetting } from './HomeBaseSetting';
import { RoutineSetting } from './RoutineSetting';
import { setHomeBase } from './userPlanStore';
import { updateLayerStore, useLayerStore } from './useWeekPlanStore';

export function OnboardingSetup() {
  const { layer } = useLayerStore();
  // fragment：两项直接落进 BasicInfoStep 的 `.grid`，不另起外框/标题。
  // ⚠️ 各自占**整行**（`sm:col-span-2`）：住处是三级联选 + 走读切换、作息是两组轮盘，
  //    挤在半栏里会截断（RAY 2026-10-01 反馈「太挤了信息显示不全」）。
  //    占整行不等于「另起一栏」—— 它们仍是同一张网格里的字段，样式同源。
  return (
    <>
      <div className="sm:col-span-2">
        <HomeBaseSetting
          embedded
          value={layer.homeBase ?? null}
          onChange={(next) => updateLayerStore((prev) => setHomeBase(prev, next))}
          defaultOpen
        />
      </div>
      <div className="sm:col-span-2">
        <RoutineSetting embedded defaultOpen />
      </div>
    </>
  );
}
