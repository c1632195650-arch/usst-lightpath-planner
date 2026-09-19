/**
 * 「自动顺延」（Ripple）—— 给一个时段让出地方
 * ============================================================
 * 场景：某件事要落在 [start, end)，而这段时间已经被别的块占着 ——
 *   这些块要**往后排队**，而不是被删掉或硬挤重叠。
 *
 * 两条使用者：
 *   · **S1 定住跨周**：长期锁的时段要在后续周次里留出来
 *   · **R1 拖拽**：用户把一块拖到某个位置
 * 两者本质是同一件事，所以只有这一份实现 —— 各写一份必然漂移。
 *
 * ── 三条规矩（计划书 §二-4）──────────────────────────────────
 *   1. **课程永不动**（`kind==='course'` 或 `source==='course'`）：它是既成事实，
 *      顺延遇到它就**跳过去**（从它后面接着排），试图挪课只会排不出有意义的方案。
 *   2. **只在同一天内顺延**：把溢出推到第二天等于偷偷改变用户的安排，禁止。
 *   3. **放不下就报 `dropped`**，由调用方决定怎么告诉用户 ——
 *      这里**绝不**制造重叠（硬约束 H1 是验收基准，破了就没有意义了）。
 *
 * 纯函数：不读时钟、不随机、同输入必得同输出。
 */
import type { TimeBlock } from '@/types';

/** 一个已被挪动的块：原 starting minute → 新 starting minute */
export interface RippleMove {
  id: string;
  fromStartMin: number;
  toStartMin: number;
}

export interface RippleResult {
  /** 新的块集合（含新增/未动的块） */
  blocks: TimeBlock[];
  /** 被顺延的块（可直接转成 `MoveRecord{ source:'ripple' }`） */
  moved: RippleMove[];
  /** 塞不下的块 id —— 调用方必须如实告诉用户 */
  dropped: string[];
  /** 目标时段被课程占着（一个块都没动，由调用方决定怎么处置） */
  blockedByCourse: boolean;
}

export interface RippleOptions {
  /** 当天最早时间（默认 07:00 —— 与 `construct` 的 `dayStart` 默认值一致） */
  dayStartMin?: number;
  /** 当天最晚时间（默认 23:00） */
  dayEndMin?: number;
  /** 相邻块之间留的最小间隔（默认 0 —— 顺延是压缩情境，硬塞最少 enforcement） */
  minGap?: number;
}

const overlap = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;
const isCourse = (b: TimeBlock) => b.kind === 'course' || b.source === 'course';
const duration = (b: TimeBlock) => Math.max(0, b.endMin - b.startMin);

/**
 * 把 `target` 放进 `blocks` 所在的这一天，占不到的块往后顺延。
 *
 * @param target 要落位的块（可以是**新块**，也可以是要搬家的既有块）
 * @param blocks 当前**整天**的块（含 course；course 永远保持在原位）
 */
