/**
 * 对话身份与基础信息 —— 单一来源（M1）
 * =====================================
 * 2026-09-20 CY 拍板：
 *  · `user_id` 暂不跨设备（无登录体系），但取值**必须收敛到本文件这一个函数**，
 *    将来要换登录/同步方案时只改这里；
 *  · 「基础信息」（称呼/年级/学院/专业）是用户可自由编辑的客观事实区 ——
 *    AI 在对话里听到身份信息时只能**提议**（后端 facts 表 pending），
 *    用户在建议卡里点了确认，才经 `applyObjectiveFact` 写进这里；
 *  · AI 永远不直接改写基础信息（core §4 L4：绝不替用户拍板）。
 * 2026-10-06 更新：user_id 改为「账号 ID 优先，无账号回退设备 ID」（见 getUserId）。
 */

// 账号键的唯一事实来源在移动端 auth.ts（网页端登录复用同一键，假联通修复·必修 2）
import { USER_KEY as ACCOUNT_USER_KEY } from '@/features/mobile/lib/auth';

const USER_KEY = 'usst.libao.user_id';
const BASIC_KEY = 'usst.libao.basic_info';

/** 年级（v2 方案 WP1）：收窄为 1-4 数字，供题库分层（WP2）与排程默认值消费 */
export type Grade = 1 | 2 | 3 | 4;
/** 校区值域封死（数据红线：地点只允许军工路本部 + 1100） */
export type Campus = '军工路本部' | '1100';

export const GRADE_LABELS: Record<Grade, string> = { 1: '大一', 2: '大二', 3: '大三', 4: '大四' };
export const CAMPUS_OPTIONS: readonly Campus[] = ['军工路本部', '1100'];

const GRADE_FROM_LABEL: Record<string, Grade> = {
  大一: 1, 大二: 2, 大三: 3, 大四: 4, '1': 1, '2': 2, '3': 3, '4': 4,
};

/** 「大二」/「2」→ 2；解析不了返回 null（调用方必须忽略，不许猜） */
export function gradeFromLabel(v: string): Grade | null {
  return GRADE_FROM_LABEL[v.trim()] ?? null;
}

export interface BasicInfo {
  /** 怎么称呼你 */
  nickname?: string;
  /** 年级 1-4（读取时兼容旧版「大二」式字符串，自动迁移成数字） */
  grade?: Grade;
  /** 学院，如「光电学院」 */
  college?: string;
  /** 专业，如「光电信息科学与工程」 */
  major?: string;
  /** 校区：军工路本部 | 1100 */
  campus?: Campus;
  /** 宿舍楼号，纯文本；禁坐标（数据红线：落盘无 lat/lon） */
  dorm?: string;
  /** 平日就寝时间（分钟 0-1440）→ 喂排程 dayEnd */
  sleepMin?: number;
  /** 每周运动次数 0-7 → 排程运动条数默认值 */
  exercisePerWeek?: number;
}

export const BASIC_INFO_FIELDS = [
  { key: 'nickname', label: '称呼', placeholder: '怎么称呼你' },
  { key: 'grade', label: '年级', placeholder: '如：大二' },
  { key: 'college', label: '学院', placeholder: '如：光电学院' },
  { key: 'major', label: '专业', placeholder: '如：光电信息科学与工程' },
] as const;

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* 老浏览器 / 非安全上下文没有 randomUUID，走下面的兜底 */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 设备级标识（唯一来源）：持久化复用 —— 后端的「对话信号」靠它跨会话累积。
 *  2026-10-06「假联通」修复：登录后（网页/移动共用 `usst.mobile.user` 同一键）
 *  **优先返回云端账号 ID**（`acct-<userId>`），记忆库/画像事实才能跨端续用；
 *  无账号（或键损坏）回退设备 ID `u-*`（原语义不变，老用户无感）。
 *  已知限制：未登录时换设备或清缓存 = 变成另一个人。 */
