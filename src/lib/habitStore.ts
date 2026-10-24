/**
 * 习惯（A3 · F7-1 批）—— 「每周三 20:00 跑步 40min」这类**每周重复的小事**
 * ============================================================
 * 与排程引擎的关系（F7-1 纪律：**零引擎改动、不加引擎类型**）：
 *   · kind='fixed'      → 应用层展开为既有 `UserTask`（指定 dayOfWeek/startMin 即固定块，
 *                         重排时引擎不动它 —— templates.ts UserTask 既有语义）；
 *   · kind='accumulate' → 展开为既有 splittable `Commit` 语义的**骨架**
 *                         （effortMin = 每周次数 × 单次时长，minAcceptableMin、window）。
 * 展开只是产出与既有任务类型**同构的对象**，本模块不调用引擎、不进 `types.ts`；
 * 谁把它们喂给 `buildWeekPlan` 是后续批的事（接线时复用 `pendingTodos` 同款通道）。
 *
 * 打卡（打勾）= 复用 behaviorLog 既有 `markBlock` 行为记录通路：
 *   · fixed      → blockId `habit-{id}`（同块同天覆盖，天然幂等）；
 *   · accumulate → blockId `habit-{id}-s{n}`（第 n 次，n = 本周已 done 数 + 1），
 *     块 id 带前缀 → 欠账统计走 behaviorLog.habitDebt()（同一前缀口径）。
 *
 * 存储照 behaviorLog / prefLearn 体例：裸 localStorage + try/catch + 逐条校验回落，
 * **不走 storageGateway**（F7-1 允许清单外，与行为记录同一独立分片理由）。
 *
 * 反向验证锚点（详见 tests/habit-store.test.ts 头注）：
 *   F7-RV1/2 ← habitDebt 的 done 匹配口径   F7-RV3 ← accumulate 的 effortMin 推导
 *   F7-RV4  ← 存储坏数据回落
 */
import type { Commit } from './planner/model';
import type { UserTask } from './planner/templates';
import { currentWeekNo, todayISO } from './date';
import {
  habitBlockId, habitDebt, habitSessionBlockId, loadRecords, markBlock,
  type BehaviorRecord,
} from './behaviorLog';

/** 存储键（工作单指定：usst.habits-v1） */
export const HABITS_KEY = 'usst.habits-v1';

/**
 * 一条习惯的定义。
 * ⚠️ `kind` 是**习惯的展开方式**（fixed/accumulate），不是 BlockKind —— 两者同名不同义。
 * `weekday` 口径与 `UserTask.dayOfWeek` 一致：1=周一 … 7=周日（**不是** `weekdayOf` 的 0=周日）。
 */
export interface HabitDef {
  id: string;
  title: string;
  /** 展开方式：fixed = 每周固定时段 → UserTask；accumulate = 每周累计 N 次 → splittable Commit 骨架 */
  kind: 'fixed' | 'accumulate';
  /** kind='fixed'：星期几（1=周一…7=周日） */
  weekday?: number;
  /** kind='fixed'：开始分钟（自午夜起，如 20:00 = 1200） */
  startMin?: number;
  /** 单次时长（分钟）：fixed = 块时长；accumulate = 单次会话时长 */
  durationMin?: number;
  /** kind='accumulate'：每周次数（如 3 = 「每周累计 3 次」） */
  perWeekCount?: number;
  /** kind='accumulate'：周投入总分钟覆盖；缺省 = perWeekCount × durationMin */
  effortMin?: number;
  /** kind='accumulate'：最小可接受单次时长（Commit.minAcceptableMin 语义） */
  minAcceptableMin?: number;
  /** kind='accumulate'：允许落点窗口名（'morning'/'afternoon'/'evening' 或中文别名「晚间」等） */
  window?: string;
  /** 归档：不展开、不显示、不计欠账（与 memoStore 同款「归档而非删除」语义） */
  archived?: boolean;
}

