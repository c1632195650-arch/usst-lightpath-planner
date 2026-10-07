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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addGoal, addGoalMilestone, addTodo, archiveGoal, archiveTodo, canAddGoal,
  patchTodoDetail, sortTodosForView, toggleGoalMilestone, toggleTodoDone,
  type MemoData,
} from '@/features/mobile/lib/memoStore.ts';
import { plannedDoneLabel, type Goal, type Todo } from '@/features/mobile/lib/memoTypes.ts';
import { loadIdentity } from '@/features/mobile/lib/auth.ts';
import { filterTodos, tagsOf, updateTodoTitle, todosToPendingTodos, groupTodosForBoard, type TodoFilter } from './memoLogic.ts';
import { loadAssignments } from '@/features/week/assignmentStore';
import { readCachedMemo, withCloudMemo, writeCachedMemo } from './webMemo.ts';
import TodoList from './TodoList.tsx';
import TodoEditor, { type TodoDraft } from './TodoEditor.tsx';
import GoalPanel from './GoalPanel.tsx';
import { Icon } from '@/components/icons/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Tag } from '@/components/ui/Tag';
import { monthOptions, periodLabel, periodValues, suggestPeriod } from './milestonePicker.ts';

const nowIso = () => new Date().toISOString();

/** S3b：排程锚点 —— 状态条用「当前周会带上几条待办」作口径；App 传入（本组件不持有课表） */
export interface MemoPlanAnchor {
  termStart: string;
  weekNo: number;
}

/** §11.5 顶部范围分段的三个取值（与 TodoFilter.state 同域）。 */
type StateScope = 'open' | 'done' | 'all';

