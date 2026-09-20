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
 */

const USER_KEY = 'usst.libao.user_id';
const BASIC_KEY = 'usst.libao.basic_info';

export interface BasicInfo {
  /** 怎么称呼你 */
  nickname?: string;
  /** 年级，如「大二」 */
  grade?: string;
  /** 学院，如「光电学院」 */
  college?: string;
  /** 专业，如「光电信息科学与工程」 */
  major?: string;
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
 *  ⚠️ 已知限制（2026-09-20 确认先不做跨设备）：换设备或清缓存 = 变成另一个人。 */
export function getUserId(): string {
  try {
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

export function loadBasicInfo(): BasicInfo {
  try {
    const raw = localStorage.getItem(BASIC_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Partial<BasicInfo>;
    // 只认字符串字段，其余丢弃（存储层出错不报错、不污染）
    const out: BasicInfo = {};
    for (const { key } of BASIC_INFO_FIELDS) {
      const v = data[key];
      if (typeof v === 'string' && v.trim()) out[key] = v.trim();
    }
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
 *  只覆盖对应单字段，不碰其它字段。 */
export function applyObjectiveFact(key: string, value: string): BasicInfo {
  const field = objectiveKeyToField(key);
  if (!field) return loadBasicInfo();
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
  if (info.grade) bits.push(`年级：${info.grade}`);
  if (info.college) bits.push(`学院：${info.college}`);
  if (info.major) bits.push(`专业：${info.major}`);
  return bits.length ? `[用户基础信息]\n${bits.join('；')}` : '';
}
