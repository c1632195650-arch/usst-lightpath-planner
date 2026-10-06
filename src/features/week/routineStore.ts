/**
 * 作息边界 store（Q1a / 问卷规格书 §2.5 + §6.2）
 * ============================================================
 * 要解决的问题：引擎**早就支持**自定义每日窗口（`PlanRequest.dayStart/dayEnd`，
 * `model.ts:248/250` 正式契约字段，`construct.ts:269-271` 消费），但 UI 从未传过、
 * 问卷从未采过 → 「四六级真题被排到 07:00 还没起床」那类问题的根因。
 *
 * ── 为什么独立 localStorage，不进 AppState / PersonaProfile ──
 * 问卷规格书 §6.1 禁止把「几点起」塞进 0–100 的画像轴（语义污染），
 * §6.2 定死的正确通道：**独立 store + 组装层翻译**。
 *   · 本文件只负责「存」与「校验」—— 数据形状是分钟数（number）；
 *   · 组装层（`useWeekPlan.ts`）通过 `routineToDayWindow()` 把它翻译成
 *     `dayStart` / `dayEnd` 的 `"HH:MM"` 字符串塞进 `PlanRequest`；
 *   · 引擎侧**零改动**（`dayStart/dayEnd` 本来就是正式契约字段）。
 *
 * 未采集时本 store 恒为空值 → `routineToDayWindow()` 返回 null →
 * 组装层不传 `dayStart/dayEnd` → 引擎走 `'07:00' / '23:00'` 缺省，行为与改造前完全一致。
 *
 * 纯函数与 localStorage 严格分离 —— 前者可在 Node 里单测（同 `userPlanStore`）。
 *
 * ⚠️ 移植注（2026-10-06 收官批次 P0-1a，来源 _integration_full）：
 *   上游版存储层走 `@/lib/persistence`（云双写，integration-full 的账号线）；
 *   本树存储层仍是 `storage.ts` 单机口径（同 `userPlanStore` 惯例：store 内裸
 *   localStorage + try/catch），故这里只换存储三行，纯函数与语义逐行一致。
 * Q1a，自 _integration_full 移植；2026-10-06 CY 裁决 R2 本批补齐写入端
 * （采集入口 = 周计划页 routine-entry 面板；引擎日窗接线走已有字段）。
 */

import { toMinutes } from '@/constants/time';

/** 当前结构版本（字段变更时升版；读到不匹配版本 → 视为未采集，不猜测迁移） */
export const ROUTINE_SCHEMA_VERSION = 1;

/** 唯一 key */
const KEY = 'usst-routine-v1';

/**
 * 作息边界（问卷规格书 §4-L1 的 #1「作息」两条硬数据的落点）。
 *
 * 全部为「自午夜起的分钟数」；`null` = 未采集（引擎届时走缺省窗口）。
 * `weekdayDiffMin` / `napMin` 是交接书点名的预留字段：Q1a 只负责存取与校验，
 * **消费方式等 Q1b 采集上线后与 RAY 定**——不猜、不擅自接进引擎。
 */
export interface RoutineSettings {
  schemaVersion: number;
  /** 工作日起床时刻；null = 未采集 */
  wakeMin: number | null;
  /** 工作日入睡时刻（**同日语义**，0–1439）；null = 未采集 */
  sleepMin: number | null;
  /** 周末与工作日作息的差异（分钟）；null = 未采集 */
  weekdayDiffMin: number | null;
  /** 午休习惯时长（分钟）；null = 未采集 */
  napMin: number | null;
}

/** 每个数值字段的合法区间（超出 = 坏数据，按未采集处理） */
const MIN_MIN = 0;
const MAX_MIN = 24 * 60 - 1;

export function emptyRoutine(): RoutineSettings {
  return {
    schemaVersion: ROUTINE_SCHEMA_VERSION,
    wakeMin: null,
    sleepMin: null,
    weekdayDiffMin: null,
    napMin: null,
  };
}

/* ============================================================
 * 纯函数（不碰 localStorage，可单测）
 * ========================================================== */

/** 「分钟数」→ `"HH:MM"`（`routineToDayWindow` 的格式化步骤） */
export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 把作息边界翻译成引擎的每日窗口。
 *
 * 规则（不猜纪律）：
 *   · `wakeMin` / `sleepMin` **任一未采集** → null（引擎走 `'07:00'/'23:00'` 缺省）；
 *   · 二者都采集但 **wake ≥ sleep**（跨午夜入睡本 store 表达不了，见 `RoutineSettings` 注释）
 *     → 视为坏数据返回 null，**绝不猜一个「纠正值」**；
 *   · `weekdayDiffMin` / `napMin` 不参与本翻译（预留字段，见上）。
 */
export function routineToDayWindow(
  routine: RoutineSettings | null | undefined,
): { dayStart: string; dayEnd: string } | null {
  if (!routine) return null;
  const { wakeMin, sleepMin } = routine;
  if (wakeMin == null || sleepMin == null) return null;
  if (!Number.isInteger(wakeMin) || !Number.isInteger(sleepMin)) return null;
  if (wakeMin < MIN_MIN || sleepMin > MAX_MIN || wakeMin >= sleepMin) return null;
  return { dayStart: minutesToHHMM(wakeMin), dayEnd: minutesToHHMM(sleepMin) };
}

