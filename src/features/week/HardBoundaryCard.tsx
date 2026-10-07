/**
 * 硬边界卡（本树轻版）——「我的作息」入口。
 * ============================================================
 * 2026-10-08 按 CY 截图裁决从周计划页**迁到「我的画像」页**：周页操作条与面板
 * 收敛回 Ray 的设计（作息不属于「这周临时调一下」的干预项）。
 *
 * 设计出处：RAY 40a57ea「作息住处迁画像页」（其版为 `HardBoundaryCard`：
 * 作息 + 住处 + 精力高峰三段）。本树**有意只保留作息一段**：
 *   · 作息 —— routineStore 唯一真源 → 引擎 `PlanRequest.dayStart/dayEnd`（R2 口径）；
 *   · **住处不放**：本树引擎没有 homeBase 概念（住处仍只在基础信息采集），
 *     摆一个写了没人读的输入框 = 不诚实 —— 待契约扩展后再补；
 *   · 精力高峰微调（energyStore）入口同理留待后续（数据链已在，仅缺 UI）。
 *
 * 口径与迁前逐字一致：校验 routineFromHHMM（不猜：无效给具体原因）、保存 saveRoutine、
 * 清除 clearRoutine；**写 store 不触发重排** —— 引擎日窗在重排时重读（见 useWeekPlan）。
 */
import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  clearRoutine, loadRoutine, minutesToHHMM, routineFromHHMM, saveRoutine,
} from './routineStore';

export function HardBoundaryCard() {
  const [draft, setDraft] = useState({ wake: '', sleep: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const openPanel = (open: boolean) => {
    if (open) {
      const r = loadRoutine();
      setDraft({
        wake: r.wakeMin != null ? minutesToHHMM(r.wakeMin) : '',
        sleep: r.sleepMin != null ? minutesToHHMM(r.sleepMin) : '',
      });
      setMsg(null);
    }
  };

  const saveDraft = () => {
    const r = routineFromHHMM(draft.wake, draft.sleep);
    if (!r.ok) {
      setMsg(r.reason === 'order'
        ? '起床要早于入睡（跨零点入睡先按当天时刻记，比如 23:30）'
        : '时间格式要用 HH:MM，比如 07:30');
      return;
    }
    saveRoutine(r.routine);
    setMsg('已保存。点周计划页「重新排一遍」按新作息重排；评估摘要已同步。');
  };

  const clearDraft = () => {
    clearRoutine();
    setDraft({ wake: '', sleep: '' });
    setMsg('已清除，引擎回到缺省 07:00–23:00。');
  };

  return (
    <section className="panel px-4 py-3 sm:px-5">
      <p className="section-label">HARD BOUNDARIES</p>
      <div>
        <details
          data-testid="routine-entry"
          className="mt-2"
          onToggle={(e) => openPanel((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-ink">
            <Icon name="bed" size="sm" className="shrink-0 text-brand" />
            我的作息
            <Icon name="chevron-down" size="xs" className="chev shrink-0" />
            <span className="ml-2 text-[11px] font-normal text-ink-faint">
              起床/就寝决定引擎给你排事的时段（不排「你还没起床」的块）
            </span>
          </summary>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            <label className="flex items-center gap-1">
              起床
              <input
                data-testid="routine-wake"
                type="time"
                value={draft.wake}
                onChange={(e) => setDraft((d) => ({ ...d, wake: e.target.value }))}
                className="rounded-lg border border-ink/15 px-2 py-1 text-[12px]"
              />
            </label>
            <label className="flex items-center gap-1">
              就寝
              <input
                data-testid="routine-sleep"
                type="time"
                value={draft.sleep}
                onChange={(e) => setDraft((d) => ({ ...d, sleep: e.target.value }))}
                className="rounded-lg border border-ink/15 px-2 py-1 text-[12px]"
              />
            </label>
            <button type="button" data-testid="routine-save" onClick={saveDraft} className="button-primary px-3 py-1.5 text-xs">
              保存
            </button>
            <button
              type="button"
              data-testid="routine-clear"
              onClick={clearDraft}
              className="rounded-xl border border-ink/15 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink/30"
            >
              清除
            </button>
            {msg && <span className="w-full text-[11.5px] text-ink-soft" data-testid="routine-msg">{msg}</span>}
          </div>
        </details>
      </div>
    </section>
  );
}
