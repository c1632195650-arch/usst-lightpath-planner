/**
 * EditBlockPanel —— 块级编辑（R2.2）
 * ============================================================
 * 改一个块的**开始时间 / 时长 / 地点**，不用「删掉重加」。
 *
 * ── 边界（与计划书对齐）────────────────────────────────────
 *   · **只能同日改**。跨天移动是拖拽（R1）的事 —— 两条动线分开，
 *     各自的行为才讲得清楚（这里不会出现「改个时间结果跑到别天」的意外）。
 *   · **课程块不从这里改**。课程的时间变动是「调课」（R3），
 *     走 `CourseOverrideEditor` —— 它有「只这周 / 以后都这样」的语义，
 *     与「我自己加的事换个时间」是两回事。
 *
 * ── 落库 ───────────────────────────────────────────────────
 * 保存 = 写一条 `MoveRecord{ source:'edit' }`（hard）；
 * 引擎重排时它被并入 `lockedPlacements` 写回原位 —— 用户改的不会被挪走。
 * 「恢复引擎安排」= 删掉这条记录。
 *
 * 本组件是**纯 UI**：不碰 localStorage，结果通过回调交给父组件。
 */
import { useState } from 'react';
import type { TimeBlock } from '@/types';
import { toHHmm, toMinutes } from '@/constants/time';
import { TimeWheelPicker } from './TimeWheelPicker';

/** 时长选项（分钟）—— 不给自由输入：乱填的时长（如 7 分钟）只会制造碎片 */
const DURATIONS = [30, 45, 60, 90, 120, 150, 180];

export function EditBlockPanel({
  block,
  /** 当前是否已有用户改动（决定要不要显示「恢复引擎安排」） */
  edited,
  /**
   * 同一天**其它**块占用的时段（不含自己）—— 用于**碰撞校验**（2026-10-07 补）。
   *
   * 为什么必须有：`applyPendingMoves` 把手动改动**无条件盲写**到计划上、不做任何校验，
   * 而引擎的 `hardViolations` 是在**它自己那份 plan** 上算的 —— 手动改动发生在引擎之后，
   * 引擎根本看不见。于是「改时间和别的块撞了」会变成**屏幕上真实的重叠**，
   * 而头部还显示「硬约束违反 0」。RAY 2026-10-07 报的「块重叠」就是这个。
   *
   * 拖拽那条路本来就有校验（非法落位显示「放不下」）—— 这里补上同一条纪律。
   */
  occupied,
  onSave,
  onRevert,
  onCancel,
}: {
  block: TimeBlock;
  edited: boolean;
  occupied?: readonly { id: string; title: string; startMin: number; endMin: number }[];
  /** startMin / endMin 是用户确认的新值；place 为 undefined 表示「没改地点」 */
  onSave: (next: { startMin: number; endMin: number; place?: string }) => void;
  onRevert: () => void;
  onCancel: () => void;
}) {
  // TimeWheelPicker 的口径是 `"HH:mm"` 字符串，排程内部用「当日分钟数」—— 边界上转一次。
  const [startText, setStartText] = useState(() => toHHmm(block.startMin));
  const [dur, setDur] = useState(block.endMin - block.startMin);
  const [place, setPlace] = useState(block.place ?? '');
  /** 派生：轮盘给的是字符串，排程要的是分钟数 */
  const start = toMinutes(startText);

  // 时长被改成非选项值（如来自上一版计划的 50 分钟）时，原样保留为一个选项，
  // 否则 select 会静默跳到第一项 —— 用户没动它却变了，是最糟糕的那种意外。
  const durOptions = DURATIONS.includes(dur) ? DURATIONS : [...DURATIONS, dur].sort((a, b) => a - b);

  /**
   * 与同日其它块**撞上的那一块**（区间半开 `[start, end)`，相接不算撞）。
   * 有 clash ⟹ 不许保存 —— 与拖拽「放不下就不让放」同一口径：
   * **如实说「不能这么改」比偷偷让它叠上去更诚实**（这也是本项目一贯的纪律）。
   */
  const end = start + dur;
  const clash = (occupied ?? []).find((o) => start < o.endMin && o.startMin < end) ?? null;

  return (
    <div className="space-y-1.5 rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-ink-soft ring-1 ring-ink/10">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0">开始</span>
        <TimeWheelPicker value={startText} onChange={setStartText} step={10} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0">时长</span>
        <select
          value={dur}
          onChange={(e) => setDur(Number(e.target.value))}
          className="rounded border border-ink/20 bg-white px-1.5 py-0.5 text-[11.5px]"
        >
          {durOptions.map((d) => (
            <option key={d} value={d}>{d} 分钟</option>
          ))}
        </select>
        <span className="text-ink-faint">→ {toHHmm(start)}–{toHHmm(start + dur)}</span>      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0">地点</span>
        <input
          type="text"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="留空 = 不指定"
          className="min-w-0 flex-1 rounded border border-ink/20 bg-white px-1.5 py-0.5 text-[11.5px]"
        />
      </div>
      {/* 碰撞提示：说清**和谁**撞了、怎么办 —— 只写「冲突」等于没说 */}
      {clash && (
        <div className="rounded bg-amber-50 px-2 py-1 text-[10.5px] leading-relaxed text-amber-900 ring-1 ring-amber-700/20">
          这个时间和「{clash.title}」（{toHHmm(clash.startMin)}–{toHHmm(clash.endMin)}）撞了，所以先不记下 ——
          换个开始时间或时长，或者先把那一块挪开。
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <button
          type="button"
          disabled={!!clash}
          onClick={() => {
            if (clash) return; // 兜底：按钮已禁用，这里再挡一次
            onSave({
              startMin: start,
              endMin: end,
              ...(place.trim() ? { place: place.trim() } : {}),
            });
          }}
          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
            clash
              ? 'cursor-not-allowed bg-slate-300 text-white/80'
              : 'bg-slate-800 text-white'
          }`}
        >
          记下（点「重新排一遍」生效）
        </button>
        {edited && (
          <button
            type="button"
            onClick={onRevert}
            className="rounded bg-white px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-ink/20"
          >
            恢复引擎安排
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-[11px] text-ink-faint"
        >
          取消
        </button>
      </div>
    </div>
  );
}
