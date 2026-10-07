import type { ReactNode } from 'react';

/**
 * 头像 / 头像组（UI v2 §10.3.2）：26 / 38 / 56px 三档够用；
 * 在线 = 右下 10px 圆点 + 2px 白描边（描边是为了在深色头像上还能看清）；
 * 头像组重叠 9px，最多显示 3 个再折叠成 +N。
 */

type Size = 26 | 38 | 56;

const SIZE_CLASS: Record<Size, string> = {
  26: 'h-[26px] w-[26px] text-[10px]',
  38: 'h-[38px] w-[38px] text-sm',
  56: 'h-14 w-14 text-lg',
};

const TONES = [
  'bg-brand-light text-brand',
  'bg-ok-light text-ok',
  'bg-warn-light text-[#965C18]',
  'bg-gold/15 text-[#7A5A1E]',
];

interface Props {
  /** 头像内容：单字（姓）或 <img> */
  children?: ReactNode;
  name?: string;
  size?: Size;
  online?: boolean;
  className?: string;
}

export function Avatar({ children, name, size = 38, online = false, className = '' }: Props) {
  const display = children ?? (name ? name.slice(0, 1) : '?');
  const tone = name
    ? TONES[[...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % TONES.length]
    : TONES[0];
  return (
    <span className={`relative inline-block shrink-0 ${className}`}>
      <span className={`grid place-items-center rounded-full font-semibold ${SIZE_CLASS[size]} ${tone}`} aria-hidden="true">
        {display}
      </span>
      {name && <span className="sr-only">{name}</span>}
      {online && (
        <span
          className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-ok"
          aria-label="在线"
          role="img"
        />
      )}
    </span>
  );
}

export function AvatarGroup({ names, size = 26, extra, className = '' }: {
  names: string[];
  size?: Size;
  /** 超出 3 个时的剩余数；不给则按 names.length - 3 自动算 */
  extra?: number;
  className?: string;
}) {
  const shown = names.slice(0, 3);
  const rest = extra ?? Math.max(0, names.length - 3);
  return (
    <span className={`inline-flex items-center ${className}`} aria-label={names.join('、')}>
      {shown.map((n, i) => (
        <span key={`${n}-${i}`} className={i > 0 ? '-ml-[9px] rounded-full ring-2 ring-white' : 'rounded-full ring-2 ring-white'}>
          <Avatar name={n} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className={`-ml-[9px] grid place-items-center rounded-full bg-paper text-[10px] font-semibold text-ink-soft ring-2 ring-white ${SIZE_CLASS[size]}`}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
