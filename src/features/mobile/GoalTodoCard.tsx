/**
 * 光溯移动端 · 目标 + 待办常驻设置区（新任务三 Wave 4 · D1；M1 改造 2026-10-07）
 * ============================================================
 * 三列表：目标（1-3）/ 最近待办 / 中长期待办。
 * M1（CY 反馈⑥「压根没有待办目标的设置区域」）：此卡**不再 4 秒淡出** ——
 * 标题行常驻，默认展开；用户点「收起」后保持收起（localStorage 持久化），
 * 但标题行永远在（可随时点开）。「+ 记一条」随时聚焦输入框。
 * 逾期/将到期（memoNeedsAttention）→ 自动展开 + 角标（保留原行为）。
 * 左滑露出「完成 / 归档」；**最近待办打勾即完成，中长期必须填粗粒度完成期**
 *（上/中/下旬 + 年月，不精确到日）—— 两条完成流程行为不同，tests/mobile/memoStore.test.ts 锁住。
 * 即时正反馈（CY：「办完一桩心事」）：打勾动画 + 文案 1.8s 自动消失，不遮挡主界面。
 */
import { useEffect, useRef, useState } from 'react';
import { plannedDoneLabel, todoScheduleHint, type Todo } from './lib/memoTypes.ts';
import { Icon } from '@/components/icons/Icon';
import {
  canAddGoal, openTodoCount, sortTodosForView,
  type MemoData,
} from './lib/memoStore.ts';

const PARTS = ['上旬', '中旬', '下旬'] as const;

export interface GoalTodoHandlers {
  onComplete: (id: string, plannedDone?: string) => void;
  onArchive: (id: string) => void;
  onAddTodo: (title: string, kind: Todo['kind']) => void;
  onToggleMilestone: (goalId: string, msId: string) => void;
  onAddMilestone: (goalId: string, title: string) => void;
}

/** 左滑待办行：位移 + 露出动作；完成/归档按钮 ≥44px 拇指命中区 */
function TodoRow({ todo, onPressDone, onArchive, feedback }: {
  todo: Todo;
  /** 完成走卡片统一入口（正反馈 / 长期必填时段的分流都在那里） */
  onPressDone: () => void;
  onArchive: () => void;
  feedback: { id: string; kind: 'ok' | 'blocked' } | null;
}) {
  const [dx, setDx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const startX = useRef<number | null>(null);
  const done = todo.completion === 'done';
  const offset = revealed ? -120 : dx;
  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    setRevealed(false);
    setDx(Math.min(0, Math.max(-120, e.touches[0].clientX - startX.current)));
  };
  const onTouchEnd = () => {
    setRevealed(dx < -60);
    setDx(0);
    startX.current = null;
  };
  return (
    <div className="relative overflow-hidden rounded-xl" data-testid="m-todo-row">
      <div className="absolute inset-y-0 right-0 flex">
        <button type="button" data-testid="m-todo-done-btn" onClick={onPressDone}
          className="h-11 w-14 bg-ok text-xs font-bold text-white">完成</button>
        <button type="button" data-testid="m-todo-archive-btn" onClick={onArchive}
          className="h-11 w-14 bg-ink/40 text-xs font-bold text-white">收起</button>
      </div>
      <div
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onClick={() => setRevealed((v) => !v)}
        style={{ transform: `translateX(${offset}px)`, transition: startX.current === null ? 'transform 0.15s' : 'none' }}
        className={`relative flex cursor-pointer items-center gap-2 bg-paper-sunken px-3 py-2 ${done ? 'opacity-50' : ''}`}
      >
        <span className={`h-4 w-4 shrink-0 rounded-full border ${done ? 'border-ok bg-ok' : 'border-ink/30'}`}
          aria-hidden>{done ? '✓' : ''}</span>
        <span className={`min-w-0 flex-1 truncate text-xs text-ink ${done ? 'line-through' : ''}`}>
          {todo.title}
        </span>
        {feedback?.id === todo.id && (
          <span data-testid="m-todo-feedback"
            className={`shrink-0 text-[11px] font-semibold ${feedback.kind === 'ok' ? 'text-ok' : 'text-danger'}`}>
            {feedback.kind === 'ok' ? (
              <span className="inline-flex items-center gap-1">
                <Icon name="check" size="xs" className="shrink-0" />
                办完一桩心事
              </span>
            ) : (
              '要填完成时间'
            )}
          </span>
        )}
        {/* M1c：排程状态回显（与网页端 S3a 同口径）—— 已排进才显示，不制造噪音 */}
        {!done && todo.scheduledBlockId && (
          <span data-testid="m-todo-sched-hint" className="shrink-0 text-[10px] font-medium text-ok">
            {todoScheduleHint(todo)}
          </span>
        )}
        {todo.plannedDone && todo.kind === 'longterm' && (
          <span className="shrink-0 text-[11px] text-ink-faint">{plannedDoneLabel(todo.plannedDone)}</span>
        )}
      </div>
    </div>
  );
}

