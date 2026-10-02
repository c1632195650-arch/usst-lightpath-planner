/**
 * 光溯移动端 · 本地重算管线（方案 §7.2）
 * ============================================================
 * 「权威状态 = SyncState」：手机上没有画像（SyncState 不含 persona，方案 §5.1 的
 * 既有取舍），这里用**同步过来的** schedule + planState + userOverrides 重算视图。
 *
 * 与网页端 WeekPlanView 的差异（如实申报，均为 v1 取舍）：
 *   · persona / scenarios → null（不在同步载荷里）；
 *   · 校历事件 / 目标 / 天气 → 不进 tasks（这些是网页端本地数据，未同步）；
 *   · 转场 → planWeek 无注入时自动走后端批量问路、失败降级估算（引擎既有路径）。
 * 结果：重算布局以「课表 + 覆盖层 + 锁」为准；画像差异导致的微调留白天接 persona 同步。
 */
import type { Schedule, TimeBlock, WeekPlan } from '@/types';
import type { PlanPersistState } from '@/types';
import type { UserPlanLayer, MoveRecord } from '@/features/week/userPlanStore';
import { movesOfWeek } from '@/features/week/userPlanStore';
import { assignmentsOfWeek } from '@/features/week/assignmentStore';
import { applyCourseOverrides } from '@/lib/planner/courseOverrides';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases';
import { TERM_CALENDAR } from '@/constants/term';
import { toPlanRequest } from '@/lib/planner/schedule';
import { planWeek } from '@/lib/planner/planWeek';
import type { UserTask } from '@/lib/planner/templates';

export interface RecomputeInput {
  schedule: Schedule;
  weekNo: number;
  planState: PlanPersistState | null;
  layer: UserPlanLayer;
}

/** 锁的两半（与 WeekPlanView R2 同构）：edit/drag → hard、ripple → soft */
function mergeLocks(planState: PlanPersistState | null, layer: UserPlanLayer, weekNo: number) {
  const lockLevels: Record<string, 'hard' | 'soft' | 'free'> = { ...(planState?.locks ?? {}) };
  const lockedPlacements: Record<string, { dayOfWeek: number; startMin: number; endMin: number; place?: string; room?: string }> = {
    ...(planState?.lockedPlacements ?? {}),
  };
  const moveMap = movesOfWeek(layer.moves, weekNo);
  for (const [id, m] of moveMap) {
    lockLevels[id] = m.source === 'ripple' ? 'soft' : 'hard';
    lockedPlacements[id] = {
      dayOfWeek: m.dayOfWeek,
      startMin: m.startMin,
      endMin: m.endMin,
      ...(m.place !== undefined ? { place: m.place } : {}),
      ...(m.room !== undefined ? { room: m.room } : {}),
    };
  }
  return { lockLevels, lockedPlacements };
}

/** 作业 → UserTask（WeekPlanView T6 同款映射：priority 78、不设 essential） */
function assignmentTasks(layer: UserPlanLayer, weekNo: number): UserTask[] {
  return assignmentsOfWeek(layer.assignments, weekNo).map((a): UserTask => ({
    id: a.id,
    title: `${a.courseTitle} 作业`,
    emoji: '📝',
    kind: 'study',
    durationMin: a.estimatedMin,
    weeks: [weekNo],
    priority: 78,
    note: `课程作业 —— 预计 ${a.estimatedMin} 分钟（你自己填的）`,
  }));
}

/**
 * 本地重算一整周。失败返回 null（调用方给「重算失败」空态，不给假数据）。
 */
export async function recomputeWeek(input: RecomputeInput): Promise<WeekPlan | null> {
  const { schedule, weekNo, planState, layer } = input;

  // R3 同款：调课/停课 → 派生课表（原始 schedule 不动）
  const { schedule: effectiveSchedule } = applyCourseOverrides(schedule, layer.courseOverrides, weekNo);

  // 阶段策略：校历常量 + 空画像（buildPhases 本身就是纯函数，null persona 有兜底路径）
  const calendar = TERM_CALENDAR[schedule.semesterName];
  const semester = buildPhasesFromCalendar(effectiveSchedule, null, calendar);
  const phase = phaseOfWeek(semester.plan, weekNo) ?? semester.plan.phases[semester.plan.phases.length - 1];
  if (!phase) return null;

  // 用户任务：与网页端同一周过滤口径（weeks 空 = 全学期）
  const userTasks = layer.tasks.filter((t) => !t.weeks?.length || t.weeks.includes(weekNo));
  const tasks: UserTask[] = [...userTasks, ...assignmentTasks(layer, weekNo)];

  const { lockLevels, lockedPlacements } = mergeLocks(planState, layer, weekNo);

  // 跨周负荷：只有 throughWeek < 被排周次才喂给引擎（types.ts 既有规则，防本周自指）
  const rolling = planState?.rolling;
  const safeRolling = rolling && typeof rolling.throughWeek === 'number' && rolling.throughWeek < weekNo
    ? rolling
    : null;

  const req = {
    ...toPlanRequest({
      schedule: effectiveSchedule,
      weekNo,
      policy: phase.policy,
      scenarios: null,
      persona: null,
      tasks,
    }),
    lockLevels,
    lockedPlacements,
    mealAutoPlace: true,
    unavailable: layer.slots.map((s) => ({
      id: s.id,
      days: s.days,
      fromMin: s.fromMin,
      toMin: s.toMin,
      weeks: s.weeks,
      createdAtWeek: s.createdAtWeek,
      ...(s.title !== undefined ? { title: s.title } : {}),
    })),
    rolling: safeRolling,
    excludedBlockIds: [...layer.excluded],
  };

  try {
    const result = await planWeek(req);
    return result.plan;
  } catch (e) {
    console.warn('[mobile] 本地重算失败：', e);
    return null;
  }
}

/** 今天之后还有哪些块在「今天这条时间轴」上（F4「顺延下一块」/ F5 用） */
export function nextUpcoming(blocks: readonly TimeBlock[], nowMin: number, doneIds: ReadonlySet<string>): TimeBlock | null {
  const pending = blocks.filter((b) => b.endMin > nowMin && !doneIds.has(b.id));
  pending.sort((a, b) => a.startMin - b.startMin);
  return pending[0] ?? null;
}

/** 单块顺延的覆盖层记录（§7.3：{startMin: +Δ, endMin: +Δ}；blockId 语义不变） */
export function shiftMove(m: MoveRecord, deltaMin: number): MoveRecord {
  return { ...m, startMin: m.startMin + deltaMin, endMin: m.endMin + deltaMin };
}
