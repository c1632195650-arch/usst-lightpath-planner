import { checklistStatus, type ChecklistKey } from './checklist';
import { Icon } from '@/components/icons/Icon';

interface Props {
  hasSchedule: boolean;
  lifeMode: string | null;
  userDeadlineCount: number;
  onGotoImport: () => void;
  onOpenModeSetup: () => void;
  onGotoLibao: () => void;
}

const ACTION_OF: Record<ChecklistKey, (p: Props) => void> = {
  importCourse: (p) => p.onGotoImport(),
  lifeMode: (p) => p.onOpenModeSetup(),
  deadline: (p) => p.onGotoLibao(),
};

/**
 * V0-3：总览页 onboarding checklist 卡。
 * 三条待办完成一条亮一个勾；**全部完成整卡隐藏**（不留装饰性空卡）。
 */
export function OnboardingChecklist(props: Props) {
  const { items, doneCount, allDone } = checklistStatus(props);
  if (allDone) return null;
  return (
    <div className="panel px-4 py-3.5 sm:px-5" data-testid="onboarding-checklist">
      <div className="flex items-baseline justify-between gap-3">
        <p className="section-label-zh">开始使用</p>
        <span className="text-[11px] text-ink-faint tabular-nums">{doneCount} / {items.length} 完成</span>
      </div>
      <ul className="mt-2 grid gap-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3">
            <span className={`min-w-0 text-[12.5px] leading-5 ${item.done ? 'text-ink-faint line-through' : 'text-ink'}`}>
              <span className="relative top-[2px] inline-flex ${item.done ? 'text-ok' : 'text-ink-faint'}" aria-hidden="true"><Icon name={item.done ? 'check-square' : 'mg-square'} size="xs" /></span> {item.label}
            </span>
            {!item.done && (
              <button
                type="button"
                data-testid={`checklist-action-${item.key}`}
                onClick={() => ACTION_OF[item.key](props)}
                className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-medium text-brand ring-1 ring-brand/25 transition-colors hover:bg-brand/5"
              >
                {item.actionLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
