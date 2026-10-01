/**
 * 右栏「截止与重要日期」（总览页改版 批次 2）
 * ============================================================
 * 旧版「接下来的节点 / 校园节点」的三宗罪：
 *   1. 与 TodayCard 补位、CAL_EVENTS 三处展示同一份静态数据；
 *   2. 「校园节点」命名含糊 —— 明明就是截止日期和考试日；
 *   3. 倒计时只给压力不给出路（`expandDeadlines()` 的准备块明明存在，UI 不讲）。
 *
 * 现在的数据源 = 统一日期层（批次 1 的 `mergedImportantDates`）：
 * 内置种子（可忽略）+ 用户自定义（可增删）+ 目标截止（动态，GoalEditor 管）。
 * 分组：本周内 ≤7 天常显；更远的折叠。倒计时行带行动指引。
 *
 * 纪律：与「今天」卡去重靠 OverviewPage 传 `todayHighlightedIds`，
 * 本组件不重复猜。
 */
import { useMemo, useState } from 'react';
import { DEADLINES } from '@/data/usst';
import { diffDays, shortCN, todayISO } from '@/lib/date';
import { deadlineColor } from '@/constants/chartColors';
import { expandDeadlines } from '@/lib/planner/events';
import type { Goal } from '@/features/activity/goalStore';
import {
  builtinImportantDates, loadImportantDates, mergeImportantDates, saveImportantDates,
  withIgnoredBuiltin, withUserDate, withoutIgnoredBuiltin, withoutUserDate,
  type ImportantDate, type ImportantDatesState,
} from '@/features/overview/importantDatesStore';

interface Props {
  /** 学期第一周的周一（expandDeadlines 换算周次用） */
  termStart: string;
  /** 学期总周数（准备块窗口落在学期外要剔除） */
  totalWeeks: number;
  /** 目标列表（goal 源动态合并；GoalEditor 的增删改自动反映到这里） */
  goals: readonly Goal[];
  /** 今天卡已在首屏重点展示的日期 id（右栏标「今日」，不重复倒计时） */
  todayHighlightedIds?: readonly string[];
  /** 点击条目 → 跳周程（去看准备块） */
  onOpenWeek?: (iso: string) => void;
}

const KIND_LABEL: Record<ImportantDate['kind'], string> = {
  deadline: '截止',
  exam: '考试',
  personal: '个人',
};

const KIND_EMOJI: Record<ImportantDate['kind'], string> = {
  deadline: '⏳',
  exam: '📝',
  personal: '⭐',
};

/** 单条：色条 + 标题 + 日期 + 倒计时（或「今日」） */
function DateRow({
  d, days, highlighted, prepNote, onOpen,
}: {
  d: ImportantDate;
  days: number;
  highlighted: boolean;
  prepNote?: string;
  onOpen?: () => void;
}) {
  const urgent = !highlighted && days <= 7;
  const body = (
    <div className="flex items-center gap-3 py-3">
      <div
        className="h-9 w-1 shrink-0 rounded-full"
        style={{ background: deadlineColor(d.tag ?? KIND_LABEL[d.kind]) }}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">
            {d.emoji ? `${d.emoji} ` : ''}{d.title}
          </span>
          <span className="shrink-0 rounded-md bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
            {d.source === 'goal' ? '目标' : KIND_LABEL[d.kind]}
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-ink-faint">
          {shortCN(d.date)}{d.note ? ` · ${d.note}` : ''}
        </div>
        {prepNote && (
          <div className="mt-1 truncate text-[11px] text-brand">
            🗓 {prepNote}
          </div>
        )}
      </div>

      <div className="shrink-0 pl-1 text-right">
        {highlighted ? (
          <span className="text-xs font-semibold text-brand">今日</span>
        ) : days === 0 ? (
          <span className="text-xs font-semibold text-danger">今天</span>
        ) : (
          <>
            <div className={`text-lg font-semibold leading-none tabular-nums ${urgent ? 'text-danger' : 'text-ink'}`}>
              {days}<span className="ml-0.5 text-[10px] font-medium text-ink-faint">天</span>
            </div>
            <div className="mt-1 text-[10px] text-ink-faint">{urgent ? '临近' : '剩余'}</div>
          </>
        )}
      </div>
    </div>
  );

  if (!onOpen || !prepNote) return body;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full text-left transition-opacity hover:opacity-80"
      title="查看本周安排里的准备块"
    >
      {body}
    </button>
  );
}

