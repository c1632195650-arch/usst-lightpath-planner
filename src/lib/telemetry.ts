/**
 * 交互埋点 —— 「第 6 环 · 行为记录」的交互侧
 * ============================================================
 * 与 `features/behavior/behaviorLog.ts` 分工明确、**互不重复**：
 *   · behaviorLog  = 排程的**执行反馈**（每个块最后做了 / 没做）—— 回答「排得对不对」
 *   · telemetry    = 交互的**过程信号**（搜了什么类型、点了哪个地点、有没有降级）
 *                     —— 回答「用户到底在用什么、哪一步卡住了」
 *
 * ## 为什么只落本机、零上报（这条是硬约束，不是权衡）
 *
 * `docs/technical-roadmap.md §3.6` 的 **NF-2「个人数据本地优先」**是本项目的红线。
 * 埋点一旦上报原始查询句，就与 NF-2 自相矛盾 —— 答辩时会被当场问住，
 * 而且「搜索词」在个人信息保护语境下本就属于可识别信息。
 * 所以这里**只写 localStorage，没有任何网络调用**，也**没有对应的后端端点**。
 * 答辩口径：*痕迹只留在你自己的设备上，我们连收集的入口都没有。*
 *
 * ## 记录里到底存了什么
 *
 * 只有 `{t, ev, id?, ok?, ms?, n?}` —— **数字与枚举**，没有一个字段是用户输入的自由文本。
 * 连「哪一步失败」都不存原因文本（原因里常夹着用户原话），只存 `ok: false`。
 *
 * 存储**独立于 `AppState`**，与 behaviorLog 同理：
 * 条数随时间线性增长，而 `saveState` 每次 `patch` 都要全量序列化主状态，
 * 塞进去会拖慢用户的每一次输入；而且它应该能被单独清空。
 */

/** localStorage 键。⚠️ 键名沿用方案定稿的写法（其余两个键用连字符，此处不改以免方案与实现脱节）。 */
const KEY = 'usst.telemetry.v1';

/**
 * 环形上限。按每次交互约 120 字节算，500 条约 60KB ——
 * 离 localStorage 的 5MB 配额很远，且足够看出「最近这段时间在用哪些功能」。
 * 刻意**不做**「学长那套 localStorage 1000 条 + 全量重写」：全量重写随条数变慢，
 * 而这里只需要近期信号，远期数据的参考价值本就低。
 */
const MAX_EVENTS = 500;

/** `id` 的长度上限 —— 超过就不像标识符，更像一句话了 */
const MAX_ID_LEN = 32;

export type TelemetryEvent =
  | 'search'       // 发起一次检索（校园地点 / 文章库）
  | 'poi_view'     // 看了一个地点的详情
  | 'plan_result'  // 排程引擎给出了方案
  | 'route_used'   // 用了两点间步行路径
  | 'degrade';     // 某条链路降级（检索不可用 / 算不出路 …）

export interface TelemetryRecord {
  /** 事件时刻（ISO 8601）。按天分桶由它推导，不另存 date 字段（少一个能写错的地方） */
  t: string;
  ev: TelemetryEvent;
  /** 对象标识：POI id / 降级枚举。**绝不能塞用户输入的原句**（见 isSafeId 的兜底） */
  id?: string;
  /** 成功与否。失败**不记原因文本** —— 原因里常夹着用户原话 */
  ok?: boolean;
  /** 耗时（毫秒）—— 用来回答「慢在哪」 */
  ms?: number;
  /** 结果条数。数字不涉隐私，却是**召回质量的关键信号**（0 结果 = 白问了） */
  n?: number;
}

/* ---------------- 纯函数部分（不碰 localStorage、不读时钟，可单测） ---------------- */

/**
 * `id` 是否够「像标识符」。
 *
 * 这是一道**兜底防线**：类型上 `id` 是 string，拦不住有人顺手把查询词传进来。
 * 于是显式只放行 ASCII 标识符字符（本项目的地点 id 形如 `canteen1` / `teach3`，
 * 降级枚举形如 `rag-offline`）。中文、空格、引号一律拒绝 ——
 * 这三样几乎覆盖了「不小心把用户原话传进来」的全部情形。
 * 被拒绝时**整条记录照样写**，只是丢掉 `id`：宁可少一个维度，也不要留下用户原话。
 */
const SAFE_ID_RE = /^[A-Za-z0-9_.:-]+$/;

export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LEN && SAFE_ID_RE.test(id);
}

/** 追加一条并做环形裁剪（超出上限丢最旧的）。 */
export function append(list: TelemetryRecord[], rec: TelemetryRecord): TelemetryRecord[] {
  const next = [...list, normalize(rec)];
  return next.length <= MAX_EVENTS ? next : next.slice(next.length - MAX_EVENTS);
}

/** 把一条记录收敛成「只含白名单字段」的形状 —— 顺手挡掉调用方多传的字段。 */
export function normalize(rec: TelemetryRecord): TelemetryRecord {
  const out: TelemetryRecord = { t: rec.t, ev: rec.ev };
  if (isSafeId(rec.id)) out.id = rec.id;
  if (typeof rec.ok === 'boolean') out.ok = rec.ok;
  if (typeof rec.ms === 'number' && Number.isFinite(rec.ms)) out.ms = Math.round(rec.ms);
  if (typeof rec.n === 'number' && Number.isFinite(rec.n)) out.n = rec.n;
  return out;
}