/** 新增习惯时的入参：id 可省（自动生成） */
export type HabitDraft = Omit<HabitDef, 'id'> & { id?: string };

/* ---------------- 存储（裸 localStorage + try/catch + 坏数据回落，同 behaviorLog 体例） ---------------- */

function isHabitDef(v: unknown): v is HabitDef {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' && o.id !== ''
    && typeof o.title === 'string' && o.title !== ''
    && (o.kind === 'fixed' || o.kind === 'accumulate')
    && (o.weekday === undefined || (typeof o.weekday === 'number' && Number.isInteger(o.weekday) && o.weekday >= 1 && o.weekday <= 7))
    && (o.startMin === undefined || (typeof o.startMin === 'number' && o.startMin >= 0 && o.startMin < 1440))
    && (o.durationMin === undefined || (typeof o.durationMin === 'number' && o.durationMin > 0))
    && (o.perWeekCount === undefined || (typeof o.perWeekCount === 'number' && Number.isInteger(o.perWeekCount) && o.perWeekCount >= 1))
    && (o.effortMin === undefined || (typeof o.effortMin === 'number' && o.effortMin >= 0))
    && (o.minAcceptableMin === undefined || (typeof o.minAcceptableMin === 'number' && o.minAcceptableMin > 0))
    && (o.window === undefined || typeof o.window === 'string')
    && (o.archived === undefined || typeof o.archived === 'boolean')
  );
}

/** 读取习惯列表；没写过 / 坏 JSON / 非数组 → []；坏条目只丢那一条（同 loadRecords 口径） */
export function loadHabits(): HabitDef[] {
  try {
    const raw = localStorage.getItem(HABITS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHabitDef);
  } catch {
    return [];
  }
}

export function saveHabits(habits: HabitDef[]): void {
  try {
    localStorage.setItem(HABITS_KEY, JSON.stringify(habits));
  } catch (e) {
    console.warn('[habit] 写入失败', e);
  }
}

/** 清空习惯（供「重置」入口调用） */
export function clearHabits(): void {
  try {
    localStorage.removeItem(HABITS_KEY);
  } catch {
    /* 隐私模式下不可写，静默即可 */
  }
}

