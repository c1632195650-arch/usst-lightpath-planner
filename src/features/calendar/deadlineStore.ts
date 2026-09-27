/**
 * 重要日体系（v2 方案 WP11）—— 用户自定义截止日的唯一存储与合并口径
 * ============================================================
 *  · `UserDeadline`：用户记下的重要日（梨宝对话确认写入，或后续 UI 添加）；
 *  · `mergeDeadlines(静态, 用户)`：去重键 **title+date**，同一节点用户版优先 ——
 *    合并结果交给 `expandDeadlines` 反向展开成准备块；
 *  · `upcomingDeadlines`：未来 n 个节点（周计划「接下来」横排消费）。
 *
 * 铁律（core §4）：记下重要日**不自动重排**，只出问询 —— 下次重排时
 * `expandDeadlines` 自然吃到准备块。纯函数部分不碰 localStorage，可直测。
 */
import type { Deadline } from '@/data/usst';

/** 用户重要日（与 usst.ts 静态 Deadline 的扁平差异：prep 三参数摊平 + source 溯源） */
export interface UserDeadline {
  id: string;
  title: string;
  /** ISO 日期（YYYY-MM-DD） */
  date: string;
  /** 提前多少天开始准备（>0 才产生准备块） */
  leadDays?: number;
  /** 单块时长（分钟） */
  blockMin?: number;
  /** 总准备时长（小时） */
  prepHours?: number;
  source: 'static' | 'user';
}

const KEY = 'usst.libao.deadlines.v1';

function readStore(): UserDeadline[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (d): d is UserDeadline =>
        !!d && typeof d === 'object' &&
        typeof (d as UserDeadline).id === 'string' &&
        typeof (d as UserDeadline).title === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(String((d as UserDeadline).date)),
    );
  } catch {
    return [];
  }
}

function writeStore(list: UserDeadline[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[deadlineStore] 写入失败', e);
  }
}

export function loadUserDeadlines(): UserDeadline[] {
  return readStore();
}

/** 记下一条重要日（title 归一去空白；同 title+date 已存在时不重复记）。返回最新全表。 */
export function addUserDeadline(d: Omit<UserDeadline, 'id' | 'source'> & { id?: string }): UserDeadline[] {
  const title = d.title.trim();
  const list = readStore();
  if (list.some((x) => x.title === title && x.date === d.date)) return list;
  const id = d.id ?? `ud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const next = [...list, { ...d, title, id, source: 'user' as const }];
  writeStore(next);
  return next;
}

export function removeUserDeadline(id: string): UserDeadline[] {
  const next = readStore().filter((d) => d.id !== id);
  writeStore(next);
  return next;
}

/** 用户条目 → 静态 Deadline 形状（喂 expandDeadlines）。没有准备参数 = 纯提醒。 */
export function userDeadlineToDeadline(u: UserDeadline): Deadline {
  const leadDays = u.leadDays ?? 0;
  const blockMin = u.blockMin ?? 0;
  const prep = leadDays > 0 && blockMin > 0
    ? {
        leadDays,
        blockMin,
        prepHours: u.prepHours ?? 3,
        taskTitle: `${u.title}·准备`,
      }
    : undefined;
  return {
    id: u.id,
    date: u.date,
    title: u.title,
    emoji: '📌',
    tag: '我的',
    color: '#C24B3A',
    ...(prep ? { prep } : {}),
  };
}

/**
 * 静态校历 ∪ 用户重要日 —— 去重键 **title+date**，同一节点用户版优先
 * （用户自己记的比校历更懂他的安排）。结果按日期排序，确定性输出。
 */
export function mergeDeadlines(staticList: readonly Deadline[], user: readonly UserDeadline[]): Deadline[] {
  const userConverted = user.map(userDeadlineToDeadline);
  const seen = new Set(userConverted.map((d) => `${d.title}|${d.date}`));
  const kept = staticList.filter((d) => !seen.has(`${d.title}|${d.date}`));
  return [...userConverted, ...kept].sort((a, b) => a.date.localeCompare(b.date));
}

/** 未来 n 个节点（默认 3）：date >= today，按日期升序，附剩余天数。 */
export function upcomingDeadlines(
  list: readonly Deadline[],
  today: string,
  n = 3,
): Array<{ deadline: Deadline; daysLeft: number }> {
  return list
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, n)
    .map((d) => ({
      deadline: d,
      daysLeft: Math.round((Date.parse(d.date) - Date.parse(today)) / 86400000),
    }));
}

/** V1-3：紧急度三档（≤3 天红 / ≤7 天橙 / 其余灰）。纯函数。 */
export type UrgencyLevel = 'red' | 'orange' | 'gray';
export function urgencyLevel(daysLeft: number): UrgencyLevel {
  if (daysLeft <= 3) return 'red';
  if (daysLeft <= 7) return 'orange';
  return 'gray';
}
