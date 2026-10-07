/**
 * 周计划页头部（F2d/A5 拆出的第 ③ 个纯展示子组件 · 前端架构规格书 §8.1）
 * ============================================================
 * 从 `WeekPlanView.tsx` 原样搬出，两个展示块：
 *   · `PhaseHeader`   —— 阶段头：周次/策略/理由 + 求解器诊断 + P2 控制条 + 如实提示；
 *   · `NearEventsPanel` —— 本周节点：说明这些截止日是怎么进了日程的。
 * 纯展示：不取数、不落库；「从此刻开始排」开关经回调上抛（状态在会话 store）。
 */
import { useEffect, useState } from 'react';
import type { PlanPersistState, Phase } from '@/types';
import type { Diagnostics } from '@/lib/planner/model';
import type { Deadline } from '@/data/usst';
import { lockCount } from '@/features/plan/planLock';
import { diffDays, todayISO } from '@/lib/date';
import { PersonaImpactPanel } from './PersonaImpactPanel';
import { fromNowSwitchCopy, nowMinutes } from './weekViewUtils';

/**
 * 切换「从此刻开始排」的就地提示 —— **模块级**缓存（跨"骨架屏卸载"存活）。
 *
 * 切换该开关会触发重排 ⟹ `WeekPlanView` 先渲染骨架屏 ⟹ `PhaseHeader` 被卸载重建。
 * 纯组件内 `useState` 活不过那一下（实测：按钮文案翻了、提示一个字没显示）。
 * 与 `WeekTimelineGrid` 的 `rememberedScrollTop` 同一个坑：要点必须活在骨架屏之外。
 * 连**过期时刻**一起记，重挂载后按剩余时长重新计时。
 */
let fromNowNoteCache: { text: string; until: number } | null = null;

/** 提示停留时长：够读完一句，又不至于赖在页面上 */
const NOTE_MS = 9000;


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
  /**
   * 切换「从此刻开始排」后的**就地提示**（RAY 2026-10-08 00:18 拍板要「切换反馈」）。
   *
   * 🔴 为什么要跨挂载活下来：切换这个开关会**触发重排**（`fromNowOn` 在引擎重算依赖里），
   *    `WeekPlanView` 会先渲染**骨架屏** ⟹ `PhaseHeader` 被**卸载重建** ⟹
   *    纯局部 state 当场清空，提示一个字都来不及显示（实测：按钮文案翻了、提示没出现）。
   *    这与 `WeekTimelineGrid` 的 `rememberedScrollTop` 是**同一个坑**：
   *    凡是"要点"都必须活在骨架屏之外。这里把**过期时刻**一起记，
   *    重挂载后按剩余时长重新计时，不会被"重置"成永不消失。
   *
   * 为什么用就地提示而不是 toast：① 这个开关立即生效，要回答的是"我这一下改变了什么"，
   * 贴在控件旁边最省事；② 实测把 `notify` 从 `WeekPlanView` 透传下来并没有到位
   * （点了没 toast），就地渲染不依赖任何跨文件传参。
   *
   * 为什么必须说清：**凌晨**切换时 `softFloor = max(07:00, 现在)` 等于没变
   * （实测块数 94→94），没有这句话用户会当成坏了 —— 见 `fromNowSwitchCopy`。
   */
  const [fromNowNote, setFromNowNote] = useState<string | null>(() =>
    (fromNowNoteCache && fromNowNoteCache.until > Date.now() ? fromNowNoteCache.text : null));
  useEffect(() => {
    if (!fromNowNote) return;
    const left = Math.max(400, (fromNowNoteCache?.until ?? 0) - Date.now());
    const t = window.setTimeout(() => { fromNowNoteCache = null; setFromNowNote(null); }, left);
    return () => window.clearTimeout(t);
  }, [fromNowNote]);
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
          {' · '}质量分 {Math.round(diag.cost.total)}
          {' · '}{diag.iterations} 次迭代
          {' · '}{Math.round(diag.elapsedMs)} ms
          {lockCount(planState) > 0 && <>{' · '}已定住 {lockCount(planState)} 块</>}
          {diag.churnMin > 0 && <>{' · '}本次挪动 {diag.churnMin} 分钟</>}
        </div>
      )}
      {/* 锁太多会挤掉引擎的自由度 —— 与其让用户自己发现排不出来，不如先说一句 */}
      {lockCount(planState) >= 6 && (
        <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800">
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
            onClick={() => {
              const next = !fromNowOn;
              setFromNowOn(next);
              const text = fromNowSwitchCopy(next, nowMinutes());
              fromNowNoteCache = { text, until: Date.now() + NOTE_MS };
              setFromNowNote(text);
            }}
            className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition ${
              fromNowOn
                ? 'bg-slate-800 text-white'
                : 'bg-white text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50'
            }`}
          >
            {fromNowOn ? '⏱ 只排剩下的时间' : '⏱ 从此刻开始排'}
          </button>
          <span className="text-[11px] text-ink-faint">
            {fromNowOn
              ? '今天已经过去的时间不再安排，其余日子不受影响'
              : '完整排满这一周（默认）'}
          </span>
        </div>
      )}
      {/* 切换后的就地提示（几秒后自动收走）—— 回答"我这一下改变了什么"。
          尤其凌晨：计划不会变，必须明说「还没到今天的起点」，否则看着就像坏了。 */}
      {isCurrentWeek && fromNowNote && (
        <div
          role="status"
          aria-live="polite"
          className="mt-1.5 rounded-md border border-brand/25 bg-brand-light/45 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink"
        >
          {fromNowNote}
        </div>
      )}

      {/* ── P2 转场收敛如实提示（T2.4 / AC-10） ────────────────────
          收敛成功时不显示任何东西（正常情况不需要夸奖）。
          只有「还有路没问到」才提示 —— 这时块上的分钟数是估算值，
          用户有权知道，而不是把一个猜的数字当实测值看。 */}
      {transferInfo && transferInfo.uncovered.length > 0 && (
        <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11.5px] text-ink-soft">
          有 {transferInfo.uncovered.length} 处转场时间仍是**估算值**
          （后端暂无这些路线的实测数据）：{transferInfo.uncovered.slice(0, 3).join('、')}
          {transferInfo.uncovered.length > 3 ? ' 等' : ''}
        </div>
      )}

      {!backendOk && (
        <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800">
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
              <span className={left >= 0 && left <= 7 ? 'text-red-600' : 'text-ink-soft'}>
                {left === 0 ? '就是今天' : left > 0 ? `还有 ${left} 天` : `已过 ${-left} 天`}
              </span>
              {d.prep && (
                <span className="text-purple-700">→ 已排准备块</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
