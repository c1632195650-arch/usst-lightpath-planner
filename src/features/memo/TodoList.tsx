/**
 * 网页端待办工作区 · 待办列表（任务四 W1-P1-1）
 * ============================================================
 * 列表只管渲染；**两类待办的完成流程差异由 MemoPanel 决定**（recent 直勾 /
 * longterm 弹粗粒度时段选择），本组件只把点击事件交回去。
 */
import { plannedDoneLabel, type Todo } from '@/features/mobile/lib/memoTypes.ts';
import { scheduledLabel } from './memoLogic.ts';
import { resolveBlock } from './webMemo.ts';
import { Icon } from '@/components/icons/Icon';

export interface TodoListProps {
  todos: readonly Todo[];
  /** 点勾选框（完成/撤销）。长期待办的"完成"由父层先弹时间选择再回调 */
  onToggle: (todo: Todo) => void;
  onArchive: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  /** S3a（CY 反馈③）：排程状态回显口径 —— 未排进时给「登录后…/未排进本周+出口」。
   *  已排进的仍走 scheduledLabel（todo-scheduled-chip），缺省 = 不显示。 */
  schedHint?: { loggedIn: boolean; onGotoPlan?: () => void };
  /** UI v2 D4：逾期集合 —— 逾期行 ⚑ + 危险文字色（形状+颜色双编码，不靠单一颜色）。 */
  overdueIds?: ReadonlySet<string>;
}

export default function TodoList({ todos, onToggle, onArchive, onEdit, schedHint, overdueIds }: TodoListProps) {
  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink/10 bg-white/60 px-4 py-8 text-center">
        <Icon name="inbox" size="xl" className="text-ink-faint" />
        <p className="text-[12px] text-ink-faint">还没有待办。想起什么就记一条，办好打个勾就行。</p>
      </div>
    );
  }
  return (
    <ul className="space-y-1.5" data-testid="todo-list">
      {todos.map((t) => {
        const done = t.completion === 'done';
        const overdue = !done && (overdueIds?.has(t.id) ?? false);
        const chip = scheduledLabel(t, resolveBlock);
        return (
          <li
            key={t.id}
            data-testid={`todo-item-${t.id}`}
            className={`flex items-start gap-2 rounded-xl border border-ink/[0.07] bg-white px-3 py-2 ${done ? 'opacity-60' : ''} ${overdue ? 'border-[#B0402F]/40' : ''}`}
          >
            <input
              type="checkbox"
              data-testid={`todo-check-${t.id}`}
              checked={done}
              onChange={() => onToggle(t)}
              className="mt-0.5 h-4 w-4 accent-slate-800"
              aria-label={done ? `撤销完成：${t.title}` : `完成：${t.title}`}
            />
            <div className="min-w-0 flex-1">
              {/* D4 逾期双编码：⚑（形状）+ 危险色（颜色）+ aria 标注；完成项划线保留 */}
              <p className={`text-[13px] leading-5 text-ink ${done ? 'line-through' : 'font-medium'} ${overdue ? 'text-[#B0402F]' : ''}`}>
                {overdue && <span aria-hidden="true" className="mr-1">⚑</span>}
                {t.title}
                {overdue && <span className="sr-only">（已逾期）</span>}
              </p>
              {t.note && <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-ink-soft">{t.note}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {(t.tags ?? []).map((tag) => (
                  <span key={tag} className="rounded-full bg-paper px-1.5 py-0.5 text-[10px] text-ink-soft ring-1 ring-ink/10">
                    #{tag}
                  </span>
                ))}
                {t.plannedDone && (
                  <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10px] text-ink-soft ring-1 ring-ink/10">
                    {done ? '完成于 ' : '目标 '}{plannedDoneLabel(t.plannedDone)}
                  </span>
                )}
                {chip && (
                  <span
                    data-testid="todo-scheduled-chip"
                    className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200"
                  >
                    {chip}
                  </span>
                )}
                {/* S3a：完全没排上的待办不再零提示 —— 给状态 chip + 出口（CY 反馈③） */}
                {!done && !chip && schedHint && (schedHint.loggedIn ? (
                  <button
                    type="button"
                    data-testid="memo-todo-sched-state"
                    onClick={schedHint.onGotoPlan}
                    className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
                  >
                    未排进本周 · 排进本周 →
                  </button>
                ) : (
                  <span
                    data-testid="memo-todo-sched-state"
                    className="rounded-full bg-paper px-1.5 py-0.5 text-[10px] text-ink-faint ring-1 ring-ink/10"
                  >
                    登录后可自动排进日程
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                data-testid={`todo-edit-${t.id}`}
                onClick={() => onEdit(t)}
                className="rounded-lg px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-paper"
              >
                编辑
              </button>
              <button
                type="button"
                data-testid={`todo-archive-${t.id}`}
                onClick={() => onArchive(t)}
                className="rounded-lg px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-paper"
                aria-label={`归档：${t.title}`}
              >
                归档
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
