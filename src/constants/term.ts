/**
 * 学期校历
 *
 * termStart = 学期第一周的**周一**，排程引擎靠它把「第 N 周」换算成具体日期。
 * 这个值教务 PDF 里没有，只能来自校历 —— 所以它必须有据可查，不能拍脑袋。
 *
 * ⚠️ 每年都要补新学年的条目。补的时候把来源链接写进 source，别只写日期。
 */

export interface TermCalendar {
  /** 学期 key，与教务文件名一致，如「徐朗睿(2026-2027-1)课表.pdf」里的 2026-2027-1 */
  key: string;
  /** 学期第一周的周一，"YYYY-MM-DD" */
  termStart: string;
  /** 总教学周 */
  totalWeeks: number;
  /** 数据来源，便于答辩/复核时追溯 */
  source: string;
}

export const TERM_CALENDAR: Record<string, TermCalendar> = {
  '2026-2027-1': {
    key: '2026-2027-1',
    termStart: '2026-09-07',
    totalWeeks: 20,
    source:
      '上海理工大学本科生院《2026-2027学年第一学期开学教学准备工作通知》：短学期 2026-09-07(周一) 起、理论教学 09-21 起；' +
      '计算中心《实验室预约服务开放通知》：本学期 2026-09-07 开始、2027-01-24 结束，共 20 个教学周（含 9 月短学期）。两处互证。',
  },
};

/** 纯算术求星期几（0=周日 … 6=周六）。不用 Date 对象，保证可复现、可测试 */
function weekday(year: number, month: number, day: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  return (
    (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + (t[month - 1] ?? 0) + day) % 7
  );
}

/**
 * 兜底：某年 9 月的第一个周一。
 * 高校秋季学期惯例在 9 月第一个周一开学 —— 校历没收录的年份先用它，但要提示待核对。
 * 实测校验：firstMondayOfSeptember(2026) === '2026-09-07'，与 2026-2027-1 官方校历一致。
 */
export function firstMondayOfSeptember(year: number): string {
  const offset = (8 - weekday(year, 9, 1)) % 7;
  return `${year}-09-${String(1 + offset).padStart(2, '0')}`;
}

/**
 * 从学期 key（如「2026-2027-1」）里取开学年份。
 * 教务导出的文件名是「姓名(2026-2027-1)课表.pdf」，所以年份几乎总是能拿到的。
 */
export function yearFromSemesterKey(key?: string): number | undefined {
  const m = /^(\d{4})/.exec((key ?? '').trim());
  return m ? Number(m[1]) : undefined;
}

export interface TermResolution {
  termStart: string;
  totalWeeks: number;
  /** true = 来自校历常量；false = 走的兜底规则，需在 UI 提示用户核对 */
  exact: boolean;
  source: string;
}

/**
 * 解析学期起始信息。优先级：
 *   1. 显式给的 termStart / totalWeeks（用户手填最高）
 *   2. semesterKey 命中校历常量
 *   3. 兜底：9 月第一个周一 + 数据里出现的最大周次
 *   4. 连年份都推不出来 → termStart 留空，交给 validateSchedule 报 error（不猜、不静默）
 */
export function resolveTerm(opts: {
  termStart?: string;
  totalWeeks?: number;
  semesterKey?: string;
  /** 兜底用的年份，省略则尝试从 semesterKey 推导 */
  fallbackYear?: number;
  /** 课表数据里出现的最大周次，兜底时用它当总周数 */
  dataMaxWeek: number;
}): TermResolution {
  const calendar = opts.semesterKey ? TERM_CALENDAR[opts.semesterKey] : undefined;
  if (calendar) {
    return {
      termStart: opts.termStart ?? calendar.termStart,
      totalWeeks: opts.totalWeeks ?? calendar.totalWeeks,
      exact: true,
      source: calendar.source,
    };
  }
  const year = opts.fallbackYear ?? yearFromSemesterKey(opts.semesterKey);
  if (opts.termStart === undefined && year === undefined) {
    return {
      termStart: '',
      totalWeeks: opts.totalWeeks ?? (opts.dataMaxWeek > 0 ? opts.dataMaxWeek : 16),
      exact: false,
      source: `校历未收录学期「${opts.semesterKey ?? '未知'}」且推不出年份，无法解析 termStart，请手填`,
    };
  }
  return {
    termStart: opts.termStart ?? firstMondayOfSeptember(year as number),
    totalWeeks: opts.totalWeeks ?? (opts.dataMaxWeek > 0 ? opts.dataMaxWeek : 16),
    exact: opts.termStart !== undefined,
    source:
      opts.termStart !== undefined
        ? '调用方显式指定'
        : `校历未收录学期「${opts.semesterKey ?? '未知'}」，按 ${year} 年 9 月第一个周一兜底，待核对`,
  };
}
