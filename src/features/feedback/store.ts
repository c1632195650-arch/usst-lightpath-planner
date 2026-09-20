/**
 * 偏好校正层 · 存储
 * ============================================================
 * 存用户的改进建议（`CorrectionRule`）。
 *
 * ── 为什么独立 localStorage，不进 AppState ────────────────────
 * 与 `features/behavior/behaviorLog.ts` 同一理由：
 *   1. 条数会随使用线性增长，而 `saveState` 每次 `patch` 都**全量序列化**主状态
 *      —— 塞进主状态会拖慢用户的每一次输入；
 *   2. 它应该能被**独立清空**（「清掉我提过的要求」），不该和课表 / 画像同生共死。
 *   3. 附带好处：**零契约改动**，不与排程引擎那条线争夺 `types.ts`。
 *
 * ── 与行为记录的差异 ─────────────────────────────────────────
 *   · 顶层包一层 `{ schemaVersion, rules }`（校正规则字段复杂，需要版本位以便将来迁移）
 *   · 上限 300 而非 800 —— 用户主动提要求远少于「每天 15 个块」的执行标记
 *   · **有 `active` 开关**：撤销但不删除（行为记录没有「撤销」概念）
 *
 * 结构说明：纯函数与 localStorage 严格分离 —— 前者可单测（Node 无 localStorage）。
 */
import type { CorrectionRule, CorrectionPayload, CorrectionKind } from '@/lib/planner/corrections';

const KEY = 'usst-pref-corrections-v1';

/** 存储结构版本。将来改字段形状时递增，旧数据回落空（校正层可安全丢弃）。 */
export const SCHEMA_VERSION = 1;

/**
 * 上限。用户主动干预是低频动作（一天几条到几十条），
 * 300 条足够覆盖一整个学期且离 localStorage 配额很远。
 */
const MAX_RULES = 300;

export interface CorrectionStore {
  schemaVersion: number;
  rules: CorrectionRule[];
}

/* ============================================================
 * 一、纯函数部分（不碰 localStorage，可单测）
 * ========================================================== */

/**
 * 生成规则 id。
 *
 * ⚠️ 与引擎的「纯函数纪律」无关 —— 本文件属**应用层**（`features/**`），
 *    允许读时钟/随机。引擎侧（`lib/planner/**`）才禁用这些。
 *    用「时间戳 + 单调序号」而不是 `crypto.randomUUID()`：
 *    前者在 Node 与浏览器行为一致，也不必处理 secure context 的差异。
 */
let seq = 0;
export function makeRuleId(): string {
  seq += 1;
  return `corr-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** 同一 id 覆盖、新 id 追加；超出上限时丢**最旧**的 */
export function upsertRule(rules: readonly CorrectionRule[], rule: CorrectionRule): CorrectionRule[] {
  const i = rules.findIndex((r) => r.id === rule.id);
  const next = [...rules];
  if (i < 0) next.push(rule);
  else next[i] = rule;
  return next.length <= MAX_RULES ? next : next.slice(next.length - MAX_RULES);
}

/** 撤销 / 重新生效。**保留记录**，只翻 `active`。 */
export function setActive(
  rules: readonly CorrectionRule[],
  id: string,
  active: boolean,
  now: string,
): CorrectionRule[] {
  return rules.map((r) => (r.id === id ? { ...r, active, updatedAt: now } : r));
}

/** 编辑载荷（如把「周四」改成「周五」）。只改 payload，**不换 kind**。 */
export function updatePayload(
  rules: readonly CorrectionRule[],
  id: string,
  patch: Partial<CorrectionRule>,
  now: string,
): CorrectionRule[] {
  return rules.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: now } : r));
}

/** 彻底删除（与 `setActive(false)` 的区别：这条从列表里消失） */
export function removeRule(rules: readonly CorrectionRule[], id: string): CorrectionRule[] {
  return rules.filter((r) => r.id !== id);
}

const VALID_KINDS: readonly CorrectionKind[] = [
  'unavailable_slot', 'avoid_day', 'target_duration', 'block_density',
  'avoid_place', 'avoid_kind', 'prefer_time', 'manual_note',
];

const VALID_MAPS: readonly CorrectionRule['mapsTo'][] = ['axis', 'scenario', 'policy', 'none'];

/**
 * 校验一条规则。
 *
 * 为什么逐字段查而不是「有 id 就收」：localStorage 里的数据可能来自
 * **旧版本** 或**手工改坏**。坏数据只该丢掉自己，不该让整个列表读不出来
 * （读取侧用 `filter(isRule)`，逐条过滤）。
 */
export function isRule(v: unknown): v is CorrectionRule {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return false;
  if (typeof r.kind !== 'string' || !VALID_KINDS.includes(r.kind as CorrectionKind)) return false;
  if (typeof r.active !== 'boolean') return false;
  if (r.source !== 'ui' && r.source !== 'text') return false;
  if (typeof r.createdAt !== 'string') return false;
  if (typeof r.mapsTo !== 'string' || !VALID_MAPS.includes(r.mapsTo as CorrectionRule['mapsTo'])) return false;
  const p = r.payload as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return false;
  // 载荷的 kind 必须与外层一致 —— 不一致说明数据被改坏了
  if (p.kind !== r.kind) return false;
  return true;
}

/* ============================================================
 * 二、存储层（唯一碰 localStorage 的地方）
 * ========================================================== */

/**
 * 读取。任何异常都回落空数组 ——
 * 校正层是**增强**，它的数据损坏绝不该让页面打不开。
 */
export function loadRules(): CorrectionRule[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CorrectionStore> | null;
    if (!parsed || !Array.isArray(parsed.rules)) return [];
    // 版本不符 → 直接弃用（校正层可安全重建，且没有跨版本的语义保证）
    if (parsed.schemaVersion !== SCHEMA_VERSION) return [];
    return parsed.rules.filter(isRule);
  } catch {
    return [];
  }
}

export function saveRules(rules: readonly CorrectionRule[]): void {
  try {
    const store: CorrectionStore = { schemaVersion: SCHEMA_VERSION, rules: [...rules] };
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch (e) {
    // 配额满 / 隐私模式 —— 不该让交互崩掉
    console.warn('[feedback] 写入失败：', e);
  }
}

/** 清空（「清掉我提过的要求」）。保留给设置页用。 */
export function clearRules(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式下静默 */
  }
}

/** 供测试与调试：暴露 key，避免测试里硬编码字符串两处漂移 */
export const STORAGE_KEY = KEY;

/** 供测试断言上限用 */
export const MAX_RULES_LIMIT = MAX_RULES;
