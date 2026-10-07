/**
 * 「你的作息与住处」设置卡（2026-10-07）
 * ============================================================
 * RAY 拍板：把这两个修改入口从**周计划页工具面板**搬到**「我的画像」页**，
 * 与画像页其它卡片（`BASIC FACTS` / `PLANNING INPUTS` / `EVERYDAY PREFERENCES`）
 * 共用同一套版式：同一 `panel` 外壳 + `section-label` 小标题。
 * （2026-10-07 追加：卡头右侧的说明文案按 RAY 要求**删除**，说明下移到各字段自己的 hint。）
 *
 * ── 为什么是「作息与住处」放一起 ──────────────────────────────
 * 语义上**性格是软倾向、作息与住处是硬边界**（问卷规格书 §6.1 / §6.2）：
 *   · 作息决定「一天从几点排到几点」（引擎 `PlanRequest.dayStart / dayEnd`）；
 *   · 住处决定「午休、宿舍自习这类块落在哪」（引擎替换宿舍类模板的地点）。
 * 两者同一形制、同一位置，故同卡并列，各自用一个分隔块承载。
 *
 * ── 为什么由组合根注入（而不是 persona 域直接 import）──────────
 * 两个编辑器属 `features/week/**`。若 `features/persona/**` 反向 import 它，
 * 就会**新增 `persona → week` 跨域依赖**，而架构护栏（`tests/arch-guards.test.ts`
 * AC-6·R5）把跨域域对冻结为**只许缩短、不许加长**。
 * 于是沿用本仓既有手法（与 `BasicInfoStep` + `OnboardingSetup` 完全同构）：
 * `PersonaResult` 只认一个 `ReactNode` 插槽，真正的组合落在组合根 `App.tsx`
 * （它本来就同时 import 两个域）。
 *
 * ── 为什么用 `embedded` 形态 ─────────────────────────────────
 * `HomeBaseSetting` / `RoutineSetting` 有两种形态：
 *   · 默认 = 自带 `rounded-xl border` 的**可折叠卡片**；
 *   · `embedded` = 只有标签 + 控件（无外框、无折叠开关）。
 * 本卡已经是一层 `panel`，若再用默认形态就变成「卡片里套卡片」（双重描边）。
 * 所以这里统一用 `embedded` —— 与画像页 `BasicInfoCard` 的扁平字段同款。
 *
 * ── 生效时机（不自动重排）────────────────────────────────────
 * 两项都**只写 store、不触发重排** —— 与「手动改完攒着、点『重新排一遍』」同一口径。
 * 这条提示现在由 `RoutineSetting` 自己的「已保存：…改动会在下次『重新排一遍』或重新打开时生效」
 * 那行承载（卡头文案删掉后，别再以为提示没了）。
 */
import { useState } from 'react';
import { HomeBaseSetting } from './HomeBaseSetting';
import { RoutineSetting } from './RoutineSetting';
import { setHomeBase } from './userPlanStore';
import { updateLayerStore, useLayerStore } from './useWeekPlanStore';
import { PEAK_PRESETS, loadEnergyPeak, saveEnergyPeak } from './energyStore';

export function HardBoundaryCard() {
  const { layer } = useLayerStore();
  // 精力高峰微调（§2.3）：本地 state 起于已存值；写 store 不触发重排（与作息同口径）
  const [peak, setPeak] = useState<number | null>(() => loadEnergyPeak());

  return (
    <section className="panel mt-6 overflow-hidden">
      {/* 卡头：只留小标题 + 主标题（2026-10-07 RAY 要求删掉右侧那段说明文案）。
          与其它卡的「左标题 + 右说明」略有不同 —— 说明改由**每个字段自己的 hint** 承载
          （住处：「午休、宿舍自习等块的地点会跟着它…」；作息：「引擎只在这段里排块…」）。 */}
      <div className="border-b border-ink/10 px-5 py-5 sm:px-7 sm:py-6">
        <p className="section-label">HARD BOUNDARIES</p>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">你的作息与住处</h2>
      </div>

      {/* 两块用分隔线串起来（与 `panel` 列表形态一致），各自用 embedded 扁平字段 */}
      <div className="divide-y divide-ink/10">
        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <HomeBaseSetting
            embedded
            value={layer.homeBase ?? null}
            onChange={(next) => updateLayerStore((prev) => setHomeBase(prev, next))}
          />
        </div>
        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <RoutineSetting embedded />
        </div>
        <div className="px-5 py-5 sm:px-7 sm:py-6">
          {/* ⚡ 精力高峰（§2.3）：只微调一档；曲线由作息 + 画像轴 + 这一档现算。
              不选 = 引擎按「起床 + 3 小时」推断。与作息同口径：写 store 不触发重排。 */}
          <p className="text-sm font-medium text-ink">⚡ 精力高峰</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PEAK_PRESETS.map((p) => (
              <button
                key={p.fromHour}
                type="button"
                onClick={() => { setPeak(p.fromHour); saveEnergyPeak(p.fromHour); }}
                className={
                  peak === p.fromHour
                    ? 'rounded-lg border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand'
                    : 'rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:border-ink/30'
                }
              >
                {p.label}（{p.fromHour}:00 起）
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/50">
            {peak != null
              ? '已保存：你的难事会尽量排进这个时段 —— 下次「重新排一遍」生效'
              : '未设置：引擎按你的作息推断（起床约 3 小时后为高峰）'}
            {peak != null && (
              <button type="button" className="ml-2 underline" onClick={() => { setPeak(null); saveEnergyPeak(null); }}>
                清除
              </button>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
