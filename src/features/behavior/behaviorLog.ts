/**
 * 行为记录 —— 排程的反馈闭环（用户构想里一直没落地的那一环）
 * ============================================================
 * 前面几层解决的是「排得对不对」；这一层解决「**排了之后真的做了吗**，
 * 下次该不该照着再来一遍」。没有它，引擎永远只能拿**假设的**执行率做规划。
 *
 * 最小版只记一件事：每个块最后是「做了」还是「没做」。
 * 刻意不记「改到几点」「为什么没做」—— 那些要额外的输入成本，
 * 而记不住的原因通常不是字段不够，是**记起来太麻烦**。
 *
 * 存储**独立于 `AppState`**，两个理由：
 *   1. 条数随天数线性增长（每天约 15 条），而 `saveState` 在每次 `patch` 时
 *      都全量序列化主状态 —— 塞进主状态会拖慢用户的每一次输入；
 *   2. 它应该能被独立清空（「清掉我的执行记录」），不该和课表 / 画像同生共死。
 * 附带好处：零契约改动，不与排程引擎那条线争夺 `types.ts`。
 */
import type { BlockKind } from '@/types';
import { addDays, weekDates, weekdayOf } from '@/lib/date';

const KEY = 'usst-behavior-log-v1';

/**
 * 本地存储有配额（约 5MB）。按每天 15 条、每条约 200 字节算，
 * 800 条约 160KB —— 够记两个多月，且离配额很远。
 */
const MAX_RECORDS = 800;

export type BehaviorStatus = 'done' | 'skipped';

/** 一个块在某一天的执行结果 */
export interface BehaviorRecord {
  /** 稳定 id：`{blockId}@{date}` —— **同一个块在同一天只有一条记录** */
  id: string;
  blockId: string;
  /** ISO 日期（yyyy-mm-dd） */
  date: string;
  weekNo: number;
  kind: BlockKind;
  title: string;
  /** 计划时长（分钟）—— 聚合「实际投入」时用它 */
  plannedMin: number;
  status: BehaviorStatus;
  /** 记录时刻（ISO） */
  at: string;
}

/* ---------------- 纯函数部分（不碰 localStorage，可单测） ---------------- */

export function makeId(blockId: string, date: string): string {
  return `${blockId}@${date}`;
}

/**
 * 写入或覆盖一条记录。
 *
 * 同一块同一天**覆盖**而不是追加：用户改主意是常态（点了「没做」又想改成「做了」），
 * 追加会让完成率出现「同一个块算了两次」的假象。
 */
export function upsert(records: BehaviorRecord[], rec: BehaviorRecord): BehaviorRecord[] {
  const i = records.findIndex((r) => r.id === rec.id);
  if (i < 0) return prune([...records, rec]);
  const next = records.slice();
  next[i] = rec;
  return next;
}

/** 超出上限时丢掉**最旧**的（保留最近的行为，远期的参考价值本就低） */
export function prune(records: BehaviorRecord[]): BehaviorRecord[] {
  return records.length <= MAX_RECORDS
    ? records
    : records.slice(records.length - MAX_RECORDS);
}

export function findStatus(
  records: BehaviorRecord[],
  blockId: string,
  date: string,
): BehaviorStatus | undefined {
  const id = makeId(blockId, date);
  for (const r of records) if (r.id === id) return r.status;
  return undefined;
}

export interface WeekProgress {
  /** 已标记的块数（没标记的不算 —— 没反馈不等于没做） */
  marked: number;
  done: number;
  skipped: number;
  /** 已完成块的计划时长合计（分钟） */
  doneMin: number;
  /** 已标记块的计划时长合计（分钟） */
  markedMin: number;
  /**
   * 完成率；**没有记录时是 `null` 而不是 0**。
   * 0 会被读成「一个都没做」，而实际含义是「还没有数据」—— 两者对用户的暗示完全不同。
   */
  rate: number | null;
}

