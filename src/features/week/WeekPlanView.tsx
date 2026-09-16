/**
 * WeekPlanView —— 周计划时间轴（只读「感受测试」版）
 * ============================================================
 * 消费 `planWeek()` 的产物：一天一列时间轴，块上直接标
 * 「几分钟走到下一件事」，问题清单和「为什么这么排」都能看到。
 *
 * 这是排程引擎的第一个 UI 出口 —— 先让 CY **看**排得对不对，
 * 「改参数/改决定」的交互等感受反馈回来再做。
 *
 * 数据流（App → 本组件）：
 *   schedule + weekNo + persona
 *     → buildPhasesFromCalendar（这个阶段该多紧）
 *     → planWeek()（两遍法编排：第一遍收集点对 → 后端实测转场 → 第二遍真结果）
 *
 * ⚠️ 两遍法**不在本组件里手写**。编排已抽到 `planner/planWeek.ts`（唯一编排点），
 *    本组件只负责注入「怎么取转场」（浏览器里 = 调后端 route）和一个失败提示。
 *    原先是本组件与 `features/libao/weekPlanForChat.ts` 各写一份 —— 同一套编排
 *    写两份，任何一处调整都要改两遍，且必然漂移。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanIssue, Schedule, TimeBlock, WeekPlan } from '@/types';
import type { Diagnostics } from '@/lib/planner/model';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases';
import { toPlanRequest } from '@/lib/planner/schedule';
import { planWeek } from '@/lib/planner/planWeek';
import { buildTransferProvider } from '@/lib/planner/transfer';
import { expandDeadlines, eventsNearWeek } from '@/lib/planner/events';
import { fetchWeather, weatherToTasks } from '@/features/weather/weather';
import type { WeatherReport } from '@/features/weather/weather';
import { WeatherStrip } from '@/features/weather/WeatherStrip';
import {
  findStatus, loadRecords, makeId, saveRecords, summarizeWeek, upsert,
} from '@/features/behavior/behaviorLog';
import type { BehaviorRecord, BehaviorStatus } from '@/features/behavior/behaviorLog';
import { TERM_CALENDAR } from '@/constants/term';
import { toHHmm } from '@/constants/time';
import { addDays, diffDays, todayISO } from '@/lib/date';
import { DEADLINES } from '@/data/usst';

interface Props {
  schedule: Schedule;
  weekNo: number;
  persona: import('@/types').PersonaProfile | null;
}

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const KIND_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  course: { bg: 'bg-blue-100 border-blue-400', text: 'text-blue-900', label: '课' },
  meal: { bg: 'bg-amber-100 border-amber-400', text: 'text-amber-900', label: '饭' },
  study: { bg: 'bg-green-100 border-green-400', text: 'text-green-800', label: '学' },
  activity: { bg: 'bg-purple-100 border-purple-400', text: 'text-purple-900', label: '动' },
  user: { bg: 'bg-pink-100 border-pink-400', text: 'text-pink-900', label: '我' },
  commute: { bg: 'bg-gray-100 border-gray-400', text: 'text-gray-700', label: '走' },
  blank: { bg: 'bg-white border-gray-200', text: 'text-gray-400', label: '空' },
};

const ISSUE_STYLE = {
  error: 'bg-red-50 border-red-300 text-red-800',
  warn: 'bg-amber-50 border-amber-300 text-amber-800',
  info: 'bg-blue-50 border-blue-300 text-blue-800',
} as const;

function BlockCard({ block, date, status, onMark }: {
  block: TimeBlock;
  /** 这个块所属的 ISO 日期 —— 行为记录按「块 + 日期」定位 */
  date: string;
  /** 已标记的执行结果；undefined = 还没标记 */
  status?: BehaviorStatus;
  onMark: (block: TimeBlock, date: string, status: BehaviorStatus) => void;
}) {
  const style = KIND_STYLE[block.kind] ?? KIND_STYLE.blank;
  const t = block.transfer;
  // 校历事件展开出来的准备块（光电杯材料、四六级真题…）单独标出来 ——
  // 否则用户只看到「又一个活动块」，意识不到它和那个截止日有关
  const isEvent = Boolean(block.fromEventId);
  // 标记过的块降一点视觉重量：一眼看出「这段已经处理过了」
  const marked = status !== undefined;
  return (
    <div className={`rounded-lg border-l-4 ${style.bg} px-2.5 py-2 ${isEvent ? 'ring-1 ring-purple-300' : ''} ${marked ? 'opacity-85' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[13px] font-semibold ${style.text}`}>
          {block.emoji ? `${block.emoji} ` : ''}{block.title}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">
          {toHHmm(block.startMin)}–{toHHmm(block.endMin)}
        </span>
      </div>
      {isEvent && (
        <div className="mt-1 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800">
          校历事件 · 提前准备
        </div>
      )}
      {block.place && (
        <div className="mt-0.5 text-[11px] text-ink-soft">
          @{block.place}{block.room ? ` ${block.room}` : ''}
        </div>
      )}
      {t && (
        <div className={`mt-1 rounded px-1.5 py-0.5 text-[11px] ${t.tight ? 'bg-white/70 text-red-700' : 'text-ink-soft'}`}>
          🚶 {t.fromPlace} → {t.toPlace}：{t.minutes} 分钟
          （余 {t.slackMin}{t.tight ? ' · 紧' : ''}）
        </div>
      )}
      {block.reason && (
        <div className="mt-1 text-[11px] leading-snug text-ink-faint">💡 {block.reason}</div>
      )}

      {/* 执行标记 —— 行为记录的唯一入口。
          两个按钮而不是一个勾：「没做」同样是有效信息（连续跳过某个时段/地点，
          下次排程就该改），只记「做了」等于丢掉一半信号。 */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onMark(block, date, 'done')}
          className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
            status === 'done'
              ? 'bg-green-600 text-white'
              : 'bg-white/70 text-ink-soft hover:bg-green-50 hover:text-green-700'
          }`}
        >
          ✓ 做了
        </button>
        <button
          type="button"
          onClick={() => onMark(block, date, 'skipped')}
          className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
            status === 'skipped'
              ? 'bg-red-500 text-white'
              : 'bg-white/70 text-ink-soft hover:bg-red-50 hover:text-red-700'
          }`}
        >
          ✗ 没做
        </button>
        {marked && <span className="text-[10px] text-ink-faint">已记录</span>}
      </div>
    </div>
  );
}

