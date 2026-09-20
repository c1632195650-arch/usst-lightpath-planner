/**
 * 目标管理（R5.1）+ 成就面板（R5.4）
 * ============================================================
 * 两块放在一起：它们本来就是同一件事的两面 ——
 * 「我想做成什么」和「我已经投入了多少」。分开写会让两块 UI 各自维护一份
 * 目标筛选逻辑，改动必然不同步。
 *
 * 所有数字都由 `aggregate.ts` 现算 —— 面板里没有一个「累计值」被存下来。
 */
import { useMemo, useState } from 'react';
import {
  DEFAULT_EMOJI, GOAL_KIND_LABEL, GOAL_PACE_LABEL, loadGoals, makeGoalId, removeGoal, saveGoals,
  withPace, type Goal, type GoalKind, type GoalPace,
} from './goalStore';
import { loadActivityLog, type ActivityEntry } from './activityStore';
import { humanHours, summarizeRange, totalForGoal } from './aggregate';

const KINDS: GoalKind[] = ['contest', 'interest', 'study', 'habit'];
const PACES: GoalPace[] = ['sprint', 'steady', 'both'];

/** 「今天」的 ISO（UI 层读时钟允许；纯函数不许 —— 与 behaviorLog 同一口径） */
function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 距截止还有几天（负数 = 已过期） */
function daysUntil(dueAt: string): number {
  const due = new Date(`${dueAt}T23:59:59`);
  return Math.ceil((due.getTime() - new Date().getTime()) / 86400000);
}

