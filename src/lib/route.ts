/**
 * 手写 hash 路由（《页面与使用逻辑规格书》§4.1；《前端架构规格书》§4.1 禁新依赖）
 * ============================================================
 * F1（页面与使用逻辑规格书 §2.1）：一级导航从 4 项改 5 项 ——
 * today / week / goals / profile / libao；`import` 仅 DEV 作为第六项。
 *
 * P2-1（任务收口计划书 R3）：从 `App.tsx` 抽出的**纯函数层**。抽出来的唯一目的是
 * **可单测** —— `parseRoute` 现在**收 hash 字符串**，而不是自己去读 `window.location.hash`，
 * 于是 Node 里零 DOM 就能测（本仓无 jsdom / testing-library，且红线禁新增依赖，
 * 真渲染版测试做不了 → 只能把「可测的部分」推到纯函数里）。
 *
 * 环境相关的两件事由调用方（`App.tsx`）注入，本模块**不读** window / document / Vite env：
 *   ① 当前 hash —— 作为参数传进来；
 *   ② 是否 DEV  —— 作为 `RouteEnv.showImport` 传进来。
 * 这条「不许碰 window」的约束由 `tests/route.test.ts` 静态守住，防止日后被改回去。
 *
 * `TAB_LABEL` 与 `MainTab` 放在同一个模块：`Record<MainTab, string>` 是穷尽映射，
 * 新增一个 tab 却忘写文案会**直接编译不过**（tsc 是门禁之一）。
 */
import { mondayOf } from '@/lib/date';

export type MainTab = 'today' | 'week' | 'goals' | 'profile' | 'libao' | 'import';

/** 导航文案与 tab 同处一地，避免开发期专用入口（import）的文案漂移 */
export const TAB_LABEL: Record<MainTab, string> = {
  today: '今天',
  week: '周计划',
  goals: '目标',
  profile: '我的画像',
  libao: '梨宝',
  import: '导入课表',
};

/**
 * 路由 = 唯一的「当前页」事实来源。
 * `#/week` 可带周参数 `#/week/<ISO-Monday>`；导航只写 `location.hash`，
 * route 状态由 hashchange 事件回流 —— 浏览器前进 / 后退因此天然可用；
 * 刷新时从 hash 重新解析 → 停在当前页。
 */
export interface Route {
  tab: MainTab;
  /** 周计划页的本周一（ISO）；null = 本周默认口径（原 `weekMonday === null` 同义） */
  weekMonday: string | null;
}

/** 路由解析所需的环境事实 —— 由调用方注入，本模块不自取 */
export interface RouteEnv {
  /** 是否允许 `#/import`（课表导入联调页只在开发环境出现） */
  showImport?: boolean;
}

/**
 * hash → Route。坏 hash 一律**安静回落**，不抛错、不问用户：
 *   · `#/week/<非法 ISO>` → 按「本周」处理（不猜具体周）；
 *   · 未知 / 缺省 hash     → 今天页。
 * `hashOf` 是它的逆运算，二者往返一致由 `tests/route.test.ts` 守住。
 */
export function parseRoute(hash: string, env: RouteEnv = {}): Route {
  const seg = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const head = seg[0];
  if (head === 'week') {
    const iso = seg[1];
    // 周参数必须是合法 ISO 日期；坏参数按「本周」处理（不猜具体周）
    return { tab: 'week', weekMonday: iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? mondayOf(iso) : null };
  }
  if (head === 'import' && env.showImport) return { tab: 'import', weekMonday: null };
  if (head === 'goals' || head === 'profile' || head === 'libao') return { tab: head, weekMonday: null };
  // 缺省 / 未知 hash → 今天页
  return { tab: 'today', weekMonday: null };
}

/** Route → hash（带 `#`）。`weekMonday` 只对 week 有意义，其余 tab 忽略它。 */
export function hashOf(tab: MainTab, weekMonday: string | null): string {
  if (tab === 'week') return weekMonday ? `#/week/${weekMonday}` : '#/week';
  return `#/${tab}`;
}