/**
 * 组装层的日窗组合：**作息设置（Q1a/Q1b store）是唯一真源**，问卷（BasicInfo.sleepMin）
 * 只作就寝兜底 —— 上游 2026-10-02 白天批 P1-2。
 *
 * 为什么不新建 PlanRequest.sleepMin 契约字段：`dayStart/dayEnd` 本就是正式契约字段
 * （`model.ts`，construct 消费），再开一个 sleepMin 会制造**第二个就寝真源**。
 * 本函数把两处采集收敛成一个组装结果：
 *   · 作息设置已采集 → `routineToDayWindow`（起床+就寝都生效）；
 *   · 作息未采集、问卷填了就寝分钟 → dayEnd=就寝、dayStart 保持缺省 07:00
 *     （问卷没有起床时间，不猜）；
 *   · 都没有 → null（引擎走缺省，行为与改造前逐位一致 = golden 零漂移）。
 *
 * 退化守卫：问卷就寝 ≤ 07:00（缺省起床）会让 dayEnd ≤ dayStart，引擎排不出任何
 * 软块 —— 视为坏数据返回 null，不猜纠正值（同 `routineToDayWindow` 的不猜纪律）。
 */
export function dayWindowWithFallback(
  routine: RoutineSettings | null | undefined,
  basicSleepMin: number | null | undefined,
): { dayStart: string; dayEnd: string } | null {
  const viaRoutine = routineToDayWindow(routine);
  if (viaRoutine) return viaRoutine;
  if (
    basicSleepMin != null && Number.isInteger(basicSleepMin)
    && basicSleepMin > 420 && basicSleepMin <= 1440
  ) {
    return { dayStart: '07:00', dayEnd: minutesToHHMM(basicSleepMin) };
  }
  return null;
}

/* ---------- 界面草稿 → 设置（Q1b 采集 UI 用；纯函数，可单测）---------- */

/** `routineFromHHMM` 拒绝的原因（界面据此给**具体**提示，不静默丢弃） */
export type RoutineDraftProblem =
  /** 不是 `H:MM` 或 `HH:MM` 形态 */
  | 'unparsable'
  /** 起床不早于入睡 —— 跨午夜作息本版表达不了 */
  | 'order';

export type RoutineDraftResult =
  | { ok: true; routine: RoutineSettings }
  | { ok: false; reason: RoutineDraftProblem };

/**
 * 严格「小时:分钟」：小时 0–23、分钟 00–59。
 * 刻意收紧到合法区间 —— 不然 `25:00` 会被归到「顺序错」而不是「格式错」，
 * 给用户的提示就指错了地方。
 */
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * 界面上的两个时间串 → 可存进 store 的 `RoutineSettings`。
 *
 * **不猜纪律**：无效时返回**原因**而不是 null —— 界面必须明确告诉用户
 * 「为什么没保存」。静默丢弃正是本特性要消灭的那类问题
 * （「设了没用」和「根本没设」在界面上必须看得出区别）。
 *
 * 未采集的两个预留字段（`weekdayDiffMin` / `napMin`）保持 null —— 见 `RoutineSettings` 注释。
 */
export function routineFromHHMM(wake: string, sleep: string): RoutineDraftResult {
  const w = (wake ?? '').trim();
  const s = (sleep ?? '').trim();
  if (!HHMM_RE.test(w) || !HHMM_RE.test(s)) return { ok: false, reason: 'unparsable' };
  const wakeMin = toMinutes(w);
  const sleepMin = toMinutes(s);
  if (wakeMin >= sleepMin) return { ok: false, reason: 'order' };
  return { ok: true, routine: { ...emptyRoutine(), wakeMin, sleepMin } };
}

/** 逐字段宽松校验：坏数据只丢自己（该字段回落 null），不连累整份设置 */
function nullableMinute(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  if (v < MIN_MIN || v > MAX_MIN) return null;
  return v;
}

/** 读到的原始数据 → `RoutineSettings`；结构不符（版本不对 / 根本不是对象）→ null */
export function normalizeRoutine(raw: unknown): RoutineSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== ROUTINE_SCHEMA_VERSION) return null;
  const out = emptyRoutine();
  out.wakeMin = nullableMinute(r.wakeMin);
  out.sleepMin = nullableMinute(r.sleepMin);
  out.weekdayDiffMin = nullableMinute(r.weekdayDiffMin);
  out.napMin = nullableMinute(r.napMin);
  return out;
}

/* ============================================================
 * 存储层（唯一碰 localStorage 的地方；本树口径，见文件头移植注）
 * ========================================================== */

/**
 * 读取作息边界。任何异常都回落空 —— 作息是增强数据，坏了不该让排程页打不开。
 */
export function loadRoutine(): RoutineSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyRoutine();
    return normalizeRoutine(JSON.parse(raw)) ?? emptyRoutine();
  } catch {
    return emptyRoutine();
  }
}

export function saveRoutine(routine: RoutineSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...routine, schemaVersion: ROUTINE_SCHEMA_VERSION }));
  } catch (e) {
    console.warn('[routine] 写入失败：', e);
  }
}

export function clearRoutine(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式静默 */
  }
}

/* ---------- 供测试用 ---------- */
export const STORAGE_KEY = KEY;