function newHabitId(): string {
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 新增一条（id 自动生成；草稿非法 → 原样返回不写入）。返回写入后的完整列表。 */
export function addHabit(draft: HabitDraft): HabitDef[] {
  const def: HabitDef = { ...draft, id: draft.id ?? newHabitId() };
  if (!isHabitDef(def)) return loadHabits();
  const next = [...loadHabits(), def];
  saveHabits(next);
  return next;
}

/** 按 id 打补丁（id 不存在 / 合并结果非法 → 原样返回）。返回写入后的完整列表。 */
export function updateHabit(id: string, patch: Partial<Omit<HabitDef, 'id'>>): HabitDef[] {
  const cur = loadHabits();
  const i = cur.findIndex((h) => h.id === id);
  if (i < 0) return cur;
  const merged: HabitDef = { ...cur[i], ...patch, id };
  if (!isHabitDef(merged)) return cur;
  const next = cur.slice();
  next[i] = merged;
  saveHabits(next);
  return next;
}

/** 归档 / 取消归档（archived：不展开不显示不计欠账） */
export function archiveHabit(id: string, archived = true): HabitDef[] {
  return updateHabit(id, { archived });
}

/** 删除一条（增删改查的「删」；常规路径建议用 archiveHabit 留痕） */
export function removeHabit(id: string): HabitDef[] {
  const next = loadHabits().filter((h) => h.id !== id);
  saveHabits(next);
  return next;
}

/* ---------------- 展开：HabitDef → 既有任务类型的同构对象（零引擎改动） ---------------- */

/** 展开产物：fixed → UserTask；accumulate → Commit。用 `'effortMin' in t` 区分。 */
export type HabitTask = UserTask | Commit;

/**
 * 命名时段窗 → `Commit.window`（fromMin/toMin）。
 * 边界与 prefLearn 的分桶**逐字一致**：morning <720 / afternoon 720–1080 / evening >1080
 * （「晚间（18:00 后）」同一套话术，不另造时段口径）。认不出的名字 → undefined（不加约束）。
 */
const WINDOW_RANGES: Record<'morning' | 'afternoon' | 'evening', { fromMin: number; toMin: number }> = {
  morning: { fromMin: 0, toMin: 720 },
  afternoon: { fromMin: 720, toMin: 1080 },
  evening: { fromMin: 1080, toMin: 1440 },
};

const WINDOW_ALIASES: ReadonlyArray<readonly [string, 'morning' | 'afternoon' | 'evening']> = [
  ['早晨', 'morning'], ['上午', 'morning'],
  ['下午', 'afternoon'],
  ['晚间', 'evening'], ['晚上', 'evening'],
];

export function habitWindowRange(name?: string): { fromMin: number; toMin: number } | undefined {
  const key = (name ?? '').trim();
  if (!key) return undefined;
  if (key in WINDOW_RANGES) return { ...WINDOW_RANGES[key as 'morning' | 'afternoon' | 'evening'] };
  const hit = WINDOW_ALIASES.find(([alias]) => key.includes(alias));
  return hit ? { ...WINDOW_RANGES[hit[1]] } : undefined;
}

/**
 * 把一条习惯展开为引擎既有通道能吃的东西（**纯函数，不落盘、不调用引擎**）。
 *   · fixed      → `UserTask`：dayOfWeek + startMin + durationMin 三件套齐 = 固定块（重排不动）；
 *   · accumulate → `Commit` 骨架：effortMin = effortMin 覆盖 ?? perWeekCount × durationMin，
 *                  splittable + minAcceptableMin + window（工作单示例「每周累计 3 次×40min」
 *                  → effortMin 120 + minAcceptableMin 30 + window 晚间）。
 * 传 `weekNo` 则产出限定在该周（`weeks: [weekNo]`，与 schedule.ts 待办通道同款）；不传 = 全学期。
 * 归档习惯返回 []（不展开不显示）。
 */
export function habitToTasks(def: HabitDef, weekNo?: number): HabitTask[] {
  if (def.archived) return [];
  if (def.kind === 'accumulate') {
    const effortMin = def.effortMin ?? (def.perWeekCount ?? 0) * (def.durationMin ?? 0);
    const win = habitWindowRange(def.window);
    const commit: Commit = {
      id: habitBlockId(def.id),
      title: def.title,
      emoji: '🔁',
      kind: 'activity',
      effortMin,
      ...(def.minAcceptableMin != null ? { minAcceptableMin: def.minAcceptableMin } : {}),
      splittable: true,
      ...(win ? { window: win } : {}),
      priority: 92, // 用户自己的长期约定，与待办 longterm 通道同级（92 > 缺省 90）
      ...(weekNo != null ? { weeks: [weekNo] } : {}),
    };
    return [commit];
  }
  const task: UserTask = {
    id: habitBlockId(def.id),
    title: def.title,
    emoji: '🔁',
    kind: 'activity',
    ...(def.weekday != null && def.weekday >= 1 && def.weekday <= 7 ? { dayOfWeek: def.weekday } : {}),
    ...(def.startMin != null ? { startMin: def.startMin } : {}),
    ...(def.durationMin != null ? { durationMin: def.durationMin } : {}),
    ...(weekNo != null ? { weeks: [weekNo] } : {}),
    priority: 90, // 用户自己要排的事（customTemplate 同款缺省）
    note: '来自习惯（每周固定打卡）',
  };
  return [task];
}

/* ---------------- 打卡（UI 层写侧：走既有 markBlock 通路） ---------------- */

/**
 * 打勾 = 记一条 done 行为记录（复用 behaviorLog.markBlock，覆盖同块同天）。
 *   · fixed      → `habit-{id}`：同周内再点也只是同块不同天的独立记录，
 *                  但 UI 端 done ≥ expected 后按钮已禁用，正常流不会超；
 *   · accumulate → `habit-{id}-s{n}`：n = 本周已 done 数 + 1（habitDebt 口径），
 *                  同天多次打卡各占一个会话号，不会互相覆盖。
 * 归档习惯 → null（不写任何记录）。`startMin` 透传仅 fixed（供 F3 分桶，字段本身不动）。
 */
export function markHabitDone(
  def: HabitDef,
  weekNo: number,
  date = todayISO(),
): { blockId: string; session: number } | null {
  if (def.archived) return null;
  if (def.kind === 'fixed') {
    markBlock({
      blockId: habitBlockId(def.id),
      date,
      weekNo,
      kind: 'activity',
      title: def.title,
      plannedMin: def.durationMin ?? 0,
      status: 'done',
      ...(def.startMin != null ? { startMin: def.startMin } : {}),
    });
    return { blockId: habitBlockId(def.id), session: 0 };
  }
  const [entry] = habitDebt(loadRecords(), [def], weekNo);
  const session = (entry?.done ?? 0) + 1;
  const blockId = habitSessionBlockId(def.id, session);
  markBlock({
    blockId,
    date,
    weekNo,
    kind: 'activity',
    title: def.title,
    plannedMin: def.durationMin ?? 0,
    status: 'done',
  });
  return { blockId, session };
}

/* ---------------- UI 快照（读 localStorage；纯函数纪律只约束 lib/planner/**，同 behaviorLog 体例） ---------------- */

/** GoalTodoCard 习惯行的一格：定义 + 本周进度 + 是否完成 */
export interface HabitRowView {
  def: HabitDef;
  /** 本周已打卡次数 */
  done: number;
  /** 本周应做次数（fixed = 1；accumulate = perWeekCount） */
  expected: number;
  /** done ≥ expected（expected 为 0 的畸形数据永远不算完成） */
  complete: boolean;
}

/**
 * 渲染用的行视图（归档习惯已被 habitDebt 滤掉，天然不显示）。
 * records / habits 有缺省值（直接读存储），测试可显式注入。
 */
export function habitRowViews(
  weekNo: number,
  records: readonly BehaviorRecord[] = loadRecords(),
  habits: readonly HabitDef[] = loadHabits(),
): HabitRowView[] {
  const byId = new Map(habitDebt(records, habits, weekNo).map((e) => [e.habitId, e]));
  return habits
    .filter((h) => byId.has(h.id))
    .map((h) => {
      const e = byId.get(h.id)!;
      return { def: h, done: e.done, expected: e.expected, complete: e.expected > 0 && e.done >= e.expected };
    });
}

/* ---------------- 周次来源 ---------------- */

/**
 * UI 层：当前周次（打卡记录的 weekNo 字段来源）。
 * termStart 取自 web 主状态（键与 src/lib/storage.ts:9 同一；该键未导出，
 * 这里按字面量登记 —— mobile/webSync.ts 既有同款先例）；缺失 / 非法 / 开学前
 * → 1（与 webSync 的 `weekNoFromTermStart(...) ?? 1` 同口径）。
 * ⚠️ 习惯记录必须与全仓其它行为记录同一周次刻度，否则会污染 summarizeWeek 的周统计。
 */
export function habitWeekNoNow(): number {
  try {
    const raw = localStorage.getItem('usst-life-assistant-v2');
    if (raw) {
      const data = JSON.parse(raw) as { schedule?: { termStart?: unknown } | null };
      const ts = data?.schedule?.termStart;
      if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ts)) {
        const wn = currentWeekNo(ts.slice(0, 10));
        if (wn >= 1) return wn;
      }
    }
  } catch {
    /* 主状态读不到 → 回落 */
  }
  return 1;
}