export function GoalEditor({
  goals, onChange,
}: {
  goals: readonly Goal[];
  onChange: (next: Goal[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<GoalKind>('contest');
  const [target, setTarget] = useState('');
  const [dueAt, setDueAt] = useState('');
  /** 待选节奏的目标（提交后弹三选一；用户拍板：先弹窗询问，之后可改） */
  const [paceAsk, setPaceAsk] = useState<Goal | null>(null);

  const commitGoal = (g: Goal) => {
    const next = [...goals, g];
    saveGoals(next);
    onChange(next);
    setTitle('');
    setTarget('');
    setDueAt('');
    setOpen(false);
  };

  const submit = () => {
    if (!title.trim()) return;
    const g: Goal = {
      id: makeGoalId(),
      title: title.trim(),
      emoji: DEFAULT_EMOJI[kind],
      kind,
      source: 'manual',
      ...(Number(target) > 0 ? { targetMinutes: Number(target) * 60 } : {}),
      ...(dueAt ? { dueAt } : {}),
    };
    // 有截止日期 → 问节奏（sprint/steady/both）；没有 → 不猜，直接存（不排程）
    if (g.dueAt) setPaceAsk(g);
    else commitGoal(g);
  };

  const setGoalPace = (g: Goal, pace: GoalPace) => {
    commitGoal(withPace(g, pace));
    setPaceAsk(null);
  };

  /** 改既有目标的节奏（列表里的三档点选，改完下次重排生效） */
  const updatePace = (id: string, pace: GoalPace) => {
    const next = goals.map((g) => (g.id === id ? withPace(g, pace) : g));
    saveGoals(next);
    onChange(next);
  };

  return (
    <div className="mt-2 border-t border-ink/10 pt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-medium text-ink">我的目标</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded bg-white px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50"
        >
          {open ? '收起' : '＋ 加一个'}
        </button>
      </div>

      {goals.length === 0 && !open && (
        <p className="mt-1 text-[11px] text-ink-faint">
          加了目标之后，登记投入时就能挂上去 —— 学期末才知道哪件事真的占了时间。
        </p>
      )}

      <ul className="mt-1.5 space-y-1.5">
        {goals.map((g) => {
          const left = g.dueAt ? daysUntil(g.dueAt) : null;
          return (
            <li key={g.id} className="text-[11.5px] text-ink-soft">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-ink">{g.emoji} {g.title}</span>
                <span className="text-[10.5px] text-ink-faint">{GOAL_KIND_LABEL[g.kind]}</span>
                {g.targetMinutes && <span className="text-[10.5px] text-ink-faint">目标 {humanHours(g.targetMinutes)}</span>}
                {left != null && (
                  <span className={`text-[10.5px] ${left <= 14 ? 'font-semibold text-red-600' : 'text-ink-faint'}`}>
                    {left < 0 ? '已过截止' : `距截止 ${left} 天`}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const next = removeGoal(goals, g.id);
                    saveGoals(next);
                    onChange(next);
                  }}
                  className="rounded px-1 text-[10.5px] text-ink-faint hover:text-red-600"
                >
                  删除
                </button>
              </div>
              {/* 节奏切换 —— 三档点选，改完下次「重新排一遍」生效 */}
              {g.dueAt && (
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  <span className="text-[10.5px] text-ink-faint">节奏：</span>
                  {PACES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => updatePace(g.id, p)}
                      title="改动会在下次「重新排一遍」时生效"
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        g.pace === p
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-ink-soft ring-1 ring-ink/15 hover:bg-indigo-50'
                      }`}
                    >
                      {GOAL_PACE_LABEL[p]}
                    </button>
                  ))}
                  {!g.pace && <span className="text-[10px] text-ink-faint">（未选 —— 暂不排进日程）</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {open && (
        <div className="mt-1.5 space-y-1.5 rounded-md border border-ink/10 bg-white/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="比如：数学建模国赛"
              className="min-w-0 flex-1 rounded border border-ink/20 bg-white px-1.5 py-0.5 text-[11.5px]"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as GoalKind)}
              className="rounded border border-ink/20 bg-white px-1.5 py-0.5 text-[11.5px]"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>{GOAL_KIND_LABEL[k]}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="目标小时"
              className="w-20 rounded border border-ink/20 bg-white px-1.5 py-0.5 text-[11.5px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-[11.5px] text-ink-soft">截止日期</span>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              min={todayISO()}
              className="rounded border border-ink/20 bg-white px-1.5 py-0.5 text-[11.5px]"
            />
            <span className="text-[10.5px] text-ink-faint">填了才会问「投入节奏」并排进日程</span>
          </div>
          <button
            type="button"
            onClick={submit}
            className="rounded bg-slate-800 px-2.5 py-0.5 text-[11.5px] font-medium text-white"
          >
            记下
          </button>
        </div>
      )}

      {/* 节奏三选一 —— 用户拍板的流程：设立带截止日期的目标后弹窗询问 */}
      {paceAsk && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg">
            <h3 className="text-[14px] font-semibold text-ink">「{paceAsk.title}」打算怎么投入？</h3>
            <p className="mt-1 text-[11.5px] text-ink-soft">
              截止 {paceAsk.dueAt}。以后随时可以在目标列表里改。
            </p>
            <div className="mt-3 grid gap-2">
              {PACES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setGoalPace(paceAsk, p)}
                  className="flex min-h-11 items-center gap-3 rounded-xl border border-ink/10 bg-paper px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:border-brand/40 hover:bg-brand-light/45"
                >
                  {GOAL_PACE_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AchievementPanel({ weekNo }: { weekNo: number }) {
  const [goals, setGoals] = useState<Goal[]>(() => loadGoals());
  const [entries] = useState(() => loadActivityLog());
  /** 「学期至今」= 第 1 周到本周 —— 它就是用户问「这学期花了多少」的那个区间 */
  const range = useMemo(() => summarizeRange(entries, 1, weekNo, goals), [entries, weekNo, goals]);

  return (
    <div className="panel px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-[14px] font-semibold text-ink">投入与成就</h3>
        <span className="text-[11.5px] text-ink-soft">
          第 1–{weekNo} 周共 {range.count} 笔 · {humanHours(range.totalMin)}
        </span>
      </div>

      {range.count === 0 ? (
        <p className="mt-1.5 text-[11.5px] text-ink-faint">
          还没登记过 —— 空闲时段旁边点「记一笔」就行，不想说也可以跳过。
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {range.byGoal.filter((g) => g.minutes > 0).map((g) => (
            <li key={g.goalId} className="text-[11.5px]">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-ink">{g.emoji} {g.title}</span>
                <span className="text-ink-soft">{humanHours(g.minutes)}</span>
                {g.progress != null && (
                  <span className="text-[10.5px] text-ink-faint">
                    完成 {Math.round(g.progress * 100)}%
                  </span>
                )}
              </div>
              {g.targetMinutes && (
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-black/5">
                  <div
                    className="h-full rounded-full bg-teal-500"
                    style={{ width: `${Math.min(100, Math.round((g.minutes / g.targetMinutes) * 100))}%` }}
                  />
                </div>
              )}
            </li>
          ))}
          {range.byTag.map((t) => (
            <li key={t.tag} className="text-[11.5px] text-ink-soft">
              {t.tag === 'interest' ? '兴趣' : t.tag === 'goal' ? '长期目标' : '其它'}：{humanHours(t.minutes)}
            </li>
          ))}
        </ul>
      )}

      <GoalEditor goals={goals} onChange={setGoals} />
    </div>
  );
}

export function goalTotalOf(list: ActivityEntry[], goalId: string): number {
  return totalForGoal(list, goalId);
}
