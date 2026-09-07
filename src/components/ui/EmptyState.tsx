interface Props {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/** 空状态 —— 空状态写得好，产品观感提升一个档次 */
export function EmptyState({ icon = '🌱', title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="text-[38px] mb-3 opacity-70">{icon}</div>
      <p className="font-bold text-[15px] text-ink">{title}</p>
      {description && (
        <p className="text-[13.5px] text-ink-faint mt-1.5 max-w-[280px] leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
