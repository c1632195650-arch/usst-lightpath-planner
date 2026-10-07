/**
 * 用户覆盖层（UserPlanLayer）—— 阶段 R2
 * ============================================================
 * **本文件是本轮改进的地基**：R1（拖拽）/ R3（调课停课）/ S1（定住跨周）/ S4（指定食堂）
 * 全都建在它上面。
 *
 * ── 要解决什么 ────────────────────────────────────────────────
 * 在它之前，用户手动产生的东西**散在多个 key 里**：
 *   · `usst-plan-edits-v1`  → 用户加的块 + 删掉的块
 *   · `usst-assignments-v1` → 课程作业（T6）
 *   · `feedback/store` 的校正规则（另一条线）
 * 本轮还要再加三类（改块位置 / 不可时段 / 调课停课）—— 再各开一个 key，读取会碎成一地。
 *
 * 所以**一次性收口**：凡是「用户对本周期计划做过的事」，都进这一个文件、一个 key。
 *
 * ── 为什么独立 localStorage，不进 AppState ────────────────────
 * 同 `behaviorLog.ts` / `planEditsStore.ts`：条数会增长，而 `saveState` 每次 patch
 * 都全量序列化主状态 → 拖慢用户每一次输入；且这批数据应能**独立清空**。
 * 附带好处：**零契约改动**。
 *
 * ── 迁移（v1 → v2）──────────────────────────────────────────
 * 读不到 v2 时，尝试读旧 key 并映射；成功后写 v2。旧 key **保留一个版本周期**再删
 * （`loadUserPlan()` 不会主动删旧 key —— 万一 v2 写入失败还能退回去）。
 *
 * 纯函数与 localStorage 严格分离 —— 前者可在 Node 里单测。
 */
import type { UserTask } from '@/lib/planner/templates';
import type { Assignment } from './assignmentStore.ts';

/** 作业记录的形状仍由 `assignmentStore` 定义（它保留纯函数），这里只做 re-export 方便消费方一处引入 */
export type { Assignment } from './assignmentStore.ts';

/** 当前结构版本 */
export const SCHEMA_VERSION = 2;

/** 唯一 key —— 所有用户覆盖数据都在这里 */
const KEY = 'usst-user-plan-v1';

/** 旧 key（迁移源，保留读兼容） */
const LEGACY_EDITS_KEY = 'usst-plan-edits-v1';
const LEGACY_ASSIGNMENTS_KEY = 'usst-assignments-v1';

/** 上限（防止 localStorage 被撑爆；正常使用远达不到） */
const MAX_TASKS = 200;
const MAX_EXCLUDED = 500;
const MAX_MOVES = 500;
const MAX_SLOTS = 100;
const MAX_OVERRIDES = 200;
const MAX_ASSIGNMENTS = 200;

/* ============================================================
 * 一、数据模型
 * ========================================================== */

/**
 * 用户改过的块位置。
 *
 * ⚠️ **关键设计：`blockId` 保持原样，不改其中的 `d` 段。**
 * `blockId` 形如 `w3-d2-study-lib-2`，星期几编码在里面。拖到另一天后若重写 id，
 * 引擎会把它认成「删了一个 + 新增一个」→ churn 虚高、锁失效。
 * 所以：**id 是「逻辑身份」，本记录是「物理位置」**，两者解耦；
 * 回写时以 `dayOfWeek` 为准覆盖块自身的值。
 */
export interface MoveRecord {
  weekNo: number;
  blockId: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  place?: string;
  room?: string;
  /**
   * 来源：
   *   · `drag`   用户拖的 → hard（用户明确表达的位置）
   *   · `edit`   用户改的 → hard
   *   · `ripple` 被顺延带出来的 → soft（引擎后续还可以再调）
   */
  source: 'drag' | 'edit' | 'ripple';
  /**
   * 光溯移动端（2026-10-03）：完成勾选。
   * 仅追加的可选字段 —— 无此字段 = 未完成（读取处向后兼容，normalize 宽松校验
   * 不剥它：移动端 EditSheet 勾选后随 moves 一起云同步，方案 §7.3）。
   */
  done?: boolean;
}

/**
 * 用户声明的「不可用时段」。
 *
 * `scope` 与「长期」语义挂钩 —— **必须与 `detectScope()` 共用判定**（见计划书 §1.5），
 * 不许在别处再写一份「这是不是长期」的判断。
 */
