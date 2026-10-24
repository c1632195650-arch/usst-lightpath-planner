/**
 * ScenarioModeCard —— 场景模式卡（F6·A4，2026-10-24）
 * ============================================================
 * 总览页的低频开关：日常 / 考试周 / 比赛周三档（组件库 Segmented）。
 *   · 切换**立即持久化**（usst.scenario-mode），但**不自动重排**——
 *     与「目标改动攒着、点重新排一遍」同一 T3 语义，卡上明说；
 *   · 排程侧在 useWeekPlan 读模式做安全档内补丁（scenarioModes.ts），
 *     本组件零引擎知识。
 */
import { useState } from 'react';
import { Segmented } from '@/components/ui/Segmented';
import { SCENARIO_MODES, loadScenarioMode, saveScenarioMode, type ScenarioMode } from '@/lib/scenarioModes';

export function ScenarioModeCard() {
  const [mode, setMode] = useState<ScenarioMode>(() => loadScenarioMode());
  const hint = SCENARIO_MODES.find((m) => m.id === mode)?.hint ?? '';
  return (
    <div data-testid="scenario-mode-card" className="panel px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="section-label">SCENARIO</span>
          <span className="text-[13px] font-medium text-ink">这周的节奏</span>
        </div>
        <Segmented
          label="场景模式"
          testId="scenario-mode-switch"
          value={mode}
          onChange={(v) => { setMode(v); saveScenarioMode(v); }}
          options={SCENARIO_MODES.map((m) => ({ value: m.id, label: m.label }))}
        />
      </div>
      <p className="mt-2 text-[12px] leading-5 text-ink-soft">
        {hint}{mode !== 'off' && ' —— 切换后到周计划页点「重新排一遍」生效'}
      </p>
    </div>
  );
}
