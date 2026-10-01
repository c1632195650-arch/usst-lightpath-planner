/**
 * 时间轮盘选择器（T7；2026-10-01 重做）
 * ============================================================
 * 用户要求：「选择时间做一个轮盘，鼠标滚轮选择时间，但也保留选中输入功能」。
 * 所以这里**两条路都给**：
 *   · 左侧两列滚轮（小时 / 分钟）：滚轮滚动 or 点击上下两行
 *   · 右侧原生 `input[type=time]`，想手打就手打
 * 两者共用同一个 `value`，改哪边都一样。
 *
 * ── 三行 + 循环（2026-10-01 RAY 反馈后重做）────────────────────
 * 旧版是两列 `overflow-y-auto` 的长列表（一屏能看到五行左右），两个问题：
 *   ① 视觉上挤、当前值不突出；
 *   ② **不是循环的** —— 23 下面就没有了，00 上面也没有东西，
 *      可时间本来就是环：00 上一格应该是 55（分钟）/ 23（小时）。
 * 现在改成**固定三行**：只显示「选中 / 上一格 / 下一格」，且按模运算循环 ——
 * 分钟轮 00 的上下就是 55 和 05，小时轮 23 的下一个就是 00。
 * 上下两行可点，点了就选它。
 *
 * ── 「滚轮会把页面一起滚走」的根因（本轮修的 bug）─────────────
 * React 17+ 把 `wheel` 注册在根容器上，而且是 **passive** 监听 ——
 * 在 `onWheel` 里调 `preventDefault()` **不生效**（浏览器直接忽略，控制台还会报
 * 「Unable to preventDefault inside passive event listener」）。
 * 旧版只有在「档位真的变了」时才尝试 preventDefault，于是滚到边界那一刻、
 * 以及所有 preventDefault 被忽略的时刻，页面就跟着滚了。
 *
 * 正解只有一个：**用原生 `addEventListener('wheel', fn, { passive: false })`**
 * （见下面 `useEffect`）。加了 `{ passive: false }`，`preventDefault()` 才真正拦得住。
 * ⚠️ 别改回 `onWheel` —— 那等于把这个 bug 再写回来。
 *
 * ── 为什么分钟按 5 分钟一档 ──────────────────────────────────
 * 日程粒度不需要精确到分（60 个分钟项滚起来又长又难停）。需要精确值时用右边的输入框。
 *
 * ── 为什么不用第三方库 ────────────────────────────────────────
 * 项目规矩是**零新增依赖**；这就是两个定高三行的列 + 一个原生滚轮监听，几十行就够。
 */
import { useEffect, useRef } from 'react';

interface Props {
  /** `"HH:mm"` */
  value: string;
  onChange: (v: string) => void;
  /** 分钟步长，默认 5 */
  step?: number;
}

/** 单行高度（px）。三行总高 = 3 × 它。改这里要连着 ROW_H 一起看样式，别只改一处。 */
const ROW_H = 28;

const pad = (n: number) => String(n).padStart(2, '0');

/** 环形下标：负数与越界都绕回同一圈里（`-1 → n-1`，`n → 0`） */
const ring = (i: number, n: number) => ((i % n) + n) % n;

/** `"HH:mm"` → 分钟数；解析失败返回 null（不猜） */
function parse(v: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec((v ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, m: mi };
}

export function TimeWheelPicker({ value, onChange, step = 5 }: Props) {
  const parsed = parse(value);
  const h = parsed?.h ?? 0;
  // 分钟向下取到步长档位（手动输入的 07 也能归到 05 档上高亮）
  const m = parsed ? Math.floor(parsed.m / step) * step : 0;

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);

  const hourColRef = useRef<HTMLDivElement>(null);
  const minColRef = useRef<HTMLDivElement>(null);

  /**
   * 最新一次渲染的值。原生监听器只装一次（空依赖），不能闭包住首次的 h/m
   * —— 否则滚第二下时用的还是旧值，表现为「滚不动」。
   */
  const latest = useRef({ h, m, hours, minutes, onChange });
  latest.current = { h, m, hours, minutes, onChange };

  useEffect(() => {
    /** 给一列装**非 passive** 的滚轮监听：被滚到的列前进/后退一格，页面不跟着滚 */
    const bind = (el: HTMLDivElement | null, isHour: boolean) => {
      if (!el) return () => {};
      const onWheel = (e: WheelEvent) => {
        // ⚠️ 这两行只有在 { passive: false } 下才是真的 —— 见文件头注
        e.preventDefault();
        e.stopPropagation();
        const s = latest.current;
        const list = isHour ? s.hours : s.minutes;
        const cur = isHour ? s.h : s.m;
        const i = Math.max(0, list.indexOf(cur));
        const next = list[ring(i + (e.deltaY > 0 ? 1 : -1), list.length)];
        s.onChange(isHour ? `${pad(next)}:${pad(s.m)}` : `${pad(s.h)}:${pad(next)}`);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    };
    const offHour = bind(hourColRef.current, true);
    const offMin = bind(minColRef.current, false);
    return () => {
      offHour();
      offMin();
    };
  }, []);

  const setHM = (nh: number, nm: number) => latest.current.onChange(`${pad(nh)}:${pad(nm)}`);

  const iH = Math.max(0, hours.indexOf(h));
  const iM = Math.max(0, minutes.indexOf(m));

  /** 一行：`cur` 高亮，上下两行暗一档且可点 */
  const cell = (v: number, kind: 'cur' | 'side', onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      style={{ height: ROW_H }}
      className={`grid w-full place-items-center tabular-nums transition-colors ${
        kind === 'cur'
          ? 'bg-slate-800 font-medium text-white'
          : 'text-ink-faint hover:bg-slate-50 hover:text-ink-soft'
      }`}
    >
      {pad(v)}
    </button>
  );

  const column = (which: 'h' | 'm') => {
    const list = which === 'h' ? hours : minutes;
    const idx = which === 'h' ? iH : iM;
    const cur = list[idx];
    const prev = list[ring(idx - 1, list.length)];
    const next = list[ring(idx + 1, list.length)];
    const pick = (v: number) => (which === 'h' ? setHM(v, m) : setHM(h, v));
    return (
      <>
        {cell(prev, 'side', () => pick(prev))}
        {cell(cur, 'cur', () => pick(cur))}
        {cell(next, 'side', () => pick(next))}
      </>
    );
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-xl border border-ink/15 bg-paper">
        {/* 小时列：只画三行，23 的下一个是 00（循环） */}
        <div
          ref={hourColRef}
          className="flex w-11 flex-col border-r border-ink/10"
          style={{ height: ROW_H * 3 }}
          role="listbox"
          aria-label="小时"
        >
          {column('h')}
        </div>
        {/* 分钟列：00 的上一个是 55、下一个是 05（循环） */}
        <div
          ref={minColRef}
          className="flex w-11 flex-col"
          style={{ height: ROW_H * 3 }}
          role="listbox"
          aria-label="分钟"
        >
          {column('m')}
        </div>
      </div>

      {/* 手动输入 —— 用户要求「保留选中输入功能」，所以两条路都给 */}
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-ink/15 bg-paper px-2 py-1.5 text-[12.5px] text-ink"
      />
    </div>
  );
}
