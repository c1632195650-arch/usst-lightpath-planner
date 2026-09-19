/**
 * 对话场景的一周排程（路线 C2：技术并轨）
 * ============================================================
 * 与「周计划」页**共用同一个引擎**（`planWeek()`），而不是另起一套模板。
 *
 * 为什么必须并轨：旧的那套是硬编码时间的模板（08:00 / 11:45 / 19:00），
 * 不排转场、不读校历、不认用户锁定块。于是同一个 App 里有两套输出，
 * 对话里那份明显更差 —— 用户连着看两处就会发现对不上。这就是「双轨」的破绽。
 * （那套模板 `lib/lbao.ts::lbaoRecommend` 已于 2026-09-19 整体删除，
 *   最后一个残留调用点 `features/week/WeekView.tsx` 也已切到本模块。）
 *
 * 与周计划页的唯一差别是**输出形态**：那边铺完整时间轴，这边只取要点
 * （见 `summarizeWeekPlan`）。**数据同源、呈现分层** ——
 * 「对话给建议、周页给执行」本就是产品设计上该有的分工，不是妥协。
 *
 * ⚠️ 两遍法**不在本文件里手写**：编排统一走 `planner/planWeek.ts`（唯一编排点）。
 *    原先这里与 `features/week/WeekPlanView.tsx` 各抄了一份，同一套逻辑两个副本。
 */
import type { PersonaProfile, Schedule, WeekPlan } from '@/types';
import { toPlanRequest } from '@/lib/planner/schedule';
import { planWeek } from '@/lib/planner/planWeek';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases';
import { TERM_CALENDAR } from '@/constants/term';
import { WEEKDAY_CN } from '@/lib/date';

/** 学期阶段策略来自校历常量。按 `termStart` 反查比写死学年 key 更扛得住换学期。 */
function calendarOf(schedule: Schedule) {
  return (
    Object.values(TERM_CALENDAR).find((c) => c.termStart === schedule.termStart) ??
    TERM_CALENDAR['2026-2027-1']
  );
}

/**
 * 排一周，供对话使用。
 *
 * @returns `null` = 排不了（该周不在学期范围内）→ 调用方应降级为纯引导，**不要编造日程**。
 *
 * 后端未连通时**不失败**：`planWeek` 的降级策略保证仍能给出结果 ——
 * 转场退回跨校区估算值。估算值也远好过硬编码模板，这是与周计划页一致的
 * 降级行为（那边也是 `backendOk=false` 时继续显示）。
 */
export async function planWeekForChat(
  schedule: Schedule,
  profile: PersonaProfile | null,
  weekNo: number,
): Promise<WeekPlan | null> {
  const semester = buildPhasesFromCalendar(schedule, profile, calendarOf(schedule));
  const phase = phaseOfWeek(semester.plan, weekNo);
  if (!phase) return null;

  const base = {
    schedule,
    weekNo,
    policy: phase.policy,
    scenarios: profile?.scenarios ?? null,
  };

  // 两遍法编排统一走公共入口（`planner/planWeek.ts`）。
  // 它内部**动态** import `transfer.ts` —— 转场模块会把后端客户端（lib/api）拉进
  // 模块图，而后者用了 Vite 专有的 `import.meta.env`。静态 import 会让「只想读
  // 排程要点」的测试也被拖进这层依赖；动态 import 顺带让 Vite 把它 code-split。
  // 取不到 provider（如 Node 单测）时它会**降级为单遍**，不会抛错。
  const result = await planWeek(toPlanRequest(base));
  return result.plan;
}

/**
 * 把周计划压成几句可对话的话。
 *
 * **只陈述引擎算出来的事实**，不替用户做决定 —— 「决策层不拍板」是这个产品
 * 既定的智能边界（见项目记忆 §1）。所以这里只输出「哪天满」「哪里紧」
 * 「哪天空」，而不是「你应该把自习挪到周四」。
 */
export function summarizeWeekPlan(plan: WeekPlan): string[] {
  const out: string[] = [];
  const byDay = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    label: WEEKDAY_CN[day % 7],
    blocks: plan.blocks.filter((b) => b.dayOfWeek === day),
  }));

  // 1) 哪天最满 —— 这是「结合你的课表」最直观的证据
  const busiest = [...byDay].sort((a, b) => b.blocks.length - a.blocks.length)[0];
  if (busiest && busiest.blocks.length > 0) {
    out.push(`${busiest.label}最满，排了 ${busiest.blocks.length} 个块`);
  }

  // 2) 时间紧张的地方。直接引用引擎的判定（转场是实测出来的），不在这里重复判断 ——
  //    否则就成了「两处各算一遍」，正是双轨问题的翻版。
  const tight = plan.issues.filter((i) => i.level === 'error' || i.level === 'warn');
  for (const t of tight.slice(0, 2)) out.push(t.message);
  if (tight.length === 0) out.push('走路和转场的余量都在安全范围内');

  // 3) 整天空着的天 —— 对「那我能干点啥」这类追问最有用
  const free = byDay.filter((d) => d.blocks.length === 0).map((d) => d.label);
  if (free.length > 0) out.push(`${free.join('、')}基本空着`);

  // 4) 量的口径：自习总量 + **日均**留白。
  //    刻意不报留白总时长 —— 实测一周能到 63 小时，那个数字看着像系统压根没干活，
  //    日均才是人读得懂的（「每天留出 9 小时」）。
  const h = (min: number) => Math.round((min / 60) * 10) / 10;
  out.push(
    `自习 ${h(plan.stats.studyMin)}h · 日均留白 ${h(plan.stats.blankMin / 7)}h · 共 ${plan.stats.blockCount} 个块`,
  );

  return out;
}