export interface UnavailableSlot {
  id: string;
  days: number[];
  fromMin: number;
  toMin: number;
  /** 空 = 长期（按 `createdAtWeek` 起往后生效）；非空 = 指定周 */
  weeks: number[];
  scope: 'once' | 'long';
  /**
   * 创建时所处的周次 —— **长期规则的冲突解决靠它**（计划书 §1.5 读法 A）：
   * 求某周生效的规则 = 在 `createdAtWeek <= 该周` 里取最大者。
   * 没有它就无法区分「第 5 周说的」和「第 8 周说的」。
   */
  createdAtWeek: number;
  title?: string;
}

/** 停课 / 调课（**视图覆盖**，永不改导入的 `Schedule`） */
export interface CourseOverride {
  id: string;
  courseId: string;
  startPeriod: number;
  /** null = 长期；否则只影响这一周 */
  weekNo: number | null;
  action: 'cancel' | 'move';
  newDay?: number;
  newStartMin?: number;
  newEndMin?: number;
}

/** 用户指定的食堂（S4）—— 留空 = 不指定（保持 T2 的行为） */
export interface MealPlaces {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
}

export interface UserPlanLayer {
  schemaVersion: number;
  /** 用户加的块；`weeks` 空 = 长期，指定 = 一次性/区间 */
  tasks: UserTask[];
  /** 删掉的块 blockId（重排后不回来） */
  excluded: string[];
  /** 改过位置的块 */
  moves: MoveRecord[];
  /** 手动声明的不可时段 */
  slots: UnavailableSlot[];
  /** 停课/调课 */
  courseOverrides: CourseOverride[];
  /** 指定的食堂（S4） */
  mealPlaces: MealPlaces;
  /** 课程作业（T6；RAY 决策：一并收口到这里） */
  assignments: Assignment[];
}

/* ============================================================
 * 二、空值与纯函数（不碰 localStorage，可单测）
 * ========================================================== */

export function emptyUserPlan(): UserPlanLayer {
  return {
    schemaVersion: SCHEMA_VERSION,
    tasks: [], excluded: [], moves: [], slots: [],
    courseOverrides: [], mealPlaces: {}, assignments: [],
  };
}

let seq = 0;
/** 生成覆盖层内各种条目的 id（时间戳 + 单调序号，见 `planEditsStore` 同款说明） */
export function makeLayerId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

function pushCapped<T>(list: readonly T[], item: T, cap: number): T[] {
  const next = [...list, item];
  return next.length <= cap ? next : next.slice(next.length - cap);
}

/** 记一条位置改动：同 blockId 覆盖（同一个块改多次只留最后一次） */
export function upsertMove(moves: readonly MoveRecord[], rec: MoveRecord): MoveRecord[] {
  const i = moves.findIndex((m) => m.blockId === rec.blockId && m.weekNo === rec.weekNo);
  const next = [...moves];
  if (i < 0) {
    const appended = pushCapped(next, rec, MAX_MOVES);
    return appended;
  }
  next[i] = rec;
  return next;
}

export function removeMove(moves: readonly MoveRecord[], blockId: string, weekNo: number): MoveRecord[] {
  return moves.filter((m) => !(m.blockId === blockId && m.weekNo === weekNo));
}

/** 取某一周的位置覆盖表（`blockId → MoveRecord`） */
export function movesOfWeek(moves: readonly MoveRecord[], weekNo: number): Map<string, MoveRecord> {
  const map = new Map<string, MoveRecord>();
  for (const m of moves) if (m.weekNo === weekNo) map.set(m.blockId, m);
  return map;
}

export function addTask(tasks: readonly UserTask[], task: UserTask): UserTask[] {
  const i = tasks.findIndex((t) => t.id === task.id);
  const next = [...tasks];
  if (i < 0) return pushCapped(next, task, MAX_TASKS);
  next[i] = task;
  return next;
}

export function removeTask(tasks: readonly UserTask[], id: string): UserTask[] {
  return tasks.filter((t) => t.id !== id);
}

export function excludeBlock(excluded: readonly string[], id: string): string[] {
  if (excluded.includes(id)) return [...excluded];
  return pushCapped(excluded, id, MAX_EXCLUDED);
}

