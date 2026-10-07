/**
 * 光溯移动端 · 时间燃烧条（新任务三 §3.3）
 * 颜色随进度（绿→琥珀→红），带百分比与「还剩 N 分钟」；
 * 未开始 → 「还有 N 分钟开始」；已结束 → burnRatio 返回 null → 整条不渲染。
 */
import { burnRatio } from './lib/burnBar.ts';

const PHASE_COLOR: Record<string, string> = {
  green: 'bg-ok',
  amber: 'bg-amber-400',
  red: 'bg-danger',
};

export default function BurnBar({ startMin, endMin, nowMin, tone = 'dark' }: {
  startMin: number;
  endMin: number;
  nowMin: number;
  /** dark = 深色底（品牌色横幅内），light = 浅色底 */
  tone?: 'dark' | 'light';
}) {
  const b = burnRatio(startMin, endMin, nowMin);
  if (!b) return null;
  const pct = Math.round(b.ratio * 100);
  const label = b.phase === 'upcoming'
    ? `还有 ${b.remainMin} 分钟开始`
    : b.remainMin < 1
      ? '即将结束'
      : `还剩 ${b.remainMin} 分钟 · ${pct}%`;
  return (
    <div data-testid="m-burn-bar" className="mt-2">
      <div className={`h-2 w-full overflow-hidden rounded-full ${tone === 'dark' ? 'bg-white/25' : 'bg-ink/10'}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-base ${PHASE_COLOR[b.phase] ?? 'bg-ok'}`}
          style={{ width: `${Math.round(b.ratio * 100)}%` }}
        />
      </div>
      <p className={`mt-1 text-xs ${tone === 'dark' ? 'text-white/90' : 'text-ink-soft'}`}>{label}</p>
    </div>
  );
}
