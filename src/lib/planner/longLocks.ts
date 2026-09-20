/**
 * 长期锁（S1：定住跨周，单双周分开）
 * ============================================================
 * 用户的原话：「定住代表『**以后每周都留着**』」「单双周按照单双周分别定住来处理」。
 *
 * ── 为什么必须新做一套 key ──────────────────────────────────
 * 块锁的 key 是 `blockId`，形如 `w3-d2-study-lib-2` —— **周次与序号都编码在里面**。
 * 于是「第 3 周点的定住」在第 4 周天然失效：那周的块 id 根本不一样。
 * 长期锁的 key 必须**不含周次**：
 *
 *     {odd|even}-d{星期}-{类型}-{起}-{止}
 *
 * 只认「星期 + 起止 + 类型」，不认 `-2` 这种序号 —— 序号在跨周时会错位（S1.6）。
 *
 * ── 两套锁互不污染（与 R2 的块锁）─────────────────────────────
 * 判据是**前缀**：`odd-` / `even-` 开头 = 长期锁，其余（`w{周}-…`）= 块锁。
 * 两边各自只读自己那一类 key，绝不去解析对方的形状 —— 详见 `planLock.ts` 顶部注释。
 *
 * ── 冲突口径（用户拍板）──────────────────────────────────────
 * 长期锁的时段与课程重叠 → **本周取消这个块**（不再排到别处），
 * 诊断里只留一条 `info`，**不报 warn**（「存在就说明用户要在课上自习，不算冲突」）。
 * ⚠️ 但**不放宽硬约束 H1** —— 同一时刻仍然不允许两个块。
 *
 * 纯函数：不读时钟、不随机。
 */
import type { LockedPlacement, LockLevel, PlanIssue, TimeBlock, WeekPlan } from '@/types';
import { DAY_NAME } from './construct.ts';
import { makeRoom } from './ripple.ts';

/** 长期锁 key 的前缀 —— 与块锁（`w{周}-…`）靠它区分 */
export type WeekParity = 'odd' | 'even';

/** 第几周 → 奇偶（按**学期周次**算，不是日历周） */
export function weekParity(weekNo: number): WeekParity {
  return weekNo % 2 === 1 ? 'odd' : 'even';
}

/** 长期锁的键：不含周次、不含序号 */
export function longLockKey(weekNo: number, b: TimeBlock): string {
  return `${weekParity(weekNo)}-d${b.dayOfWeek}-${b.kind}-${b.startMin}-${b.endMin}`;
}

export function isLongLockKey(key: string): boolean {
  return key.startsWith('odd-') || key.startsWith('even-');
}

/** 一个长期锁在这一周要落实成的目标时段 */
export interface LongLockTarget {
  key: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  kind: TimeBlock['kind'];
  title: string;
  emoji?: string;
  place?: string;
  room?: string;
}

/**
 * 取出「这一周生效」的长期锁。
 *
 * 两步筛选：
 *   · key 是长期锁形状；
 *   · 奇偶与该周匹配（第 3 周的单周锁不影响第 4 周 —— 用户明确要求的语义）。
 * 逆 Level 必须是 `hard`（软锁是引擎内部的事，不该在这里变成预留）。
 */
export function longLockTargetsFor(
  placements: Record<string, LockedPlacement> | undefined,
  lockLevels: Record<string, LockLevel> | undefined,
  weekNo: number,
): LongLockTarget[] {
  if (!placements || !lockLevels) return [];
  const want = weekParity(weekNo);
  const out: LongLockTarget[] = [];
  for (const key of Object.keys(placements).sort()) {
    if (!isLongLockKey(key) || !key.startsWith(`${want}-`)) continue;
    if (lockLevels[key] !== 'hard') continue;
    const snap = placements[key];
    const m = /^(odd|even)-d(\d)-([a-z]+)-(\d+)-(\d+)$/.exec(key);
    if (!m) continue;
    out.push({
      key,
      dayOfWeek: Number(m[2]),
      startMin: snap.startMin,
      endMin: snap.endMin,
      kind: m[3] as TimeBlock['kind'],
      title: snap.title ?? '你定住的时段',
      emoji: undefined,
      place: snap.place,
      room: snap.room,
    });
  }
  return out.sort((a, b) => (a.dayOfWeek - b.dayOfWeek) || (a.startMin - b.startMin));
}