export default function MemoPanel({ planAnchor, onGotoPlan }: {
  /** S3b：由 App 传（schedule.termStart + 当前教学周）；缺省 = 不显示状态条 */
  planAnchor?: MemoPlanAnchor;
  /** S3a：跳「日程」页（进当前周计划）的出口 */
  onGotoPlan?: () => void;
} ) {
  const [data, setData] = useState<MemoData>(() => readCachedMemo());
  const [filter, setFilter] = useState<TodoFilter>({ q: '', tag: null, state: 'open' });
  const [editorFor, setEditorFor] = useState<Todo | 'new' | null>(null);
  /** 中长期待办打勾 → 先在这里确认时段（未选不能确认） */
  const [askDone, setAskDone] = useState<Todo | null>(null);
  const [askPeriod, setAskPeriod] = useState('');
  const [sync, setSync] = useState<'local' | 'synced' | 'offline'>('local');
  /** S3c：新增待办后的轻提示（不弹窗，几秒自动消失） */
  const [flash, setFlash] = useState('');
  /** P0-2：云端写失败/被拒 → 显式错误条（不静默丢输入）；记最近一次 mutate 供「重试」 */
  const [writeError, setWriteError] = useState(false);
  const lastMutateRef = useRef<((d: MemoData) => MemoData) | null>(null);
  const token = loadIdentity()?.token ?? '';

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 5000);
    return () => clearTimeout(t);
  }, [flash]);

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

  /** 单项操作标准路径：登录 = 读-改-写云端；未登录 = 改本地缓存（不静默装作已同步）。
   *  P0-2a：登录写失败 → **本地兜底**（并集 LWW：本地新条目 updatedAt 更新，
   *  下一次成功读改写会带上行）+ 显式错误条；返回 'ok' | 'offline' 供提交方分流。 */
  const mutate = async (fn: (d: MemoData) => MemoData): Promise<'ok' | 'offline'> => {
    lastMutateRef.current = fn;
    if (!token) {
      const next = fn(data);
      setData(next);
      writeCachedMemo(next);
      return 'ok';
    }
    setSync('offline'); // 写入中先给「未同步」提示，成功后回 synced
    const r = await withCloudMemo(token, fn).catch(() => null);
    if (!r) {
      // 网络失败：本地兜底入列（用户看得见），错误条常驻
      const next = fn(data);
      setData(next);
      writeCachedMemo(next);
      setWriteError(true);
      return 'offline';
    }
    setData(r.data);
    writeCachedMemo(r.data);
    if (r.accepted) {
      setSync('synced');
      setWriteError(false);
      return 'ok';
    }
    // LWW 被拒 = 服务端版本更新：已回落云端真相，但本次写没上去 —— 如实标注
    setSync('offline');
    setWriteError(true);
    return 'offline';
  };

  /** P0-2b：错误条「重试」= 重放最近一次 mutate */
  const retryLastMutate = () => {
    const fn = lastMutateRef.current;
    if (fn) void mutate(fn);
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

  const onSubmitEditor = async (draft: TodoDraft): Promise<'ok' | 'offline'> => {
    if (editorFor === 'new') {
      const r = await mutate((d) => addTodo(d, { title: draft.title, kind: draft.kind, nowIso: nowIso(), note: draft.note, tags: draft.tags, goalId: draft.goalId }));
      // S3c：闭环第一拍 —— 告诉用户这条待办下一步去哪（不弹窗，不拦人）
      setFlash('已加入待办 —— 去「日程」页生成计划就会带上它');
      setEditorFor(null);
      return r;
    }
    if (editorFor) {
      const r = await mutate((d) => {
        let next = updateTodoTitle(d, editorFor.id, draft.title, nowIso());
        next = patchTodoDetail(next, editorFor.id, {
          ...(draft.note !== undefined ? { note: draft.note } : {}),
          ...(draft.tags !== undefined ? { tags: draft.tags } : {}),
          ...(draft.goalId !== undefined ? { goalId: draft.goalId } : {}),
        }, nowIso());
        return next;
      });
      setEditorFor(null);
      return r;
    }
    return 'ok';
  };

  const recent = sortTodosForView(filterTodos(data.todos.filter((t) => t.kind === 'recent'), filter));
  const longterm = sortTodosForView(filterTodos(data.todos.filter((t) => t.kind === 'longterm'), filter));
  const tags = useMemo(() => tagsOf(data.todos), [data.todos]);
  const months = useMemo(() => monthOptions(new Date(), 6), []);
  // S3b：当前周计划会带上几条未完成待办（todosToPendingTodos 与 WeekPlanView 排程前同源）
  const pendingTodoCount = planAnchor
    ? todosToPendingTodos(data.todos, planAnchor.termStart, planAnchor.weekNo).length
    : null;
  const schedHint = { loggedIn: !!token, onGotoPlan };

  /* UI v2 D4：看板分组（今天/本周/逾期/未排/已完成）。分组推导全在 memoLogic 纯函数，
     今天由本机时钟给出（UI 层读时钟允许）；逾期行由 TodoList 按 overdueIds 双编码。 */
  const todayDow = (() => { const wd = new Date().getDay(); return wd === 0 ? 7 : wd; })();
  const todayIso = nowIso();
  const groupProps = (list: Todo[]) => {
    const g = groupTodosForBoard(list, todayDow, todayIso);
    return {
      groups: g,
      overdueIds: new Set(g.overdue.map((t) => t.id)),
    };
  };
  const recentBoard = groupProps(recent);
  const longtermBoard = groupProps(longterm);
  /** §11.5：筛选行右侧的逾期计数（逾期本来就是筛选时要看的第一眼）。 */
  const overdueCount = recentBoard.groups.overdue.length + longtermBoard.groups.overdue.length;
  /** UI v2 D4：本周作业条（assignmentStore 只读；不新增存储、不写回） */
  const weekAssignments = planAnchor
    ? loadAssignments().filter((a) => a.weekNo === planAnchor.weekNo)
    : [];
  /** 分组渲染：只在「该组有东西且不止一组有」时出小标；单组时保持原样（少一层噪声）。 */
  const renderGrouped = (board: ReturnType<typeof groupProps>, groupOrder: Array<keyof typeof board.groups>) => {
    const present = groupOrder.filter((k) => board.groups[k].length > 0);
    if (present.length === 0) {
      return <TodoList todos={[]} onToggle={onToggle} onArchive={() => {}} onEdit={() => {}} schedHint={schedHint} overdueIds={board.overdueIds} />;
    }
    if (present.length === 1) {
      return <TodoList todos={board.groups[present[0]]} onToggle={onToggle} onArchive={(t) => mutate((d) => archiveTodo(d, t.id, nowIso()))} onEdit={(t) => setEditorFor(t)} schedHint={schedHint} overdueIds={board.overdueIds} />;
    }
    const GROUP_LABEL: Record<string, string> = {
      overdue: '已逾期', today: '今天', week: '本周 / 本旬', unscheduled: '未排', done: '已完成',
    };
    return (
      <div className="flex flex-col gap-3">
        {present.map((k) => (
          <div key={k}>
            <p className={`px-1 text-[11px] font-semibold ${k === 'overdue' ? 'text-[#B0402F]' : 'text-ink-faint'}`} data-testid={`todo-group-${k}`}>
              {GROUP_LABEL[k]} · {board.groups[k].length}
            </p>
            <div className="mt-1">
              <TodoList todos={board.groups[k]} onToggle={onToggle} onArchive={(t) => mutate((d) => archiveTodo(d, t.id, nowIso()))} onEdit={(t) => setEditorFor(t)} schedHint={schedHint} overdueIds={board.overdueIds} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="memo-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
            <Icon name="inbox" size="md" className="shrink-0 text-brand" />
            待办
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-soft">记下来，剩下的交给排程 —— 网页端排计划时会带上这里的未完成事项。</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="memo-sync-state"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
              sync === 'synced' ? 'bg-ok-light text-ok ring-ok/25'
                : sync === 'offline' ? 'bg-warn-light text-warn-text ring-warn/25'
                  : 'bg-paper text-ink-faint ring-ink/10'}`}
          >
            <Icon name={sync === 'synced' ? 'cloud' : 'cloud-off'} size="xs" className="inline-block align-[-2px]" />
            {' '}
            {sync === 'synced' ? '已同步' : sync === 'offline' ? '未同步（本地）' : '本地模式（未登录）'}
          </span>
          <button
            type="button"
            data-testid="memo-add"
            onClick={() => setEditorFor('new')}
            className="button-primary inline-flex items-center gap-1 px-3 py-1.5 text-[12px]"
          >
            <Icon name="plus" size="sm" />
            新待办
          </button>
        </div>
      </div>

      {/* P0-2b：云端写失败/被拒 → 显式错误条（不再静默丢输入），带「重试」；下次成功自动清除 */}
      {writeError && (
        <div
          data-testid="memo-write-error"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/30 bg-warn-light px-4 py-2.5 text-[12px] text-warn-text"
        >
          <span>这次没连上云端，已先存在本机 —— 联网后会自动补传。</span>
          <button
            type="button"
            onClick={retryLastMutate}
            className="rounded-lg bg-white px-3 py-1 font-medium text-warn-text ring-1 ring-warn/30 transition-colors hover:bg-warn-light"
          >
            重试
          </button>
        </div>
      )}

      {/* S3b：待办 → 日程的可见闭环状态条（CY 反馈③：加了待办要看得见它去哪了） */}
      {pendingTodoCount != null && (
        <div
          data-testid="memo-plan-link"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/10 bg-white px-4 py-2.5 text-[12px] text-ink-soft"
        >
          <span>
            {pendingTodoCount > 0
              ? <>本次排程带上了 <b className="text-ink">{pendingTodoCount}</b> 条待办{flash ? '' : ' —— 去「日程」页生成或重算就会排进去'}</>
              : '待办还没进本周计划 —— 去「日程」页生成一次'}
          </span>
          <span className="flex items-center gap-2">
            {flash && <span className="text-ok">{flash}</span>}
            {onGotoPlan && (
              <button
                type="button"
                onClick={onGotoPlan}
                className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-ink-soft ring-1 ring-ink/15 transition-colors hover:bg-paper"
              >
                去「日程」页 →
              </button>
            )}
          </span>
        </div>
      )}

      {/* 筛选行（§11.5：顶部范围分段控件 + 右侧逾期计数 Tag）——
          原来这里是一个 <select>，规范要求分段控件（选项 ≤4 且是「同一份清单的不同范围」），
          顺带改用 ui/Segmented（组件库既有件）。 */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <input
          data-testid="memo-search"
          value={filter.q}
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
          placeholder="搜标题或备注…"
          className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-paper px-3 py-1.5 text-[12px] outline-none focus:border-ink/15 focus:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]"
        />
        <Segmented<StateScope>
          testId="memo-state-filter"
          label="待办范围"
          value={(filter.state ?? 'open') as StateScope}
          onChange={(v) => setFilter((f) => ({ ...f, state: v }))}
          options={[
            { value: 'open', label: '未完成' },
            { value: 'done', label: '已完成' },
            { value: 'all', label: '全部' },
          ]}
        />
        {overdueCount > 0 && (
          <Tag tone="danger" className="shrink-0">
            <Icon name="flag" size="xs" className="shrink-0" />
            逾期 {overdueCount}
          </Tag>
        )}
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
          {renderGrouped(recentBoard, ['today', 'week', 'unscheduled', 'done'])}
        </div>
      </section>

      <section className="panel p-4" data-testid="memo-longterm-section">
        <h3 className="text-sm font-semibold text-ink">中长期待办</h3>
        <p className="mt-0.5 text-[11px] text-ink-faint">完成时要填一个粗略时段 —— 怕你忘掉自己是哪天办成的。</p>
        <div className="mt-2">
          {renderGrouped(longtermBoard, ['overdue', 'today', 'week', 'unscheduled', 'done'])}
        </div>
      </section>

      {/* UI v2 D4：本周作业（assignmentStore 只读，不新增存储）——
          作业在课程块上由 T6 通道排进计划，这里只给「这周记了多少」的可见性。 */}
      {weekAssignments.length > 0 && (
        <p className="px-1 text-[11px] text-ink-faint" data-testid="memo-assignments-line">
          本周已记作业 {weekAssignments.length} 门 · 合计约 {weekAssignments.reduce((n, a) => n + a.estimatedMin, 0)} 分钟（在课程块上排进计划）
        </p>
      )}

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

      {/* 中长期待办完成确认：未选时段不能确认（阻止并提示，不静默跳过）
          P0-1c：包 <form> —— 回车确认；「还没办成」保持 type=button 防误触 */}
      {askDone && (
        <div className="overlay-in fixed inset-0 z-40 flex items-end justify-center bg-ink/30 p-4 sm:items-center" data-testid="planned-done-dialog">
          <form
            className="overlay-in-panel w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl"
            onSubmit={(e) => { e.preventDefault(); confirmLongtermDone(); }}
          >
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
                type="submit"
                data-testid="planned-done-confirm"
                disabled={!askPeriod}
                className="button-primary px-4 py-1.5 text-[12px] disabled:opacity-40"
              >
                完成
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export type { Goal, Todo };