export function includeBlock(excluded: readonly string[], id: string): string[] {
  return excluded.filter((x) => x !== id);
}

export function addSlot(slots: readonly UnavailableSlot[], slot: UnavailableSlot): UnavailableSlot[] {
  const i = slots.findIndex((s) => s.id === slot.id);
  const next = [...slots];
  if (i < 0) return pushCapped(next, slot, MAX_SLOTS);
  next[i] = slot;
  return next;
}

export function removeSlot(slots: readonly UnavailableSlot[], id: string): UnavailableSlot[] {
  return slots.filter((s) => s.id !== id);
}

export function addOverride(list: readonly CourseOverride[], ov: CourseOverride): CourseOverride[] {
  const i = list.findIndex((o) => o.id === ov.id);
  const next = [...list];
  if (i < 0) return pushCapped(next, ov, MAX_OVERRIDES);
  next[i] = ov;
  return next;
}

export function removeOverride(list: readonly CourseOverride[], id: string): CourseOverride[] {
  return list.filter((o) => o.id !== id);
}

/**
 * 把本周的位置覆盖**套用到计划上**，得到「用户改过之后的那一版」。
 *
 * 为什么要有它：手动改动**不自动重排**（T3）—— 记录先攒在 `moves` 里。
 * 但在用户点「重新排一遍」之前，屏幕上必须显示**改过的样子**，
 * 否则点了等于没点。
 *
 * ⚠️ `blockId` 一律**原样保留**：拖到别的天也只改 `dayOfWeek` 字段，
 * 不重写 id —— 否则引擎会认成「删一个 + 新增一个」（见 `MoveRecord` 注释）。
 */
export function applyPendingMoves(
  plan: import('@/types').WeekPlan,
  moves: ReadonlyMap<string, MoveRecord>,
): import('@/types').WeekPlan {
  if (moves.size === 0) return plan;
  const blocks = plan.blocks.map((b) => {
    const m = moves.get(b.id);
    if (!m) return b;
    const dur = m.endMin - m.startMin;
    const next = { ...b, dayOfWeek: m.dayOfWeek as import('@/types').DayOfWeek, startMin: m.startMin, endMin: m.startMin + dur };
    if (m.place === undefined) delete next.place; else next.place = m.place;
    if (m.room === undefined) delete next.room; else next.room = m.room;
    return next;
  });
  return { ...plan, blocks };
}

/* ---------- 作业 ---- */
export function upsertAssignment(
  list: readonly Assignment[],
  item: Assignment,
): Assignment[] {
  const i = list.findIndex((a) => a.id === item.id);
  const next = [...list];
  if (i < 0) return pushCapped(next, item, MAX_ASSIGNMENTS);
  next[i] = item;
  return next;
}

export function removeAssignment(list: readonly Assignment[], id: string): Assignment[] {
  return list.filter((a) => a.id !== id);
}

/**
 * @deprecated WP6（2026-09-27）：「常去食堂」功能已删除 —— 三餐由引擎自动就近
 * （`PlanRequest.mealAutoPlace`，离下一节课最近的食堂）。保留 deprecated 存根
 * 是为了旧调用方/旧 localStorage 数据不炸；下下版连本存根一起删。
 */
export function setMealPlace(
  mp: MealPlaces,
  _meal: keyof MealPlaces,
  _place: string | undefined,
): MealPlaces {
  void _meal;
  void _place;
  return { ...mp }; // no-op：不再写入
}

/* ============================================================
 * 三、校验与迁移
 * ========================================================== */

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** 逐条宽松校验：坏数据只丢自己，不连累整个列表 */
function isTask(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return typeof t.id === 'string' && !!t.id && typeof t.title === 'string' && !!t.title;
}

function isAssignmentLike(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return typeof a.id === 'string' && !!a.id && typeof a.courseId === 'string'
    && typeof a.weekNo === 'number' && typeof a.estimatedMin === 'number';
}

