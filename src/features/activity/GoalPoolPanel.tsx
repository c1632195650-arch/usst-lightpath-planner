/**
 * 目标池面板（孵化池 UI，2026-10-07）
 * ============================================================
 * GoalsPage 顶部的苗圃：轻条目（标题 + 备注 + 粗交期）躺在这里，
 * 时机成熟点「转正」→ 表单补全（六类 / 截止 / 总时长 / 节奏）→
 * 生成正式 Goal 回调给 GoalsPage 入库，原条目标 promotedGoalId 留痕。
 *
 * 纪律：
 *   · 转正只**新增** Goal，不直接改 GoalsPage 的 goals 状态 —— 经
 *     `onPromote` 回调交回组合层（与 GoalQuickInput 同款单向流）；
 *   · 池子自己的状态自己管（loadPool/savePool），GoalsPage 不感知；
 *   · 粗交期 → 截止日预填用 plannedDoneToISO（与 CY memo 同口径），
 *     用户可在表单里改精确日期。
 */
import { useState } from 'react';
import {
  loadPool, savePool, makeEntryId, addEntry, patchEntry, archiveEntry,
  incubatingEntries, promotedEntries, plannedDoneToISO, buildGoalFromEntry,
  PLANNED_DONE_RE, type PoolEntry,
} from './goalPoolStore';
import {
  CATEGORY_TO_KIND, GOAL_CATEGORY_LABEL, GOAL_PACE_LABEL, makeGoalId,
  type Goal, type GoalCategory, type GoalPace,
} from './goalStore';
import { EXPERIENCE_HOURS } from './goalDecompose';

const CATEGORIES: GoalCategory[] = ['contest', 'academic', 'skill', 'growth', 'health', 'social'];
const PACES: GoalPace[] = ['sprint', 'steady', 'both'];

