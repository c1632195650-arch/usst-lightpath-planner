/**
 * 光溯品牌符号（UI v2 批次 B，设计总成 §01.2 断线几何最终版）
 * ============================================================
 * 几何（照抄设计稿 §1.2 表，禁止随手改数值）：
 *   入射光  M5.25 24h8.5
 *   棱镜三角 M20.75 12L34.15 35H7.35z（加粗 3.2）
 *   折射光  三条等长、张角 ±22°：M30.85 18L35.85 15.98 / M34.34 24L39.35 24 / M37.84 30L42.84 32.02
 * 规则：
 *   - 单色 currentColor（光谱金退出符号——#E8B44E 白底 1.90:1，浅底会整片消失）。
 *   - 端点/拐角统一 round（尖角在小尺寸会崩）。
 *   - plate 态内嵌 rx=12 色板 + 白符号，内层 translate(2.1,2.1) scale(.912)（引用宽高 ×0.91）。
 *   - xs 降级：size ≤ 24 时线宽整体升到 3.2 / 三角 4.2（小尺寸补偿）。
 */
interface Props {
  /** 32 |
   *  ink：浅底标准墨色；on-dark：深底反白；mono：完全继承文字色；plate：品牌色板方块。 */
  tone?: 'ink' | 'on-dark' | 'mono' | 'plate';
  /** 渲染边长（px）。≤24 走 xs 线宽补偿。 */
  size?: number;
  className?: string;
}

const BEAM = 'M5.25 24h8.5';
const TRI = 'M20.75 12L34.15 35H7.35z';
const SP = 'M30.85 18L35.85 15.98M34.34 24L39.35 24M37.84 30L42.84 32.02';

const TONE_COLOR: Record<NonNullable<Props['tone']>, string | undefined> = {
  ink: '#1F2A44',
  'on-dark': '#FFFFFF',
  mono: undefined, // currentColor：随上下文文字色
  plate: '#FFFFFF', // plate 的符号本体永远反白（底由色板承担）
};

export function LightpathMark({ tone = 'mono', size = 32, className }: Props) {
  const t = tone;
  const xs = size <= 24;
  const strokeWidth = xs ? 3.2 : 2.4;
  const triWidth = xs ? 4.2 : 3.2;
  const color = TONE_COLOR[t];
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', flex: 'none', color, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }}
      aria-hidden="true"
    >
      {t === 'plate' && <rect x="0" y="0" width="48" height="48" rx="12" fill="#1F3A78" stroke="none" />}
      <g transform={t === 'plate' ? 'translate(2.1,2.1) scale(.912)' : undefined}>
        <path d={BEAM} stroke="currentColor" strokeWidth={strokeWidth} />
        <path d={TRI} stroke="currentColor" strokeWidth={triWidth} />
        <path d={SP} stroke="currentColor" strokeWidth={strokeWidth} />
      </g>
    </svg>
  );
}

/**
 * 光溯字标：中文「光溯」（霞鹜文楷 Screen / display 栈）+ 西文副标 LIGHTPATH。
 * 用于欢迎页与需要完整品牌署名的场景；顶栏窄位用 LightpathMark 即可。
 */
export function LightpathWordmark({
  tone = 'on-dark',
  size = 'md',
  subtitle = 'USST · LIGHTPATH',
  className,
}: {
  tone?: 'ink' | 'on-dark' | 'mono';
  size?: 'sm' | 'md' | 'lg';
  subtitle?: string;
  className?: string;
}) {
  const titleSize = { sm: 'text-xl', md: 'text-2xl', lg: 'text-4xl' }[size];
  const color = tone === 'ink' ? 'text-[#1F2A44]' : tone === 'mono' ? '' : 'text-white';
  const subColor = tone === 'on-dark' ? 'text-white/55' : 'text-ink-faint';
  return (
    <span className={`inline-flex flex-col leading-tight ${className ?? ''}`}>
      <span className={`font-display font-semibold tracking-[0.01em] ${titleSize} ${color}`}>光溯</span>
      {subtitle && (
        <span className={`mt-0.5 text-[10px] font-semibold tracking-[0.28em] ${subColor}`}>{subtitle}</span>
      )}
    </span>
  );
}