export default function GoalTodoCard({ data, attention, syncError, h }: {
  data: MemoData;
  /** 有到期/逾期 → 自动展开 + 角标 */
  attention: boolean;
  /** M2c：同步失败 → 卡内 amber 告警条（与网页端 W1-P0-2 同一文案体系，不另起一套） */
  syncError?: boolean;
  h: GoalTodoHandlers;
}) {
  // M1a：展开态持久化（usst.mobile.goalCardOpen）；默认展开。不再 4 秒淡出。
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('usst.mobile.goalCardOpen') !== '0'; } catch { return true; }
  });
  const [feedback, setFeedback] = useState<{ id: string; kind: 'ok' | 'blocked' } | null>(null);
  const [pickTodo, setPickTodo] = useState<string | null>(null); // longterm 正在选完成期
  const [ym, setYm] = useState(() => new Date().toISOString().slice(0, 7));
  const [part, setPart] = useState<(typeof PARTS)[number]>('中旬');
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<Todo['kind']>('recent');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setOpenPersist = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem('usst.mobile.goalCardOpen', v ? '1' : '0'); } catch { /* 无存储时仅本次生效 */ }
  };

  // M1a：逾期/待办将到期 → 自动展开（收起状态被顶开是有声的：有角标说明为什么）
  useEffect(() => {
    if (attention) setOpen(true);
  }, [attention]);

  // 中长期待办点了「完成」要填时段 → 此时自动展开，保证选择器可见
  useEffect(() => {
    if (pickTodo) setOpen(true);
  }, [pickTodo]);

  const flash = (id: string, kind: 'ok' | 'blocked') => {
    setFeedback({ id, kind });
    window.setTimeout(() => setFeedback(null), 1800);
  };
  const complete = (t: Todo) => {
    if (t.kind === 'longterm' && t.completion !== 'done') {
      setPickTodo(t.id); // 必须填时间：打开粗粒度选择器（不弹系统框）
      return;
    }
    h.onComplete(t.id);
    flash(t.id, 'ok');
  };
  const confirmLongterm = () => {
    if (!pickTodo) return;
    const id = pickTodo;
    setPickTodo(null);
    h.onComplete(id, `${ym}-${part}`);
    flash(id, 'ok');
  };

  // M1b：「+ 记一条」= 展开卡片 + 直接聚焦输入框（不依赖展开动画，任何时候都能记）
  const quickAdd = () => {
    setOpenPersist(true);
    // 展开后输入框才挂载 → 等一帧再聚焦
    window.setTimeout(() => inputRef.current?.focus(), 30);
  };

  const goals = data.goals.filter((g) => !g.archived);
  const recent = sortTodosForView(data.todos.filter((t) => t.kind === 'recent'));
  const longterm = sortTodosForView(data.todos.filter((t) => t.kind === 'longterm'));

  return (
    <section data-testid="m-goal-card" className="rounded-card bg-paper-card p-4 shadow-sm">
      {/* M1b：标题行 = 显式开合入口 + 「+ 记一条」快速出口（常驻，收起时也在） */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="m-goal-card-toggle"
          aria-expanded={open}
          onClick={() => setOpenPersist(!open)}
          className="text-sm font-bold text-ink"
        >
          目标与待办 <span className="text-ink-faint">({openTodoCount(data)})</span> {open ? '▴' : '▾'}
        </button>
        <div className="flex items-center gap-2">
          {attention && (
            <span data-testid="m-goal-attention" className="rounded-full bg-accent-light px-2 py-0.5 text-[10px] font-semibold text-danger">有待办到期</span>
          )}
          <button type="button" data-testid="m-todo-quick-add" onClick={quickAdd}
            className="rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white">+ 记一条</button>
        </div>
      </div>

      {open && (
        <>
          {/* M2c：同步失败时如实告警（amber，与网页端 memo-write-error 同口径） */}
          {syncError && (
            <p data-testid="m-todo-sync-warn" className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
              未同步 · 已存在本机 —— 联网后会自动补传。
            </p>
          )}
          {/* 目标（1-3）+ 里程碑 */}
          <div className="mt-2 space-y-1" data-testid="m-goal-list">
            {goals.map((g) => (
              <div key={g.id} className="rounded-xl bg-brand-light/60 px-3 py-2">
                <p className="flex items-center gap-1 text-xs font-semibold text-ink"><Icon name="target" size="xs" className="shrink-0" />{g.title}</p>
                {(g.milestones ?? []).map((m) => (
                  <button key={m.id} type="button" onClick={() => h.onToggleMilestone(g.id, m.id)}
                    className={`mt-0.5 block text-left text-[11px] ${m.done ? 'text-ink-faint line-through' : 'text-ink-soft'}`}>
                    <span className="inline-flex items-center gap-1">
                      <Icon name={m.done ? 'check-square' : 'mg-square'} size="xs" className="shrink-0" />
                      {m.title}
                    </span>
                  </button>
                ))}
                {(g.milestones ?? []).length === 0 && (
                  <p className="mt-0.5 text-[11px] text-ink-faint">还没有里程碑 —— 在网页端拆解，或点下面「记一条」挂上去</p>
                )}
                <button type="button" data-testid="m-goal-add-ms" onClick={() => h.onAddMilestone(g.id, '下一步：')}
                  className="mt-1 text-[11px] text-brand underline">+ 里程碑</button>
              </div>
            ))}
            {goals.length === 0 && (
              <p className="text-[11px] text-ink-faint">还没有目标（最多 3 个 {canAddGoal(data) ? '' : '· 已满'}）</p>
            )}
          </div>

          {/* 最近待办：打勾即完成，不要求时间 */}
          <p className="mt-3 text-[11px] font-semibold tracking-wide text-ink-soft">最近待办（左滑可完成/收起）</p>
          <div className="mt-1 space-y-1" data-testid="m-todo-recent">
            {recent.slice(0, 4).map((t) => (
              <TodoRow key={t.id} todo={t} onPressDone={() => complete(t)} onArchive={() => h.onArchive(t.id)} feedback={feedback} />
            ))}
            {recent.length === 0 && (
              <p className="text-[11px] text-ink-faint">还没有待办 —— 点「+ 记一条」随手记下，网页端排计划时会带上它。</p>
            )}
          </div>

          {/* 中长期待办：打勾必须填完成时间（粗粒度） */}
          <p className="mt-3 text-[11px] font-semibold tracking-wide text-ink-soft">中长期待办（完成时记时段，不怕忘）</p>
          <div className="mt-1 space-y-1" data-testid="m-todo-long">
            {longterm.slice(0, 4).map((t) => (
              <TodoRow key={t.id} todo={t} onPressDone={() => complete(t)} onArchive={() => h.onArchive(t.id)} feedback={feedback} />
            ))}
            {longterm.length === 0 && (
              <p className="text-[11px] text-ink-faint">还没有中长期待办 —— 点「+ 记一条」后选「记长期」。</p>
            )}
          </div>
        </>
      )}

      {/* 粗粒度完成期选择器（年月 + 上/中/下旬）—— pickTodo 时已自动展开 */}
      {pickTodo && (
        <div data-testid="m-todo-period-picker" className="mt-2 rounded-xl border border-brand/40 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold text-ink">大概什么时候能办完？（不用精确到日）</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input type="month" value={ym} onChange={(e) => setYm(e.target.value)}
              data-testid="m-todo-period-month"
              className="rounded-lg border border-ink/15 px-2 py-1 text-xs" />
            {PARTS.map((p) => (
              <button key={p} type="button" onClick={() => setPart(p)}
                className={`rounded-lg px-2 py-1 text-xs ${part === p ? 'bg-brand text-white' : 'bg-paper-sunken text-ink-soft'}`}>
                {p}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" data-testid="m-todo-period-confirm" onClick={confirmLongterm}
              className="h-11 flex-1 rounded-xl bg-ok text-sm font-bold text-white">就这个，完成 ✓</button>
            <button type="button" onClick={() => setPickTodo(null)}
              className="h-11 flex-1 rounded-xl border border-ink/15 text-sm text-ink-soft">再想想</button>
          </div>
        </div>
      )}

      {/* 快速记录 —— M1b：「+ 记一条」聚焦到这里；回车默认记最近 */}
      <div className="mt-3 flex gap-2">
        <input ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim()) { h.onAddTodo(newTitle.trim(), 'recent'); setNewTitle(''); } }}
          data-testid="m-todo-input" placeholder="随手记一条…"
          className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-3 py-2 text-xs" />
        <button type="button" data-testid="m-todo-add-recent"
          onClick={() => { if (newTitle.trim()) { h.onAddTodo(newTitle.trim(), 'recent'); setNewTitle(''); } }}
          className="rounded-xl bg-paper-sunken px-3 py-2 text-xs font-semibold text-ink">记最近</button>
        <button type="button" data-testid="m-todo-add-long"
          onClick={() => { if (newTitle.trim()) { h.onAddTodo(newTitle.trim(), 'longterm'); setNewTitle(''); } }}
          className="rounded-xl bg-paper-sunken px-3 py-2 text-xs font-semibold text-ink">记长期</button>
      </div>
    </section>
  );
}
