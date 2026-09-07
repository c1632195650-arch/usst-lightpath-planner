import { Card } from '@/components/ui/Card';
import { PHASE_STYLE } from '@/constants/phases';
import { DEMO_PHASES, DEMO_PHASE_PLAN } from '@/mocks/demo';

/**
 * 学期阶段（演示版）
 * 真实版：buildPhases() 按学期类型+总周数生成，currentPhase 按当前日期推算。
 * 这里展示「一学期切成 5 段 + 留白率曲线」的核心视觉，并高亮当前阶段。
 */

export default function PhasePage() {
  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">学期阶段</span>
        <span className="text-[12px] text-ink-faint tabular-nums">第 {DEMO_PHASE_PLAN.currentWeek} 周 · 还剩 {DEMO_PHASE_PLAN.weeksLeft} 周</span>
      </div>

      {/* 五段比例条 */}
      <div className="flex h-9 w-full overflow-hidden rounded-lg mb-1.5">
        {DEMO_PHASES.map((p) => (
          <div
            key={p.id}
            className={`${PHASE_STYLE[p.id].bar} flex items-center justify-center text-white text-[11px] font-semibold whitespace-nowrap overflow-hidden`}
            style={{ flexGrow: p.endWeek - p.startWeek + 1 }}
            title={p.name}
          >
            {p.endWeek - p.startWeek + 1 >= 2 ? p.name : ''}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10.5px] text-ink-faint mb-5">
        <span>第 1 周</span>
        <span>第 {DEMO_PHASES[DEMO_PHASES.length - 1].endWeek} 周</span>
      </div>

      {/* 阶段详情 + 留白率曲线 */}
      <div className="space-y-3">
        {DEMO_PHASES.map((p) => {
          const isCurrent = p.id === DEMO_PHASE_PLAN.currentPhaseId;
          const style = PHASE_STYLE[p.id];
          const pct = Math.round(p.blankRate * 100);
          return (
            <Card key={p.id} className={isCurrent ? 'ring-2 ring-brand/30' : ''}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${style.bar}`} />
                  <div>
                    <div className="font-bold text-[14.5px] text-ink flex items-center gap-2">
                      {p.name}
                      {isCurrent && (
                        <span className="text-[10.5px] font-semibold bg-brand text-white rounded-full px-2 py-0.5">当前</span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-ink-faint">
                      第 {p.startWeek}–{p.endWeek} 周
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-bold text-ink tabular-nums">{pct}%</div>
                  <div className="text-[10.5px] text-ink-faint">留白率</div>
                </div>
              </div>

              <p className="mt-2 text-[12.5px] text-ink-soft leading-relaxed">{p.focus}</p>

              <div className="mt-2.5 h-2 rounded-full bg-paper-line overflow-hidden">
                <div className={`h-full ${style.bar} transition-all`} style={{ width: `${pct}%` }} />
              </div>
            </Card>
          );
        })}
      </div>

      {/* 反内卷记忆点 */}
      <Card className="mt-4 bg-brand-light border-brand/20">
        <div className="flex gap-3">
          <div className="text-[20px] leading-none">💡</div>
          <div className="text-[13px] leading-relaxed text-brand-dark">
            <div className="font-bold mb-1">为什么考试周留白率「不降反升」？</div>
            冲刺期留白 22%，进入考试周反而上调到 30%——因为考试周再压缩休息只会损害记忆巩固与考场发挥。
            这是本产品与所有「帮你把日程塞满」的竞品的核心差异：<b>我们追求的是计划被执行率，不是学习小时数。</b>
          </div>
        </div>
      </Card>
    </div>
  );
}
