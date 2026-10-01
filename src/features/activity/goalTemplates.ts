/**
 * 目标模板 + 兴趣追问命中判定（总览页改版 批次 5 · 量化一期）
 * ============================================================
 * 一期不做联网搜索：内置常见竞赛/目标的「经验投入曲线」，
 * 用户选模板或手填，先跑通「问卷 → 弹窗 → 目标 → 排程」全链路；
 * 二期接梨宝（`features/libao/`）做「搜课程 → 估时间」的辅助生成。
 *
 * 🔴 模板只是**预填建议**：标题/截止/总时长/节奏全部可改；
 *    落地后就是普通 Goal（source:'auto'），GoalEditor 可改可删。
 *
 * 命中判定（RAY 拍板范围）：问卷里 D01/D02/B01 三题沾边——
 *   · D01（FC）：「看到机会第一反应是兴奋想报名」（key 'A'）
 *   · D02（L5）：「愿意为长远目标放弃现在的享乐」≥4
 *   · B01（L5）：「成绩和履历是最在意的事，选课/竞赛/实习围着转」≥4
 * 任一命中即弹兴趣追问（可跳过，跳过不再纠缠）。
 */
import type { AnswerMap } from '@/types';
import type { Goal, GoalKind, GoalPace } from './goalStore';

export interface GoalTemplate {
  id: string;
  /** 预填标题（可改） */
  title: string;
  kind: GoalKind;
  emoji: string;
  /** 建议总投入（小时）→ Goal.totalHours（分解算法的总量来源） */
  suggestedHours: number;
  /** 建议截止（ISO）；没有通用日期就留空让用户填 —— 不猜 */
  suggestedDueAt?: string;
  pace: GoalPace;
  /** 文字版阶段计划（隐性备赛计划），确认前展示给用户 */
  planText: string;
}

export const GOAL_TEMPLATES: readonly GoalTemplate[] = [
  {
    id: 'mcm',
    title: '数学建模国赛备赛',
    kind: 'contest',
    emoji: '🧮',
    suggestedHours: 80,
    pace: 'both',
    planText: '组队与选题练习（前 1/3）→ 真题模拟与论文写作训练（中期）→ 赛前全真模拟冲刺（最后 3 周）',
  },
  {
    id: 'dianzu',
    title: '电子设计竞赛备赛',
    kind: 'contest',
    emoji: '⚡',
    suggestedHours: 100,
    pace: 'sprint',
    planText: '基础模块搭建（电源/信号/控制）→ 专题练手（控制类/仪器类二选一）→ 赛前四天三夜全真演练',
  },
  {
    id: 'cet',
    title: '四六级备考',
    kind: 'study',
    emoji: '📝',
    suggestedHours: 40,
    suggestedDueAt: '2026-12-12',
    pace: 'steady',
    planText: '词汇打底 + 每周 2 套真题听力 → 阅读专项与错题精读 → 考前两周作文模板与全真模拟',
  },
  {
    id: 'kaoyan',
    title: '考研初试备考',
    kind: 'study',
    emoji: '🎯',
    suggestedHours: 300,
    suggestedDueAt: '2026-12-26',
    pace: 'steady',
    planText: '基础轮（教材+全书）→ 强化轮（专题+真题一刷）→ 冲刺轮（真题二刷+政治大题+模拟考）',
  },
  {
    id: 'lanqiao',
    title: '蓝桥杯备赛',
    kind: 'contest',
    emoji: '💻',
    suggestedHours: 40,
    pace: 'both',
    planText: '语言基础与刷题入门 → 省赛真题分类刷（动态规划/搜索/数学）→ 赛前模拟赛复盘',
  },
] as const;

/** 问卷命中判定（纯函数）：任一命中即弹兴趣追问 */
export function interestAskHit(answers: AnswerMap): boolean {
  if (answers['D01'] === 'A') return true;
  for (const id of ['D02', 'B01']) {
    const v = answers[id];
    if (typeof v === 'number' && v >= 4) return true;
  }
  return false;
}

/** 模板 → Goal（source:'auto'；id 由调用方给，保持 goalStore 的 id 工厂唯一入口） */
export function templateToGoal(
  t: GoalTemplate,
  over: { title: string; dueAt?: string; totalHours: number; pace: GoalPace },
  id: string,
): Goal {
  return {
    id,
    title: over.title || t.title,
    emoji: t.emoji,
    kind: t.kind,
    source: 'auto',
    totalHours: over.totalHours,
    ...(over.dueAt ? { dueAt: over.dueAt } : {}),
    pace: over.pace,
  };
}
