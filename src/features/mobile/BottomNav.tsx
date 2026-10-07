/**
 * 光溯移动端 · 底部导航栏（2026-10-08，按 CY 要求新增）
 * ============================================================
 * 五格：今天 / 本周 / 梨宝（中，品牌色）/ 待办 / 我的。
 * · 梨宝中键 = 打开既有 LbaoDrawer（沿用 m-lbao-toggle 锚点，e2e 零改动）；
 * · 固定底栏 + iOS 安全区；当前页 aria-current=page；
 * · 图标统一走本仓图鉴（Icon 组件）——不再有 emoji/字符图标。
 * 语义：导航只管切页（状态在 MobileApp），不碰任何数据。
 */
import { Icon } from '@/components/icons/Icon';
import type { IconName } from '@/components/icons/Icon';

export type MobileTab = 'today' | 'week' | 'todo' | 'me';

const TABS: Array<{ id: MobileTab; label: string; icon: IconName }> = [
  { id: 'today', label: '今天', icon: 'clock' },
  { id: 'week', label: '本周', icon: 'calendar-days' },
  { id: 'todo', label: '待办', icon: 'check-square' },
  { id: 'me', label: '我的', icon: 'user-round' },
];

export default function BottomNav({ tab, onTab, onLbao }: {
  tab: MobileTab;
  onTab: (t: MobileTab) => void;
  /** 梨宝中键：打开抽屉（不切页） */
  onLbao: () => void;
}) {
  return (
    <nav
      aria-label="主导航"
      data-testid="m-bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-paper/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-5 items-end px-2 pb-1.5 pt-1.5">
        {TABS.slice(0, 2).map((t) => <NavItem key={t.id} t={t} tab={tab} onTab={onTab} />)}
        {/* 梨宝：中键（品牌色圆钮，语义 = 打开对话抽屉） */}
        <button
          type="button"
          data-testid="m-lbao-toggle"
          onClick={onLbao}
          aria-label="问梨宝"
          className="mx-auto -mt-5 flex h-14 w-14 flex-col items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition-transform duration-fast active:scale-[0.985]"
        >
          <Icon name="sparkle" size="lg" />
        </button>
        {TABS.slice(2).map((t) => <NavItem key={t.id} t={t} tab={tab} onTab={onTab} />)}
      </div>
    </nav>
  );
}

function NavItem({ t, tab, onTab }: {
  t: { id: MobileTab; label: string; icon: IconName };
  tab: MobileTab;
  onTab: (t: MobileTab) => void;
}) {
  const active = tab === t.id;
  return (
    <button
      type="button"
      data-testid={`m-tab-${t.id}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => onTab(t.id)}
      className={`mx-auto flex min-h-11 w-full flex-col items-center justify-end gap-0.5 rounded-lg pb-0.5 text-[11px] font-medium transition-colors active:scale-[0.985] ${
        active ? 'text-brand' : 'text-ink-faint'
      }`}
    >
      <Icon name={t.icon} size="md" />
      {t.label}
    </button>
  );
}
