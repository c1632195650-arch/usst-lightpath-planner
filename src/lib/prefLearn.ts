/**
 * 偏好学习 v1（F3 批 A1）——「越用越懂你」的第一块
 * ============================================================
 * behaviorLog 早就攒着块级的 done/skipped 与（可选的）actualMin，但从没有人
 * 把它们翻译成**人话**。本文件是第一版翻译器：把近 4 周的执行记录统计成
 * 三类保守建议（时段跳过 / 档位完成率 / 估时偏差），在总览页以建议卡呈现，
 * 用户一键采纳或忽略 —— 采纳/忽略状态落 `usst.preflearn-v1`（仅本机）。
 *
 * 懂分寸（L3/L4 边界，docs/project-core.md §4，与 profilePrefs 同一纪律）：
 *   · v1 **零引擎改动、零契约改动** —— 本文件不 import `lib/planner/**`，
 *     只消费 behaviorLog 的记录形状；
 *   · 样本不足不出建议（每条规则都有 n 门槛），**宁可不说话**；
 *   · 每条建议都带证据（窗口 / 样本量 / 百分比），可被用户质疑与推翻；
 *   · 采纳在 v1 只记意向（写 applied），**不自动改排程** —— 作息修正的
 *     既有写入端（features/week/routineStore 的 usst-routine-v1）要求
 *     wake+sleep 成对采集，且「晚间块跳过率高」并不构成「就寝应提前」的
 *     可辩护依据，单写 sleepMin 又是 no-op（组装层 wake 缺席即忽略）。
 *     找不到语义安全的通路 → 按 v1 保守优先降级为「仅提示 + 指路手动入口」。
 *
 * 纯函数与 localStorage 严格分离 —— 前者可在 Node 里单测（同 behaviorLog）。
 * 存储层沿用 behaviorLog 的裸 localStorage + try/catch 模式：storageGateway
 * 的 REGISTRY 登记不在本批允许触碰的文件清单里，登记留给后续批次。
 */
import type { BehaviorRecord } from '@/lib/behaviorLog';
import { diffDays } from './date';

/* ============================================================
 * 一、形状
 * ========================================================== */

export type PrefKind = 'routine' | 'tier' | 'estimate';

/** 一条建议（可直接展示）。`status` 由存储层叠加，纯函数 learnPrefs **从不填它**。 */
export interface PrefSuggestion {
  /** 稳定 id（确定性生成）—— 存储层 applied/dismissed 的键 */
  id: string;
  kind: PrefKind;
  /** 人话建议（给用户的正文） */
  text: string;
  /** 证据（数字与口径，可质疑 —— 与 Phase.reasons 同一透明纪律） */
  evidence: string;
  /** 处置状态：'applied' 采纳 / 'dismissed' 忽略；未处置 = 缺席 */
  status?: 'applied' | 'dismissed';
}

export type SuggestionStatus = NonNullable<PrefSuggestion['status']>;

/* ============================================================
 * 二、常量（门槛集中在顶部，可测试可调参；改这里即改全部规则）
 * ========================================================== */

/** 统计窗口：近 4 周（28 天，含今天；只统计过去，不认未来记录） */
export const WINDOW_DAYS = 28;

/** R1（时段跳过）：桶内样本 n ≥ 6 且跳过率 ≥ 60% 才开口 */
export const R1_MIN_N = 6;
export const R1_SKIP_RATE = 0.6;

/** R2（档位完成率）：每桶 n ≥ 5 且完成率差 ≥ 25 个百分点才开口；档位分界 50 分钟 */
export const R2_MIN_N = 5;
export const R2_GAP_PCT = 25;
export const R2_TIER_MIN = 50;

/** R3（估时偏差）：样本 n ≥ 8 且实际/计划中位比偏离 1 达 ±30% 才开口（v1 仅提示） */
export const R3_MIN_N = 8;
export const R3_DEV = 0.3;

/** R1 分桶（按 startMin）：晨 <720 / 午 720–1080 / 晚 >1080（分钟，自午夜起） */
export type DayBucket = 'morning' | 'afternoon' | 'evening';

export const BUCKET_LABELS: Record<DayBucket, string> = {
  morning: '上午（12 点前）',
  afternoon: '下午（12:00–18:00）',
  evening: '晚间（18:00 后）',
};

export function bucketOf(startMin: number): DayBucket {
  if (startMin < 720) return 'morning';
  if (startMin > 1080) return 'evening';
  return 'afternoon';
}

/* ============================================================
 * 三、纯函数核心（不碰 localStorage，不读时钟；now 由调用方注入）
 * ========================================================== */

/** ISO 日期串的形状校验（宽松：前 10 位是 yyyy-mm-dd 即可） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * 一条记录的「统计日」：取**记录时间戳 `at`** 的日期部分。
 * `at` 缺失或不可解析 → null（该条自动过滤，零迁移 —— 旧坏数据不必洗）。
 */
export function recordDay(r: BehaviorRecord): string | null {
  const m = DATE_RE.exec(r.at ?? '');
  return m ? m[0] : null;
}

