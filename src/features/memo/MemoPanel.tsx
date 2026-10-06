/**
 * 网页端待办工作区（任务四 W1 · 主面板）
 * ============================================================
 * 数据流：本地缓存（离线可看）→ GET /api/sync/state 并集合并 → 展示；
 * 每次操作走 `withCloudMemo`（读-改-写，服务端按 id 逐项 LWW 保护并发）→
 * 成功后落地缓存。未登录 = 本地模式（诚实标注，不上网）。
 *
 * 🔴 两类待办的完成流程**必须不同**（CY 核心要求，tests 锁定）：
 *   · 最近待办：打勾即完成，不弹时间选择；
 *   · 中长期待办：打勾**必须**填粗粒度时段（上/中/下旬 + 年月），未填不能确认。
 * 归档而非删除（archived）。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  addGoal, addGoalMilestone, addTodo, archiveGoal, archiveTodo, canAddGoal,
  patchTodoDetail, sortTodosForView, toggleGoalMilestone, toggleTodoDone,
  type MemoData,
} from '@/features/mobile/lib/memoStore.ts';
import { plannedDoneLabel, type Goal, type Todo } from '@/features/mobile/lib/memoTypes.ts';
import { loadIdentity } from '@/features/mobile/lib/auth.ts';
import { filterTodos, tagsOf, updateTodoTitle, type TodoFilter } from './memoLogic.ts';
import { readCachedMemo, withCloudMemo, writeCachedMemo } from './webMemo.ts';
import TodoList from './TodoList.tsx';
import TodoEditor, { type TodoDraft } from './TodoEditor.tsx';
import GoalPanel from './GoalPanel.tsx';
import { monthOptions, periodLabel, periodValues, suggestPeriod } from './milestonePicker.ts';

const nowIso = () => new Date().toISOString();

export default function MemoPanel() {
  const [data, setData] = useState<MemoData>(() => readCachedMemo());
  const [filter, setFilter] = useState<TodoFilter>({ q: '', tag: null, state: 'open' });
  const [editorFor, setEditorFor] = useState<Todo | 'new' | null>(null);
  /** 中长期待办打勾 → 先在这里确认时段（未选不能确认） */
  const [askDone, setAskDone] = useState<Todo | null>(null);
  const [askPeriod, setAskPeriod] = useState('');
  const [sync, setSync] = useState<'local' | 'synced' | 'offline'>('local');
  const token = loadIdentity()?.token ?? '';

  useEffect(() => {
    if (!token) { setSync('local'); return; }
    let cancelled = false;
    void withCloudMemo(token, (d) => d).then((r) => {
      if (cancelled || !r) { if (!cancelled) setSync('offline'); return; }
      setData(r.data);
      writeCachedMemo(r.data);
      setSync('synced');
    });
    return () => { cancelled = true; };
  }, [token]);

  /** 单项操作标准路径：登录 = 读-改-写云端；未登录 = 改本地缓存（不静默装作已同步） */
  const mutate = (fn: (d: MemoData) => MemoData) => {
    if (!token) {
      const next = fn(data);
      setData(next);
      writeCachedMemo(next);
      return;
    }
    setSync('offline'); // 写入中先给「未同步」提示，成功后回 synced
    void withCloudMemo(token, fn).then((r) => {
      if (!r) return; // 网络失败：保持本地态，状态灯如实显示
      setData(r.data);
      writeCachedMemo(r.data);
      setSync('synced');
    });
  };

  /** 打勾/撤销（两类分流在此：recent 直勾；longterm 未完成 → 弹时段确认） */
  const onToggle = (t: Todo) => {
    if (t.completion === 'done') {
      mutate((d) => toggleTodoDone(d, t.id, { nowIso: nowIso(), uncomplete: true }).data);
      return;
    }
    if (t.kind === 'longterm') {
      setAskDone(t);
      setAskPeriod(suggestPeriod(new Date()));
      return;
    }
    mutate((d) => toggleTodoDone(d, t.id, { nowIso: nowIso() }).data);
  };

  const confirmLongtermDone = () => {
    if (!askDone || !askPeriod) return; // 未选时段 = 不完成（硬规则）
    const pd = askPeriod;
    mutate((d) => {
      const r = toggleTodoDone(d, askDone.id, { nowIso: nowIso(), plannedDone: pd });
      return r.ok ? r.data : d;
    });
    setAskDone(null);
  };

  const onSubmitEditor = (draft: TodoDraft) => {
    if (editorFor === 'new') {
      mutate((d) => addTodo(d, { title: draft.title, kind: draft.kind, nowIso: nowIso(), note: draft.note, tags: draft.tags, goalId: draft.goalId }));
    } else if (editorFor) {
      mutate((d) => {
        let next = updateTodoTitle(d, editorFor.id, draft.title, nowIso());
        next = patchTodoDetail(next, editorFor.id, {
          ...(draft.note !== undefined ? { note: draft.note } : {}),
          ...(draft.tags !== undefined ? { tags: draft.tags } : {}),
          ...(draft.goalId !== undefined ? { goalId: draft.goalId } : {}),
        }, nowIso());
        return next;
      });
    }
    setEditorFor(null);
  };

  const recent = sortTodosForView(filterTodos(data.todos.filter((t) => t.kind === 'recent'), filter));
  const longterm = sortTodosForView(filterTodos(data.todos.filter((t) => t.kind === 'longterm'), filter));
  const tags = useMemo(() => tagsOf(data.todos), [data.todos]);
  const months = useMemo(() => monthOptions(new Date(), 6), []);

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="memo-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">待办</h2>
          <p className="mt-0.5 text-[12px] text-ink-soft">记下来，剩下的交给排程 —— 网页端排计划时会带上这里的未完成事项。</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="memo-sync-state"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
              sync === 'synced' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : sync === 'offline' ? 'bg-amber-50 text-amber-700 ring-amber-200'
                  : 'bg-paper text-ink-faint ring-ink/10'}`}
          >
            {sync === 'synced' ? '已同步' : sync === 'offline' ? '未同步（本地）' : '本地模式（未登录）'}
          </span>
          <button
            type="button"
            data-testid="memo-add"
            onClick={() => setEditorFor('new')}
            className="button-primary px-3 py-1.5 text-[12px]"
          >
            + 新待办
          </button>
        </div>
      </div>

      {/* 筛选/搜索（网页端专属） */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <input
          data-testid="memo-search"
          value={filter.q}
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
          placeholder="搜标题或备注…"
          className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-paper px-3 py-1.5 text-[12px] outline-none focus:border-ink/40"
        />
        <select
          data-testid="memo-state-filter"
          value={filter.state}
          onChange={(e) => setFilter((f) => ({ ...f, state: e.target.value as TodoFilter['state'] }))}
          className="rounded-xl border border-ink/15 bg-paper px-2 py-1.5 text-[12px]"
        >
          <option value="open">未完成</option>
          <option value="done">已完成</option>
          <option value="all">全部</option>
        </select>
        {tags.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-1" data-testid="memo-tag-bar">
            <button
              type="button"
              onClick={() => setFilter((f) => ({ ...f, tag: null }))}
              className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${filter.tag == null ? 'bg-ink text-paper ring-ink' : 'bg-white text-ink-soft ring-ink/10'}`}
            >
              全部标签
            </button>
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                data-testid={`memo-tag-${tag}`}
                onClick={() => setFilter((f) => ({ ...f, tag: f.tag === tag ? null : tag }))}
                className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${filter.tag === tag ? 'bg-ink text-paper ring-ink' : 'bg-white text-ink-soft ring-ink/10'}`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="panel p-4" data-testid="memo-recent-section">
        <h3 className="text-sm font-semibold text-ink">最近待办</h3>
        <p className="mt-0.5 text-[11px] text-ink-faint">办好打勾就行，不用填时间。</p>
        <div className="mt-2">
          <TodoList
            todos={recent}
            onToggle={onToggle}
            onArchive={(t) => mutate((d) => archiveTodo(d, t.id, nowIso()))}
            onEdit={(t) => setEditorFor(t)}
          />
        </div>
      </section>

      <section className="panel p-4" data-testid="memo-longterm-section">
        <h3 className="text-sm font-semibold text-ink">中长期待办</h3>
        <p className="mt-0.5 text-[11px] text-ink-faint">完成时要填一个粗略时段 —— 怕你忘掉自己是哪天办成的。</p>
        <div className="mt-2">
          <TodoList
            todos={longterm}
            onToggle={onToggle}
            onArchive={(t) => mutate((d) => archiveTodo(d, t.id, nowIso()))}
            onEdit={(t) => setEditorFor(t)}
          />
        </div>
      </section>

      <GoalPanel
        goals={data.goals}
        todos={data.todos}
        canAdd={canAddGoal(data)}
        onAddGoal={(title, why) => mutate((d) => addGoal(d, { title, why, nowIso: nowIso() }).data)}
        onAddMilestone={(goalId, title) => mutate((d) => addGoalMilestone(d, goalId, { title }, nowIso()))}
        onToggleMilestone={(goalId, msId) => mutate((d) => toggleGoalMilestone(d, goalId, msId, nowIso()))}
        onArchiveGoal={(goalId) => mutate((d) => archiveGoal(d, goalId, nowIso()))}
      />

      {editorFor && (
        <TodoEditor
          editing={editorFor === 'new' ? null : editorFor}
          goals={data.goals}
          onCancel={() => setEditorFor(null)}
          onSubmit={onSubmitEditor}
        />
      )}

      {/* 中长期待办完成确认：未选时段不能确认（阻止并提示，不静默跳过） */}
      {askDone && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30 p-4 sm:items-center" data-testid="planned-done-dialog">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-ink">什么时候办成的？</h3>
            <p className="mt-1 text-[12px] text-ink-soft">「{askDone.title}」—— 选个大概时段就行，不精确到日。</p>
            <div className="mt-3 flex gap-2">
              <select
                data-testid="planned-done-month"
                value={askPeriod.slice(0, 7)}
                onChange={(e) => setAskPeriod(`${e.target.value}-中旬`)}
                className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-paper px-2 py-1.5 text-[12px]"
              >
                {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <div className="flex gap-1 rounded-xl border border-ink/10 bg-paper p-1">
                {periodValues(askPeriod.slice(0, 7)).map((v) => (
                  <button
                    key={v}
                    type="button"
                    data-testid={`planned-done-tail-${v.slice(8)}`}
                    onClick={() => setAskPeriod(v)}
                    className={`nav-item whitespace-nowrap ${askPeriod === v ? 'nav-item-active' : ''}`}
                  >
                    {v.slice(8)}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">将记为：{periodLabel(askPeriod) || plannedDoneLabel(askPeriod)}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAskDone(null)} className="rounded-lg px-4 py-1.5 text-[12px] text-ink-soft ring-1 ring-ink/15 transition-colors hover:bg-paper">还没办成</button>
              <button
                type="button"
                data-testid="planned-done-confirm"
                disabled={!askPeriod}
                onClick={confirmLongtermDone}
                className="button-primary px-4 py-1.5 text-[12px] disabled:opacity-40"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { Goal, Todo };
