/**
 * 时间追问（R3.4）
 * ============================================================
 * 用户说「周三下午有实验」—— **下午是几点到几点？**
 *
 * ── 为什么必须问 ─────────────────────────────────────────────
 * 「下午」可以是 13:00 也可以是 15:30。引擎填一个默认值的话：
 *   · 填早了 → 与真实验冲突，用户还得手动改；
 *   · 填晚了 → 那天的别的事被挤出半天。
 * 所以按项目编号 10「不猜」：**拿不到时间就问**，问不到就不建块。
 *
 * ── 拿不到怎么办 ─────────────────────────────────────────────
 * 用户直接关掉 → **不建块**，界面留一条提示「那段时间还空着，你可以手动补」，
 * 而不是偷偷替他排一块假的。留空窗本身也是一种诚实的表达。
 */
import { useState } from 'react';
import { toHHmm } from '@/constants/time';
import { TimeWheelPicker } from './TimeWheelPicker';

export interface TimeAskRequest {
  title: string;
  dayOfWeek: number;
  durationMin: number;
  /** 要不要问时间（知道时间时跳过这一步） */
  askTime: boolean;
  /** 要不要问「只这周 / 每周」（`detectScope()` 拿不准时才问） */
  askScope: boolean;
  /** 已经判出来的范围（拿得准时直接按它执行，不再多问一句） */
  scopeKnown?: 'once' | 'long';
}

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
/** 时长候选（分钟）—— 不给自由输入：乱填的时长只会制造碎片 */
const DURATIONS = [30, 45, 60, 90, 120, 150, 180];

export function TimeAskDialog({
  req, hintText, onConfirm, onCancel,
}: {
  req: TimeAskRequest;
  /** `detectScope()` 的判定理由（`scopeReason`）—— 让用户知道为什么问这一句 */
  hintText?: string;
  onConfirm: (startMin: number, long: boolean) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('14:00');
  const [dur, setDur] = useState(req.durationMin || 60);
  const [long, setLong] = useState(req.scopeKnown === 'long');

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg">
        <h3 className="text-[14px] font-semibold text-ink">「{req.title}」还差一点信息</h3>
        {hintText && (
          <p className="mt-1 text-[11px] text-ink-faint">{hintText}</p>
        )}
        {req.askTime && (
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">
            {DAY_LABELS[req.dayOfWeek - 1]}这一件事你没说具体时间 —— 我不替你猜，
            排错时间比留白更麻烦。
          </p>
        )}
        {req.askTime && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px]">开始</span>
            <TimeWheelPicker value={text} onChange={setText} step={10} />
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px]">要多久</span>
          <select
            value={dur}
            onChange={(e) => setDur(Number(e.target.value))}
            className="rounded border border-ink/20 bg-white px-1.5 py-0.5 text-[11.5px]"
          >
            {DURATIONS.includes(dur) ? DURATIONS : [...DURATIONS, dur].sort((a, b) => a - b)}
          </select>
        </div>
        {req.askScope && (
          <div className="mt-2 space-y-1">
            <span className="text-[11.5px]">只这周，还是每周都这样？</span>
            <label className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
              <input type="radio" checked={!long} onChange={() => setLong(false)} />
              只这一次
            </label>
            <label className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
              <input type="radio" checked={long} onChange={() => setLong(true)} />
              每周都这样
            </label>
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-faint">
          {toHHmm(minutesOf(text))} 开始，{dur} 分钟
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-[11.5px] text-ink-faint"
          >
            先算了，我还不清楚
          </button>
          <button
            type="button"
            onClick={() => onConfirm(minutesOf(text), long)}
            className="rounded-md bg-slate-800 px-3 py-1 text-[11.5px] font-medium text-white"
          >
            记下
          </button>
        </div>
      </div>
    </div>
  );
}

function minutesOf(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec((hhmm ?? '').trim());
  if (!m) return 14 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}
