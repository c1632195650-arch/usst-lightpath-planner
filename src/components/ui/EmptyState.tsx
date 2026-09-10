interface Props {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/** 空状态 —— 空状态写得好，产品观感提升一个档次 */
export function EmptyState({ icon = '🌱', title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-brand-light text-xl">{icon}</div>
      <p className="text-base font-semibold tracking-tight text-ink">{title}</p>
      {description && (
        <p className="mt-2 max-w-[280px] text-sm leading-6 text-ink-faint">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
