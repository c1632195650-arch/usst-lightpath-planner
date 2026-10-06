/**
 * 网页端待办工作区 · 新增/编辑待办（任务四 W1-P1-3）
 * ============================================================
 * 网页端专属：长文本 note（textarea）+ 标签（逗号分隔）+ 挂目标。
 * kind 建后不可改（两端同口径：recent/longterm 的完成流程不同，改种类会混语义）。
 */
import { useState } from 'react';
import type { Todo, TodoKind } from '@/features/mobile/lib/memoTypes.ts';
import type { Goal } from '@/features/mobile/lib/memoTypes.ts';

export interface TodoDraft {
  title: string;
  kind: TodoKind;
  note?: string;
  tags?: string[];
  goalId?: string;
}

export interface TodoEditorProps {
  /** null = 新增；否则为编辑该条 */
  editing: Todo | null;
  goals: readonly Goal[];
  onCancel: () => void;
  /** P0-2c：异步提交 —— 'ok'/'offline' 都由父层关闭；await 期间按钮 disabled + 「…」 */
  onSubmit: (draft: TodoDraft) => Promise<'ok' | 'offline'>;
}

export default function TodoEditor({ editing, goals, onCancel, onSubmit }: TodoEditorProps) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [kind, setKind] = useState<TodoKind>(editing?.kind ?? 'recent');
  const [note, setNote] = useState(editing?.note ?? '');
  const [tags, setTags] = useState((editing?.tags ?? []).join('，'));
  const [goalId, setGoalId] = useState(editing?.goalId ?? '');
  const [busy, setBusy] = useState(false);
  const openGoals = goals.filter((g) => !g.archived);

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    const tagList = tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    setBusy(true);
    try {
      await onSubmit({
        title: t,
        kind,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(tagList.length ? { tags: tagList } : {}),
        ...(goalId ? { goalId } : {}),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30 p-4 sm:items-center" data-testid="todo-editor">
      {/* P0-1a：包 <form> —— 标题输入框回车 = 提交（浏览器默认表单提交）；
          textarea 备注保留回车换行（textarea 内回车不会触发提交） */}
      <form
        className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        <h3 className="text-sm font-semibold text-ink">{editing ? '编辑待办' : '新待办'}</h3>
        <input
          data-testid="todo-editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="要做什么？（最多 120 字）"
          maxLength={120}
          className="mt-3 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-[13px] outline-none focus:border-ink/40"
        />
        {!editing && (
          <div className="mt-3 flex gap-1 rounded-xl border border-ink/10 bg-paper p-1" data-testid="todo-editor-kind">
            {(['recent', 'longterm'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`nav-item flex-1 whitespace-nowrap ${kind === k ? 'nav-item-active' : ''}`}
              >
                {k === 'recent' ? '最近待办' : '中长期待办'}
              </button>
            ))}
          </div>
        )}
        <p className="mt-1 px-1 text-[11px] text-ink-faint">
          {kind === 'recent' ? '办好打勾就行，不用填时间。' : '完成打勾时要填一个粗略时段（如 2026 年 10 月中旬），防忘。'}
        </p>
        <textarea
          data-testid="todo-editor-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="补充说明（可空）—— 网页端可写长文本"
          rows={4}
          className="mt-3 w-full resize-y rounded-xl border border-ink/15 bg-paper px-3 py-2 text-[13px] outline-none focus:border-ink/40"
        />
        <input
          data-testid="todo-editor-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="标签，用逗号分隔（如：读书，备考）"
          className="mt-3 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-[13px] outline-none focus:border-ink/40"
        />
        {openGoals.length > 0 && (
          <select
            data-testid="todo-editor-goal"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className="mt-3 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-[13px] outline-none focus:border-ink/40"
          >
            <option value="">不挂到目标</option>
            {openGoals.map((g) => (
              <option key={g.id} value={g.id}>挂到目标：{g.title}</option>
            ))}
          </select>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-1.5 text-[12px] text-ink-soft ring-1 ring-ink/15 transition-colors hover:bg-paper">取消</button>
          <button
            type="submit"
            data-testid="todo-editor-submit"
            disabled={!title.trim() || busy}
            className="button-primary px-4 py-1.5 text-[12px] disabled:opacity-40"
          >
            {busy ? '…' : editing ? '保存' : '添加'}
          </button>
        </div>
      </form>
    </div>
  );
}