/** ISO 时间 → `yyyy-mm-dd`（本地时区按天分桶；用 UTC 会让晚上的记录掉到第二天） */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface TelemetrySummary {
  total: number;
  /** 有记录的天数 */
  activeDays: number;
  byEvent: Record<TelemetryEvent, number>;
  /** 检索次数 */
  searchCount: number;
  /** 检索「白问」次数（结果条数为 0） */
  searchEmpty: number;
  /** 降级次数 */
  degradeCount: number;
  /** 热门地点 Top N（仅统计 poi_view 的安全 id） */
  topPois: Array<{ id: string; n: number }>;
  /**
   * 降级率；**没有记录时是 `null` 而不是 0**。
   * 与 `behaviorLog.summarizeWeek().rate` 同一条原则：0 会被读成「一次都没降级」，
   * 而实际含义是「还没有数据」—— 两者对读的人的暗示完全不同。
   */
  degradeRate: number | null;
}

export const EMPTY_SUMMARY: TelemetrySummary = {
  total: 0,
  activeDays: 0,
  byEvent: { search: 0, poi_view: 0, plan_result: 0, route_used: 0, degrade: 0 },
  searchCount: 0,
  searchEmpty: 0,
  degradeCount: 0,
  topPois: [],
  degradeRate: null,
};

/** 聚合出「活跃日 / 检索次数 / 热门地点 / 降级率」。纯函数：同输入同输出。 */
export function summarize(list: TelemetryRecord[], topN = 5): TelemetrySummary {
  if (list.length === 0) return { ...EMPTY_SUMMARY, byEvent: { ...EMPTY_SUMMARY.byEvent } };

  const s: TelemetrySummary = {
    ...EMPTY_SUMMARY,
    byEvent: { ...EMPTY_SUMMARY.byEvent },
    total: list.length,
  };
  const days = new Set<string>();
  const poiCount = new Map<string, number>();

  for (const r of list) {
    s.byEvent[r.ev] = (s.byEvent[r.ev] ?? 0) + 1;
    const d = dayOf(r.t);
    if (d) days.add(d);
    if (r.ev === 'search') {
      s.searchCount += 1;
      if (r.n === 0) s.searchEmpty += 1;
    }
    if (r.ev === 'degrade') s.degradeCount += 1;
    if (r.ev === 'poi_view' && r.id) poiCount.set(r.id, (poiCount.get(r.id) ?? 0) + 1);
  }

  s.activeDays = days.size;
  s.topPois = [...poiCount.entries()]
    .map(([id, n]) => ({ id, n }))
    // 同票数时按 id 字典序 —— 保证「同输入同输出」，不然测试会飘
    .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, topN);
  s.degradeRate = s.degradeCount / list.length;
  return s;
}

/* ---------------- 存储层（唯一碰 localStorage 的地方） ---------------- */

const EVENTS: ReadonlySet<string> = new Set([
  'search', 'poi_view', 'plan_result', 'route_used', 'degrade',
]);

function isRecord(v: unknown): v is TelemetryRecord {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.t === 'string' && typeof o.ev === 'string' && EVENTS.has(o.ev);
}

export function loadEvents(): TelemetryRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 逐条校验：坏数据只丢坏的那条，不让整份记录失效（与 behaviorLog 同一策略）
    return parsed.filter(isRecord).map(normalize);
  } catch {
    return [];
  }
}

export function saveEvents(list: TelemetryRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    // 隐私模式 / 配额满：静默降级。埋点是**辅助**功能，绝不能因为它让主流程报错
    console.warn('[telemetry] 写入失败', e);
  }
}

export function clearEvents(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式下不可写，静默即可 */
  }
}

/**
 * 记一条事件。**这是本模块唯一被业务代码调用的写入口。**
 *
 * 全流程无网络调用；失败一律吞掉（埋点坏了不该影响用户正在做的事）。
 * 时钟只在**这一层**读 —— 纯函数部分不读时钟，才能被单测覆盖。
 *
 * @param ev   事件类型
 * @param patch 可选补充字段（`id` 会过 `isSafeId`，不安全则自动丢弃）
 */
export function track(ev: TelemetryEvent, patch: Partial<Omit<TelemetryRecord, 't' | 'ev'>> = {}): void {
  try {
    const rec = normalize({ t: new Date().toISOString(), ev, ...patch });
    saveEvents(append(loadEvents(), rec));
  } catch (e) {
    console.warn('[telemetry] track 失败（已忽略）', e);
  }
}

/** 导出为 JSON 字符串（供「导出我的使用记录」按钮；数据始终留在用户手里）。 */
export function exportJSON(): string {
  return JSON.stringify(
    { _note: '本文件只包含本机记录的数字与枚举，不含任何输入原文', events: loadEvents() },
    null,
    2,
  );
}
