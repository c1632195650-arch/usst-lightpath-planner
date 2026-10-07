import type { InputHTMLAttributes, ReactNode } from 'react';

/**
 * 开关 / 复选 / 单选（UI v2 §10.2.4，native accent-color 路线）。
 * 开关 vs 复选的语义边界：
 *   开关 = 立即生效（拨一下就保存，不需要「保存」按钮）；
 *   复选 = 攒着一起提交。
 * 开关不给「是/否」标签——文案写在左边，右边只有拨杆，读作「提醒设置：开」。
 */

interface SwitchProps {
  label: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** 关联表单字段名（随原生 input 提交时用） */
  name?: string;
  /** 测试锚点（data-testid，落到原生 input 上）——与其余 ui 组件同规。 */
  testId?: string;
}

/** 拨杆开关：native checkbox + accent-brand 视觉拨杆，键盘可达。 */
export function Switch({ label, checked, onChange, disabled = false, name, testId }: SwitchProps) {
  return (
    <label className={`inline-flex items-center justify-between gap-3 ${disabled ? 'opacity-40' : ''}`}>
      <span className="text-sm text-ink">{label}</span>
      <input
        type="checkbox"
        name={name}
        data-testid={testId}
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={[
          'peer h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full border border-ink/15 bg-paper',
          'transition-[background-color,border-color] duration-fast ease-out',
          'checked:border-brand checked:bg-brand',
          'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
          'disabled:cursor-not-allowed',
          // 拨杆圆点：未选中在左，选中滑到右
          'relative after:absolute after:left-0.5 after:top-1/2 after:h-[18px] after:w-[18px] after:-translate-y-1/2 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-fast after:ease-out after:content-[""]',
          'checked:after:translate-x-4',
        ].join(' ')}
      />
    </label>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

/** 复选：native input + accent-brand；完成项划线由调用方传 label 上的样式。 */
export function Checkbox({ label, className = '', ...rest }: CheckboxProps) {
  return (
    <label className={`inline-flex min-h-11 items-center gap-2.5 ${rest.disabled ? 'opacity-40' : ''} ${className}`}>
      <input
        type="checkbox"
        className={[
          'h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-ink/30 accent-brand',
          'transition-[box-shadow] duration-fast ease-out',
          'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
          'disabled:cursor-not-allowed',
        ].join(' ')}
        {...rest}
      />
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

/** 单选：native input + accent-brand；name 由调用方给同组相同值。 */
export function Radio({ label, className = '', ...rest }: RadioProps) {
  return (
    <label className={`inline-flex min-h-11 items-center gap-2.5 ${rest.disabled ? 'opacity-40' : ''} ${className}`}>
      <input
        type="radio"
        className={[
          'h-[18px] w-[18px] shrink-0 cursor-pointer border-ink/30 accent-brand',
          'transition-[box-shadow] duration-fast ease-out',
          'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
          'disabled:cursor-not-allowed',
        ].join(' ')}
        {...rest}
      />
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}
