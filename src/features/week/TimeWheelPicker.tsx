/**
 * 时间轮盘选择器（T7）
 * ============================================================
 * 用户要求：「选择时间做一个轮盘，鼠标滚轮选择时间，但也保留选中输入功能」。
 * 所以这里**两条路都给**：
 *   · 左侧两列滚轮（小时 / 分钟），滚轮滚动或点击某一项
 *   · 右侧原生 `input[type=time]`，想手打就手打
 * 两者共用同一个 `value`，改哪边都一样。
 *
 * ── 为什么分钟按 5 分钟一档 ──────────────────────────────────
 * 日程粒度不需要精确到分。60 个分钟项会让滚轮变得又长又难停；
 * 12 档（00/05/…/55）滚动起来才跟手。需要精确值时用右边的输入框。
 *
 * ── 为什么不用 `<select>` 或第三方库 ──────────────────────────
 * 项目规矩是**零新增依赖**；而 `<select>` 在小面板里展开体验很差。
 * 这就是两个 `overflow-y-auto` 的列表 + `onWheel`，几十行就够。
 */
import { useEffect, useRef } from 'react';

interface Props {
  /** `"HH:mm"` */
  value: string;
  onChange: (v: string) => void;
  /** 分钟步长，默认 5 */
  step?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

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

  // 滚动到当前值 —— 否则面板一打开，选中的那一项在视野外，用户看不出选了什么
  useEffect(() => {
    hourColRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'center' });
    minColRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'center' });
  }, [h, m]);

  /** 滚轮：只改一格。`preventDefault` 防止整个页面跟着滚 */
  function wheel(
    e: React.WheelEvent<HTMLDivElement>,
    list: number[], cur: number, apply: (n: number) => void,
  ) {
    const i = list.indexOf(cur);
    const next = e.deltaY > 0 ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    if (next !== i) {
      e.preventDefault();
      apply(list[next]);
    }
  }

  const setHM = (nh: number, nm: number) => onChange(`${pad(nh)}:${pad(nm)}`);

  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-ink/15 bg-white">
        {/* 小时列 */}
        <div
          ref={hourColRef}
          onWheel={(e) => wheel(e, hours, h, (n) => setHM(n, m))}
          className="h-24 w-12 overflow-y-auto border-r border-ink/10 text-center text-[12.5px]"
        >
          {hours.map((x) => (
            <button
              key={x}
              type="button"
              data-on={x === h}
              onClick={() => setHM(x, m)}
              className={`block w-full py-1 ${
                x === h ? 'bg-slate-800 font-medium text-white' : 'text-ink-soft hover:bg-slate-50'
              }`}
            >
              {pad(x)}
            </button>
          ))}
        </div>
        {/* 分钟列 */}
        <div
          ref={minColRef}
          onWheel={(e) => wheel(e, minutes, m, (n) => setHM(h, n))}
          className="h-24 w-12 overflow-y-auto text-center text-[12.5px]"
        >
          {minutes.map((x) => (
            <button
              key={x}
              type="button"
              data-on={x === m}
              onClick={() => setHM(h, x)}
              className={`block w-full py-1 ${
                x === m ? 'bg-slate-800 font-medium text-white' : 'text-ink-soft hover:bg-slate-50'
              }`}
            >
              {pad(x)}
            </button>
          ))}
        </div>
      </div>

      {/* 手动输入 —— 用户要求「保留选中输入功能」，所以两条路都给 */}
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-[12.5px] text-ink"
      />
    </div>
  );
}
