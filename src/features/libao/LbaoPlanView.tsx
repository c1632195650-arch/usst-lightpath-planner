import type { LbaoPlan } from '@/lib/lbao';
import { shortCN } from '@/lib/date';

/**
 * 梨宝生活方案统一渲染组件。
 * 周程页「一键推荐」与梨宝对话「帮我安排」共用，消除两处重复的渲染逻辑。
 */
export function LbaoPlanView({ plan }: { plan: LbaoPlan }) {
  return (
    <div className="flex w-full flex-col gap-4">
      {/* The plan header names the selected pace first, keeping recommendation content easy to scan. */}
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: plan.mode.color }} />
        <span className="text-sm font-semibold text-ink">{plan.mode.name}</span>
      </div>
      <p className="-mt-2 text-sm leading-6 text-ink-soft">{plan.headline}</p>

      <div className="rounded-xl border border-ink/10 bg-paper p-4 text-xs leading-5 text-ink-soft">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">推荐依据</div>
        {plan.reasons.map((r, i) => (
          <div key={i} className="flex gap-2"><span className="text-brand">·</span>{r}</div>
        ))}
      </div>

      {/* 每天 */}
      {plan.days.map((d) => (
        <div key={d.date}>
          <div className="mb-2 text-xs font-semibold text-ink-faint">{shortCN(d.date)} · {d.label}</div>
          <div className="flex flex-col gap-2">
            {d.blocks.map((b, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white px-3 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-paper text-sm">{b.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-tight text-ink">{b.title}</div>
                  <div className="mt-1 text-xs leading-4 text-ink-faint">{b.note}</div>
                </div>
                <span className="shrink-0 text-xs font-medium text-ink-faint tabular-nums">{b.time}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
