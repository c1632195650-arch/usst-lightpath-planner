/**
 * 空间库 → 排程引擎的选取策略（E 批 E2 · 2026-09-28 · 纯函数）
 * ============================================================
 * 为什么要有这个文件：`places.ts` 早已把 147 个校园地点显式化（校区 / 营业时段 / 别名），
 * `transfer.ts` 也能给真实步行分钟，但引擎选「去哪儿」时**只看画像偏好池的顺序**
 * —— 不知道「此刻开不开」「走过去几分钟」「这个点到底是不是估算值」。
 * 本文件把空间库的这三件事变成**可排序的确定性判据**。
 *
 * 纪律（与 places.ts 一脉相承）：
 *   · **不 import JSON、不做 IO**：步行分钟由调用方注入（与 `transfer` provider 同手法）；
 *   · **不猜**：校区未知（UNKNOWN）一律剔除；营业时段未知 → `openNow = null`
 *     （保留但不假装知道），而不是当成「开」或「关」；
 *   · **估算要留余量**：`walkEstimate` 的位置按**更紧的步行预算**筛
 *     （`ESTIMATE_SLACK_EXTRA_MIN`），宁可少走一段去确定的地方；
 *   · **不引入随机数**：同输入必得同序（末位用名称字典序兜底）。
 *
 * 边界：本文件不改区块内容、不写盘；开关 `spatialWired()` 缺省开启（G 批 2026-10-01
 * 拍板全开，golden 已按开启态重拍），env 显式置 `'0'`/`'false'` 可关闭回退。
 */
import type { CampusId } from '@/types';
import type { Place } from './model.ts';

/* ============================================================
 * 一、总开关（缺省开启；G 批 2026-10-01 起，golden 已按开启态重拍）
 * ========================================================== */

/**
 * 空间策略开关。双路读取（Node 测试 / Vite 浏览器）。**缺省 true**（E 批灰度期
 * 已结束，G 批拍板全开）；env 显式置 `'0'`/`'false'` 关闭 —— 逃生门。
 * 每次调用都读 —— 用例内可翻开关再复原，不在 import 期定死。
 */
export function spatialWired(): boolean {
  const on = (v: string | undefined) => v == null || (v !== '0' && v !== 'false');
  let v: string | undefined;
  try {
    v = typeof process !== 'undefined'
      ? (process as unknown as { env?: Record<string, string | undefined> }).env?.SPATIAL_WIRED
      : undefined;
  } catch {
    v = undefined;
  }
  if (v != null) return on(v);
  try {
    v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_SPATIAL_WIRED;
  } catch {
    v = undefined;
  }
  return on(v);
}

/* ============================================================
 * 二、常量
 * ========================================================== */

/** 默认步行预算（分钟）：超过就不去（校园内 20 分钟已是很远的一段）。 */
export const DEFAULT_WALK_BUDGET_MIN = 20;

/**
 * **估算值额外余量**：路网实测偏长 30~100%（见 `audit:transfer`），且估算本身有误差
 * —— 估算的步行分钟按「预算 − 本值」筛，即同等时间内只接受更近的估算地点。
 * 与 `objective.ts` 的 `TRANSFER_TRUST = 0.8` 是**两回事**：那个打折成本，这个收紧可达性。
 */
export const ESTIMATE_SLACK_EXTRA_MIN = 5;

/* ============================================================
 * 三、营业时段判定（诚实三态）
 * ========================================================== */

export type OpenState = true | false | null;

/**
 * 目标时刻是否开放。
 *   · `hours` 为空 → `null`（时段未知：不限时或没数据，**不假装知道**）；
 *   · 落在任一窗口内（含端点）→ `true`；否则 `false`。
 */
export function openStateAt(place: Pick<Place, 'hours'>, atMin: number | undefined): OpenState {
  if (atMin == null) return null;
  if (!place.hours || place.hours.length === 0) return null;
  const hit = place.hours.some((w) => atMin >= w.startMin && atMin <= w.endMin);
  return hit;
}

/* ============================================================
 * 四、排序（E2 的核心）
 * ========================================================== */

/** 调用方注入的步行分钟查询：返回 null = **未知**（不是 0，也不是不可达） */
export type WalkQuery = (name: string) => { minutes: number; estimate: boolean } | null;

export interface RankPlacesInput {
  candidates: readonly Place[];
  /** 当日校区：只保留同校区（校区未知的地点会被 `places.ts` 标 UNKNOWN 并在此剔除） */
  campus: CampusId;
  /** 目标时刻（分钟）；给了就判营业 */
  atMin?: number;
  /** 步行分钟查询（注入）；不给 = 本轮不做距离排序（只按营业 + 名称） */
  walk?: WalkQuery;
  /** 步行预算（分钟），默认 `DEFAULT_WALK_BUDGET_MIN` */
  walkBudgetMin?: number;
}

export interface RankedPlace {
  name: string;
  campus: CampusId;
  /** 步行分钟；null = 未知（保留但排在已知的后面） */
  walkMin: number | null;
  /** 该分钟是否来自估算（估算已按更紧预算筛过） */
  walkEstimate: boolean;
  /** 三态营业 */
  openNow: OpenState;
  /** 排序用的位置线索：'policy' = 画像偏好池给的首选（由调用方再叠加） */
  note?: string;
}

