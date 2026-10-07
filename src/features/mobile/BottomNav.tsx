/**
 * 光溯移动端 · 底部导航栏（2026-10-08 新增；同日二改：梨宝并入同形态页签）
 * ============================================================
 * 四格：日程 / 待办 / 梨宝 / 我的 —— **四个形态完全一致**。
 * · 2026-10-08 二改（CY 指令）：去掉梨宝的「高光」——原先它是品牌色圆钮、
 *   上浮 5、带投影（`-mt-5 h-14 w-14 rounded-full bg-brand shadow-lg`），现在
 *   与其它页签同一形态（同高、同色、同字号），点击语义也统一为**切到全屏页**
 *   （不再是弹抽屉）；`m-lbao-toggle` 锚点保留（e2e 只改断言内容，不改定位）。
 * · 固定底栏 + iOS 安全区；当前页 aria-current=page；
 * · 图标统一走本仓图鉴（Icon 组件）——不再有 emoji/字符图标。
 * 语义：导航只管切页（状态在 MobileApp），不碰任何数据。
 */
import { Icon } from '@/components/icons/Icon';
import type { IconName } from '@/components/icons/Icon';

/**
 * 页签标识。`week` 保留在联合类型里仅为兼容既有引用（WeekTab/WeekBoard 组件未删，
 * 万一要回退只需把 TABS 里那一项加回来）；当前导航不再有该页签。
 */
export type MobileTab = 'today' | 'week' | 'todo' | 'me' | 'lbao';

/** 四个页签（含梨宝）——同一形态，从左到右：日程 / 待办 / 梨宝 / 我的。 */
const TABS: Array<{ id: MobileTab; label: string; icon: IconName }> = [
  { id: 'today', label: '日程', icon: 'calendar-days' },
  { id: 'todo', label: '待办', icon: 'check-square' },
  { id: 'lbao', label: '梨宝', icon: 'sparkle' },
  { id: 'me', label: '我的', icon: 'user-round' },
];

export default function BottomNav({ tab, onTab }: {
  tab: MobileTab;
  onTab: (t: MobileTab) => void;
}) {
  return (
    <nav
      aria-label="主导航"
      data-testid="m-bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-paper/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className="mx-auto grid w-full max-w-md items-end px-2 pb-1.5 pt-1.5"
        style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={t.id === 'lbao' ? 'm-lbao-toggle' : `m-tab-${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}
            aria-label={t.id === 'lbao' ? '问梨宝' : undefined}
            className={`mx-auto flex min-h-11 w-full flex-col items-center justify-end gap-0.5 rounded-lg pb-0.5 text-[11px] font-medium transition-colors active:scale-[0.985] ${
              tab === t.id ? 'text-brand' : 'text-ink-faint'
            }`}
          >
            <Icon name={t.icon} size="md" />
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