export interface LongLockApplyResult {
  blocks: TimeBlock[];
  /** 已成功留出的时段 */
  reserved: string[];
  /** 这周被跳过的时段（key）—— 例如撞课 */
  skipped: { key: string; title: string; reason: string }[];
  /** 因让路而被顺延的块（UI 可以把它们标成「被挪了」） */
  displaced: { id: string; fromStartMin: number; toStartMin: number }[];
}

/**
 * 把长期锁的时段**在这周留出来**。
 *
 * 做法不是「排除后再让 construct 重排」（那会让整周都跟着变），
 * 而是构造之后、改进之前**就地放一块并让周围的软块顺延**：
 *   · 与课程重叠 → 本周跳过，只留 info（S1.5）；
 *   · 与软块重叠 → 软块顺延（`ripple`）；顺延不下则从这一天的计划里消失并如实告知。
 *
 * @param dayBounds 当天可用区间（顺延不许越过它）
 */
export function applyLongLocks(
  plan: WeekPlan,
  placements: Record<string, LockedPlacement> | undefined,
  lockLevels: Record<string, LockLevel> | undefined,
  weekNo: number,
  dayBounds: { dayStartMin: number; dayEndMin: number } = { dayStartMin: 7 * 60, dayEndMin: 23 * 60 },
): LongLockApplyResult {
  const targets = longLockTargetsFor(placements, lockLevels, weekNo);
  const base: LongLockApplyResult = {
    blocks: plan.blocks, reserved: [], skipped: [], displaced: [],
  };
  if (targets.length === 0) return base;

  let blocks = [...plan.blocks];
  const reserved: string[] = [];
  const skipped: LongLockApplyResult['skipped'] = [];
  const displaced: LongLockApplyResult['displaced'] = [];
  const issues: PlanIssue[] = [];

  for (const t of targets) {
    // 已经存在一模一样的块（比如用户手动又加了一块）→ 不必重复插入
    if (blocks.some((b) => b.dayOfWeek === t.dayOfWeek && b.startMin === t.startMin
      && b.endMin === t.endMin && b.title === t.title)) {
      reserved.push(t.key);
      continue;
    }
    const block: TimeBlock = {
      id: t.key,
      kind: t.kind,
      dayOfWeek: t.dayOfWeek as TimeBlock['dayOfWeek'],
      startMin: t.startMin,
      endMin: t.endMin,
      title: t.title,
      locked: true,
      source: 'user',
      emoji: t.emoji ?? '🔒',
      place: t.place,
      room: t.room,
      reason: '你定住的时段 —— 这一周的同一个时间去见它',
    };
    const room = makeRoom(blocks, block, dayBounds);
    if (room.blockedByCourse) {
      // S1.5：本周取消这个块，只留 info —— 不报 warn（「在课上自习」不算用户犯错）
      skipped.push({ key: t.key, title: t.title, reason: '这个时段这周有课' });
      issues.push({
        level: 'info',
        code: 'lock-conflict',
        blockId: t.key,
        message: `「${t.title}」这周没排 —— ${DAY_NAME[t.dayOfWeek] ?? `周${t.dayOfWeek}`}这个时段有课，下次不占时间的周次会自动恢复`,
      });
      continue;
    }
    blocks = room.blocks;
    reserved.push(t.key);
    displaced.push(...room.moved);
    for (const id of room.dropped) {
      issues.push({
        level: 'info',
        code: 'lock-conflict',
        blockId: id,
        message: `为了给你定住的时段腾地方，「${id}」这周排不下了（当天塞满）`,
      });
    }
  }

  // issues 是追加式的：这里用 push 是为了让调用方把消息并进 plan.issues
  plan.issues.push(...issues);
  return { blocks, reserved, skipped, displaced };
}
