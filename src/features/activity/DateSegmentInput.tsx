/**
 * 分段式日期输入（2026-10-07 RAY：「输完年份光标自动跳月份，输完月份自动跳日」）
 * ============================================================
 * 原生 `<input type="date">` 的分段交互受浏览器 locale 控制、键盘体验割裂。
 * 本组件自己拆 **年 / 月 / 日** 三段：
 *   · **自动跳段**：年满 4 位 → 月；月/日按「首数字已定完整则即跳」
 *     （月份首数字 ≥2 即完整，日期首数字 ≥4 即完整 —— 3 月、31 日都还要等第二位）；
 *   · `Enter` / `-` / `/` / `.` 手动跳下一段；空段上退格回上一段；
 *   · 三段齐且合法 → 才提交 ISO（onChange）；不完整/非法（2 月 30 日）不提交，
 *     段上红框提示；三段全空 → 提交 ''（调用方自行决定清空语义）；
 *   · 粘贴整段 `2026-10-31` 自动分发到三段。
 * 零依赖：纯受控 input + ref 焦点管理。
 */
import { useEffect, useRef, useState } from 'react';

const onlyDigits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

export function DateSegmentInput({ value, onChange, ariaLabel }: {
  value: string;
  /** 合法完整日期（ISO）或 ''（三段全空）—— 不完整/非法的中间态不回调 */
  onChange: (iso: string) => void;
  ariaLabel?: string;
}) {
  const [y, setY] = useState(value.slice(0, 4));
  const [m, setM] = useState(value.slice(5, 7));
  const [d, setD] = useState(value.slice(8, 10));
  const yRef = useRef<HTMLInputElement | null>(null);
  const mRef = useRef<HTMLInputElement | null>(null);
  const dRef = useRef<HTMLInputElement | null>(null);

  // 外部值变化 → 同步分段（清空/程序化设置都覆盖）
  useEffect(() => {
    setY(value.slice(0, 4));
    setM(value.slice(5, 7));
    setD(value.slice(8, 10));
  }, [value]);

  /** 三段齐 + 真实存在（2/30 拒绝）→ 提交 */
  const commit = (ny: string, nm: string, nd: string) => {
    if (!ny && !nm && !nd) { onChange(''); return; }
    if (ny.length === 4 && nm.length >= 1 && nd.length >= 1) {
      const mi = Number(nm); const di = Number(nd);
      const dt = new Date(Date.UTC(Number(ny), mi - 1, di));
      if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31
        && dt.getUTCMonth() === mi - 1 && dt.getUTCDate() === di) {
        onChange(dt.toISOString().slice(0, 10));
      }
    }
  };

  /** 数字段通用 onChange：清洗 → set → 自动跳段 / 提交 */
  const seg = (
    which: 'y' | 'm' | 'd',
    raw: string,
    set: (v: string) => void,
    maxLen: number,
    jumpIfSingle: number,
  ) => {
    let digits = onlyDigits(raw, maxLen);
    // 粘贴整段日期（只可能落在年段：2026-10-31）
    const full = raw.match(/(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/);
    if (full) {
      setY(full[1]); setM(onlyDigits(full[2], 2)); setD(onlyDigits(full[3], 2));
      commit(full[1], onlyDigits(full[2], 2), onlyDigits(full[3], 2));
      return;
    }
    set(digits);
    const ny = which === 'y' ? digits : y;
    const nm = which === 'm' ? digits : m;
    const nd = which === 'd' ? digits : d;
    // 🔴 日期段只在**满 2 位**时提交（敲到一半的 10-1→ 会把总量建议算歪）；
    //   单位数字靠 blur 提交（见日段 onBlur）。
    if (which !== 'y' && digits.length === maxLen) {
      commit(ny, nm, nd);
      // 月满位 → 跳日段；日满位 → 提交完成（日期是最后一段）
      if (which === 'm') dRef.current?.focus();
      return;
    }
    if (which === 'y' && digits.length === 4) {
      mRef.current?.focus();
      return;
    }
    if (which === 'm' && digits.length === 1 && Number(digits) >= jumpIfSingle) {
      // 月份首数字 ≥2（2–9 月）已是完整月份 → 提交并跳日段
      commit(ny, nm, nd);
      dRef.current?.focus();
      return;
    }
    if (which === 'm') commit(ny, nm, nd);
  };

  const onKeyDown = (which: 'y' | 'm' | 'd', e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (e.key === 'Enter' || e.key === '-' || e.key === '/' || e.key === '.') {
      e.preventDefault();
      (which === 'y' ? mRef : which === 'm' ? dRef : null)?.current?.focus();
      return;
    }
    if (e.key === 'Backspace' && el.value === '') {
      e.preventDefault();
      (which === 'm' ? yRef : which === 'd' ? mRef : null)?.current?.focus();
    }
  };

  const mi = Number(m); const di = Number(d);
  const invalid = (m.length > 0 && (mi < 1 || mi > 12))
    || (d.length > 0 && (di < 1 || di > 31))
    || (y.length === 4 && m.length > 0 && d.length > 0
      && (() => { const dt = new Date(Date.UTC(Number(y), mi - 1, di)); return dt.getUTCMonth() !== mi - 1 || dt.getUTCDate() !== di; })());
  const ringCls = invalid ? ' ring-red-400' : ' ring-ink/15';

  const segCls = 'w-12 rounded border-0 bg-white px-1 py-0.5 text-center text-[11.5px] text-ink ring-1 focus:outline-none focus:ring-2 focus:ring-brand';

  return (
    <div className="inline-flex items-center gap-0.5" aria-label={ariaLabel}>
      <input
        ref={yRef}
        value={y}
        inputMode="numeric"
        placeholder="2026"
        aria-label="年份"
        onChange={(e) => seg('y', e.target.value, setY, 4, 0)}
        onKeyDown={(e) => onKeyDown('y', e)}
        className={`${segCls} w-14`}
      />
      <span className="text-ink-faint">-</span>
      <input
        ref={mRef}
        value={m}
        inputMode="numeric"
        placeholder="10"
        aria-label="月份"
        onChange={(e) => seg('m', e.target.value, setM, 2, 2)}
        onKeyDown={(e) => onKeyDown('m', e)}
        className={segCls + ringCls}
      />
      <span className="text-ink-faint">-</span>
      <input
        ref={dRef}
        value={d}
        inputMode="numeric"
        placeholder="31"
        aria-label="日期"
        onChange={(e) => seg('d', e.target.value, setD, 2, 4)}
        onBlur={() => { if (d.length >= 1) commit(y, m, d); }}
        onKeyDown={(e) => onKeyDown('d', e)}
        className={segCls + ringCls}
      />
    </div>
  );
}
