/**
 * 周计划视图的模块级工具（F2d/A5 从 WeekPlanView 拆出，纯函数可单测）
 */
import { unionAffectedDays } from '@/lib/planner/localizedReplan';

/**
 * 星期显示名 —— **真源已搬到 `lib/date.ts`**（2026-09-21 P2-5 去重），此处只做转发。
 *
 * 搬家的原因：同一份字面量在仓里有 8 处副本，涵盖前端各域**与排程引擎**
 * （`lib/planner/incremental.ts`、`roll.ts`），而 `lib/**` 不得 import `features/**`
 * —— 共同上游只能落在 `lib/`。
 * 保留这条转发是因为周视图三处（`useWeekPlan` / `useWeekPlanDrag` / `WeekPlanView`）
 * 本来就从这个模块取用它，改路径没有收益、只有 churn 风险。
 * 其它域（如 `features/activity`）请**直接**从 `@/lib/date` 取，别绕到这里（否则会新增跨域依赖）。
 */
export { DAY_LABELS } from '@/lib/date';

/**
 * 「现在几点」→ 当日绝对分钟。UI 层读时钟是允许的（引擎层不许，见规格书纯函数纪律）。
 *
 * 取整到 **5 分钟**而不是精确到分：否则用户 14:03 打开页面、14:04 刷新，
 * `fromNow` 变了 → 引擎重排 → 一整列块微调，看起来像「页面自己乱动」。
 * 对齐到 5 分钟档位后，同一档内多次重排结果一致。
 */
export function nowMinutes(): number {
  const d = new Date();
  const raw = d.getHours() * 60 + d.getMinutes();
  return Math.floor(raw / 5) * 5;
}

/**
 * 两份滚动状态是否等价 —— 用来避免无意义的持久化写入。
 *
 * 为什么不直接 `JSON.stringify` 比较：`rolling.upcoming` 是数组，
 * 顺序理论上稳定，但直接用字符串比较会因任何字段顺序差异误判为「变了」，
 * 从而多写一次 localStorage 并触发下一轮渲染。逐字段比更准也更省。
 */
export function sameRolling(
  a: import('@/types').PlanPersistState['rolling'],
  b: import('@/types').PlanPersistState['rolling'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.recentLoad.length !== b.recentLoad.length) return false;
  for (let i = 0; i < a.recentLoad.length; i++) {
    if (a.recentLoad[i] !== b.recentLoad[i]) return false;
  }
  if (a.loadByDow.length !== b.loadByDow.length) return false;
  for (let i = 0; i < a.loadByDow.length; i++) {
    if (a.loadByDow[i] !== b.loadByDow[i]) return false;
  }
  if (a.upcoming.length !== b.upcoming.length) return false;
  for (let i = 0; i < a.upcoming.length; i++) {
    const x = a.upcoming[i];
    const y = b.upcoming[i];
    if (x.id !== y.id || x.dueAtWeek !== y.dueAtWeek || x.urgency !== y.urgency) return false;
  }
  return true;
}

/**
 * R6.1：这次排程「受影响的天」是哪些 —— `null` = 没有定点诉求，整周重排。
 * 任一改动说不清哪天，就退回整周重排 —— **宁可多排不可漏排**。
 *
 * ⚠️ **2026-09-21（P2-5）修了两个洞**，修之前这个函数的注释与实现不一致：
 *
 *   ① **`applied` 被 `void` 掉、从未参与计算**，而调用方确实在传它
 *      （`useWeekPlan.ts:296` → `localizedDaysFor(curLayer, curDerived.applied, weekNo)`）。
 *      后果：**只改了调课/停课**时，被调课那天可能不进融合范围 → 局部融合留下**旧块**。
 *      修法：`applyCourseOverrides` 的 `AppliedOverride` 补出 `day`（原节次的天）
 *      与 `newDay`（调课后的天，跨天调课时两天都要重排），这里据实并入。
 *
 *   ② **`if (t.dayOfWeek != null)` 让没写星期的任务被静默跳过** —— 既不定点、也不回落整周，
 *      与上面那句「说不清哪天就退回整周重排」直接矛盾。
 *      `UserTask.dayOfWeek` 的语义是「不给 = 本周每天都可参与」⟹ 它**可能落在任意一天**，
 *      根本没法定点 → 按注释的本意返回 `null`（整周重排）。这比原来"假装它不影响任何天"更保守也更诚实。
 */
export function localizedDaysFor(
  layer: { slots: Array<{ days?: number[] }>; moves: Array<{ weekNo: number; dayOfWeek: number }>; tasks: Array<{ dayOfWeek?: number | null }> },
  /** 本周实际生效的调课/停课（`applyCourseOverrides().applied`）—— 跨天调课时 `day` 与 `newDay` 都要算 */
  applied: ReadonlyArray<{ id: string; courseName: string; day?: number; newDay?: number }>,
  weekNo: number,
): number[] | null {
  const rules: Array<{ days?: number[] }> = [];
  for (const s of layer.slots) rules.push({ days: s.days });
  for (const m of layer.moves) if (m.weekNo === weekNo) rules.push({ days: [m.dayOfWeek] });
  for (const t of layer.tasks) {
    // 没写星期 = 哪一天都有可能（见上方 ②）→ 整周重排
    if (t.dayOfWeek == null) return null;
    rules.push({ days: [t.dayOfWeek] });
  }
  for (const ov of applied) {
    const days = [ov.day, ov.newDay].filter(
      (d): d is number => typeof d === 'number' && d >= 1 && d <= 7,
    );
    if (days.length > 0) rules.push({ days });
  }
  return unionAffectedDays(rules, weekNo);
}

/**
 * 今天列的整列底色（T3 时间轴 · WeekTimelineGrid 列头/泳道用）。
 * 值 = 原型真机实测 rgb(159,173,208)；对比度跟进项见 `_T3落地设计-2026-10-07.md` §4.4。
 */
export const TODAY_COL_BG = '#9fadd0';