export function GoalPoolPanel({ onPromote }: { onPromote: (goal: Goal) => void }) {
  const [entries, setEntries] = useState<PoolEntry[]>(() => loadPool());
  // 新建条目表单
  const [showAdd, setShowAdd] = useState(false);
  const [dTitle, setDTitle] = useState('');
  const [dNote, setDNote] = useState('');
  const [dPd, setDPd] = useState('');
  // 转正表单（promoteId 非空 = 打开）
  const [promoteId, setPromoteId] = useState<string | null>(null);
  const [pCat, setPCat] = useState<GoalCategory>('growth');
  const [pDue, setPDue] = useState('');
  const [pHours, setPHours] = useState('');
  const [pPace, setPPace] = useState<GoalPace | ''>('');

  const commit = (next: PoolEntry[]) => { savePool(next); setEntries(next); };
  const nowIso = new Date().toISOString();

  const open = incubatingEntries(entries);
  const doneList = promotedEntries(entries);
  const archivedList = entries.filter((e) => e.archived);
  const promoting = entries.find((e) => e.id === promoteId) ?? null;

  const submitAdd = () => {
    const title = dTitle.trim();
    if (!title) return;
    const pd = dPd.trim();
    const e: PoolEntry = {
      id: makeEntryId(), title,
      ...(dNote.trim() ? { note: dNote.trim() } : {}),
      ...(PLANNED_DONE_RE.test(pd) ? { plannedDone: pd } : {}),
      source: 'manual' as const,
      createdAt: nowIso,
    };
    commit(addEntry(entries, e));
    setDTitle(''); setDNote(''); setDPd(''); setShowAdd(false);
  };

  const submitPromote = () => {
    if (!promoting) return;
    const dueAt = pDue.trim() || undefined;
    const hours = Number(pHours);
    const { goal, entry } = buildGoalFromEntry(promoting, {
      category: pCat,
      ...(dueAt ? { dueAt } : {}),
      ...(pHours.trim() && Number.isFinite(hours) && hours > 0 ? { totalHours: hours } : {}),
      ...(pPace ? { pace: pPace } : {}),
      nowIso,
    }, makeGoalId());
    onPromote(goal);
    commit(entries.map((e) => (e.id === entry.id ? entry : e)));
    setPromoteId(null); setPDue(''); setPHours(''); setPPace('');
  };

  /** 转正表单打开时按类别预填：粗交期 → 截止日、经验值 → 总时长 */
  const openPromote = (e: PoolEntry) => {
    setPromoteId(e.id);
    setPCat('growth');
    setPDue(plannedDoneToISO(e.plannedDone ?? '') ?? '');
    setPHours(String(EXPERIENCE_HOURS[CATEGORY_TO_KIND.growth]));
    setPPace('');
  };

  return (
    <div className="panel px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink">目标池</h3>
        <span className="text-[11px] text-ink-faint">孵化中 {open.length} · 已转正 {doneList.length}</span>
        <button type="button" onClick={() => setShowAdd(!showAdd)}
          className="ml-auto rounded bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-100">
          {showAdd ? '收起' : '+ 记一条'}
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        还没想清楚投多少时间的念头先放这里。躺熟了（知道截止和总时长）再转正进长目标。
      </p>

      {/* ── 新建条目 ─────────────────────────────── */}
      {showAdd && (
        <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2.5 ring-1 ring-ink/5">
          <input type="text" value={dTitle} onChange={(e) => setDTitle(e.target.value)}
            maxLength={120} placeholder="想做什么？比如「学吉他」「考驾照」"
            className="w-full rounded border border-ink/15 px-2 py-1 text-[12px]"
            onKeyDown={(e) => { if (e.key === 'Enter') submitAdd(); }} />
          <input type="text" value={dNote} onChange={(e) => setDNote(e.target.value)}
            maxLength={200} placeholder="备注（可空）"
            className="w-full rounded border border-ink/15 px-2 py-1 text-[12px]" />
          <div className="flex items-center gap-2">
            <input type="text" value={dPd} onChange={(e) => setDPd(e.target.value)}
              placeholder="粗交期，如 2026-11-中旬（可空）"
              className="w-56 rounded border border-ink/15 px-2 py-1 text-[12px]" />
            <button type="button" onClick={submitAdd}
              className="rounded bg-green-600 px-3 py-1 text-[12px] text-white hover:bg-green-700">记入</button>
          </div>
          {dPd.trim() && !PLANNED_DONE_RE.test(dPd.trim()) && (
            <p className="text-[10.5px] text-amber-700">粗交期格式：2026-11-上旬 / 中旬 / 下旬，留空也可以</p>
          )}
        </div>
      )}

      {/* ── 孵化中列表 ───────────────────────────── */}
      {open.length === 0 && !showAdd && (
        <p className="mt-2 text-[11.5px] text-ink-faint">池子是空的。</p>
      )}
      <div className="mt-2 space-y-1.5">
        {open.map((e) => (
          <div key={e.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-ink/10">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{e.title}</span>
              <button type="button" onClick={() => openPromote(e)}
                className="rounded bg-teal-50 px-2 py-0.5 text-[11px] text-teal-700 hover:bg-teal-100">转正</button>
              <button type="button" onClick={() => commit(archiveEntry(entries, e.id, nowIso))}
                className="rounded bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-600">归档</button>
            </div>
            {(e.note || e.plannedDone) && (
              <p className="mt-0.5 text-[10.5px] text-ink-faint">
                {e.plannedDone && <span className="mr-2">想在这之前搞定：{e.plannedDone}</span>}
                {e.note}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── 转正表单 ─────────────────────────────── */}
      {promoting && (
        <div className="mt-2 space-y-2 rounded-lg bg-teal-50/60 p-3 ring-1 ring-teal-200">
          <p className="text-[12px] font-medium text-teal-800">转正：{promoting.title}</p>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <label className="text-ink-soft">类别</label>
            <select value={pCat} onChange={(e) => {
              const cat = e.target.value as GoalCategory;
              setPCat(cat);
              setPHours(String(EXPERIENCE_HOURS[CATEGORY_TO_KIND[cat]]));
            }} className="rounded border border-ink/15 px-1.5 py-0.5 text-[12px]">
              {CATEGORIES.map((c) => <option key={c} value={c}>{GOAL_CATEGORY_LABEL[c]}</option>)}
            </select>
            <label className="text-ink-soft">截止</label>
            <input type="date" value={pDue} onChange={(e) => setPDue(e.target.value)}
              className="rounded border border-ink/15 px-1.5 py-0.5 text-[12px]" />
            <label className="text-ink-soft">总时长 h</label>
            <input type="number" min={1} value={pHours} onChange={(e) => setPHours(e.target.value)}
              className="w-16 rounded border border-ink/15 px-1.5 py-0.5 text-[12px]" />
            <label className="text-ink-soft">节奏</label>
            <select value={pPace} onChange={(e) => setPPace(e.target.value as GoalPace | '')}
              className="rounded border border-ink/15 px-1.5 py-0.5 text-[12px]">
              <option value="">按缺省</option>
              {PACES.map((p) => <option key={p} value={p}>{GOAL_PACE_LABEL[p]}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={submitPromote}
              className="rounded bg-teal-600 px-3 py-1 text-[12px] text-white hover:bg-teal-700">转正进长目标</button>
            <button type="button" onClick={() => setPromoteId(null)}
              className="rounded bg-white px-3 py-1 text-[12px] text-ink-soft ring-1 ring-ink/15">取消</button>
          </div>
        </div>
      )}

      {/* ── 已转正 / 已归档（折叠展示，溯源留痕）──── */}
      {(doneList.length > 0 || archivedList.length > 0) && (
        <div className="mt-2 border-t border-ink/10 pt-1.5">
          {doneList.map((e) => (
            <p key={e.id} className="text-[10.5px] text-ink-faint">
              ✅ {e.title} <span className="ml-1">已转正（{e.promotedAt?.slice(0, 10)}）</span>
            </p>
          ))}
          {archivedList.map((e) => (
            <p key={e.id} className="text-[10.5px] text-ink-faint/70">🗄️ {e.title}（已归档）</p>
          ))}
        </div>
      )}
    </div>
  );
}
