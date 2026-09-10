import type { Axes } from '@/types';
import { AXIS_KEYS, AXIS_META } from '@/lib/persona';

/** 8 轴雷达图（SVG） */
export function Radar({ axes, size = 320 }: { axes: Axes; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.34;
  const n = AXIS_KEYS.length;

  const angle = (i: number) => (-90 + (i * 360) / n) * (Math.PI / 180);
  const point = (i: number, r: number) => {
    const a = angle(i);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };

  // 网格（4 圈）
  const rings = [0.25, 0.5, 0.75, 1];
  const gridPolygons = rings.map((f) =>
    AXIS_KEYS.map((_, i) => point(i, R * f).join(',')).join(' ')
  );

  // 数据多边形
  const dataPoly = AXIS_KEYS.map((k, i) => {
    const v = Math.max(6, Math.min(100, axes[k]));
    return point(i, R * (v / 100)).join(',');
  }).join(' ');

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="mx-auto block h-auto w-full max-w-[300px]"
      role="img"
      aria-label="八个生活维度的倾向分布"
    >
      {/* 网格 */}
      {gridPolygons.map((p, idx) => (
        <polygon
          key={idx}
          points={p}
          fill="none"
          stroke="#dfe5ee"
          strokeWidth={idx === 3 ? 1.5 : 1}
        />
      ))}
      {/* 轴线 */}
      {AXIS_KEYS.map((_, i) => {
        const [x, y] = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#dfe5ee" strokeWidth="1" />;
      })}

      {/* 数据多边形 */}
      <polygon points={dataPoly} fill="#3865a6" fillOpacity="0.16" stroke="#3865a6" strokeWidth="2.5" strokeLinejoin="round" />
      {AXIS_KEYS.map((k, i) => {
        const v = Math.max(6, Math.min(100, axes[k]));
        const [x, y] = point(i, R * (v / 100));
        return <circle key={k} cx={x} cy={y} r="4" fill="#3865a6" stroke="#fff" strokeWidth="1.5" />;
      })}

      {/* 标签 + 数值 */}
      {AXIS_KEYS.map((k, i) => {
        const a = angle(i);
        const [x, y] = point(i, R + 22);
        const [lx, ly] = point(i, R + 8);
        const val = Math.round(axes[k]);
        const dx = Math.cos(a);
        const anchor = Math.abs(dx) < 0.3 ? 'middle' : dx > 0 ? 'start' : 'end';
        return (
          <g key={k}>
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight="700" fill="#172033">
              {val}
            </text>
            <text x={x} y={y + 2} textAnchor={anchor} dominantBaseline="middle" fontSize="12" fill="#536174">
              {AXIS_META[k].short}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
