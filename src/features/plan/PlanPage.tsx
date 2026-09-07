import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DEMO_WEEK_PLAN, WEEKDAY_LABELS } from '@/mocks/demo';
import type { BlockKind } from '@/types';

/**
 * 本周计划（演示版）
 * 真实版：scheduler.ts 输出 WeekPlan，这里直接用演示数据。
 * 核心要展示的是「留白」——日程没有被塞满，休息是理直气壮的一部分。
 */

const KIND_STYLE: Record<BlockKind, { bg: string; text: string; dot: string }> = {
  course: { bg: 'bg-brand-light', text: 'text-brand-dark', dot: 'bg-brand' },
  study: { bg: 'bg-accent-light', text: 'text-accent', dot: 'bg-accent' },
  rest: { bg: 'bg-ok-light', text: 'text-ok', dot: 'bg-ok' },
  blank: { bg: 'bg-paper', text: 'text-ink-faint', dot: 'bg-paper-line' },
  meal: { bg: 'bg-paper', text: 'text-ink-faint', dot: 'bg-paper-line' },
  commute: { bg: 'bg-warn-light', text: 'text-warn', dot: 'bg-warn' },
  sleep: { bg: 'bg-paper', text: 'text-ink-faint', dot: 'bg-paper-line' },
};

function fmtHour(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export default function PlanPage() {
  const [dayIdx, setDayIdx] = useState(0); // 0 = 周一
  const [rested, setRested] = useState(false);

  const day = DEMO_WEEK_PLAN.days[dayIdx];
  const pct = Math.round(DEMO_WEEK_PLAN.actualBlankRate * 100);

  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">本周计划</span>
        <span className="text-[12px] text-ink-faint">第 {DEMO_WEEK_PLAN.weekNo} 周</span>
      </div>

      {/* 周汇总 */}
      <Card className="mb-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-paper p-3">
            <div className="text-[18px] font-extrabold text-ink tabular-nums">{fmtHour(DEMO_WEEK_PLAN.studyMin)}</div>
            <div className="text-[11px] text-ink-faint mt-0.5">本周学习</div>
          </div>
          <div className="rounded-lg bg-paper p-3">
            <div className="text-[18px] font-extrabold text-ink tabular-nums">{fmtHour(DEMO_WEEK_PLAN.blankMin)}</div>
            <div className="text-[11px] text-ink-faint mt-0.5">本周留白</div>
          </div>
          <div className="rounded-lg bg-ok-light p-3">
            <div className="text-[18px] font-extrabold text-ok tabular-nums">{pct}%</div>
            <div className="text-[11px] text-ink-faint mt-0.5">留白率</div>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-ink-faint leading-relaxed">
          你没有把日程塞满——{pct}% 的时间是空的，用来休息、运动、发呆。
          计划被执行，比计划排得满更重要。
        </p>
      </Card>

      {/* 星期选择 */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4">
        {DEMO_WEEK_PLAN.days.map((d, i) => (
          <button
            key={i}
            onClick={() => setDayIdx(i)}
            className={[
              'flex-shrink-0 px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-all border',
              i === dayIdx ? 'bg-brand text-white border-brand' : 'bg-paper-card text-ink-soft border-paper-line',
            ].join(' ')}
          >
            {WEEKDAY_LABELS[i + 1]}
          </button>
        ))}
      </div>

      {/* 当日时间轴 */}
      <Card
        title={`${WEEKDAY_LABELS[dayIdx + 1]} · ${day.date.slice(5)}`}
        subtitle={`学习 ${fmtHour(day.studyMin)} · 留白 ${fmtHour(day.blankMin)}`}
      >
        <div className="space-y-1.5">
          {day.blocks.map((b, i) => {
            const s = KIND_STYLE[b.kind];
            const isBlank = b.kind === 'blank';
            return (
              <div
                key={i}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ${s.bg}`}
                style={isBlank ? { opacity: 0.7 } : undefined}
              >
                <span className="text-[11.5px] text-ink-faint tabular-nums w-[76px] shrink-0">
                  {b.start}–{b.end}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                <span className={`text-[13px] font-medium truncate ${isBlank ? 'text-ink-faint' : s.text}`}>
                  {b.title}
                  {b.note && <span className="text-[11px] text-ink-faint ml-1.5">· {b.note}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 今天不想动 */}
      <div className="mt-4">
        <Button
          full
          variant="secondary"
          onClick={() => {
            setRested(true);
            setDayIdx((i) => i);
          }}
        >
          🛋️ 今天不想动，帮我重排
        </Button>
        {rested && (
          <p className="mt-2 text-center text-[12.5px] text-ok leading-relaxed">
            已重排：今天只保留 2 件必须完成的事，其余时间都留给你休息。没人会因为休息一晚而掉队。
          </p>
        )}
      </div>
    </div>
  );
}
