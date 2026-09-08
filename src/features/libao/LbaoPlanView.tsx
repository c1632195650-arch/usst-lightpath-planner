import type { LbaoPlan } from '@/lib/lbao';
import { shortCN } from '@/lib/date';

/**
 * 梨宝生活方案统一渲染组件。
 * 周程页「一键推荐」与梨宝对话「帮我安排」共用，消除两处重复的渲染逻辑。
 */
export function LbaoPlanView({ plan }: { plan: LbaoPlan }) {
  return (
    <div className="flex flex-col gap-2.5 w-full">
      {/* 模式头 */}
      <div className="flex items-center gap-2">
        <span className="text-[18px]">{plan.mode.emoji}</span>
        <span className="text-[14px] font-bold text-ink">梨宝推荐「{plan.mode.name}」</span>
      </div>
      <p className="text-[13px] text-ink-soft leading-relaxed -mt-1">{plan.headline}</p>

      {/* 理由 */}
      <div className="rounded-xl bg-paper border border-paper-line p-2.5 text-[12px] text-ink-soft">
        <div className="font-bold text-ink text-[11.5px] mb-1">🤔 为什么这么推</div>
        {plan.reasons.map((r, i) => (
          <div key={i} className="flex gap-1.5 leading-relaxed"><span className="text-brand">·</span>{r}</div>
        ))}
      </div>

      {/* 每天 */}
      {plan.days.map((d) => (
        <div key={d.date} className="mt-0.5">
          <div className="text-[12px] font-bold text-ink-faint mb-1.5">{shortCN(d.date)} · {d.label}</div>
          <div className="flex flex-col gap-1.5">
            {d.blocks.map((b, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-xl bg-white border border-paper-line px-3 py-2">
                <span className="text-[16px]">{b.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink leading-tight">{b.title}</div>
                  <div className="text-[11.5px] text-ink-faint leading-tight">{b.note}</div>
                </div>
                <span className="text-[11px] text-ink-faint tabular-nums shrink-0">{b.time}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
