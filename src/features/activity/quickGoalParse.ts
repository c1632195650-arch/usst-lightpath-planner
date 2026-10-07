/**
 * 一句话目标的截止日期解析（长计划增强计划书 §2.1 前置 · 「系统提议、用户拍板」）
 * ============================================================
 * 解决什么：RAY 输入「在10/31前彻底完成DAAD奖学金申请」后，排程毫无变化 ——
 * 因为 `GoalQuickInput` 建目标**只带标题和类别**，「10/31前」被当成标题文字扔掉了，
 * 目标没有 dueAt/totalHours → 引擎走「每周 60 分钟固定投入」兜底，截止日形同虚设。
 *
 * 本模块只做**日期短语**的提取（不猜内容、不猜时长 —— 计划书 §6.12.2「只预设结构」）：
 *   · 「在10/31前」「10/31前」「在10月31日前」「10月31日号前」
 *   · 提取成功 → dueAt（今年；已过期自动顺延一年），标题剔除该短语；
 *   · 提取失败 → 原样返回（解析失败不挡路，GoalQuickInput 既有原则）。
 * 纯函数：今天的日期由参数注入（与引擎同一纪律）。
 */

export interface ParsedQuickGoal {
  title: string;
  /** ISO 日期（yyyy-mm-dd）；未识别到截止短语 = undefined */
  dueAt?: string;
}

const PHRASES: Array<{ re: RegExp; date: (m: RegExpMatchArray, year: number) => string | null }> = [
  // 10/31前 · 10.31前 · 10-31前 · 10月31日(号)前 —— 分隔符一网打尽（RAY 实测「10.31前」没识别）
  { re: /在?(\d{1,2})[月/.·\-](\d{1,2})[日号]?\s*(之?前|以前)/, date: (m, y) => isoDay(y, Number(m[1]), Number(m[2])) },
  // 10月底前（月底 = 当月最后一天）
  { re: /在?(\d{1,2})月底\s*(之?前|以前)/, date: (m, y) => isoDay(y, Number(m[1]), new Date(Date.UTC(y, Number(m[1]), 0)).getUTCDate()) },
  // 年底前 → 12/31
  { re: /年底\s*(之?前|以前)/, date: (_m, y) => isoDay(y, 12, 31) },
];

/** 年 + 月 + 日 → ISO；无效日期（2 月 30 日等）返回 null —— 不静默滚动到下个月 */
function isoDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseQuickGoal(text: string, todayIso: string): ParsedQuickGoal {
  const trimmed = text.trim();
  const year = Number(todayIso.slice(0, 4));
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  for (const { re, date } of PHRASES) {
    const m = trimmed.match(re);
    if (!m) continue;
    const due = date(m, year);
    if (!due) break; // 日期非法（13 月 40 日）→ 不猜，原样返回
    const dueAt = (() => {
      const d = new Date(`${due}T00:00:00Z`);
      // 已过期的月日 → 顺延一年（「10/31前」在 11 月说，指的是明年）
      if (d.getTime() < today) d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d.toISOString().slice(0, 10);
    })();
    const title = trimmed
      .replace(m[0], ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[，。、,.\s]+|[，。、,.\s]+$/g, '');
    return { title: title.length > 0 ? title : trimmed, dueAt };
  }
  return { title: trimmed };
}

/**
 * 存量目标修补（2026-10-07 RAY 实测 bug：解析上线**前**建的目标，标题里带着
 * 「在10/31前」却缺 dueAt/totalHours → 永远走 Q4 兜底，监测面板报「没有截止/总量」）。
 * 规则：只补**缺** dueAt 且标题里能解析出截止短语的目标；totalHours 也缺才按
 * kind 经验值兜底。已有字段一律不动（显式恒胜）。
 * 纯函数：目标对象进、补全对象出，调用方负责落库。
 */
export interface QuickGoalLike {
  title: string;
  dueAt?: string;
  totalHours?: number;
  kind?: string;
}

export function repairQuickGoal<T extends QuickGoalLike>(goal: T, todayIso: string, hoursByKind: Record<string, number>): T {
  const kind = goal.kind ?? 'study';
  // 二段修补（2026-10-07）：dueAt 已存在、但 totalHours **恰好等于**类型经验值 ——
  // 那是上一版 repair 自动填的未调整痕迹（用户手调过不会恰好撞上经验值），
  // 按「每周 3h 封顶」重算（RAY 实测 40h/3.5 周 = 天天 2 小时把空闲排满）。
  if (goal.dueAt && goal.totalHours != null && goal.totalHours === hoursByKind[kind]) {
    return { ...goal, totalHours: suggestTotalHours(kind, goal.dueAt, todayIso, hoursByKind) };
  }
  if (goal.dueAt) return goal;
  const { title, dueAt } = parseQuickGoal(goal.title, todayIso);
  if (!dueAt) return goal;
  return {
    ...goal,
    title,
    dueAt,
    ...(goal.totalHours == null ? { totalHours: suggestTotalHours(kind, dueAt, todayIso, hoursByKind) } : {}),
  };
}

/**
 * 自动总量：**按截止周数封顶**（2026-10-07 RAY 实测「长目标把空闲排满」）。
 * 类型经验值（study 40h）对短截止目标是天文数字 —— 3.5 周内 40h = 天天 2 小时。
 * 规则：min(类型经验值, 剩余周数 × 每周 3 小时)，下限 2h。
 * 「系统提议」必须是能被接受的小步子，不是把日历填满的定额。
 */
export function suggestTotalHours(
  kind: string,
  dueAt: string,
  todayIso: string,
  hoursByKind: Record<string, number>,
): number {
  const exp = hoursByKind[kind] ?? 20;
  const a = Date.parse(`${todayIso}T00:00:00Z`);
  const b = Date.parse(`${dueAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return Math.min(exp, 6);
  const weeks = Math.max(1, Math.ceil((b - a) / (7 * 86_400_000)));
  return Math.min(exp, Math.max(2, weeks * 3));
}
