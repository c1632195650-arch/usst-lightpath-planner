/**
 * 课表适配层：timetable_parser 的输出 → 仓库契约 Schedule
 *
 * 上游：本地课表解析服务（timetable_parser/server.py，默认 127.0.0.1:8765）
 *   GET  /courses         -> CourseRecord[]（中文键）
 *   POST /api/import_pdf  -> { ok, count, records } | { ok:false, error }
 *
 * 本文件是**纯函数**：不碰 DOM、不 fetch、不用 Date.now()/Math.random()。
 * 网络请求在 timetableClient.ts，两者分开是为了保证排程侧可测试、可复现。
 */

import type { CampusId, Course, CourseCategory, CourseTimeSlot, DayOfWeek, Schedule, SemesterType } from '@/types';
import { guessCampus } from '@/constants/campus';
import { MAX_PERIOD } from '@/constants/time';
import { resolveTerm, yearFromSemesterKey, type TermResolution } from '@/constants/term';

/** 解析服务返回的原始记录（键名沿用教务导出的中文表头，不要在这里改名） */
export interface CourseRecord {
  '课名': string;
  '类型': string;
  '节次': string;
  '周次原文'?: string;
  '周次': number[];
  '校区': string;
  '教室': string;
  '教师': string;
  '考核方式'?: string;
  '学时组成'?: string;
  '周学时'?: string;
  '总学时'?: string;
  '学分'?: string;
  '星期': string;
}

const DAY_MAP: Record<string, DayOfWeek> = {
  星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6, 星期日: 7, 星期天: 7,
  周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 7,
};

/** 「星期一」→ 1；认不出返回 null（调用方负责降级，不静默丢弃） */
export function parseDayOfWeek(raw: string): DayOfWeek | null {
  return DAY_MAP[raw.trim()] ?? null;
}

/** 「1-4节」→ {1,4}；「3节」→ {3,3}；越界或倒置返回 null */
export function parsePeriods(raw: string): { startPeriod: number; endPeriod: number } | null {
  const m = /(\d+)\s*(?:[-~－—]\s*(\d+))?\s*节/.exec(raw);
  if (!m) return null;
  const startPeriod = Number(m[1]);
  const endPeriod = m[2] ? Number(m[2]) : startPeriod;
  if (!Number.isInteger(startPeriod) || !Number.isInteger(endPeriod)) return null;
  if (startPeriod < 1 || endPeriod > MAX_PERIOD || startPeriod > endPeriod) return null;
  return { startPeriod, endPeriod };
}

/** 「国合楼309」→ { building:'国合楼', room:'309' }；「未排地点」→ {} */
export function splitRoom(raw: string): { building?: string; room?: string } {
  const s = raw.trim();
  if (!s || s === '未排地点') return {};
  const m = /^(.*?)(\d[\dA-Za-z-]*)$/.exec(s);
  if (!m) return { building: s };
  return { building: m[1] || undefined, room: m[2] };
}

/**
 * 课程类别。课表 PDF 只有「讲课/实验/实践/上机/讨论」，
 * 推不出「专业核心/公共基础」这类培养方案信息 —— 归到「其他」，交给用户或后续教学计画补全。
 */
export function mapCategory(type: string): CourseCategory {
  if (/实验|实践|上机/.test(type)) return '实践环节';
  return '其他';
}

/** 「2026-2027-1」这类学期 key。教务 PDF 文件名形如「姓名(2026-2027-1)课表.pdf」 */
export const SEMESTER_KEY_RE = /(\d{4}-\d{4}-[123])/;

/** 学期 key 末位：1=秋、2=春、3=短。推不出来按 autumn */
export function semesterTypeFromKey(key?: string): SemesterType {
  if (key?.endsWith('-2')) return 'spring';
  if (key?.endsWith('-3')) return 'short';
  return 'autumn';
}

/** 从 PDF 文件名里抠学期 key：「徐朗睿(2026-2027-1)课表.pdf」→ 「2026-2027-1」 */
export function semesterKeyFromFileName(fileName: string): string | undefined {
  return SEMESTER_KEY_RE.exec(fileName)?.[1];
}

/** 确定性 id：同一门课每次导入都得到同一个 id，避免重排时 diff 全乱 */
function hashCode(s: string): string {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_000_007;
  return h.toString(36);
}

/**
 * 学期元信息。
 * termStart 教务 PDF 里没有，但排程引擎靠它把「第 N 周」换算成日期，所以必须解决。
 * 三条路（见 constants/term.ts 的 resolveTerm）：显式手填 > 学期 key 查校历 > 9 月第一个周一兜底。
 * 建议调用方只传 semesterKey（从 PDF 文件名「姓名(2026-2027-1)课表.pdf」里抠），其余交给校历。
 */
export interface ScheduleMeta {
  /** 学期第一周的周一，"YYYY-MM-DD"。给了就以它为准（用户手填优先级最高） */
  termStart?: string;
  semesterName?: string;
  semesterType?: SemesterType;
  totalWeeks?: number;
  /** 学期 key，如「2026-2027-1」。命中 TERM_CALENDAR 就不用手填 termStart */
  semesterKey?: string;
  /** 兜底年份。省略则从 semesterKey 推导 */
  fallbackYear?: number;
}