/**
 * 确定性排序。剔除规则（顺序即优先级）：
 *   ① 校区不是 `campus`（含 UNKNOWN）→ 剔除；
 *   ② 给了 `atMin` 且 `openStateAt === false` → 剔除（明确关门的别去）；
 *   ③ 给了 `walk` 且能拿到分钟：实测超过预算、或估算超过「预算 − 余量」→ 剔除。
 * 排序规则：
 *   ① `openNow === true` 优先于 `null`（未知）——「现在开着」是确定的好处；
 *   ② 步行分钟升序，未知排最后；
 *   ③ 名称字典序（**确定性兜底**，替代随机）。
 */
export function rankPlaces(input: RankPlacesInput): RankedPlace[] {
  const budget = input.walkBudgetMin ?? DEFAULT_WALK_BUDGET_MIN;
  const out: RankedPlace[] = [];

  for (const p of input.candidates) {
    if (p.campus !== input.campus) continue;      // ① 校区不符（含 UNKNOWN）不进候选
    const openNow = openStateAt(p, input.atMin);
    if (openNow === false) continue;              // ② 明确关门

    let walkMin: number | null = null;
    let walkEstimate = false;
    if (input.walk) {
      const w = input.walk(p.name);
      if (w) {
        walkMin = w.minutes;
        walkEstimate = w.estimate;
        // ③ 估算走更紧的预算（估算要留余量）
        const cap = walkEstimate ? budget - ESTIMATE_SLACK_EXTRA_MIN : budget;
        if (walkMin > cap) continue;
      }
    }
    out.push({ name: p.name, campus: p.campus, walkMin, walkEstimate, openNow });
  }

  return out.sort((a, b) => {
    // ① 现在开着 > 未知
    const oa = a.openNow === true ? 0 : 1;
    const ob = b.openNow === true ? 0 : 1;
    if (oa !== ob) return oa - ob;
    // ② 距离：已知升序，未知最后
    const wa = a.walkMin ?? Number.POSITIVE_INFINITY;
    const wb = b.walkMin ?? Number.POSITIVE_INFINITY;
    if (wa !== wb) return wa - wb;
    // ③ 确定性兜底
    return a.name.localeCompare(b.name, 'zh');
  });
}

/**
 * 把排序结果回填到「画像偏好池」的顺序上：**池内优先**（画像说了算），
 * 池外同校区的地点按排序结果追加为兜底 —— 保持既有语义（首选仍在最前、轮换仍从首选开始），
 * 只是把「不可达 / 关门的」从首选里挪到后面（而不是静默删掉，避免整周没有自习点）。
 */
export function reorderPool(
  pool: readonly string[],
  ranked: readonly RankedPlace[],
): { preferred: string[]; demoted: string[] } {
  const ok = new Set(ranked.map((r) => r.name));
  const preferred = pool.filter((n) => ok.has(n));
  const demoted = pool.filter((n) => !ok.has(n));
  return { preferred, demoted };
}

/* ============================================================
 * 五、按「从锚点走过去几分钟」排序（构造循环内使用）
 * ========================================================== */

/**
 * 把候选项按「从 `anchor` 出发的步行分钟」排序，**不删除任何项**（校园里最坏也就是多走一段，
 * 删掉会让整周没有自习点）。顺序 = ① 已知分钟且未超预算（升序）→ ② 未知分钟（保持原序）
 * → ③ 超预算的（原序）。估算项按更紧预算（`ESTIMATE_SLACK_EXTRA_MIN`）判可达。
 *
 * 纯函数 + 稳定：同输入必得同序（不引入随机数）。`pickup` 返回 null = 未知。
 */
export function orderByWalkFrom<T>(
  items: readonly T[],
  anchor: string | undefined,
  pickup: (item: T) => { minutes: number; estimate: boolean } | null,
  budgetMin: number = DEFAULT_WALK_BUDGET_MIN,
): T[] {
  if (!anchor) return [...items];
  const near: T[] = [];
  const unknown: T[] = [];
  const far: T[] = [];
  const mins = new Map<number, number>();
  items.forEach((it, i) => {
    const w = pickup(it);
    if (!w) {
      unknown.push(it);
      return;
    }
    mins.set(i, w.minutes);
    const cap = w.estimate ? budgetMin - ESTIMATE_SLACK_EXTRA_MIN : budgetMin;
    if (w.minutes > cap) far.push(it);
    else near.push(it);
  });
  const idxOf = new Map<T, number>();
  items.forEach((it, i) => idxOf.set(it, i));
  const byMin = (a: T, b: T): number => {
    const ma = mins.get(idxOf.get(a) ?? -1) ?? Number.POSITIVE_INFINITY;
    const mb = mins.get(idxOf.get(b) ?? -1) ?? Number.POSITIVE_INFINITY;
    return ma - mb || (idxOf.get(a) ?? 0) - (idxOf.get(b) ?? 0);
  };
  return [...near.sort(byMin), ...unknown, ...far];
}

/* ============================================================
 * 六、本批**未接线**的空间能力（如实登记，防「以为接了」）
 * ========================================================== */

export const SPATIAL_PARTIALS: readonly string[] = [
  // 结项注记（2026-10-06 收官批次 P1-6，裁决 R3）：三餐食堂选取已接线 ——
  // pickCanteen 候选池经本模块 rankPlaces 统一纪律（校区/营业/预算），择序仍按
  // 「离下一节课最近」；步行预算来自 PlanRequest.mealWalkBudgetMin（P1-7 部分）
  // 或画像「就餐半径」推导（profilePrefs.blockPrefs）。
  '1100 基础学院路网未入库 → 该校区地点拿不到实测分钟，`walk` 查询返回 null 即「未知」，'
    + '本策略**保持未知、不吸附到本部坐标**（project-core.md §8 纪律；pickCanteen 同口径）',
  '营业时段的「此刻」口径依赖调用方给 atMin（引擎纯函数不读时钟）',
];
