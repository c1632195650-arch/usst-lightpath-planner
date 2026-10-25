/**
 * chatHelpers —— LbaoChat 的纯辅助域（D1-批2/r8 拆出，2026-10-25）
 * ============================================================
 * 来历：LbaoChat.tsx 2480 行里，「消息/草稿/快照的类型 + 无状态纯函数 +
 * 会话身份/快照存取」是天然可独立的纯辅助层。本文件承接这层（行为不变搬运，
 * 逐字节来自原文件），LbaoChat 保留编排与渲染，并从本文件 re-export——
 * 既有导出面（App.tsx / LbaoDrawer.tsx 的 import）零变化。
 *
 * 红线合规：本文件不 import planner、不碰引擎；types/纯函数/存储读取均属对话层自身。
 */
import type { UserTask } from '@/lib/planner/templates';
import type { RagSource, ChatResult, MemoryFact } from '@/lib/api';
import type { IntentSlots } from './libaoIntent';
import type { TargetLocator, CancelTarget, GoalVerdict, ReschedulePreview } from './weekPlanForChat';
import type { UnavailableSlot } from '@/features/week/userPlanStore';


/* ============================================================
 * 一、消息形状（Msg）—— 对话 UI 的核心数据结构
 * ========================================================== */

export interface Msg {
  role: 'user' | 'lbao';
  text: string;
  sources?: RagSource[];
  /** F2/B2 不确定分级（server 一处计算）→ ConfidenceBadge 呈现；历史恢复的旧消息无此字段 → 不渲染 */
  confidence?: ChatResult['confidence'];
  mode?: string;
  /** 排程要点。来自**真引擎**（与「周计划」页同源），不是模板 —— 见 weekPlanForChat.ts */
  planPoints?: string[];
  /** 提示去哪儿看完整时间轴 */
  goWeek?: boolean;
  /** R批触发点①（P0-1b）：confirmGoal 落盘成功的回执 → 出「让梨宝评估这一版」按钮。
   *  点击展开**复用**的 PlanEvalPanel（纯读评估），采纳只进重排草稿流（L4 不变）。 */
  evalAsk?: boolean;
  needProfile?: boolean;
  /** 后端这一轮的完整元数据（route / intent / top_raw_vec / used_* / 耗时）。
   *  只用于 DEV 调试抽屉 —— 见本目录 ChatDebug.tsx 的说明。 */
  debug?: ChatResult;
  /** 目标草稿卡的确认键 —— 有值且 `pending` 里还有对应草稿时，渲染「就这么排」按钮。
   *  确认前**什么都不写入**：草稿只是草稿，执行权在用户手里（core §4 L4）。 */
  goalAsk?: number;
  /** WP11 重要日建议卡确认键 —— 有值且 `pendingDeadlines` 里还有对应提案时渲染「好，记下来」。确认前不写入（L4）。 */
  deadlineAsk?: number;
  /** D0 双模式：问答模式下听到排程意图 → 出切换提示卡（原句存这，点击切模式后原句重发）。
   *  不静默改道 —— 「揣测用意直接排」正是 D 批要消灭的议题断层来源之一。 */
  modeHint?: string;
  /** 记忆建议卡（M2）：客观事实待确认 —— 用户点头才进画像与基础信息 */
  proposals?: MemoryFact[];
  /** 已自动生效的偏好（M2）：出可撤销提示 */
  applied?: MemoryFact[];
  /** 后端 messages 自增 id —— 只在从 history 恢复的行上存在（跨会话恢复 E8 的去重依据） */
  mid?: number;
  /** 批次 2（交互升级方案 5.1）：快捷选项按钮卡 —— 能按钮不打字，自由输入框永远在下方。
   *  点击 = send(value)：value 是规则层解析得动的原话（编号兜底 parseOptionChoice 双保险）。 */
  options?: Array<{ label: string; value: string; hint?: string }>;
}

/** 一份等用户确认的目标草稿（确认后才落 `userPlanStore`）。
 *  WP9：kind 区分执行器（确认时走不同落层通道），缺省 create 兼容旧草稿。 */
export interface PendingGoal {
  kind?: 'create' | 'reschedule' | 'cancel' | 'replace' | 'query' | 'hold' | 'day_replan';
  title: string;
  tasks: UserTask[];
  /** 候选块真正落在的教学周（可能是一段区间，如 5–8 周） */
  weeks: number[];
  /** cancel / replace：要取消的目标（applyCancel 落层） */
  cancelTarget?: CancelTarget;
  /** reschedule：确认后 upsertMove 的记录与涟漪预览 */
  movePreview?: ReschedulePreview;
  /** V2-2 hold：确认后 addSlot 的不可时段（一次性，只作用于当前周） */
  holdSlot?: UnavailableSlot;
  /** 批 3 day_replan：确认后逐块 upsertMove 的保位钉（其余天保持原样的落盘形态） */
  dayReplan?: { pins: MoveRecord[]; days: number[] };
}

// MoveRecord 是 PendingGoal 的依赖（day_replan），从 userPlanStore 补充导入
import type { MoveRecord } from '@/features/week/userPlanStore';

/* ============================================================
 * 二、快照形状与存取（E8 跨会话恢复）
 * ========================================================== */

/** 快照 v3：对话管理器状态（mode/topic）取代 v2 的 clarify/schedMode。
 *  v2/v1 的字段保留为**只读迁移**输入，写永远写 v3。 */