export interface SkippedRecord {
  record: CourseRecord;
  reason: string;
}

export interface RoomConflict {
  courseName: string;
  /** 同一门课被解析出的多个教室。业务上「一门课只在一个教室上」，出现了多半是 PDF 拆格串格 */
  rooms: string[];
}

export interface AdaptResult {
  schedule: Schedule;
  /** 解析不出来的记录，逐条带原因 —— 给 UI 明说，不许静默丢弃 */
  skipped: SkippedRecord[];
  /** 同一门课撞出多个教室的冲突清单 */
  roomConflicts: RoomConflict[];
  /** termStart 是怎么来的。exact=false 时 UI 要提示用户核对 */
  term: TermResolution;
}

/** 同一门课（课名+教师+类型）的多次上课合并成一个 Course、多个 slot */
export function recordsToSchedule(records: CourseRecord[], meta: ScheduleMeta): AdaptResult {
  const skipped: SkippedRecord[] = [];
  const roomConflicts: RoomConflict[] = [];
  const groups = new Map<string, {
    name: string;
    teacher: string;
    type: string;
    items: Array<{ rec: CourseRecord; slot: CourseTimeSlot }>;
  }>();

  for (const rec of records) {
    const name = (rec['课名'] ?? '').trim();
    if (!name) {
      skipped.push({ record: rec, reason: '课名为空' });
      continue;
    }
    const dayOfWeek = parseDayOfWeek(rec['星期'] ?? '');
    if (dayOfWeek === null) {
      skipped.push({ record: rec, reason: `无法识别星期：${rec['星期']}` });
      continue;
    }
    const periods = parsePeriods(rec['节次'] ?? '');
    if (!periods) {
      skipped.push({ record: rec, reason: `无法识别节次：${rec['节次']}` });
      continue;
    }
    const weeks = (Array.isArray(rec['周次']) ? rec['周次'] : [])
      .filter((w) => Number.isInteger(w) && w >= 1)
      .sort((a, b) => a - b);

    const slot: CourseTimeSlot = { dayOfWeek, startPeriod: periods.startPeriod, endPeriod: periods.endPeriod, weeks };
    const key = `${name}|${rec['教师'] ?? ''}|${rec['类型'] ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = { name, teacher: rec['教师'] ?? '', type: rec['类型'] ?? '', items: [] };
      groups.set(key, group);
    }
    group.items.push({ rec, slot });
  }

  const courses: Course[] = [];
  for (const group of groups.values()) {
    const seen = new Set<string>();
    const slots: CourseTimeSlot[] = [];
    const rooms = new Set<string>();
    let firstRoom = '';

    for (const item of group.items) {
      const dedupeKey = `${item.slot.dayOfWeek}-${item.slot.startPeriod}-${item.slot.endPeriod}-${item.slot.weeks.join(',')}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      slots.push(item.slot);
      const roomRaw = item.rec['教室'] ?? '';
      if (roomRaw) rooms.add(roomRaw);
      if (!firstRoom) firstRoom = roomRaw;
    }

    slots.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startPeriod - b.startPeriod);

    // 业务规则：一门课只在一个教室上 → 教室唯一确定校区，Course 的单个 campus 字段够用，
    // CourseTimeSlot 不必再加 campus（types.ts 因此不用改）。
    // 校区只信「教室」：教务导出的「校区」字段全是「军工路校区」，516/334/1100 都叫军工路，没有区分度。
    // 若同一门课解析出多个教室，说明 PDF 拆格串了 —— 如实报出来，不悄悄取众数。
    if (rooms.size > 1) {
      roomConflicts.push({ courseName: group.name, rooms: [...rooms] });
    }
    const campus: CampusId = guessCampus(firstRoom);
    const room = splitRoom(firstRoom);
    const credit = Number.parseFloat(group.items[0]?.rec['学分'] ?? '');
    courses.push({
      id: `c_${hashCode(`${group.name}|${group.teacher}|${group.type}`)}`,
      name: group.name,
      teacher: group.teacher || undefined,
      credit: Number.isFinite(credit) ? credit : 0,
      category: mapCategory(group.type),
      campus,
      building: room.building,
      room: room.room,
      slots,
    });
  }

  courses.sort((a, b) => {
    const sa = a.slots[0];
    const sb = b.slots[0];
    return (sa ? sa.dayOfWeek : 99) - (sb ? sb.dayOfWeek : 99) || (sa ? sa.startPeriod : 99) - (sb ? sb.startPeriod : 99);
  });

  // 数据里出现的最大周次：校历没收录时用它当总周数
  let maxWeek = 0;
  for (const rec of records) {
    for (const w of Array.isArray(rec['周次']) ? rec['周次'] : []) {
      if (w > maxWeek) maxWeek = w;
    }
  }

  // 学期起始：优先 semesterKey（可从 PDF 文件名抠出来），其次 semesterName 里同格式的串
  const semesterKey = meta.semesterKey ?? SEMESTER_KEY_RE.exec(meta.semesterName ?? '')?.[1];
  const term = resolveTerm({
    termStart: meta.termStart,
    totalWeeks: meta.totalWeeks,
    semesterKey,
    // fallbackYear 三级：显式给 > 学期 key 的年份 > 学期名开头的年份（「2026-2027学年…」）
    fallbackYear: meta.fallbackYear ?? yearFromSemesterKey(meta.semesterName),
    dataMaxWeek: maxWeek,
  });

  const schedule: Schedule = {
    semesterName: meta.semesterName ?? semesterKey ?? '',
    semesterType: meta.semesterType ?? semesterTypeFromKey(semesterKey),
    termStart: term.termStart,
    totalWeeks: term.totalWeeks,
    courses,
    source: 'pdf',
  };

  return { schedule, skipped, roomConflicts, term };
}