function normalize(raw: unknown): UserPlanLayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== SCHEMA_VERSION) return null;

  const out = emptyUserPlan();
  out.tasks = Array.isArray(r.tasks) ? (r.tasks.filter(isTask) as UserTask[]) : [];
  out.excluded = isStringArray(r.excluded) ? r.excluded : [];
  out.moves = Array.isArray(r.moves) ? (r.moves.filter((m): boolean => {
    if (!m || typeof m !== 'object') return false;
    const x = m as Record<string, unknown>;
    return typeof x.blockId === 'string' && typeof x.weekNo === 'number'
      && typeof x.dayOfWeek === 'number' && typeof x.startMin === 'number';
  }) as MoveRecord[]) : [];
  out.slots = Array.isArray(r.slots) ? (r.slots.filter((s): boolean => {
    if (!s || typeof s !== 'object') return false;
    const x = s as Record<string, unknown>;
    return typeof x.id === 'string' && Array.isArray(x.days);
  }) as UnavailableSlot[]) : [];
  out.courseOverrides = Array.isArray(r.courseOverrides)
    ? (r.courseOverrides.filter((o): boolean => !!o && typeof o === 'object' && typeof (o as Record<string, unknown>).id === 'string') as CourseOverride[])
    : [];
  out.mealPlaces = (r.mealPlaces && typeof r.mealPlaces === 'object')
    ? (r.mealPlaces as MealPlaces) : {};
  out.assignments = Array.isArray(r.assignments)
    ? (r.assignments.filter(isAssignmentLike) as Assignment[]) : [];
  return out;
}

/**
 * 从旧的 v1 数据映射出 v2。
 *
 * 覆盖的旧 key：
 *   · `usst-plan-edits-v1`  → `{ schemaVersion, userTasks, excludedBlockIds }`
 *   · `usst-assignments-v1` → `{ schemaVersion, items }`
 *
 * 迁移是**尽力而为**：任一旧 key 读不到就跳过，不报错、不阻塞。
 */
export function migrateFromLegacy(
  legacyEdits: unknown,
  legacyAssignments: unknown,
): UserPlanLayer {
  const out = emptyUserPlan();

  if (legacyEdits && typeof legacyEdits === 'object') {
    const e = legacyEdits as Record<string, unknown>;
    if (Array.isArray(e.userTasks)) out.tasks = e.userTasks.filter(isTask) as UserTask[];
    if (isStringArray(e.excludedBlockIds)) out.excluded = e.excludedBlockIds;
  }

  if (legacyAssignments && typeof legacyAssignments === 'object') {
    const a = legacyAssignments as Record<string, unknown>;
    if (Array.isArray(a.items)) out.assignments = a.items.filter(isAssignmentLike) as Assignment[];
  }

  return out;
}

/* ============================================================
 * 四、存储层（唯一碰 localStorage 的地方）
 * ========================================================== */

/**
 * 读取覆盖层。
 *
 * 顺序：先试 v2 → 失败则尝试迁移旧的 v1（planEdits + assignments）→
 * 迁移成功后**立刻写回 v2**（这样下次读就是快路径）。
 * 任何异常都回落空 —— 覆盖层是增强，坏了不该让周程页打不开。
 */
export function loadUserPlan(): UserPlanLayer {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = normalize(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    /* 落到迁移分支 */
  }

  // 迁移路径
  try {
    const legacyEdits = localStorage.getItem(LEGACY_EDITS_KEY);
    const legacyAssignments = localStorage.getItem(LEGACY_ASSIGNMENTS_KEY);
    if (!legacyEdits && !legacyAssignments) return emptyUserPlan();

    const migrated = migrateFromLegacy(
      legacyEdits ? JSON.parse(legacyEdits) : null,
      legacyAssignments ? JSON.parse(legacyAssignments) : null,
    );
    // 写回 v2（失败也无所谓，下次还会再试一次迁移）
    try { localStorage.setItem(KEY, JSON.stringify(migrated)); } catch { /* 配额满 */ }
    return migrated;
  } catch {
    return emptyUserPlan();
  }
}

export function saveUserPlan(layer: UserPlanLayer): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...layer, schemaVersion: SCHEMA_VERSION }));
  } catch (e) {
    console.warn('[user-plan] 写入失败：', e);
  }
}

export function clearUserPlan(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式静默 */
  }
}

/* ============================================================
 * 一键还原（2026-10-07）：清掉本周所有「对块位置的干预」，回到引擎最初版
 * ========================================================== */

