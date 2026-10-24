/**
 * storageGateway —— 分片存储键的统一网关与迁移登记表（重构偿债 D7，r7，2026-10-24）
 * ============================================================
 * 为什么需要：应用的 localStorage 是**多键分片**（主状态
 * `usst-life-assistant-v2` 在 lib/storage.ts；`usst.mobile.memoCache/
 * memoOwner` 等各 feature 自管），迁移逻辑散在各处——每次契约升级
 * （schemaVer 3、4…）都要到处找"谁在读这个键"。
 *
 * 本模块只做三件事（**存量调用零改动**——网关是给**新代码**用的唯一入口）：
 *   ① REGISTRY：键的登记表（键名 / 所属 / 版本 / 可选 migrate 钩子）——
 *      键的单一清单，新增键必须先登记（未登记键读写直接拒绝，防再散一片）；
 *   ② gwLoad/gwSave：带校验的读写（store 可注入 → node:test 直测纯核）；
 *   ③ 损坏容错：坏 JSON 读回 null 不抛（与 storage.ts 的"不抛异常"纪律一致）。
 *
 * 与 lib/storage.ts 的关系：主状态键**仍走** storage.ts 的 loadState/saveState
 * （它的 migrate 是既有纯函数、有 8 条存量测试守护）；此处只登记、不接管，
 * 避免双写路径。将来 schemaVer 升级时把 migrate 钩子挂进登记表即可只改一处。
 */

/** 可注入的存储介质（浏览器 localStorage / 测试桩同构）。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 登记表条目：一个分片键的元数据。 */
export interface GatewayEntry {
  /** localStorage 键名（全仓唯一） */
  key: string;
  /** 谁在用（找负责人/找调用点的索引） */
  owner: string;
  /** 该键数据的版本号（将来 envelope 化后参与迁移判断；现状为记账） */
  version: number;
  /** 可选迁移钩子：将来键形状升级时挂这里（现无一处需要） */
  migrate?: (raw: unknown) => unknown;
}

/**
 * 键登记表（**新增分片键必须先登记**——gwLoad/gwSave 拒绝未登记键）。
 * 版本口径：主状态随 AppState.version（v4）；mobile 两键自 schemaVer=2 起未再变形。
 */
export const REGISTRY: GatewayEntry[] = [
  { key: 'usst-life-assistant-v2', owner: 'lib/storage.ts（主状态，仍走 loadState/saveState）', version: 4 },
  { key: 'usst.mobile.memoCache', owner: 'features/mobile/lib/memoStore', version: 2 },
  { key: 'usst.mobile.memoOwner', owner: 'features/mobile/lib/memoStore（归属章）', version: 2 },
];

const byKey = new Map(REGISTRY.map((e) => [e.key, e]));

/** 读：未登记键 → undefined 且带 warn（拒绝服务，不是静默通过）；
 *  坏 JSON → null（不抛）；键不存在 → null。 */
export function gwLoad<T = unknown>(store: StorageLike, key: string): T | null | undefined {
  const entry = byKey.get(key);
  if (!entry) {
    console.warn(`[storageGateway] 未登记的键：${key} —— 先进 REGISTRY 登记（owner/version），再读写`);
    return undefined;
  }
  const raw = store.getItem(key);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return (entry.migrate ? entry.migrate(parsed) : parsed) as T;
  } catch (e) {
    console.warn(`[storageGateway] 键 ${key} 的 JSON 损坏，读回 null`, e);
    return null;
  }
}

/** 写：未登记键 → false（拒绝）；已登记 → 序列化落盘。 */
export function gwSave(store: StorageLike, key: string, value: unknown): boolean {
  const entry = byKey.get(key);
  if (!entry) {
    console.warn(`[storageGateway] 未登记的键：${key} —— 先进 REGISTRY 登记（owner/version），再读写`);
    return false;
  }
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[storageGateway] 键 ${key} 写入失败`, e);
    return false;
  }
}