export interface ScheduleIssue {
  level: 'error' | 'warn';
  message: string;
}

/** 周次是否有交集。空数组按 types.ts 的约定代表「全学期」，故与任何周次都相交 */
function weeksIntersect(a: number[], b: number[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const set = new Set(b);
  return a.some((w) => set.has(w));
}

/** 导入后的自检。error 必须先修，warn 只是提醒用户确认 */
export function validateSchedule(s: Schedule, term?: TermResolution): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.termStart)) {
    issues.push({
      level: 'error',
      message: term
        ? `学期起始日无法解析：${term.source}`
        : `学期起始日不是 ISO 日期：${s.termStart}`,
    });
  } else if (term && !term.exact) {
    issues.push({ level: 'warn', message: `学期起始日 ${s.termStart} 是估算值：${term.source}` });
  }
  if (s.totalWeeks < 1) {
    issues.push({ level: 'error', message: `总周数非法：${s.totalWeeks}` });
  }
  if (s.courses.length === 0) {
    issues.push({ level: 'error', message: '课程数为 0' });
  }
  for (const c of s.courses) {
    if (c.slots.length === 0) {
      issues.push({ level: 'error', message: `课程「${c.name}」没有任何上课时段` });
    }
    for (const slot of c.slots) {
      if (slot.startPeriod > slot.endPeriod) {
        issues.push({ level: 'error', message: `课程「${c.name}」节次倒置：${slot.startPeriod}-${slot.endPeriod}` });
      }
      if (slot.startPeriod < 1 || slot.endPeriod > MAX_PERIOD) {
        issues.push({ level: 'error', message: `课程「${c.name}」节次越界：${slot.startPeriod}-${slot.endPeriod}（应为 1-${MAX_PERIOD}）` });
      }
      if (slot.dayOfWeek < 1 || slot.dayOfWeek > 7) {
        issues.push({ level: 'error', message: `课程「${c.name}」星期越界：${slot.dayOfWeek}` });
      }
    }
    // 同一门课自己跟自己撞：多半是 PDF 拆格造成的重复，也可能是真的排了两遍
    for (let i = 0; i < c.slots.length; i++) {
      for (let j = i + 1; j < c.slots.length; j++) {
        const a = c.slots[i];
        const b = c.slots[j];
        if (!a || !b || a.dayOfWeek !== b.dayOfWeek) continue;
        if (a.endPeriod < b.startPeriod || b.endPeriod < a.startPeriod) continue;
        if (!weeksIntersect(a.weeks, b.weeks)) continue;
        issues.push({
          level: 'warn',
          message: `课程「${c.name}」周${a.dayOfWeek} 第${a.startPeriod}-${a.endPeriod}节 与 第${b.startPeriod}-${b.endPeriod}节 时段重叠且周次有交集，请核对是不是解析重复`,
        });
      }
    }
    if (c.campus === 'UNKNOWN') {
      issues.push({
        level: 'warn',
        message: `课程「${c.name}」无法从教室推断校区（教室：${c.building ?? '未排地点'}），跨校区转场将按 UNKNOWN 估算`,
      });
    }
  }
  // 跨课程冲突：两门不同的课占同一时段且周次有交集 = 物理上不可能，必须人核对
  for (let i = 0; i < s.courses.length; i++) {
    for (let j = i + 1; j < s.courses.length; j++) {
      const a = s.courses[i];
      const b = s.courses[j];
      if (!a || !b) continue;
      for (const sa of a.slots) {
        for (const sb of b.slots) {
          if (sa.dayOfWeek !== sb.dayOfWeek) continue;
          if (sa.endPeriod < sb.startPeriod || sb.endPeriod < sa.startPeriod) continue;
          if (!weeksIntersect(sa.weeks, sb.weeks)) continue;
          issues.push({
            level: 'warn',
            message: `课程冲突：「${a.name}」与「${b.name}」都在周${sa.dayOfWeek} 第${sa.startPeriod}-${sa.endPeriod}节 / 第${sb.startPeriod}-${sb.endPeriod}节，且周次有交集`,
          });
        }
      }
    }
  }
  return issues;
}
