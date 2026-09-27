/**
 * V0-3：总览 onboarding checklist —— 纯模型
 * ============================================================
 * 三条待办（导入课表 / 选节奏 / 记重要日）→ 完成一条亮一个勾，
 * 全部完成整卡隐藏。状态来源由调用方注入（state.schedule / state.lifeMode /
 * loadUserDeadlines），本文件不碰 localStorage —— node --test 可直跑。
 */

export type ChecklistKey = 'importCourse' | 'lifeMode' | 'deadline';

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  actionLabel: string;
  done: boolean;
}

export interface ChecklistInput {
  /** 已有真实课表（state.schedule 非空；MOCK 兜底不算） */
  hasSchedule: boolean;
  /** 已选生活模式（state.lifeMode 非空） */
  lifeMode: string | null;
  /** 用户自记重要日条数（静态校历不算 —— 那不是「我的」节点） */
  userDeadlineCount: number;
}

export interface ChecklistResult {
  items: ChecklistItem[];
  doneCount: number;
  allDone: boolean;
}

/** 确定性纯函数：同输入必得同输出 */
export function checklistStatus(input: ChecklistInput): ChecklistResult {
  const items: ChecklistItem[] = [
    {
      key: 'importCourse',
      label: '导入课表 —— 日程的素材从这里来',
      actionLabel: '去导入',
      done: input.hasSchedule,
    },
    {
      key: 'lifeMode',
      label: '选一个生活节奏 —— 决定这一周怎么排',
      actionLabel: '选个节奏',
      done: input.lifeMode != null && input.lifeMode !== '',
    },
    {
      key: 'deadline',
      label: '记一个重要日 —— 梨宝帮你倒排准备',
      actionLabel: '加个重要日',
      done: input.userDeadlineCount > 0,
    },
  ];
  const doneCount = items.filter((i) => i.done).length;
  return { items, doneCount, allDone: doneCount === items.length };
}