export interface ChatSnapshot {
  v?: 3;
  messages: Msg[];
  pending: Record<number, PendingGoal>;
  pendingSeq: number;
  mode: 'chat' | 'sched';
  topic: DialogTopic | null;
  missStreak: number;
  /* ---- v2 只读迁移 ---- */
  clarify?: V2ClarifyShape | null;
  clarifyPicking?: V2PickingShape | null;
  schedMode?: 'idle' | 'collect';
}

// DialogTopic/V2*Shape 是快照的字段类型，从 dialogManager 引入（对话层内部依赖，不触红线）
import type { DialogTopic, V2ClarifyShape, V2PickingShape } from './dialogManager';

/* ============================================================
 * 三、纯函数（无状态、不碰 React）
 * ========================================================== */

/** 周列表 → 人话（[4] → 「第 4 周」；[5,6,7,8] → 「第 5–8 周」） */
export function weeksLabel(weeks: number[]): string {
  if (weeks.length === 0) return '本期';
  if (weeks.length === 1) return `第 ${weeks[0]} 周`;
  return `第 ${weeks[0]}–${weeks[weeks.length - 1]} 周`;
}

/** 追问话术渲染：带编号 + 尾注「可以用分号一起答」（S 批 §3.2）。 */
export function numberedQuestions(pairs: Array<{ question: string }>): string[] {
  const pts = pairs.map((p, i) => `${i + 1}. ${p.question}`);
  if (pts.length > 0) pts.push('可以用分号一起答，如：周五下午；每天两小时');
  return pts;
}

/** understand 端点的 patch → 意图层 Partial<IntentSlots>。
 *  时间结构化留在规则层：这里只把端点的结构化数字拼成 WhenHint 形状，
 *  日期换算（resolveWhen）由 `mergeLlmPrimary` 做 —— 防 LLM 直接编 ISO 日期。
 *  window_text 不在此映射：时段窗的分钟换算留在规则层（extractWindow），LLM 只定位。 */
export function mapUnderstandPatch(p: import('@/lib/api').PlanUnderstandResult['patch']): Partial<IntentSlots> {
  const patch: Partial<IntentSlots> = {};
  if (!p) return patch;
  if (p.title) patch.title = p.title;
  if (p.when_text || p.month != null || p.day != null || p.relativeDays != null
    || p.relativeWeeks != null || p.weekday != null || p.weekNo != null) {
    patch.when = {
      text: p.when_text ?? '',
      kind: (p.month != null || p.day != null || (p.weekNo != null && p.weekday != null)) ? 'exact'
        : (p.relativeDays != null || p.relativeWeeks != null || p.weekday != null) ? 'relative'
        : 'window',
    };
    if (p.month != null) patch.when.month = p.month;
    if (p.day != null) patch.when.day = p.day;
    if (p.relativeDays != null) patch.when.relativeDays = p.relativeDays;
    if (p.relativeWeeks != null) patch.when.relativeWeeks = p.relativeWeeks;
    if (p.relativeMonths != null) patch.when.relativeMonths = p.relativeMonths;
    if (p.weekday != null) patch.when.weekday = p.weekday;
    if (p.weekNo != null) patch.when.weekNo = p.weekNo;
  }
  if (p.perWeekCount != null) patch.perWeekCount = p.perWeekCount;
  if (p.durationMin != null) patch.durationMin = p.durationMin;
  if (p.totalHours != null) patch.totalHours = p.totalHours;
  if (p.place) patch.place = p.place;
  if (p.startMin != null || p.endMin != null) {
    patch.clock = {
      ...(p.startMin != null ? { startMin: p.startMin } : {}),
      ...(p.endMin != null ? { endMin: p.endMin } : {}),
      text: p.window_text ?? p.when_text ?? '钟点',
    };
  }
  if (p.targetHint) patch.targetHint = p.targetHint;
  if (p.targetWeekday != null) patch.targetDay = p.targetWeekday;
  if (p.targetStartMin != null || p.targetEndMin != null) {
    patch.targetClock = {
      ...(p.targetStartMin != null ? { startMin: p.targetStartMin } : {}),
      ...(p.targetEndMin != null ? { endMin: p.targetEndMin } : {}),
      text: '要动的那个时间',
    };
  }
  return patch;
}

/** 槽位的 target*（要动的旧时间）→ 执行器 locator（2026-10-07，按确切时间定位）。 */
export function cancelLocatorOf(s: IntentSlots): TargetLocator | undefined {
  if (s.targetDay == null && !s.targetClock) return undefined;
  return {
    ...(s.targetDay != null ? { dayOfWeek: s.targetDay } : {}),
    ...(s.targetClock?.startMin != null ? { startMin: s.targetClock.startMin } : {}),
    ...(s.targetClock?.endMin != null ? { endMin: s.targetClock.endMin } : {}),
  };
}

/* ============================================================
 * 四、会话身份与快照存取（sessionStorage，跨 tab 恢复）
 * ========================================================== */

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

/** 会话级标识：存 sessionStorage，关掉标签页即失效。 */
export function currentSessionId(): string {
  const KEY = 'usst.libao.session_id';
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved) return saved;
    const id = `s-${newId()}`;
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return 'default';
  }
}

/** 快照存取的 key（对外可见；真源在 dialogManager，此处 re-export 保持单一定义） */
export { SNAPSHOT_V3_KEY as CHAT_SNAPSHOT_KEY, SNAPSHOT_V2_KEY as CHAT_SNAPSHOT_V2_KEY } from './dialogManager';
export const CHAT_SNAPSHOT_V1_KEY = 'usst.libao.chat.v1';
export const CHAT_CLEARED_KEY = 'usst.libao.chat.cleared';