export function summarizeWeek(records: BehaviorRecord[], weekNo: number): WeekProgress {
  const inWeek = records.filter((r) => r.weekNo === weekNo);
  const done = inWeek.filter((r) => r.status === 'done');
  const sum = (rs: BehaviorRecord[]) => rs.reduce((n, r) => n + r.plannedMin, 0);
  return {
    marked: inWeek.length,
    done: done.length,
    skipped: inWeek.length - done.length,
    doneMin: sum(done),
    markedMin: sum(inWeek),
    rate: inWeek.length === 0 ? null : done.length / inWeek.length,
  };
}

/**
 * 逐日的**实际**负荷（分钟）—— 对应 `RollingState.recentLoad`。
 *
 * 只统计 `done`：被跳过的块没有产生负荷，把它算进去会让「跨周疲劳」的输入虚高，
 * 于是引擎以为你很累、下周自动松，而你其实什么都没做。
 *
 * @param dates 要输出的日期序列；没有记录的日期返回 0（缺口补 0，而不是跳过）
 */
export function actualLoadByDate(records: BehaviorRecord[], dates: string[]): number[] {
  const byDate = new Map<string, number>();
  for (const r of records) {
    if (r.status !== 'done') continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.plannedMin);
  }
  return dates.map((d) => byDate.get(d) ?? 0);
}

/**
 * 按**星期几**聚合的实际负荷（下标 0 = 周一 … 6 = 周日）—— 喂给引擎的
 * `ConstructCtx.actualLoadByDow`（P2-T2.2，规格书 §5.3 跨天加成）。
 *
 * 为什么要按星期几而不是按日期：跨周疲劳是「周三总是最累」这类**星期规律**，
 * 而不是「某一天是 9 月 17 日」。引擎也只认 `loadByDow`（长度 8，下标 1..7）。
 *
 * 多条同星期几的日期取**平均**（而不是求和）：记录了 3 个周三，求和会让
 * 「记了两周」凭空变成三倍负荷；平均才是「一个周三大概多重」。
 * 没记录的星期几返回 0（缺口补 0，与 `actualLoadByDate` 同一策略）。
 *
 * @param weeeksBack 只看最近几周的记录；缺省 4。太旧的记录不代表「最近累不累」。
 */
export function actualLoadByDow(
  records: BehaviorRecord[],
  mondayISO: string,
  weeksBack = 4,
): number[] {
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  if (weeksBack <= 0) return sums;

  // 最近 weeksBack 周的日期窗口（周一 → 周日），用集合做 O(1) 命中
  const inWindow = new Set<string>();
  for (let w = weeksBack - 1; w >= 0; w -= 1) {
    const monday = addDays(mondayISO, -w * 7);
    for (const iso of weekDates(monday)) inWindow.add(iso);
  }

  // 按「日期 → 该日实际负荷」先算一遍，再归到星期几
  const dates = [...inWindow].sort();
  const loads = actualLoadByDate(records, dates);
  for (let i = 0; i < dates.length; i += 1) {
    const v = loads[i];
    if (v <= 0) continue;
    const dow = weekdayOf(dates[i]); // 0 = 周日
    const idx = dow === 0 ? 6 : dow - 1; // 转成「0 = 周一」
    sums[idx] += v;
    counts[idx] += 1;
  }
  return sums.map((s, i) => (counts[i] > 0 ? Math.round(s / counts[i]) : 0));
}

/* ---------------- 存储层（唯一碰 localStorage 的地方） ---------------- */

function isRecord(v: unknown): v is BehaviorRecord {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string'
    && typeof o.blockId === 'string'
    && typeof o.date === 'string'
    && typeof o.weekNo === 'number'
    && typeof o.title === 'string'
    && typeof o.kind === 'string'
    && typeof o.plannedMin === 'number'
    && typeof o.at === 'string'
    && (o.status === 'done' || o.status === 'skipped')
  );
}

export function loadRecords(): BehaviorRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 逐条校验形状：坏数据只丢坏的那条，不让整个记录列表失效
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

export function saveRecords(records: BehaviorRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch (e) {
    console.warn('[behavior] 写入失败', e);
  }
}

/** 清空执行记录（供「重置」入口调用） */
export function clearRecords(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式下不可写，静默即可 */
  }
}