export function makeRoom(
  blocks: readonly TimeBlock[],
  target: TimeBlock,
  opts: RippleOptions = {},
): RippleResult {
  const dayStartMin = opts.dayStartMin ?? 7 * 60;
  const dayEndMin = opts.dayEndMin ?? 23 * 60;
  const gap = opts.minGap ?? 0;

  const day = target.dayOfWeek;
  const others = blocks.filter((b) => b.dayOfWeek === day && b.id !== target.id);
  const courseBlocks = others.filter(isCourse);
  const movable = others.filter((b) => !isCourse(b));

  const moved: RippleMove[] = [];
  const dropped: string[] = [];

  /**
   * 「目标块能不能在这儿站住」—— 与课程冲突时调用方另有处置（S1 是本周跳过），
   * 这里只需给出判断，不替上层做决定。
   */
  const blockedByCourse = courseBlocks.some(
    (c) => overlap(target.startMin, target.endMin, c.startMin, c.endMin),
  );
  if (blockedByCourse) {
    // 与课程冲突：一个块都不动，由调用方处置（S1 = 本周跳过，拖拽 = 拒绝落位）
    return { blocks: [...blocks], moved, dropped, blockedByCourse: true };
  }

  const hitlist = movable
    .filter((b) => overlap(target.startMin, target.endMin, b.startMin, b.endMin))
    .sort((a, b) => a.startMin - b.startMin);

  // 没人挡路 → 直接插入，一个块都不动（最常见的情况，别做无谓的重排）
  if (hitlist.length === 0) {
    return {
      blocks: [...blocks, target]
        .sort((a, b) => (a.dayOfWeek - b.dayOfWeek) || (a.startMin - b.startMin)),
      moved,
      dropped,
      blockedByCourse: false,
    };
  }

  /**
   * 重新排队：从**第一个被挡的块**起，把它后面的可动块依次往新的位置放。
   *
   * 为什么是这一段而不是只挪挡路的那几个：挪了 A 之后 A 可能压到原本在它后面的 B，
   * 只挪 A 会制造新的重叠。所以从第一个受影响者开始整段重排 —— 这也是为什么
   * 「 blockade 后面没挡路但位置更晚的块」也在 `tail` 里。
   */
  const sortedMovable = [...movable].sort((a, b) => a.startMin - b.startMin);
  const firstIdx = sortedMovable.findIndex((b) => hitlist.some((h) => h.id === b.id));
  /** 排在目标之前的自查块：它们不受影响，原样留下 */
  const keep = sortedMovable.slice(0, firstIdx);
  const tail = sortedMovable.slice(firstIdx);

  const placed: TimeBlock[] = [...keep, target];
  let cursor = target.endMin;

  for (const b of tail) {
    const dur = duration(b);
    // 起点不能早于「上一件事的结束 + 间隔」，也尽量保留原本的时刻（能不动就不动）
    let start = Math.max(b.startMin, cursor + (placed.length > 1 ? gap : 0));

    // 遇到课程就跳过它后面接着排 —— 课程既不参与排队，也不许被压
    for (const c of courseBlocks) {
      if (start < c.endMin && c.startMin < start + dur) start = c.endMin;
    }
    if (start < dayStartMin) start = dayStartMin;

    if (start + dur > dayEndMin) {
      dropped.push(b.id);
      continue;
    }
    if (start !== b.startMin) moved.push({ id: b.id, fromStartMin: b.startMin, toStartMin: start });
    const next: TimeBlock = { ...b, startMin: start, endMin: start + dur };
    placed.push(next);
    cursor = next.endMin;
  }

  // 组装：其它天原样 + 本天的课程原位 + 本天排队结果（含新落位的 target）
  const resultBlocks: TimeBlock[] = [
    ...blocks.filter((b) => b.dayOfWeek !== day),
    ...courseBlocks,
    ...placed,
  ].sort((a, b) => (a.dayOfWeek - b.dayOfWeek) || (a.startMin - b.startMin));

  return { blocks: resultBlocks, moved, dropped, blockedByCourse: false };
}

/**
 * 「补上来」（删除后的空档填补，2026-09-19）
 * ============================================================
 * 用户删掉一块后，空档怎么处理由用户选（弹窗三选一）；选「补上来」就调这里。
 *
 * ── 移动规则（用户拍板，2026-09-19 补充后不得偏离）────────────
 *   · **参与前移**：自习 / 活动 / 用户手动加的事（真正的「软事」）；
 *   · **纹丝不动**：**课程**（既成事实）与**三餐**（生理锚点）；
 *   · 前移撞到**课程** → 跳过它的时段从后面接着排（跨过上午的课收块是合理的）；
 *   · 前移撞到**三餐 → 就地停止**：三餐是日程的**硬分界（屏障）**，
 *     绝不允许跨过一餐把更晚的块拉上来 —— 否则「午休」会被拉进早餐时段，
 *     时间对了，语义全错（实测教训，2026-09-19）；
 *   · **只往前挪**：某个块前移不了就保持原位，绝不把任何块往后推。
 *
 * 纯函数：产出新位置的记录列表，由调用方转成 `MoveRecord{ source:'ripple' }`。
 */
export interface FillMove {
  blockId: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
}