/**
 * 「回到引擎最初版」的边界 —— 什么算干预、什么算事实：
 *
 * **清（对排布的干预）**：
 *   · `moves`（本周）        —— 拖拽 / 改时间 / 被顺延，全是「对引擎位置的覆盖」
 *   · `excluded`（本周）      —— 删掉的块回来（`w{周}-` 前缀的 blockId 才是本周的）
 *   · `tasks`（一次性）       —— 本周手动塞进去的块（含「⬚ 留白」，weeks 含本周）
 *
 * **留（事实声明与跨周数据，还原不该殃及）**：
 *   · 长期 tasks（`weeks` 空 = 全学期）—— 清了会波及别的周
 *   · `slots` 不可时段 / `courseOverrides` 调课停课 / `assignments` 作业时长
 *     —— 这些是用户声明的**事实**（别排 / 课改了 / 作业要多久），不是「这版怎么排」
 *   · 长期锁在 `planState` 里，由 `planLock.withoutWeekLocks` 单独清块锁、保留长期锁
 */
export function restoreEngineWeek(layer: UserPlanLayer, weekNo: number): UserPlanLayer {
  const prefix = `w${weekNo}-`;
  return {
    ...layer,
    moves: layer.moves.filter((m) => m.weekNo !== weekNo),
    excluded: layer.excluded.filter((id) => !id.startsWith(prefix)),
    tasks: layer.tasks.filter((t) => !(t.weeks && t.weeks.length > 0 && t.weeks.includes(weekNo))),
  };
}

/** 本周有多少「可还原」的干预（按钮启用与确认弹窗文案共用一个口径） */
export function engineRestoreCount(layer: UserPlanLayer, weekNo: number): number {
  const prefix = `w${weekNo}-`;
  return (
    layer.moves.filter((m) => m.weekNo === weekNo).length +
    layer.excluded.filter((id) => id.startsWith(prefix)).length +
    layer.tasks.filter((t) => t.weeks && t.weeks.length > 0 && t.weeks.includes(weekNo)).length
  );
}

/* ---------- 供测试用 ---------- */
export const STORAGE_KEY = KEY;
export const LEGACY_KEYS = { edits: LEGACY_EDITS_KEY, assignments: LEGACY_ASSIGNMENTS_KEY } as const;

/* ============================================================
 * 撤销栈（2026-09-19）
 * ============================================================
 * 用户要求：「增加一个撤回功能，和 Ctrl+Z 绑定，目前只有全部恢复」。
 *
 * 设计：**整层快照**。每次改动（updateLayer）发生前把当前层压栈，
 * 撤销 = 弹出最近一份恢复。层数据量小（几十 KB），整层快照最简单也最可靠
 * —— 逐字段记 diff 看着高级，漏记一个字段就是静默丢数据。
 *
 * 内存栈（不进 localStorage）：Ctrl+Z 是会话内操作，刷新清空符合习惯；
 * 上限 30 步，够回退一段连续操作，也远离内存担忧。
 */
const UNDO_LIMIT = 30;
let undoStack: UserPlanLayer[] = [];

/** 改动发生前调用：把当前层压入撤销栈 */
/* ============================================================
 * WP12-H8：日程变动事件 ring buffer（≤20 条）
 * ------------------------------------------------------------
 * 谁发：WeekPlanView.updateLayer 在落层时对前后两层做 diff；
 * 谁吃：LbaoChat 调 chat() 时带上 getRecentPlanEvents() → 后端
 * memory.summarize_plan_events 转成一行人话注入 prompt（M4 前只转述不抽取）。
 */
export type PlanEventType =
  | 'task_added' | 'task_removed'
  | 'blocks_excluded' | 'blocks_restored'
  | 'move_added';

export interface PlanEvent {
  type: PlanEventType;
  /** 人话摘要（块/任务标题；excluded 用 blockId） */
  title: string;
  ts: number;
}

const PLAN_EVENT_LIMIT = 20;
let planEvents: PlanEvent[] = [];

/** 追加事件（超出 20 条丢最旧）；ts 在入队时刻生成 —— diff 纯函数不碰时钟 */
export function pushPlanEvents(events: ReadonlyArray<Omit<PlanEvent, 'ts'>>): void {
  if (events.length === 0) return;
  const now = Date.now();
  planEvents = [...planEvents, ...events.map((e) => ({ ...e, ts: now }))].slice(-PLAN_EVENT_LIMIT);
}

