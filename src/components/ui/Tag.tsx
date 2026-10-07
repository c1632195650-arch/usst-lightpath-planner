import type { ReactNode } from 'react';

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'gold' | 'school';

interface Props {
  children: ReactNode;
  tone?: Tone;
  /** 未读小圆点（7px）——与数字徽标不混用（§10.2.5） */
  dot?: boolean;
  /** 数字徽标（如未读数 3） */
  count?: number;
  className?: string;
}

const TONES: Record<Tone, string> = {
  neutral: 'border-ink/10 bg-paper text-ink-soft',
  brand: 'border-brand/20 bg-brand-light text-brand',
  ok: 'border-ok/20 bg-ok-light text-ok',
  warn: 'border-warn/20 bg-warn-light text-[#965C18]',
  danger: 'border-danger/20 bg-danger-light text-[#B0402F]',
  gold: 'border-gold/30 bg-gold/10 text-[#7A5A1E]',
  school: 'border-school-red/20 bg-school-light text-school-red',
};

/**
 * 标签 / 徽标 / 状态点（UI v2 §10.2.5）。
 * 只描述「是什么类别」或「当前处于什么状态」，不写操作——「点击编辑」这种话是按钮的活。
 * 未读用小圆点（dot），数量用数字标签（count），两者不混用。
 */
export function Tag({ children, tone = 'neutral', dot = false, count, className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}
    >
      {dot && <span className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />}
      {children}
      {/* §10.2.5：未读用小圆点，数量用数字标签，两者不混用——dot 在场时抑制 count。 */}
      {!dot && count != null && (
        <span className="inline-grid min-w-[16px] place-items-center rounded-full bg-current/15 px-1 text-[10px] font-semibold tabular-nums">
          {count}
        </span>
      )}
    </span>
  );
}
