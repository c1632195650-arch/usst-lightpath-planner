import { Icon, type IconName } from '@/components/icons/Icon';

interface Props {
  /** 主题图标（设计总成 §9.7 出口②：每页固定一种，不随机）。默认 inbox = 待办主题。 */
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * 空状态（设计总成 §10.3.3：图标 xl + 主句 + 引导句）。
 *
 * ⚠️ 2026-10-08（UI 收口批）：`icon` 原先是**字符串 emoji**（默认 `'🌱'`，
 * 调用方传 `'🎯'`）—— 与 §9.6「emoji 全换图鉴」相悖，且在 Windows / Android 上
 * 各家 emoji 字形不一致，同一处空态在不同机器上长得不一样。
 * 现改为吃 `IconName`，走 90 枚图鉴的 xl 档（32px / 线宽 1.6）。
 */
export function EmptyState({ icon = 'inbox', title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-light text-brand">
        <Icon name={icon} size="xl" />
      </div>
      <p className="text-base font-semibold tracking-tight text-ink">{title}</p>
      {description && (
        <p className="mt-2 max-w-[280px] text-sm leading-6 text-ink-faint">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
