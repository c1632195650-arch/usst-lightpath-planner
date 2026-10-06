/**
 * 光溯移动端 · 执行力评估 · 行为记录（任务书 P1-1/P1-2 的数据侧）
 * ============================================================
 * 只记录**用户主动产生**的行为事件（勾完成 / 取消勾选）—— 任务书 §五明确
 * 不采集停留时长、点开次数等被动追踪。
 *
 * 本文件是副作用层（localStorage 读写、读时钟），compute.ts 保持纯函数；
 * KV 以接口注入，Node 单测用内存实现，浏览器传 localStorage。
 */
import type { BlockCheckRecord } from './model.ts';

/** 存储接口（浏览器 localStorage / 测试内存实现都满足） */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 行为日志的本地存储 key（沿用 usst.mobile.* 前缀） */
export const BEHAVIOR_KEY = 'usst.mobile.evalBehavior';
/** 上限：防止无限增长；超出丢最老的（评估只用近 7 天窗口） */
export const BEHAVIOR_CAP = 500;

/** 一次勾选状态变化（勾完成 / 取消勾选） */
export interface BehaviorEvent {
  /** 事件时刻 ISO（含时区） */
  t: string;
  /** 事件发生的**本地日历日**（勾选那一刻的日期，跨零点勾选算次日） */
  dayKey: string;
  type: 'block_done' | 'block_undone';
  blockId: string;
  /** 块类目（TimeBlock.kind 原样记录，供题库分类参照） */
  kind: string;
  /** 该块当日的计划开始（分钟数；已被顺延过的以顺延后为准 —— 用户看到的就是它） */
  plannedStartMin: number;
  /** 勾选时刻的当日分钟数 */
  checkedMin: number;
}

/** 本地日历日 → "YYYY-MM-DD"（补零，与 parseDate 的口径一致） */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readEvents(kv: KV): BehaviorEvent[] {
  try {
    const raw = kv.getItem(BEHAVIOR_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as BehaviorEvent[]) : [];
  } catch {
    return []; // 存储损坏按空处理，绝不因评估数据弄垮今日页
  }
}

function writeEvents(kv: KV, events: BehaviorEvent[]): void {
  kv.setItem(BEHAVIOR_KEY, JSON.stringify(events.slice(-BEHAVIOR_CAP)));
}

export function loadBehavior(kv: KV): BehaviorEvent[] {
  return readEvents(kv);
}

/** TodayPage 勾选/取消勾选时各记一条（副作用入口，读时钟只在这一处） */
export function recordBlockToggle(kv: KV, args: {
  blockId: string;
  kind: string;
  plannedStartMin: number;
  when: Date;
  /** true = 勾完成；false = 取消勾选 */
  done: boolean;
}): void {
  const event: BehaviorEvent = {
    t: args.when.toISOString(),
    dayKey: localDateKey(args.when),
    type: args.done ? 'block_done' : 'block_undone',
    blockId: args.blockId,
    kind: args.kind,
    plannedStartMin: args.plannedStartMin,
    checkedMin: args.when.getHours() * 60 + args.when.getMinutes(),
  };
  writeEvents(kv, [...readEvents(kv), event]);
}

/**
 * 行为日志 → 时间纪律的原料（BlockCheckRecord[]）。
 * 同一 (dayKey, blockId) 以**最后一次**事件为准：先勾后取消 = undone，不计入样本。
 */
export function toCheckRecords(events: readonly BehaviorEvent[]): BlockCheckRecord[] {
  const lastType = new Map<string, BehaviorEvent['type']>();
  for (const e of events) {
    lastType.set(`${e.dayKey}#${e.blockId}`, e.type);
  }
  const records: BlockCheckRecord[] = [];
  for (const e of events) {
    if (e.type !== 'block_done') continue;
    const final = lastType.get(`${e.dayKey}#${e.blockId}`);
    if (final !== 'block_done') continue;
    records.push({
      blockId: e.blockId,
      plannedDayKey: e.dayKey,
      plannedStartMin: e.plannedStartMin,
      checkedDayKey: e.dayKey,
      checkedMin: e.checkedMin,
      undone: false,
    });
  }
  return records;
}

/** 最终处于「已勾选」状态的 (dayKey, blockId) 集合（完成率/连续性判定用） */
export function finalDoneKeys(events: readonly BehaviorEvent[]): ReadonlySet<string> {
  const lastType = new Map<string, BehaviorEvent['type']>();
  for (const e of events) {
    lastType.set(`${e.dayKey}#${e.blockId}`, e.type);
  }
  const done = new Set<string>();
  for (const [key, type] of lastType) {
    if (type === 'block_done') done.add(key);
  }
  return done;
}

/**
 * 首个行为事件的本地日历日（=「App 开始被使用」的锚点，含当天）。
 * 没有任何事件（冷启动）→ null。脏 dayKey 忽略；无事件或全脏 → null。
 * 供 `units.ts` 的 `inUseDays` 截断统计窗（铁律 2：装 App 前不虚构 done=false 单元）。
 */
export function firstEventDayKey(events: readonly BehaviorEvent[]): string | null {
  let min: string | null = null;
  for (const e of events) {
    const k = e.dayKey;
    if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    if (min === null || k < min) min = k;
  }
  return min;
}