export function fillGap(
  blocks: readonly TimeBlock[],
  day: number,
  gapStart: number,
  gapEnd: number,
  deletedId?: string,
  opts: RippleOptions = {},
): FillMove[] {
  const dayStartMin = opts.dayStartMin ?? 7 * 60;
  // 只往前挪，不会越过 dayEnd —— 不需要下界参数；保留 opts 与 makeRoom 对齐
  void opts;

  const isFixed = (b: TimeBlock) =>
    b.kind === 'course' || b.source === 'course' || b.kind === 'meal';

  const dayBlocks = blocks.filter((b) => b.dayOfWeek === day && b.id !== deletedId);
  const fixed = dayBlocks.filter(isFixed);

  /**
   * 🔴 **三餐屏障**：空档之后的第一餐是前移的硬边界。
   * 屏障之后的块完全不参与（不能跨过午饭把午休拉进早餐 —— 实测教训）；
   * 屏障之前的块参与填补，且放置结果不许越过屏障。
   */
  const mealStarts = dayBlocks
    .filter((b) => b.kind === 'meal' && b.startMin >= gapStart)
    .map((b) => b.startMin);
  const barrier = mealStarts.length ? Math.min(...mealStarts) : Infinity;

  const movable = dayBlocks
    .filter((b) => !isFixed(b) && b.startMin >= gapStart && b.startMin < barrier)
    .sort((a, b) => a.startMin - b.startMin);

  const out: FillMove[] = [];
  let cursor = gapStart;

  for (const m of movable) {
    const dur = m.endMin - m.startMin;
    let start = cursor;
    // 撞到课程 → 跳到它后面接着试（循环处理连续多个固定块）
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of fixed) {
        if (f.kind === 'meal') continue; // 餐次不参与「跳过」—— 它是屏障
        if (start < f.endMin && f.startMin < start + dur) {
          start = f.endMin;
          changed = true;
        }
      }
    }
    if (start < dayStartMin) start = dayStartMin;

    // 三餐屏障：放不下屏障之前的完整区间 → 这个块和它后面的块都不再挪
    if (start + dur > barrier) break;

    // 只在「确实比原来早」时才挪 —— 否则保持原位（补空绝不把块往后推）
    if (start < m.startMin) {
      out.push({ blockId: m.id, dayOfWeek: m.dayOfWeek, startMin: start, endMin: start + dur });
      cursor = start + dur;
    } else {
      cursor = Math.max(cursor, m.endMin);
    }
  }
  return out;
}

/**
 * **拖拽**（R1）的落位计算 —— 把一块送到 `targetDay` 的 `startMin`。
 *
 * ⚠️ 关键：**`blockId` 保持原样**（id 是「逻辑身份」）。
 *    拖到另一天后重写 id 的 `d` 段，会让引擎认成「删一个 + 新增一个」
 *    → churn 虚高、锁失效（R1.3）。这里只输出新位置，身份不动。
 *
 * @returns `ok=false` 时必须如实告诉用户原因，**不落位**（放不下也不能制造重叠）
 */
export interface DragRecord {
  blockId: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  /** `drag` = 用户拖的那块（hard）；`ripple` = 被它挤开的（soft） */
  source: 'drag' | 'ripple';
}

export interface DragResult {
  ok: boolean;
  reason?: string;
  records: DragRecord[];
  /** 放不下而被拿掉的块 id（UI 要提示） */
  dropped: string[];
}

export function dragTo(
  blocks: readonly TimeBlock[],
  blockId: string,
  targetDay: number,
  startMin: number,
  opts: RippleOptions = {},
): DragResult {
  const src = blocks.find((b) => b.id === blockId);
  if (!src) return { ok: false, reason: '没有这一块', records: [], dropped: [] };
  if (src.kind === 'course' || src.source === 'course') {
    return { ok: false, reason: '课程不能拖 —— 要改课程时间请用「调课」', records: [], dropped: [] };
  }

  const dur = duration(src);
  // 落点吸附到 10 分钟（计划书 §二-4）：日程粒度不需要更细，
  // 而且不吸附会让每次拖拽的位置都不同，用户觉得不稳。
  const snapped = Math.round(startMin / 10) * 10;
  const target: TimeBlock = {
    ...src,
    dayOfWeek: targetDay as TimeBlock['dayOfWeek'],
    startMin: snapped,
    endMin: snapped + dur,
  };
  const room = makeRoom(blocks, target, opts);

  if (room.blockedByCourse) {
    return { ok: false, reason: '那个时段有课，课不能让位', records: [], dropped: [] };
  }
  if (room.dropped.length > 0) {
    return {
      ok: false,
      reason: `放不下：有 ${room.dropped.length} 处活动被挤出这一天`,
      records: [],
      dropped: room.dropped,
    };
  }

  const records: DragRecord[] = [
    { blockId, dayOfWeek: targetDay, startMin: snapped, endMin: snapped + dur, source: 'drag' },
    ...room.moved.map((m) => {
      const b = blocks.find((x) => x.id === m.id)!;
      return {
        blockId: m.id,
        dayOfWeek: b.dayOfWeek,
        startMin: m.toStartMin,
        endMin: m.toStartMin + duration(b),
        source: 'ripple' as const,
      };
    }),
  ];
  return { ok: true, records, dropped: [] };
}

/**
 * 同上，但只在这一天**确实放得下**时才返回（`dropped` 为空）。
 * 调用方（拖拽）用它做校验：放不下就别落位，而不是落到一半。
 */
export function canMakeRoom(
  blocks: readonly TimeBlock[],
  target: TimeBlock,
  opts: RippleOptions = {},
): boolean {
  const r = makeRoom(blocks, target, opts);
  return r.dropped.length === 0 && !r.blockedByCourse;
}