/** 最近日程变动（LbaoChat 调 chat 时带上）；返回副本，防外泄可变引用 */
export function getRecentPlanEvents(): PlanEvent[] {
  return [...planEvents];
}

/**
 * 前后两层 diff → 事件列表。纯函数（ts 由 pushPlanEvents 填）：
 *   · tasks 按 id 增删 → task_added / task_removed（title = 任务标题）
 *   · excluded 集合差 → blocks_excluded / blocks_restored（title = blockId）
 *   · moves 数量增加 → move_added（title 汇总条数）
 */
export function diffPlanEvents(prev: UserPlanLayer, next: UserPlanLayer): Array<Omit<PlanEvent, 'ts'>> {
  const events: Array<Omit<PlanEvent, 'ts'>> = [];
  const prevTasks = new Map(prev.tasks.map((t) => [t.id, t.title]));
  const nextTasks = new Map(next.tasks.map((t) => [t.id, t.title]));
  for (const [id, title] of nextTasks) {
    if (!prevTasks.has(id)) events.push({ type: 'task_added', title });
  }
  for (const [id, title] of prevTasks) {
    if (!nextTasks.has(id)) events.push({ type: 'task_removed', title });
  }
  const prevEx = new Set(prev.excluded);
  const nextEx = new Set(next.excluded);
  for (const id of nextEx) if (!prevEx.has(id)) events.push({ type: 'blocks_excluded', title: id });
  for (const id of prevEx) if (!nextEx.has(id)) events.push({ type: 'blocks_restored', title: id });
  if (next.moves.length > prev.moves.length) {
    events.push({ type: 'move_added', title: '挪动了 ' + (next.moves.length - prev.moves.length) + ' 处安排' });
  }
  return events;
}

/** V1-5：「留空白」→ 留白块实体（kind:'blank' 的固定任务，construct 落成 locked blank 块）。
 *  口径：blank 不进自习/活动分钟（daySaturation/statsOf 按 kind 排除），与远方模式共用同一 kind。 */
export function blankTaskFor(
  deleted: { title: string; day: number; startMin: number; endMin: number },
  weekNo: number,
): UserTask {
  return {
    id: makeLayerId('blank'),
    title: '留白',
    emoji: '⬚',
    kind: 'blank',
    category: 'custom',
    dayOfWeek: deleted.day,
    startMin: deleted.startMin,
    durationMin: Math.max(30, deleted.endMin - deleted.startMin),
    weeks: [weekNo],
    note: '「' + deleted.title + '」原来的时间 —— 留给你自己',
  };
}

export function pushUndoSnapshot(prev: UserPlanLayer): void {
  undoStack.push(prev);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

/** 是否有可撤销的内容 */
export function canUndo(): boolean {
  return undoStack.length > 0;
}

/** 当前栈深（UI 显示「可撤销 N 步」用） */
export function undoDepth(): number {
  return undoStack.length;
}

/** 撤销：弹出最近一份快照；栈空返回 null（调用方不动） */
export function popUndo(): UserPlanLayer | null {
  return undoStack.pop() ?? null;
}

/** 清空撤销栈（换周/清空数据时调用，避免撤回别处的内容） */
export function clearUndo(): void {
  undoStack = [];
}

/* ============================================================
 * 重做栈（2026-09-19，与撤销栈配套）
 * ============================================================
 * 标准语义：
 *   · 撤销时把**当前层**压入重做栈（回退前的样子）；
 *   · **发生新改动 → 重做栈清空**（否则 撤销→改→重做 会穿越历史）；
 *   · 重做时把当前层压回撤销栈（往返自如）。
 * 与撤销栈同限同生命周期（内存、刷新清空）。
 */
let redoStack: UserPlanLayer[] = [];

/** 撤销发生时调用：把回退前的状态压入重做栈 */
export function pushRedoSnapshot(current: UserPlanLayer): void {
  redoStack.push(current);
  if (redoStack.length > UNDO_LIMIT) redoStack.shift();
}

/** 发生新改动时调用：重做历史作废 */
export function clearRedo(): void {
  redoStack = [];
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function redoDepth(): number {
  return redoStack.length;
}

/** 重做：弹出最近一次被撤销的状态；栈空返回 null */
export function popRedo(): UserPlanLayer | null {
  return redoStack.pop() ?? null;
}
