import { Card } from '@/components/ui/Card';
import { DEMO_COUNTDOWNS } from '@/mocks/demo';

/**
 * 期末冲刺（演示版）
 * 真实版：由课程 examDate + 掌握度算出紧迫度 U，按 T-21/14/7/3 分级。
 * 这里展示「距考试倒计时 + 紧迫度 + 建议投入 + 该做什么」的四级卡片。
 */

const LEVEL_STYLE: Record<string, { badge: string; bar: string }> = {
  'T-21': { badge: 'bg-accent text-white', bar: 'bg-accent' },
  'T-14': { badge: 'bg-brand text-white', bar: 'bg-brand' },
  'T-7': { badge: 'bg-warn text-white', bar: 'bg-warn' },
  'T-3': { badge: 'bg-danger text-white', bar: 'bg-danger' },
};

export default function ExamPage() {
  const today = DEMO_COUNTDOWNS[0];

  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">期末冲刺</span>
        <span className="text-[12px] text-ink-faint">演示：假设进入第 16 周</span>
      </div>

      <p className="mb-4 text-[12.5px] text-ink-faint leading-relaxed">
        距离考试越近，系统会自动把时间往「紧迫度高的科目」倾斜——但会留出足够的休息，不让你崩在考场前。
      </p>

      <div className="space-y-3">
        {DEMO_COUNTDOWNS.map((c) => {
          const style = LEVEL_STYLE[c.level ?? 'T-21'];
          return (
            <Card key={c.courseId}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-[15px] text-ink truncate">{c.courseName}</div>
                  <div className="text-[11.5px] text-ink-faint mt-0.5">考试 {c.examDate}</div>
                </div>
                <span className={`shrink-0 text-[12px] font-bold text-white rounded-lg px-2.5 py-1 ${style.badge}`}>
                  {c.level}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between text-[11px] text-ink-faint mb-1">
                    <span>紧迫度</span>
                    <span className="tabular-nums">{c.urgency} / 100</span>
                  </div>
                  <div className="h-2 rounded-full bg-paper-line overflow-hidden">
                    <div className={`h-full ${style.bar}`} style={{ width: `${c.urgency}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[15px] font-extrabold text-ink tabular-nums">{c.suggestMin}</div>
                  <div className="text-[10.5px] text-ink-faint">建议分钟/天</div>
                </div>
              </div>

              <p className="mt-2.5 text-[12.5px] text-ink-soft leading-relaxed">📌 {c.action}</p>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4 bg-brand-light border-brand/20">
        <div className="text-[13px] leading-relaxed text-brand-dark">
          <div className="font-bold mb-1">📊 冲刺期的留白去哪了？</div>
          即便在最紧张的冲刺期，系统仍保留 22% 留白；进入考试周更上调到 30%。
          你不会看到一张「从早 8 学到晚 11」的排程——那正是大多数人三天就放弃的原因。
        </div>
      </Card>
    </div>
  );
}
