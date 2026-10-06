/**
 * 光溯移动端 · 本周视图 WeekBoard（M3 · 2026-10-07，CY 反馈⑧a）
 * ============================================================
 * 替换只读的 WeekGlance（S4-3 去重：两者只留一个）：
 *  · 周切换 ‹ ›（本地浏览态，不写云端；越界自动停在 [第1周, 第 totalWeeks 周]）；
 *  · 「回到现在」（不在当前周时高亮）；
 *  · 七天列表：每天未完成件数 + 点击展开当日块（标题 + HH:MM–HH:MM）；
 *  · 今天一行 ring 高亮，默认展开今天。
 * 手机端**只读** —— 编辑仍走 EditSheet；非当前周的 plan 复用 recomputeWeek
 * （异步，加载态给「计算中…」，结果按目标周缓存）。
 */
import { useEffect, useRef, useState } from 'react';
import type { WeekPlan } from '@/types';
import type { UserPlanLayer } from '@/features/week/userPlanStore';
import { applyLayerToBlocks, fmtMin } from './lib/sync.ts';
import { recomputeWeek } from './lib/planCompute.ts';
import { clampWeekOffset, weekBoardRows, weekRangeLabel } from './lib/weekBoard.ts';
import type { SyncStatePayload } from './lib/types.ts';

export default function WeekBoard({
  plan, layer, weekNo, todayDow, serverState,
}: {
  plan: WeekPlan | null;
  layer: UserPlanLayer;
  weekNo: number;
  todayDow: number;
  /** 切周重算的数据源（schedule/termStart/planState/persona）；缺 = 只显示当前周 */
  serverState: SyncStatePayload | null;
}) {
  const [offset, setOffset] = useState(0);
  const [openDow, setOpenDow] = useState<number | null>(todayDow);
  const [remotePlan, setRemotePlan] = useState<WeekPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<number, WeekPlan | null>());

  useEffect(() => {
    if (offset === 0) { setRemotePlan(null); setLoading(false); return; }
    const target = weekNo + offset;
    if (cache.current.has(target)) {
      setRemotePlan(cache.current.get(target) ?? null);
      setLoading(false);
      return;
    }
    if (!serverState) return;
    setLoading(true);
    let cancelled = false;
    void recomputeWeek({
      schedule: serverState.schedule, weekNo: target, planState: serverState.planState ?? null,
      layer, persona: serverState.persona ?? null, scenarios: serverState.persona?.scenarios ?? null,
    }).then((p) => {
      if (cancelled) return;
      cache.current.set(target, p);
      setRemotePlan(p);
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, weekNo, serverState, layer]);

  if (!plan || !serverState) return null;
  const viewedWeekNo = weekNo + offset;
  const active = offset === 0 ? plan : remotePlan;
  const rows = weekBoardRows(active, layer, viewedWeekNo, offset === 0 ? todayDow : -1, serverState.schedule.termStart);
  const range = weekRangeLabel(serverState.schedule.termStart, viewedWeekNo);
  const dayBlocks = (dow: number) => (active ? applyLayerToBlocks(active, layer, viewedWeekNo, dow) : null);

  const shift = (d: number) => setOffset((o) => clampWeekOffset(o + d, weekNo, serverState.schedule.totalWeeks));
  const backToToday = () => { setOffset(0); setOpenDow(todayDow); };

  return (
    <section data-testid="m-week-board" className="rounded-card bg-paper-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" data-testid="m-week-prev" aria-label="上一周" onClick={() => shift(-1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-ink/10 text-ink-soft">‹</button>
          <span data-testid="m-week-label" className="text-sm font-semibold text-ink tabular-nums">
            {loading ? '计算中…' : `第 ${viewedWeekNo} 周${range ? ` · ${range}` : ''}`}
          </span>
          <button type="button" data-testid="m-week-next" aria-label="下一周" onClick={() => shift(1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-ink/10 text-ink-soft">›</button>
        </div>
        <button type="button" data-testid="m-week-today" onClick={backToToday}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
            offset !== 0
              ? 'bg-brand text-white'
              : 'border border-ink/10 bg-paper-sunken text-ink-faint'
          }`}
        >
          回到现在
        </button>
      </div>

      <div className="mt-2 divide-y divide-ink/5">
        {rows.map((row) => {
          const view = openDow === row.dow ? dayBlocks(row.dow) : null;
          return (
            <div key={row.dow} className={row.isToday ? 'rounded-lg ring-1 ring-brand/60' : ''}>
              <button
                type="button"
                data-testid={`m-week-day-${row.dow}`}
                aria-expanded={openDow === row.dow}
                onClick={() => setOpenDow(openDow === row.dow ? null : row.dow)}
                className="flex w-full items-center justify-between px-1 py-1.5"
              >
                <span className={`text-sm ${row.isToday ? 'font-bold text-brand' : 'text-ink-soft'}`}>
                  {row.isToday ? '今天' : row.label}
                  <span className="ml-1.5 text-[11px] text-ink-faint tabular-nums">{row.dateLabel}</span>
                </span>
                <span className="text-sm font-semibold text-ink tabular-nums">{row.openCount} 件</span>
              </button>
              {view && (
                <ul className="px-1 pb-2">
                  {view.blocks.map((b) => (
                    <li key={b.id} className={`flex items-center justify-between py-0.5 text-[11.5px] ${view.doneIds.has(b.id) ? 'text-ink-faint line-through' : 'text-ink-soft'}`}>
                      <span className="min-w-0 flex-1 truncate">{b.title}</span>
                      <span className="shrink-0 tabular-nums text-ink-faint">{fmtMin(b.startMin)}–{fmtMin(b.endMin)}</span>
                    </li>
                  ))}
                  {view.blocks.length === 0 && <li className="py-0.5 text-[11px] text-ink-faint">这天没有安排</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
