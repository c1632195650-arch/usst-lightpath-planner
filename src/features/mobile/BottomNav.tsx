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

/**
 * 页签标识。`week` 保留在联合类型里仅为兼容既有引用（WeekTab/WeekBoard 组件未删，
 * 万一要回退只需把 TABS 里那一项加回来）；当前导航不再有该页签。
 */
export type MobileTab = 'today' | 'week' | 'todo' | 'me';

/** 三个页签 + 梨宝中键 = 四格（2026-10-08 页面模板批：今天/本周合并为「日程」）。 */
const TABS: Array<{ id: MobileTab; label: string; icon: IconName }> = [
  { id: 'today', label: '日程', icon: 'calendar-days' },
  { id: 'todo', label: '待办', icon: 'check-square' },
  { id: 'me', label: '我的', icon: 'user-round' },
];

/** 梨宝圆钮插在第几格（0-based）。四格时放第 3 格 —— 右手拇指最容易够到的位置。 */
const LBAO_SLOT = 2;

export default function BottomNav({ tab, onTab, onLbao }: {
  tab: MobileTab;
  onTab: (t: MobileTab) => void;
  /** 梨宝中键：打开抽屉（不切页） */
  onLbao: () => void;
}) {
  const before = TABS.slice(0, LBAO_SLOT);
  const after = TABS.slice(LBAO_SLOT);
  return (
    <nav
      aria-label="主导航"
      data-testid="m-bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-paper/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className="mx-auto grid w-full max-w-md items-end px-2 pb-1.5 pt-1.5"
        style={{ gridTemplateColumns: `repeat(${TABS.length + 1}, minmax(0, 1fr))` }}
      >
        {before.map((t) => <NavItem key={t.id} t={t} tab={tab} onTab={onTab} />)}
        {/* 梨宝：品牌色圆钮，语义 = 打开对话抽屉（沿用 m-lbao-toggle 锚点） */}
        <button
          type="button"
          data-testid="m-lbao-toggle"
          onClick={onLbao}
          aria-label="问梨宝"
          className="mx-auto -mt-5 flex h-14 w-14 flex-col items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition-transform duration-fast active:scale-[0.985]"
        >
          <Icon name="sparkle" size="lg" />
        </button>
        {after.map((t) => <NavItem key={t.id} t={t} tab={tab} onTab={onTab} />)}
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
