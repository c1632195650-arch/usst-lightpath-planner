import { ICONS } from './iconPaths';

/**
 * 全站统一图标（UI v2 批次 E1，设计总成 §09）
 * ============================================================
 * viewBox 24（微几何 12）、stroke=currentColor、fill:none、round 端点/拐角。
 * 五档尺寸/线宽补偿（§9.3，禁止随手定）：
 *   xs 14px/2.4 · sm 16px/2.2 · md★ 20px/2 · lg 24px/1.8 · xl 32px/1.6
 * 语义：`<Icon name size tone />`；tone=decorative 时 aria-hidden（默认），
 * 语义图标由调用方自带可见文字时也保持 decorative——图标不承载唯一信息（§7.7）。
 */

export type IconName = keyof typeof ICONS;
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** §9.3 尺寸阶梯（px）与线宽补偿 */
export const ICON_SIZE_STEPS: Record<IconSize, { px: number; width: number }> = {
  xs: { px: 14, width: 2.4 },
  sm: { px: 16, width: 2.2 },
  md: { px: 20, width: 2 },
  lg: { px: 24, width: 1.8 },
  xl: { px: 32, width: 1.6 },
};

interface Props {
  name: IconName;
  /** 五档阶梯；缺省 md★ */
  size?: IconSize;
  className?: string;
  /** 传 label 时图标变语义件（role=img + aria-label）；默认纯装饰 aria-hidden */
  label?: string;
}

export function Icon({ name, size = 'md', className = '', label }: Props) {
  const def = ICONS[name];
  if (!def) return null;
  const step = ICON_SIZE_STEPS[size];
  const micro = def.viewBox.startsWith('12 ');
  // 微几何符（12 viewBox）是实心 fill 形（§7.7 双编码），不吃线宽补偿
  return (
    <svg
      viewBox={def.viewBox}
      width={step.px}
      height={step.px}
      className={className}
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true })}
      fill={micro ? 'currentColor' : 'none'}
      stroke={micro ? 'none' : 'currentColor'}
      strokeWidth={micro ? undefined : step.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flex: 'none' }}
      dangerouslySetInnerHTML={{ __html: def.d }}
    />
  );
}