export function WeekPlanView({ schedule, weekNo, persona }: Props) {
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendOk, setBackendOk] = useState(true);
  /**
   * 求解器诊断（规格书 §4.4）—— 排得「好不好」的量化凭据。
   * 以前只有「有没有冲突」这一个二值信号，现在能说出硬约束违反数、
   * 加权质量分（越低越好）和耗时。这是答辩时「算法依据」的答案。
   */
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  /** 天气是可选增强：拉不到就是 null，页面不显示天气条、排程也不受影响 */
  const [weather, setWeather] = useState<WeatherReport | null>(null);

  const semester = useMemo(
    () => buildPhasesFromCalendar(schedule, persona, TERM_CALENDAR['2026-2027-1']),
    [schedule, persona],
  );
  const phase = phaseOfWeek(semester.plan, weekNo);

  /** 执行记录（反馈闭环）—— 独立存储，不进 AppState，理由见 behaviorLog.ts */
  const [records, setRecords] = useState<BehaviorRecord[]>([]);
  useEffect(() => { setRecords(loadRecords()); }, []);

  const progress = useMemo(() => summarizeWeek(records, weekNo), [records, weekNo]);

  /** 本周的周一（ISO）—— 把「周次 + 星期几」还原成具体日期，行为记录按它定位 */
  const weekMonday = useMemo(
    () => addDays(schedule.termStart, (weekNo - 1) * 7),
    [schedule.termStart, weekNo],
  );
  const dateOfDay = useCallback(
    (dayOfWeek: number) => addDays(weekMonday, dayOfWeek - 1),
    [weekMonday],
  );

  const mark = useCallback((block: TimeBlock, date: string, status: BehaviorStatus) => {
    setRecords((prev) => {
      const next = upsert(prev, {
        id: makeId(block.id, date),
        blockId: block.id,
        date,
        weekNo,
        kind: block.kind,
        title: block.title,
        plannedMin: block.endMin - block.startMin,
        status,
        at: new Date().toISOString(),   // UI 层可以读时钟；纯函数模块不许（见 behaviorLog.ts）
      });
      saveRecords(next);
      return next;
    });
  }, [weekNo]);

  // 天气与周次无关（都是「未来 7 天」），所以只拉一次；
  // 换周时靠下面的 filter（weatherToTasks 按 weekNo 过滤）而不是重拉。
  useEffect(() => {
    let cancelled = false;
    fetchWeather(7).then((r) => { if (!cancelled) setWeather(r); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!phase) { setPlan(null); return; }
        // 校历事件 → 本周准备块（光电杯材料 / 四六级真题 / 期中复习…）。
        // 这一步就是「把截止日变成日程」：事件不再只是旁边一个倒计时数字。
        const eventTasks = expandDeadlines(DEADLINES, schedule.termStart, schedule.totalWeeks);
        // 天气 → 当天提醒块（带伞 / 防暑 / 保暖 / 防风）。
        // 与事件走**同一条 tasks 通道**，引擎完全不知道有「天气」这回事。
        // 差别在权重：天气块优先级只有 45–55（事件准备块是 88），
        // 挤不进日程也没关系 —— 提醒还有天气条那条独立路径。
        const tasks = [...eventTasks, ...weatherToTasks(weather, schedule.termStart, weekNo)];
        // 两遍法编排交给公共入口 `planWeek()` —— 原先这一段在本组件和
        // `features/libao/weekPlanForChat.ts` 各写了一份，是同一套逻辑的两个副本。
        // 我们只注入「转场怎么取」：浏览器里 = 调后端批量问路（拿不到就退回估算）。
        const result = await planWeek(
          toPlanRequest({
            schedule, weekNo, policy: phase.policy,
            scenarios: persona?.scenarios ?? null,
            tasks,
          }),
          {
            transferFactory: async (blocks) => {
              const cache = await buildTransferProvider(blocks);
              // 后端一条都没问到 → 转场全是估算值，页面要如实提示
              if (!cancelled) setBackendOk(cache.size() > 0);
              return cache.provider;
            },
          },
        );
        if (!cancelled) {
          setPlan(result.plan);
          setNotes(result.notes);
          setDiag(result.diagnostics);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [schedule, weekNo, phase, persona, weather]);

  if (loading) {
    return <div className="panel px-6 py-10 text-center text-sm text-ink-soft">正在排这一周……</div>;
  }
  if (!phase || !plan) {
    return <div className="panel px-6 py-10 text-center text-sm text-ink-soft">这个周次不在学期范围内。</div>;
  }

  const issues: PlanIssue[] = plan.issues;
  /** 本周与下周的校历节点 —— 让「为什么这周多出准备块」有出处 */
  const nearEvents = eventsNearWeek(DEADLINES, schedule.termStart, weekNo);

  return (
    <div className="space-y-4">
      {/* 阶段头：现在处于什么阶段、策略是什么、为什么 */}
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
        <ul className="mt-2 space-y-0.5">
          {phase.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="text-[11.5px] leading-relaxed text-ink-faint">· {r}</li>
          ))}
        </ul>
        {/* 求解器诊断：排得「好不好」的量化凭据。
            刻意不用绿色高亮 —— 它是给人核对的事实，不是「成功了」的庆祝。 */}
        {diag && (
          <div className="mt-2 border-t border-ink/10 pt-1.5 font-mono text-[11px] text-ink-faint">
            {diag.hardViolations === 0 ? '硬约束违反 0' : `⚠ 硬约束违反 ${diag.hardViolations}`}
            {' · '}质量分 {Math.round(diag.cost.total)}
            {' · '}{diag.iterations} 次迭代
            {' · '}{Math.round(diag.elapsedMs)} ms
          </div>
        )}
        {!backendOk && (
          <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800">
            后端未连通，转场时间是估算值 —— 跑 <code className="font-mono">python server/app.py</code> 后刷新
          </div>
        )}
      </div>

      {/* 本周节点 —— 事件不再只是「旁边一个倒计时」，这里说明它怎么进了日程 */}
      {nearEvents.length > 0 && (
        <div className="panel px-4 py-3 sm:px-5">
          <h3 className="text-[14px] font-semibold text-ink">这周的节点</h3>
          <ul className="mt-2 space-y-1.5">
            {nearEvents.map((d) => {
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
      )}

      {/* 本周天气 —— 天气的**第一落点**。
          排程块（weatherToTasks）优先级低、日程满时本就该被挤掉，
          所以提醒必须有一条独立于排程的路径，否则会在最需要时消失。 */}
      <WeatherStrip report={weather} weekNo={weekNo} termStart={schedule.termStart} />

      {/* 执行情况 —— 反馈闭环里**用户能看见**的那一半。
          另一半（把实际执行率喂回引擎、修正产能估计）要等 P1 的求解器落地；
          但「看见」本身就有价值：用户第一次能看到自己的计划执行了多少。 */}
      <div className="panel px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[12.5px] font-semibold text-ink">执行情况</span>
          <span className="text-[11px] text-ink-faint">
            {progress.rate === null
              ? '还没标记过 —— 点每个块里的「做了 / 没做」'
              : `完成 ${progress.done}/${progress.marked} · 实际投入 ${Math.round((progress.doneMin / 60) * 10) / 10}h`}
          </span>
        </div>
        {progress.rate !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/5">
            <div
              className="h-full rounded-full bg-green-500"
              style={{ width: `${Math.round(progress.rate * 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* 七天时间轴 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {DAY_LABELS.map((name, idx) => {
          const day = idx + 1;
          const blocks = plan.blocks
            .filter((b) => b.dayOfWeek === day)
            .sort((a, b) => a.startMin - b.startMin);
          const study = blocks.filter((b) => b.kind === 'study')
            .reduce((n, b) => n + (b.endMin - b.startMin), 0);
          return (
            <div key={day} className="panel p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-ink">{name}</span>
                {study > 0 && (
                  <span className="text-[11px] text-ink-faint">自习 {Math.round(study / 60 * 10) / 10}h</span>
                )}
              </div>
              <div className="space-y-1.5">
                {blocks.length === 0 && (
                  <div className="rounded-lg border border-dashed border-ink/15 px-3 py-4 text-center text-[12px] text-ink-faint">
                    这一天没有安排
                  </div>
                )}
                {blocks.map((b) => {
                  const date = dateOfDay(day);
                  return (
                    <BlockCard
                      key={b.id}
                      block={b}
                      date={date}
                      status={findStatus(records, b.id, date)}
                      onMark={mark}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 问题清单 + 汇总 */}
      <div className="panel px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-ink">这一周的情况</h3>
          <span className="text-[12px] text-ink-soft">
            上课 {(plan.stats.courseMin / 60).toFixed(1)}h · 自习 {(plan.stats.studyMin / 60).toFixed(1)}h ·
            留白 {(plan.stats.blankMin / 60).toFixed(1)}h · {plan.stats.blockCount} 个块
          </span>
        </div>
        {issues.length === 0 ? (
          <p className="mt-2 text-[12px] text-green-700">没有发现问题 —— 转场余量都在安全范围内。</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {issues.map((iss, i) => (
              <li key={i} className={`rounded-md border px-2.5 py-1.5 text-[12px] leading-snug ${ISSUE_STYLE[iss.level]}`}>
                [{iss.level === 'error' ? '会迟到' : iss.level === 'warn' ? '偏紧' : '提示'}] {iss.message}
              </li>
            ))}
          </ul>
        )}
        {notes.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-ink/10 pt-2">
            {notes.map((n, i) => (
              <li key={i} className="text-[11.5px] text-ink-faint">· {n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
