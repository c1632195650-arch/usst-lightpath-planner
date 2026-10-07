import { useMemo, useState } from 'react';
import type { PersonaProfile, Schedule } from '@/types';
import {
  MODE_OPTIONS,
  modePreview,
  modeSetupRequest,
  type ModePreviewResult,
} from './modeSetup';
import { MiniWeekPreview } from '@/features/week/MiniWeekPreview';

interface Props {
  schedule: Schedule;
  profile: PersonaProfile | null;
  weekNo: number;
  currentMode: string | null;
  /** 确认（L4：用户点「就这么过」才落 lifeMode；此前一切只是预览） */
  onConfirm: (modeId: string) => void;
  onClose: () => void;
}

/**
 * 模式问询窗口（H2 / v2 方案 WP8 的 ModeSetupDialog）。
 * 六模式卡 → 点选即同步干跑（construct 毫秒级）→ compact 预览 + 三个数字 →
 * 「就这么过」确认 / 「再看看」关闭。确认前不写任何状态（core §4 L4）。
 */
export function ModeSetupDialog({ schedule, profile, weekNo, currentMode, onConfirm, onClose }: Props) {
  const req = useMemo(() => modeSetupRequest(schedule, profile, weekNo), [schedule, profile, weekNo]);
  const [selected, setSelected] = useState<string | null>(null);
  const preview: ModePreviewResult | null = useMemo(
    () => (selected && req ? modePreview(req, selected) : null),
    [selected, req],
  );
  const stats = preview && !('error' in preview) ? preview.stats : null;

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="选择这一周的节奏">
      <div className="overlay-in-panel max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-ink/[0.07] bg-white p-5 shadow-[0_24px_72px_rgba(22,35,63,0.2)] sm:p-7">
        <p className="section-label">WEEK MODE</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">这一周想过什么节奏？</h2>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          点一个先看预览，不满意随时换；确认前不会改动你的日程。
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODE_OPTIONS.map((m) => {
            const active = selected === m.id;
            const isCurrent = currentMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                data-testid={`mode-card-${m.id}`}
                aria-pressed={active}
                onClick={() => setSelected(m.id)}
                className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                  active ? 'border-brand bg-brand-light/45' : 'border-ink/10 bg-paper hover:border-brand/40'
                }`}
              >
                <p className="text-sm font-semibold text-ink">
                  {m.emoji} {m.name}
                  {isCurrent && <span className="ml-1 text-[10px] text-ink-faint">（当前）</span>}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-5 text-ink-soft">{m.tagline}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          {preview && 'error' in preview ? (
            <p role="alert" className="rounded-xl border border-warn/30 bg-warn-light px-4 py-3 text-sm text-warn-text">
              这个模式排不出来（{preview.error}），换一个看看。
            </p>
          ) : preview && stats ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-paper px-3 py-1 text-[11.5px] text-ink-soft">学习约 {stats.studyHours}h</span>
                <span className="rounded-full bg-paper px-3 py-1 text-[11.5px] text-ink-soft">自由格约 {stats.blankHours}h</span>
                <span className="rounded-full bg-paper px-3 py-1 text-[11.5px] text-ink-soft">运动 {stats.sportCount} 次</span>
                <span className="rounded-full bg-paper px-3 py-1 text-[11.5px] text-ink-soft">加餐 {stats.extraMealCount} 次</span>
              </div>
              <MiniWeekPreview draft={preview.plan} compact caption="预览 · 未落盘，以实际为准" />
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink-faint">
              点上面的模式卡，这里出预览。
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="button-secondary flex-1"
          >
            再看看
          </button>
          <button
            type="button"
            disabled={!stats}
            onClick={() => { if (selected) onConfirm(selected); }}
            className="button-primary flex-1 disabled:cursor-not-allowed disabled:opacity-40"
          >
            就这么过
          </button>
        </div>
      </div>
    </div>
  );
}
