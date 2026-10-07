/**
 * 周计划页头部（F2d/A5 拆出的第 ③ 个纯展示子组件 · 前端架构规格书 §8.1）
 * ============================================================
 * 从 `WeekPlanView.tsx` 原样搬出，两个展示块：
 *   · `PhaseHeader`   —— 阶段头：周次/策略/理由 + 求解器诊断 + P2 控制条 + 如实提示；
 *   · `NearEventsPanel` —— 本周节点：说明这些截止日是怎么进了日程的。
 * 纯展示：不取数、不落库；「从此刻开始排」开关经回调上抛（状态在会话 store）。
 */
import type { PlanPersistState, Phase } from '@/types';
import type { Diagnostics } from '@/lib/planner/model';
import type { Deadline } from '@/data/usst';
import { lockCount } from '@/features/plan/planLock';
import { Icon } from '@/components/icons/Icon';
import { diffDays, todayISO } from '@/lib/date';
import { PersonaImpactPanel } from './PersonaImpactPanel';

/* ============================================================
 * 阶段头
 * ========================================================== */

export function PhaseHeader({
  weekNo, phase, diag, planState, isCurrentWeek,
  fromNowOn, setFromNowOn, transferInfo, backendOk, onGoProfile,
}: {
  weekNo: number;
  phase: Phase;
  diag: Diagnostics | null;
  planState: PlanPersistState | null;
  isCurrentWeek: boolean;
  fromNowOn: boolean;
  setFromNowOn: (next: boolean | ((v: boolean) => boolean)) => void;
  transferInfo: { rounds: number; uncovered: string[] } | null;
  backendOk: boolean;
  /** 「去改画像」的目标路由 —— 由组合根（App.tsx）注入，组件自己不碰路由。 */
  onGoProfile?: () => void;
}) {
  return (
    <div className="panel px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink">第 {weekNo} 周 · {phase.name}</h2>
        <span className="text-[12px] text-ink-soft">
          每天自习目标 {phase.policy.dailyStudyMin} 分 · 单块 ≤{phase.policy.maxBlockMin} 分 ·
          留白 {Math.round(phase.policy.blankRatio * 100)}% ·
          晚间{phase.policy.eveningAllowed ? '可用' : '不排'} ·
          周末{phase.policy.weekendWork ? '排' : '不排'}
        </span>
      </div>
      {/* 画像影响监测（2026-10-07，提案第 13 条）。
          ⚠️ 这里原先是 `phase.reasons.slice(0, 3)` —— 第 4 条之后**全部丢弃**：
          引擎（`buildPhases.applyPersona`）逐条算出了「哪一项画像 → 哪个参数变了」，
          界面上却只给看 3 条。现在改成**全量展示**（默认收起，点开才看）。
          组件内不含任何计算：数据全部来自 `phase.reasons`。 */}
      <PersonaImpactPanel phase={phase} onGoProfile={onGoProfile} />
      {/* 求解器诊断：排得「好不好」的量化凭据。
          刻意不用绿色高亮 —— 它是给人核对的事实，不是「成功了」的庆祝。 */}
      {diag && (
        <div className="mt-2 border-t border-ink/10 pt-1.5 font-mono text-[11px] text-ink-faint">
          {diag.hardViolations === 0 ? '硬约束违反 0' : `⚠ 硬约束违反 ${diag.hardViolations}`}
          {' · '}调度代价 {Math.round(diag.cost.total)}（越低越好）
          {' · '}{diag.iterations} 次迭代
          {' · '}{Math.round(diag.elapsedMs)} ms
          {lockCount(planState) > 0 && <>{' · '}已定住 {lockCount(planState)} 块</>}
          {diag.churnMin > 0 && <>{' · '}本次挪动 {diag.churnMin} 分钟</>}
        </div>
      )}
      {/* 锁太多会挤掉引擎的自由度 —— 与其让用户自己发现排不出来，不如先说一句 */}
      {lockCount(planState) >= 6 && (
        <div className="mt-2 rounded-md bg-warn-light px-2.5 py-1.5 text-[11.5px] text-warn-text">
          已经定住 {lockCount(planState)} 块了 —— 定住的越多，引擎能腾挪的空间越小，排出来可能比较勉强
        </div>
      )}

      {/* ── P2 控制条：从此刻开始排（T2.3） ────────────────────────
          为什么只在「当前周」出现：`fromNow` 的语义是「今天剩下的时间」，
          回看第 3 周时不存在这个时间点。放出来只会让人误以为能对历史周生效。
          为什么默认关：开了之后今天这一列会明显变短（过去的时间被砍掉），
          不解释的话用户会当成 bug —— 所以标签本身就把后果写出来了。 */}
      {isCurrentWeek && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink/10 pt-2">
          <button
            type="button"
            onClick={() => setFromNowOn((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition ${
              fromNowOn
                ? 'bg-ink text-white'
                : 'bg-white text-ink-soft ring-1 ring-ink/15 hover:bg-paper'
            }`}
          >
            <Icon name="clock" size="xs" className="shrink-0" />
            {fromNowOn ? '只排剩下的时间' : '从此刻开始排'}
          </button>
          <span className="text-[11px] text-ink-faint">
            {fromNowOn
              ? '今天已经过去的时间不再安排，其余日子不受影响'
              : '完整排满这一周（默认）'}
          </span>
        </div>
      )}

      {/* ── P2 转场收敛如实提示（T2.4 / AC-10） ────────────────────
          收敛成功时不显示任何东西（正常情况不需要夸奖）。
          只有「还有路没问到」才提示 —— 这时块上的分钟数是估算值，
          用户有权知道，而不是把一个猜的数字当实测值看。 */}
      {transferInfo && transferInfo.uncovered.length > 0 && (
        <div className="mt-2 rounded-md bg-paper px-2.5 py-1.5 text-[11.5px] text-ink-soft">
          有 {transferInfo.uncovered.length} 处转场时间仍是
          <b className="font-semibold text-ink">估算值</b>
          （后端暂无这些路线的实测数据）：{transferInfo.uncovered.slice(0, 3).join('、')}
          {transferInfo.uncovered.length > 3 ? ' 等' : ''}
        </div>
      )}

      {!backendOk && (
        <div className="mt-2 rounded-md bg-warn-light px-2.5 py-1.5 text-[11.5px] text-warn-text">
          后端未连通，转场时间是估算值 —— 跑 <code className="font-mono">python server/app.py</code> 后刷新
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 本周节点
 * ========================================================== */

export function NearEventsPanel({ events }: { events: Deadline[] }) {
  if (events.length === 0) return null;
  return (
    <div className="panel px-4 py-3 sm:px-5">
      <h3 className="text-[14px] font-semibold text-ink">这周的节点</h3>
      <ul className="mt-2 space-y-1.5">
        {events.map((d) => {
          const left = diffDays(todayISO(), d.date);
          return (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
              <span>{d.emoji}</span>
              <span className="font-medium text-ink">{d.title}</span>
              <span className="font-mono text-[11px] text-ink-faint">{d.date}</span>
              <span className={left >= 0 && left <= 7 ? 'text-danger-text' : 'text-ink-soft'}>
                {left === 0 ? '就是今天' : left > 0 ? `还有 ${left} 天` : `已过 ${-left} 天`}
              </span>
              {d.prep && (
                <span className="text-chart-violet">→ 已排准备块</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
