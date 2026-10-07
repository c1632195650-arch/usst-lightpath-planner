/**
 * 网页端待办工作区 · 新增/编辑待办（任务四 W1-P1-3）
 * ============================================================
 * 网页端专属：长文本 note（textarea）+ 标签（逗号分隔）+ 挂目标。
 * kind 建后不可改（两端同口径：recent/longterm 的完成流程不同，改种类会混语义）。
 *
 * 2026-10-08（组件层批次三 · 表单控件）：四个字段从手写 `<input>/<textarea>/<select>`
 * 换成 `components/ui/FormControls` 三件套，类型切换换成 `ui/Segmented`。收益不只是样式统一：
 *   · §10.2.3 三条规则一次到位 —— **标签在输入框外上方**（原先全靠 placeholder，
 *     一输入就看不见在填什么）、占位符 `#6E7688`（4.56:1）、聚焦 2px 外环 + 3px 光晕；
 *   · 文本域按规范收到两行可见高度 + 内部滚动（原先 `rows={4}` 撑高弹窗）；
 *   · 类型切换拿回 `role="group"` + `aria-pressed` 的选中三重差异（原先靠 nav-item 类名）。
 * data-testid 一字未动（`todo-editor-title/note/tags/goal` 仍在原生控件上），e2e 零改锚。
 */
import { useState } from 'react';
import type { Todo, TodoKind } from '@/features/mobile/lib/memoTypes.ts';
import type { Goal } from '@/features/mobile/lib/memoTypes.ts';
import { Input, Select, Textarea } from '@/components/ui/FormControls';
import { Segmented } from '@/components/ui/Segmented';

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
    <div className="overlay-in fixed inset-0 z-40 flex items-end justify-center bg-ink/30 p-4 sm:items-center" data-testid="todo-editor">
      {/* P0-1a：包 <form> —— 标题输入框回车 = 提交（浏览器默认表单提交）；
          textarea 备注保留回车换行（textarea 内回车不会触发提交） */}
      <form
        className="overlay-in-panel w-full max-w-md rounded-2xl bg-white p-4 shadow-xl"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        <h3 className="text-sm font-semibold text-ink">{editing ? '编辑待办' : '新待办'}</h3>

        <Input
          label="要做什么"
          required
          testId="todo-editor-title"
          wrapClassName="mt-3"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="最多 120 字"
          maxLength={120}
        />

        {!editing && (
          <>
            <div className="mt-3">
              <span className="mb-1.5 block text-xs font-semibold text-ink-soft">类型</span>
              <Segmented<TodoKind>
                testId="todo-editor-kind"
                label="待办类型"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'recent', label: '最近待办' },
                  { value: 'longterm', label: '中长期待办' },
                ]}
                className="w-full [&>button]:flex-1"
              />
            </div>
            <p className="mt-1 px-1 text-[11px] text-ink-faint">
              {kind === 'recent'
                ? '办好打勾就行，不用填时间。'
                : '完成打勾时要填一个粗略时段（如 2026 年 10 月中旬），防忘。'}
            </p>
          </>
        )}

        <Textarea
          label="补充说明"
          testId="todo-editor-note"
          wrapClassName="mt-3"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="可空 —— 超出两行可滚动"
        />

        <Input
          label="标签"
          testId="todo-editor-tags"
          wrapClassName="mt-3"
          hint="用逗号分隔，例如：读书，备考"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />

        {openGoals.length > 0 && (
          <Select
            label="挂到目标"
            testId="todo-editor-goal"
            wrapClassName="mt-3"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
          >
            <option value="">不挂到目标</option>
            {openGoals.map((g) => (
              <option key={g.id} value={g.id}>挂到目标：{g.title}</option>
            ))}
          </Select>
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