export function getUserId(): string {
  try {
    // 账号键损坏只降级这一处读取，绝不能落进外层 catch（那会返回 anon 而不是设备 ID）
    try {
      const raw = localStorage.getItem(ACCOUNT_USER_KEY);
      if (raw) {
        const u = JSON.parse(raw) as { userId?: unknown };
        if (typeof u?.userId === 'number' && Number.isInteger(u.userId) && u.userId > 0) {
          return `acct-${u.userId}`;
        }
      }
    } catch {
      /* 坏 JSON → 走设备 ID 回退 */
    }
    const saved = localStorage.getItem(USER_KEY);
    if (saved) return saved;
    const id = `u-${newId()}`;
    localStorage.setItem(USER_KEY, id);
    return id;
  } catch {
    // 隐私模式等场景 localStorage 不可写 → 退回后端默认，功能降级但不报错
    return 'anon';
  }
}

function strField(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function intField(v: unknown, lo: number, hi: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
}

export function loadBasicInfo(): BasicInfo {
  try {
    const raw = localStorage.getItem(BASIC_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, unknown>;
    // 逐字段白名单校验；非法形状一律丢弃（存储层出错不报错、不污染）
    const out: BasicInfo = {};
    const nickname = strField(data.nickname);
    if (nickname) out.nickname = nickname;
    const g = gradeFromLabel(String(data.grade ?? '')); // 数字 1-4 直通；旧版「大二」字符串在此迁移
    if (g) out.grade = g;
    const college = strField(data.college);
    if (college) out.college = college;
    const major = strField(data.major);
    if (major) out.major = major;
    if (data.campus === '军工路本部' || data.campus === '1100') out.campus = data.campus;
    const dorm = strField(data.dorm);
    if (dorm) out.dorm = dorm;
    const sleep = intField(data.sleepMin, 0, 1440);
    if (sleep !== undefined) out.sleepMin = sleep;
    const ex = intField(data.exercisePerWeek, 0, 7);
    if (ex !== undefined) out.exercisePerWeek = ex;
    return out;
  } catch {
    return {};
  }
}

export function saveBasicInfo(info: BasicInfo): void {
  try {
    localStorage.setItem(BASIC_KEY, JSON.stringify(info));
  } catch (e) {
    console.warn('[identity] 基础信息写入失败', e);
  }
}

/** 后端 facts 的 key → 基础信息字段。key 不在映射里 = 不是客观事实，返回 null。 */
export function objectiveKeyToField(key: string): keyof BasicInfo | null {
  if (key === 'grade') return 'grade';
  if (key === 'college') return 'college';
  if (key === 'major') return 'major';
  return null;
}

/** 用户在建议卡点了「确认」→ 把这条客观事实写进本地基础信息。
 *  只覆盖对应单字段，不碰其它字段。
 *  年级走 gradeFromLabel 解析（后端 facts 给的是「大二」式字符串）；
 *  解析不了的年级一律忽略 —— 不许猜（core §4：不替用户拍板）。 */
export function applyObjectiveFact(key: string, value: string): BasicInfo {
  const field = objectiveKeyToField(key);
  if (!field) return loadBasicInfo();
  if (field === 'grade') {
    const g = gradeFromLabel(value);
    if (!g) return loadBasicInfo();
    const next = { ...loadBasicInfo(), grade: g };
    saveBasicInfo(next);
    return next;
  }
  const next = { ...loadBasicInfo(), [field]: value };
  saveBasicInfo(next);
  return next;
}

/** 基础信息 → 注入对话的档案摘要段落（给后端 system prompt 用）。
 *  与 PersonaProfile（35 题测评）互补：这里是「你是谁」，那是「你的节奏」。 */
export function basicInfoContext(): string {
  const info = loadBasicInfo();
  const bits: string[] = [];
  if (info.nickname) bits.push(`称呼：${info.nickname}`);
  if (info.grade) bits.push(`年级：${GRADE_LABELS[info.grade]}`);
  if (info.college) bits.push(`学院：${info.college}`);
  if (info.major) bits.push(`专业：${info.major}`);
  if (info.campus) bits.push(`校区：${info.campus}`);
  return bits.length ? `[用户基础信息]\n${bits.join('；')}` : '';
}