/** 手动添加小表单（收起态只有一个「＋」按钮） */
function AddDateForm({ onAdd, onCancel }: { onAdd: (t: string, date: string, kind: ImportantDate['kind']) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<ImportantDate['kind']>('personal');

  return (
    <div className="rounded-xl border border-ink/10 bg-paper px-3 py-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="叫什么？（如：小组展示）"
        className="w-full rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint/70 focus:border-brand/40 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-sm text-ink focus:border-brand/40 focus:outline-none"
        />
        <div className="flex shrink-0 gap-1">
          {(Object.keys(KIND_LABEL) as ImportantDate['kind'][]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                kind === k ? 'bg-brand text-white' : 'bg-white text-ink-soft hover:bg-brand-light'
              }`}
            >
              {KIND_EMOJI[k]}{KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-ink-soft hover:text-ink">
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            if (!title.trim() || !date) return;
            onAdd(title.trim(), date, kind);
          }}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
          disabled={!title.trim() || !date}
        >
          添加
        </button>
      </div>
    </div>
  );
}

/** 右栏：截止与重要日期 */
export function DeadlineBoard({ termStart, totalWeeks, goals, todayHighlightedIds = [], onOpenWeek }: Props) {
  const today = todayISO();
  const [state, setState] = useState<ImportantDatesState>(() => loadImportantDates());
  const [adding, setAdding] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  /** 更新 + 落盘（撤销不是本面板的职责，条目可随时删/恢复，不做栈） */
  const update = (next: ImportantDatesState) => {
    saveImportantDates(next);
    setState(next);
  };

  const all = useMemo(
    () => mergeImportantDates(state, DEADLINES, goals),
    [state, goals],
  );

  /** 未来条目（含今天），按日期已排好 */
  const upcoming = useMemo(() => {
    const hl = new Set(todayHighlightedIds);
    return all
      .filter((d) => diffDays(today, d.date) >= 0)
      .map((d) => ({ d, days: diffDays(today, d.date), highlighted: hl.has(d.id) }));
  }, [all, today, todayHighlightedIds]);

  const thisWeek = upcoming.filter((x) => x.days <= 7);
  const later = upcoming.filter((x) => x.days > 7);

  /** 行动指引：该事件展开了哪些准备块（现算，不存储） */
  const prepNotes = useMemo(() => {
    const tasks = expandDeadlines(DEADLINES, termStart, totalWeeks);
    const byEvent = new Map<string, { count: number; minDaysLeft: number }>();
    for (const t of tasks) {
      if (!t.fromEventId || typeof t.daysLeft !== 'number') continue;
      const cur = byEvent.get(t.fromEventId);
      if (!cur) {
        byEvent.set(t.fromEventId, { count: 1, minDaysLeft: t.daysLeft });
      } else {
        cur.count += 1;
        cur.minDaysLeft = Math.min(cur.minDaysLeft, t.daysLeft);
      }
    }
    return byEvent;
  }, [termStart, totalWeeks]);

  const prepNoteOf = (d: ImportantDate): string | undefined => {
    if (d.source !== 'builtin') return undefined;
    const hit = prepNotes.get(d.id.replace(/^builtin-/, ''));
    if (!hit) return undefined;
    return hit.count === 1
      ? '已为你排了 1 个准备块 → 去看周程'
      : `已为你排了 ${hit.count} 个准备块，最近的一次 ${hit.minDaysLeft} 天后 → 去看周程`;
  };

  const ignoredList = useMemo(
    () => builtinImportantDates(DEADLINES).filter((d) => state.ignoredBuiltinIds.includes(d.id)),
    [state.ignoredBuiltinIds],
  );

  if (upcoming.length === 0 && ignoredList.length === 0 && !adding) {
    return (
      <section className="panel p-5 fade-item">
        <header className="mb-3">
          <p className="section-label">KEY DATES</p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">截止与重要日期</h3>
        </header>
        <p className="text-sm leading-6 text-ink-soft">
          暂时没有。考试、报名截止和你的目标截止都会出现在这里。
        </p>
        <button type="button" onClick={() => setAdding(true)} className="button-secondary mt-4 w-full px-4 py-2 text-sm">
          ＋ 添加日期
        </button>
      </section>
    );
  }

  return (
    <section className="panel p-5 fade-item">
      <header className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="section-label">KEY DATES</p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">截止与重要日期</h3>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="button-secondary shrink-0 px-3 py-1.5 text-xs"
          aria-expanded={adding}
        >
          {adding ? '收起' : '＋ 添加'}
        </button>
      </header>

      {adding && (
        <div className="mb-3">
          <AddDateForm
            onAdd={(t, date, kind) => {
              update(withUserDate(state, { title: t, date, kind }));
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <div className="max-h-[calc(100vh-13rem)] overflow-y-auto">
        {thisWeek.length > 0 && (
          <ul className="divide-y divide-ink/10">
            {thisWeek.map(({ d, days, highlighted }) => (
              <li key={d.id} className="group relative">
                <DateRow
                  d={d}
                  days={days}
                  highlighted={highlighted}
                  prepNote={prepNoteOf(d)}
                  onOpen={onOpenWeek ? () => onOpenWeek(d.date) : undefined}
                />
                {d.source === 'user' && (
                  <button
                    type="button"
                    onClick={() => update(withoutUserDate(state, d.id))}
                    className="absolute right-0 top-3 hidden text-[11px] text-ink-faint hover:text-danger group-hover:block"
                  >
                    删除
                  </button>
                )}
                {d.source === 'builtin' && (
                  <button
                    type="button"
                    onClick={() => update(withIgnoredBuiltin(state, d.id))}
                    className="absolute right-0 top-3 hidden text-[11px] text-ink-faint hover:text-ink group-hover:block"
                    title="不参加/不关心，点这里不再显示"
                  >
                    忽略
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {later.length > 0 && (
          <details className="mt-1 border-t border-ink/10 pt-2">
            <summary className="cursor-pointer select-none py-1 text-xs font-medium text-ink-faint hover:text-ink-soft">
              以后（{later.length} 项）
            </summary>
            <ul className="divide-y divide-ink/10">
              {later.map(({ d, days, highlighted }) => (
                <li key={d.id} className="group relative">
                  <DateRow
                    d={d}
                    days={days}
                    highlighted={highlighted}
                    prepNote={prepNoteOf(d)}
                    onOpen={onOpenWeek ? () => onOpenWeek(d.date) : undefined}
                  />
                  {d.source === 'user' && (
                    <button
                      type="button"
                      onClick={() => update(withoutUserDate(state, d.id))}
                      className="absolute right-0 top-3 hidden text-[11px] text-ink-faint hover:text-danger group-hover:block"
                    >
                      删除
                    </button>
                  )}
                  {d.source === 'builtin' && (
                    <button
                      type="button"
                      onClick={() => update(withIgnoredBuiltin(state, d.id))}
                      className="absolute right-0 top-3 hidden text-[11px] text-ink-faint hover:text-ink group-hover:block"
                    >
                      忽略
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {ignoredList.length > 0 && (
          <div className="mt-2 border-t border-ink/10 pt-2">
            <button
              type="button"
              onClick={() => setShowIgnored((v) => !v)}
              className="text-[11px] text-ink-faint hover:text-ink-soft"
              aria-expanded={showIgnored}
            >
              已忽略 {ignoredList.length} 项{showIgnored ? ' · 收起' : ' · 点开恢复'}
            </button>
            {showIgnored && (
              <ul className="mt-1 space-y-1">
                {ignoredList.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-xs text-ink-faint">
                    <span className="truncate">{d.emoji} {d.title}</span>
                    <button
                      type="button"
                      onClick={() => update(withoutIgnoredBuiltin(state, d.id))}
                      className="shrink-0 text-brand hover:underline"
                    >
                      恢复
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
