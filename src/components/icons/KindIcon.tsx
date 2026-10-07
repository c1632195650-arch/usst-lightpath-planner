import { Icon } from './Icon';
import { kindIcon } from './semanticIcons';

/**
 * 块面主图标（UI 收口批）。
 *
 * 为什么不是 emoji：设计总成 §4.3 的块解剖是五层（色条 / 主标题 / 时间 / 地点 /
 * 状态），里面没有 emoji 层；而且 emoji 是彩色位图字形，Windows / Android / iOS
 * 三套渲染，同一块在不同机器上长得不一样 —— 与「一份路径数据」的图标纪律相反。
 * 数据层的 `Block.emoji` 字段一个字节都没改，只换了渲染。
 *
 * blank 不给图标（空档不该抢注意力，与 chartColors 里 blank 的极浅底同一条理由）。
 */
export function KindIcon({ kind, className = 'mr-1' }: { kind?: string; className?: string }) {
  const name = kindIcon(kind ?? '');
  if (!name) return null;
  return (
    <span className={`inline-flex align-[-2px] ${className}`} aria-hidden="true">
      <Icon name={name} size="xs" />
    </span>
  );
}