/** 是否落在近 4 周窗口内（[now-27, now]；未来记录与坏时间戳一律不算） */
export function inWindow(r: BehaviorRecord, now: string): boolean {
  const day = recordDay(r);
  if (!day || !DATE_RE.test(now)) return false;
  const d = diffDays(day, now); // 正数 = 记录在过去
  return d >= 0 && d < WINDOW_DAYS;
}

/** 中位数（偶数个取中间两数的平均 —— 标准口径，确定性） */
export function median(nums: number[]): number {
  if (nums.length === 0) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 偏好学习主入口：`learnPrefs(records, now) → PrefSuggestion[]`
 *
 * 确定性：同输入必同输出；顺序固定（R1 晨→午→晚，R2，R3）。
 * 返回的条目**不带 status** —— 处置状态由存储层经 `withStatus` 叠加。
 */
export function learnPrefs(records: BehaviorRecord[], now: string): PrefSuggestion[] {
  const win = records.filter((r) => inWindow(r, now));
  return [...learnRoutine(win), ...learnTier(win), ...learnEstimate(win)];
}

/**
 * R1 时段跳过：自习块（kind='study' —— 活动块跳过≠作息问题，不混淆口径）
 * 按 startMin 分桶统计跳过率；某桶 n≥6 且 skipRate≥0.6 → 作息修正建议。
 * 没有 startMin 的记录进不了桶（字段缺席自动跳过，零迁移）。
 */
function learnRoutine(win: BehaviorRecord[]): PrefSuggestion[] {
  const byBucket = new Map<DayBucket, { n: number; skipped: number }>();
  for (const r of win) {
    if (r.kind !== 'study') continue;
    if (typeof r.startMin !== 'number' || !Number.isFinite(r.startMin)) continue;
    const b = bucketOf(r.startMin);
    const agg = byBucket.get(b) ?? { n: 0, skipped: 0 };
    agg.n += 1;
    if (r.status === 'skipped') agg.skipped += 1;
    byBucket.set(b, agg);
  }

  const out: PrefSuggestion[] = [];
  for (const b of ['morning', 'afternoon', 'evening'] as const) {
    const agg = byBucket.get(b);
    if (!agg || agg.n < R1_MIN_N) continue;
    const rate = agg.skipped / agg.n;
    if (rate < R1_SKIP_RATE) continue; // ← R1 触发门槛（RV 锚点：短路此行，R1 用例必红）
    const pct = Math.round(rate * 100);
    const move = b === 'evening'
      ? '要不要把晚间自习挪到下午？'
      : '要不要把这一时段的自习挪到你更跟得住的时段？';
    out.push({
      id: `routine-${b}`,
      kind: 'routine',
      text: `最近 4 周，${BUCKET_LABELS[b]}的自习块你跳过了约 ${pct}%（${agg.n} 次里跳过 ${agg.skipped} 次）。${move}`
        + '也可以到周计划页的「作息设置」把对应窗口收紧。',
      evidence: `近 4 周 · ${BUCKET_LABELS[b]}自习块 n=${agg.n}，跳过 ${agg.skipped} 次（${pct}%）`,
    });
  }
  return out;
}

/**
 * R2 档位完成率：自习块按计划时长分两档（<50 = 短块 / ≥50 = 长块），
 * 两档各 n≥5 且完成率差 ≥25 个百分点 → 朝「完成率低的那档」给一条档位建议
 * （只出一条，避免同时建议"并块"又"拆块"自相矛盾）。
 */
function learnTier(win: BehaviorRecord[]): PrefSuggestion[] {
  const short = { n: 0, done: 0 };
  const long = { n: 0, done: 0 };
  for (const r of win) {
    if (r.kind !== 'study') continue;
    if (!(r.plannedMin > 0)) continue;
    const t = r.plannedMin < R2_TIER_MIN ? short : long;
    t.n += 1;
    if (r.status === 'done') t.done += 1;
  }
  if (short.n < R2_MIN_N || long.n < R2_MIN_N) return [];
  const shortPct = Math.round((short.done / short.n) * 100);
  const longPct = Math.round((long.done / long.n) * 100);
  const gapPct = Math.abs(short.done / short.n - long.done / long.n) * 100;
  if (gapPct < R2_GAP_PCT) return []; // ← R2 触发门槛（RV 锚点：短路此行，R2 用例必红）

  const worseShort = shortPct < longPct;
  return [{
    id: worseShort ? 'tier-short' : 'tier-long',
    kind: 'tier',
    text: worseShort
      ? `最近 4 周，50 分钟以下的短自习块完成率只有 ${shortPct}%（50 分钟以上的是 ${longPct}%）—— 短块对你似乎不够"扛用"。下次排程可以考虑把短块并成整块。`
      : `最近 4 周，50 分钟以上的长自习块完成率只有 ${longPct}%（50 分钟以下的是 ${shortPct}%）—— 长块可能坐不住。下次排程可以考虑把长块拆短，或换个更清醒的时段。`,
    evidence: `近 4 周 · 短块(<${R2_TIER_MIN}min) n=${short.n} 完成 ${shortPct}%；长块(≥${R2_TIER_MIN}min) n=${long.n} 完成 ${longPct}%`,
  }];
}

/**
 * R3 估时偏差：有 actualMin 的记录（写侧只在 done 补记）算 实际/计划 比值，
 * n≥8 且中位比 ≤0.7 或 ≥1.3 → 提示类建议。**v1 仅提示，不动引擎估时**。
 */
function learnEstimate(win: BehaviorRecord[]): PrefSuggestion[] {
  const ratios: number[] = [];
  for (const r of win) {
    if (r.actualMin == null || !(r.plannedMin > 0)) continue;
    ratios.push(r.actualMin / r.plannedMin);
  }
  if (ratios.length < R3_MIN_N) return [];
  const m = median(ratios);
  if (!Number.isFinite(m)) return [];
  const pct = Math.round(m * 100);
  const evidence = `近 4 周 · n=${ratios.length} 条有实际用时的记录 · 实际/计划中位比 ${pct}%`;
  if (m <= 1 - R3_DEV) {
    return [{
      id: 'estimate',
      kind: 'estimate',
      text: `你记的实际用时普遍比计划短 —— 中位数约为计划的 ${pct}%。这类块的预估可以调短，同样的空档能排进更多内容（v1 仅提示，不改排程）。`,
      evidence,
    }];
  }
  if (m >= 1 + R3_DEV) {
    return [{
      id: 'estimate',
      kind: 'estimate',
      text: `你记的实际用时普遍比计划长 —— 中位数约为计划的 ${pct}%。这类块的预估可以放宽，或者把长块拆细（v1 仅提示，不改排程）。`,
      evidence,
    }];
  }
  return [];
}

/** 把存储层里的处置状态叠到建议上（未处置的 status 缺席） */
export function withStatus(
  suggestions: PrefSuggestion[],
  statuses: Record<string, SuggestionStatus>,
): PrefSuggestion[] {
  return suggestions.map((s) => (statuses[s.id] ? { ...s, status: statuses[s.id] } : { ...s }));
}

/* ============================================================
 * 四、存储层（唯一碰 localStorage 的地方；仅本机，不上云）
 * ========================================================== */

export const PREF_LEARN_KEY = 'usst.preflearn-v1';

export interface PrefLearnState {
  version: 1;
  /** 总开关：false = 建议内容整卡隐藏（仅留开关行便于重新开启） */
  enabled: boolean;
  /** 处置表：建议 id → 采纳/忽略 */
  statuses: Record<string, SuggestionStatus>;
}

export function defaultPrefLearnState(): PrefLearnState {
  return { version: 1, enabled: true, statuses: {} };
}

function isStatus(v: unknown): v is SuggestionStatus {
  return v === 'applied' || v === 'dismissed';
}

/** 逐字段校验：坏数据整体回落默认（与 storage.migrate 的「不认坏形状」同一策略） */
function isState(v: unknown): v is PrefLearnState {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (typeof o.enabled !== 'boolean') return false;
  if (o.statuses === null || typeof o.statuses !== 'object' || Array.isArray(o.statuses)) return false;
  return Object.values(o.statuses).every(isStatus);
}

export function loadPrefLearnState(): PrefLearnState {
  try {
    const raw = localStorage.getItem(PREF_LEARN_KEY);
    if (!raw) return defaultPrefLearnState();
    const parsed: unknown = JSON.parse(raw);
    return isState(parsed) ? parsed : defaultPrefLearnState();
  } catch {
    return defaultPrefLearnState();
  }
}

export function savePrefLearnState(state: PrefLearnState): void {
  try {
    localStorage.setItem(PREF_LEARN_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[prefLearn] 写入失败', e);
  }
}

/** 处置一条建议（**幂等**：同 id 同状态写两次，落盘结果完全一致） */
export function setSuggestionStatus(id: string, status: SuggestionStatus): PrefLearnState {
  const cur = loadPrefLearnState();
  const next: PrefLearnState = { ...cur, statuses: { ...cur.statuses, [id]: status } };
  savePrefLearnState(next);
  return next;
}

/** 总开关（立即生效，无需「保存」按钮 —— 与 ui/Switch 的语义边界一致） */
export function setPrefLearnEnabled(enabled: boolean): PrefLearnState {
  const cur = loadPrefLearnState();
  const next: PrefLearnState = { ...cur, enabled };
  savePrefLearnState(next);
  return next;
}

/**
 * 「清除学习记录」：只清**建议处置表**（采纳/忽略归零，建议可重新出现），
 * 不动总开关，也**不碰** behaviorLog 的执行记录（那是另一份用户数据，
 * 有自己的清空入口）。
 */
export function clearPrefLearn(): PrefLearnState {
  const cur = loadPrefLearnState();
  const next: PrefLearnState = { ...cur, statuses: {} };
  savePrefLearnState(next);
  return next;
}
