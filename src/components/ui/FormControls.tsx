import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

/**
 * 表单三件套（UI v2 §10.2.3）：Input / Select / Textarea 共用一套外置 label + 提示/错误结构。
 * 表单三条规则：
 *   ① 标签必须在输入框外上方，不用「占位符代替标签」（一输入就看不见在填什么）；
 *   ② 错误文案写在框下方且说清「怎么改」，不写「输入有误」；
 *   ③ 必填项用 * 标出，不要标「选填」（选填是默认预期）。
 * 占位符 #6E7688（--ph，对白底 4.56:1）；聚焦 2px 外环 + 3px 光晕，不是只有颜色变深。
 * 错误态边框转 --danger-text、聚焦红色光环。
 */

const FIELD_BASE = [
  'w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-ink outline-none',
  'transition-[border-color,box-shadow] duration-fast ease-out',
  'placeholder:text-[#6E7688]',
  'disabled:cursor-not-allowed disabled:bg-paper disabled:opacity-60',
  'focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1,0_0_0_7px_rgba(74,115,209,0.18)]',
].join(' ');

const FIELD_OK = 'border-[#7A8292] focus:border-brand focus:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1,0_0_0_7px_rgba(74,115,209,0.18)]';
const FIELD_ERR = 'border-[#B0402F] focus:border-[#B0402F] focus:shadow-[0_0_0_2px_#fff,0_0_0_4px_#B0402F,0_0_0_7px_rgba(176,64,47,0.16)]';

interface FieldShellProps {
  /** 外置 label 文本；必填时自动补 * */
  label: string;
  required?: boolean;
  /** 框下方提示（错误时必须说清怎么改） */
  hint?: ReactNode;
  /** 校验失败 → 边框转 danger + 提示变红 */
  error?: boolean;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}

/** 外置 label + 框 + 下方提示的通用壳；Input/Select/Textarea 三件套共用。 */
export function FieldShell({ label, required = false, hint, error = false, htmlFor, children, className = '' }: FieldShellProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-xs font-semibold text-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-[#B0402F]" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && (
        <p className={`text-[11px] leading-4 ${error ? 'text-[#B0402F]' : 'text-ink-faint'}`} role={error ? 'alert' : undefined}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 测试锚点（data-testid，落到原生控件上） */
  testId?: string;
  label: string;
  hint?: ReactNode;
  error?: boolean;
  wrapClassName?: string;
}

export function Input({ label, hint, error = false, wrapClassName = '', id, required, testId, ...rest }: InputProps) {
  const fieldId = id ?? rest.name ?? undefined;
  return (
    <FieldShell label={label} required={required} hint={hint} error={error} htmlFor={fieldId ?? ''} className={wrapClassName}>
      <input
        id={fieldId}
        data-testid={testId}
        {...rest}
        required={required}
        aria-invalid={error || undefined}
        className={`${FIELD_BASE} ${error ? FIELD_ERR : FIELD_OK}`}
      />
    </FieldShell>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** 测试锚点（data-testid，落到原生控件上） */
  testId?: string;
  label: string;
  hint?: ReactNode;
  error?: boolean;
  wrapClassName?: string;
}

export function Select({ label, hint, error = false, wrapClassName = '', id, required, testId, children, ...rest }: SelectProps) {
  const fieldId = id ?? rest.name ?? undefined;
  return (
    <FieldShell label={label} required={required} hint={hint} error={error} htmlFor={fieldId ?? ''} className={wrapClassName}>
      <select
        id={fieldId}
        data-testid={testId}
        {...rest}
        required={required}
        aria-invalid={error || undefined}
        className={`${FIELD_BASE} ${error ? FIELD_ERR : FIELD_OK}`}
      >
        {children}
      </select>
    </FieldShell>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** 测试锚点（data-testid，落到原生控件上） */
  testId?: string;
  label: string;
  hint?: ReactNode;
  error?: boolean;
  wrapClassName?: string;
}

/** 文本域：默认两行可见高度，超出内部滚动。 */
export function Textarea({ label, hint, error = false, wrapClassName = '', id, required, testId, ...rest }: TextareaProps) {
  const fieldId = id ?? rest.name ?? undefined;
  return (
    <FieldShell label={label} required={required} hint={hint} error={error} htmlFor={fieldId ?? ''} className={wrapClassName}>
      <textarea
        id={fieldId}
        data-testid={testId}
        {...rest}
        required={required}
        aria-invalid={error || undefined}
        className={`${FIELD_BASE} ${error ? FIELD_ERR : FIELD_OK} min-h-[4.2rem] resize-none overflow-y-auto`}
      />
    </FieldShell>
  );
}
