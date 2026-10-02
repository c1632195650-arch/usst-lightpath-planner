/**
 * 光溯移动端 · 同步纯函数（方案 §5/§7）
 * ============================================================
 * 纪律：**纯函数** —— 不 fetch、不碰 localStorage、不读时钟（时间一律入参）。
 * Node 单测（tests/mobile/）直接可跑；副作用都在 api.ts / TodayPage 里。
 */
import type { TimeBlock, WeekPlan } from '@/types';
import type { SyncStatePayload } from './types.ts';
import type { UserPlanLayer } from '@/features/week/userPlanStore';

/** 32 位稳定哈希（djb2 变体）—— F9 变化标记与 F13 通知 id 共用（确定性，跨端一致） */
export function stableHash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 星期几（1=周一 … 7=周日）—— 入参注入，可测 */
export function todayDow(d: Date): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return (((d.getDay() + 6) % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** 当天 00:00 起的分钟偏移（F5「现在」横幅用；时间入参，可测） */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * 当前周号：termStart（第一周周一）起算，向下取整 +1。
 * termStart 非法/在未来 → null（调用方回退 state.weekNo）。
 */
export function weekNoFromTermStart(termStart: string, d: Date): number | null {
  const base = parseDate(termStart);
  if (!base) return null;
  const day0 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((day0 - base) / 86_400_000);
  if (diff < 0) return null;
  return Math.floor(diff / 7) + 1;
}

/** "YYYY-MM-DD" → UTC 零点毫秒；解析失败（含 2026-13-40 这类会回卷的假日期）→ null */
export function parseDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dd = Number(m[3]);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
  const t = Date.UTC(y, mo - 1, dd);
  if (!Number.isFinite(t)) return null;
  // 回卷防护：Date.UTC 会把 2026-02-30 滚成 3 月 2 日 —— 成分对不上就不是真日期
  const d = new Date(t);
  return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === dd ? t : null;
}

/**
 * 组装 SyncState payload（方案 §5.1）。
 * `JSON.parse(JSON.stringify(...))` 剔除不可序列化项（函数/undefined）——
 * 服务端只透传不解释，这里保证上行的 JSON 是干净的纯数据。
 */
export function buildSyncPayload(args: {
  schedule: import('@/types').Schedule;
  planState: import('@/types').PlanPersistState | null;
  userOverrides: UserPlanLayer | null;
  termStart: string;
  weekNo: number;
  clientUpdatedAt: string;
}): SyncStatePayload {
  const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;
  return {
    schemaVer: 1,
    termStart: args.termStart,
    weekNo: args.weekNo,
    schedule: clean(args.schedule),
    planState: args.planState ? clean(args.planState) : null,
    userOverrides: args.userOverrides ? clean(args.userOverrides) : null,
    clientUpdatedAt: args.clientUpdatedAt,
  };
}

/**
 * LWW 裁决（方案 §5.2）：client > server → 客户端可写。
 * 解析成毫秒比较（`Z` / `+00:00` / 毫秒位数差异会让字符串序偏离时间序）；
 * 任一侧解析不了 → false（宁可「以云端为准」，不误覆盖）。
 */
export function decideLww(clientUpdatedAt: string, serverUpdatedAt: string | null): boolean {
  if (!serverUpdatedAt) return true;
  const c = Date.parse(clientUpdatedAt);
  const s = Date.parse(serverUpdatedAt);
  if (!Number.isFinite(c) || !Number.isFinite(s)) return false;
  return c > s;
}

/**
 * 当日块签名（F9）：id+startMin+endMin+done 排序拼接 —— 内容变了签名就变。
 * done 从 moves 读取（见 doneBlockIds），这里只对给定块集合做快照。
 */
export function todaySignature(blocks: readonly TimeBlock[], doneIds: ReadonlySet<string>): string {
  return blocks
    .map((b) => `${b.id}:${b.startMin}:${b.endMin}:${doneIds.has(b.id) ? 1 : 0}`)
    .sort()
    .join('|');
}

/**
 * 覆盖层 → 当日视图（方案 §7.3 映射，唯一写法）：
 *   · excluded 的块剔除；
 *   · moves 应用（applyPendingMoves 的纯语义：blockId 不变，位置以记录为准）；
 *   · done 的块标完成（视图置灰，读取处向后兼容：无字段 = 未完成）。
 */
export function applyLayerToBlocks(
  plan: WeekPlan,
  layer: UserPlanLayer,
  weekNo: number,
  dow: number,
): { blocks: TimeBlock[]; doneIds: Set<string> } {
  const excluded = new Set(layer.excluded);
  const moves = new Map<string, import('@/features/week/userPlanStore').MoveRecord>();
  for (const m of layer.moves) if (m.weekNo === weekNo) moves.set(m.blockId, m);
  const doneIds = new Set<string>();
  for (const [id, m] of moves) if (m.done) doneIds.add(id);

  const blocks: TimeBlock[] = [];
  for (const b of plan.blocks) {
    if (b.dayOfWeek !== dow) continue;
    if (excluded.has(b.id)) continue;
    const m = moves.get(b.id);
    if (m) {
      const dur = Math.max(1, (b.endMin - b.startMin) || (m.endMin - m.startMin));
      blocks.push({
        ...b,
        dayOfWeek: m.dayOfWeek as TimeBlock['dayOfWeek'],
        startMin: m.startMin,
        endMin: m.startMin + dur,
        ...(m.place !== undefined ? { place: m.place } : {}),
        ...(m.room !== undefined ? { room: m.room } : {}),
      });
    } else {
      blocks.push(b);
    }
  }
  blocks.sort((a, b) => a.startMin - b.startMin);
  return { blocks, doneIds };
}

/** HH:MM 渲染（与 toHHmm 口径一致，独立实现避免引 UI 层依赖） */
export function fmtMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
