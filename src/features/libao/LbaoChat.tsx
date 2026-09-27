import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PersonaProfile, Schedule, TimeBlock, WeekPlan } from '@/types';
import type { UserTask } from '@/lib/planner/templates';
import { currentWeekNo, todayISO, weekdayOf } from '@/lib/date';
import { lbaoChat, lbaoHealth, chatHistory, resetMemory, decideFact, planUnderstand, type ChatResult, type MemoryFact, type RagSource } from '@/lib/api';
import { applyObjectiveFact, basicInfoContext, getUserId, objectiveKeyToField } from '@/lib/identity';
import { track } from '@/lib/telemetry';
import { buildProfileContext } from '@/features/libao/profileContext';
import { applyClarifyAnswers, applyClarifyFragments, deadlineProposal, parseGoalIntent, describeSlots, questionsForSlots, topQuestionPairs, mergeLlmPrimary, missingSlots, parseIntentSlots, type ClarifyAnswersResult, type DeadlineProposal, type IntentSlots, type SlotKey } from '@/features/libao/libaoIntent';
import {
  EXIT_ACK,
  EXPIRE_NOTE,
  HOLD_ON_PREFIX,
  MISS_STREAK_LIMIT,
  isExitCommand,
  nextMissStreak,
  shouldExpireSession,
  type SchedMode,
} from '@/features/libao/schedSession';
import {
  SNAPSHOT_V3_KEY,
  SNAPSHOT_V2_KEY,
  SNAPSHOT_V1_KEY,
  TOPIC_TURNS_LIMIT,
  blockedTopic,
  bumpTurns,
  collectTopic,
  draftTopic,
  modeFromV2,
  pickingTopic,
  sanitizeTopic,
  serializeDialogState,
  topicExpired,
  topicFromV2,
  transitionTopic,
  validateDialogAct,
  type DialogAct,
  type DialogActArgs,
  type DialogTopic,
  type PickOption,
} from '@/features/libao/dialogManager';
import { addUserDeadline } from '@/features/calendar/deadlineStore';
import {
  applyCancel,
  checkGoalFeasibility,
  describeVerdict,
  findCancelTargets,
  findMoveTargets,
  goalToTasks,
  planReschedule,
  planWeekForChat,
  planWeekWithTasks,
  summarizeWeekPlan,
  holdSlotFrom,
  holdToUnavailableSlot,
  matchCandidate,
  proposeReplanOptions,
  type CancelTarget,
  type GoalVerdict,
  type ReschedulePreview,
} from '@/features/libao/weekPlanForChat';
import type { UnavailableSlot } from '@/features/week/userPlanStore';
import { addSlot, addTask, diffPlanEvents, getRecentPlanEvents, loadUserPlan, pushPlanEvents, pushUndoSnapshot, saveUserPlan, upsertMove } from '@/features/week/userPlanStore';
import { MiniWeekPreview } from '@/features/week/MiniWeekPreview';
import { ChatDebug } from '@/features/libao/ChatDebug';
import { MemoryPanel, factLabel } from '@/features/libao/MemoryPanel';
import { historyToMsgs, mergeHistory, RESTORE_CHAT } from '@/features/libao/chatRestore';

/** DEV 专用：把「已经拿回来、但一直没人看」的检索与路由信号显示出来。
 *  `import.meta.env.DEV` 在生产构建里是字面量 false → 整段被摇掉，线上零变化。 */
const SHOW_DEBUG = import.meta.env.DEV;

interface Msg {
  role: 'user' | 'lbao';
  text: string;
  sources?: RagSource[];
  mode?: string;
  /** 排程要点。来自**真引擎**（与「周计划」页同源），不是模板 —— 见 weekPlanForChat.ts */
  planPoints?: string[];
  /** 提示去哪儿看完整时间轴 */
  goWeek?: boolean;
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
}

/** 一份等用户确认的目标草稿（确认后才落 `userPlanStore`）。
 *  WP9：kind 区分执行器（确认时走不同落层通道），缺省 create 兼容旧草稿。 */
interface PendingGoal {
  kind?: 'create' | 'reschedule' | 'cancel' | 'replace' | 'query' | 'hold';
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
}

/** 周列表 → 人话（[4] → 「第 4 周」；[5,6,7,8] → 「第 5–8 周」） */
function weeksLabel(weeks: number[]): string {
  if (weeks.length === 0) return '本期';
  if (weeks.length === 1) return `第 ${weeks[0]} 周`;
  return `第 ${weeks[0]}–${weeks[weeks.length - 1]} 周`;
}

/** 常见问法，避免第一次进入对话没有入口。 */
const QUICK = ['四六级什么时候报名', '帮我安排这周', '我要报名数学建模，帮我规划备赛', '这学期放假安排'];

/**
 * 追问话术渲染：带编号 + 尾注「可以用分号一起答」（S 批 §3.2）。
 * 编号与 `asked` 清单一一对应 —— 用户照编号用分号答时，
 * `applyClarifyAnswers` 按位置收槽。
 */
function numberedQuestions(pairs: Array<{ question: string }>): string[] {
  const pts = pairs.map((p, i) => `${i + 1}. ${p.question}`);
  if (pts.length > 0) pts.push('可以用分号一起答，如：周五下午；每天两小时');
  return pts;
}

/** understand 端点的 patch → 意图层 Partial<IntentSlots>。
 *  时间结构化留在规则层：这里只把端点的结构化数字拼成 WhenHint 形状，
 *  日期换算（resolveWhen）由 `mergeLlmPrimary` 做 —— 防 LLM 直接编 ISO 日期。
 *  window_text 不在此映射：时段窗的分钟换算留在规则层（extractWindow），LLM 只定位。 */
function mapUnderstandPatch(p: import('@/lib/api').PlanUnderstandResult['patch']): Partial<IntentSlots> {
  const patch: Partial<IntentSlots> = {};
  if (!p) return patch;
  if (p.title) patch.title = p.title;
  if (p.when_text || p.month != null || p.day != null || p.relativeDays != null
    || p.relativeWeeks != null || p.weekday != null) {
    patch.when = {
      text: p.when_text ?? '',
      kind: (p.month != null || p.day != null) ? 'exact'
        : (p.relativeDays != null || p.relativeWeeks != null || p.weekday != null) ? 'relative'
        : 'window',
    };
    if (p.month != null) patch.when.month = p.month;
    if (p.day != null) patch.when.day = p.day;
    if (p.relativeDays != null) patch.when.relativeDays = p.relativeDays;
    if (p.relativeWeeks != null) patch.when.relativeWeeks = p.relativeWeeks;
    if (p.weekday != null) patch.when.weekday = p.weekday;
  }
  if (p.perWeekCount != null) patch.perWeekCount = p.perWeekCount;
  if (p.durationMin != null) patch.durationMin = p.durationMin;
  if (p.totalHours != null) patch.totalHours = p.totalHours;
  if (p.place) patch.place = p.place;
  if (p.targetHint) patch.targetHint = p.targetHint;
  return patch;
}

/** 对话初始说明，明确问答与排程两个能力。 */
const GREETING =
  '我是梨宝，咱上理的校园助手。可以问四六级、选课、放假等校园问题；也可以说「帮我安排这周」，'
  + '或者直接说要做什么（比如「我要报名数学建模，九月中旬比赛，帮我规划备赛」）——'
  + '我会先排一版草稿给你确认，你不点头我不动日程。';

/** D 批总回退开关（工作单 §11）：false = send 直落规则链路，一行回 S/T 批行为。 */
const DIALOG_ENABLED = true;

/** D3 confirm_draft 双闸之词表闸：归一后**整句**命中才算同意。
 *  「好不好嘛」「要不要就这样」都不是同意 —— 决策权在用户（L4）。 */
const CONFIRM_RE = /^(好|好呀|好啊|行|可以|对|确认|就这么排|就这么办|排吧|嗯+)[吧呢啊。！!]*$/;

/* ---------------- 对话身份 ----------------
 * 后端 `/api/chat` 早就接受 `session_id` / `user_id`，但前端此前**只发一个问题字符串**，
 * 后端只好落回 `default` / `anon` —— 结果三层记忆在前端链路上完全空转，
 * 且所有用户共用同一份画像（演示时连着问两轮不同身份就会串味）。
 * 补上身份，是让那套已经写好的记忆层真正生效的唯一前置条件。
 */

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

/** 会话级标识：存 sessionStorage，关掉标签页即失效 —— 对应后端「最近原话」的窗口。
 *  与 user_id **刻意分开**：合成一个会让「跨会话的画像」和「本次会话的上下文」互相污染。
 *  （user_id 的取值已收敛到 `@/lib/identity` 的 `getUserId()` —— 单一来源，
 *   将来换登录/同步方案只改那一处。） */
function currentSessionId(): string {
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

/* ---------------- 聊天快照与跨会话恢复（E8） ----------------
 * 切 tab（总览/画像/课表）会把本组件**卸载**，组件内 state 全部蒸发 ——
 * 用户回来说「聊天记录没了」（2026-09-20 真实反馈）。对策两层：
 *  · 同标签页内：对话/草稿/追问态存 sessionStorage（与 session_id 同生命周期），
 *    挂载时恢复 —— 解决「切 tab 丢失」；
 *  · 关过标签页（快照没了）：挂载时拉 `GET /api/chat/history`，用后端一直存着的
 *    messages 原文重建对话 —— 解决「隔天/重开浏览器丢失」。两条路在
 *    chatRestore.ts 里合并去重（按角色+文本多重集，快照消息没有后端 id）。
 *  开关 `RESTORE_CHAT`（chatRestore.ts）默认开；关掉即回到旧行为
 *  「隔天从干净问候语开始」。用户随时可点「清空对话」重置（走 /api/memory/reset）。 */

/** 排程会话态（S 批 §3.2）：`asked` = 提问时记下的槽位清单（第 i 问 ↔ 第 i 段答）。
 *  D1 起这不再是 React state —— 它是 topic{collect} 的**派生形状**（规则链路消费）。 */
interface ClarifyState {
  slots: IntentSlots;
  asked: SlotKey[];
}

/** V2-1 多目标挑块接续态。D1 起同样是 topic{picking} 的派生形状：
 *  candidates 同名同型 —— tests/v2.test.ts 的源码字面量断言与规则链路原样存活。
 *  D3（B②）：replace 多候选也走这条通道（kind 扩 'replace'）。 */
interface PickingState {
  kind: 'cancel' | 'reschedule' | 'replace';
  slots: IntentSlots;
  candidates: CancelTarget[];
}

/** 快照 v3：对话管理器状态（mode/topic）取代 v2 的 clarify/schedMode。
 *  v2/v1 的字段保留为**只读迁移**输入，写永远写 v3。 */
interface ChatSnapshot {
  v?: 3;
  messages: Msg[];
  pending: Record<number, PendingGoal>;
  pendingSeq: number;
  mode: 'chat' | 'sched';
  topic: DialogTopic | null;
  missStreak: number;
  /* ---- v2 只读迁移 ---- */
  clarify?: ClarifyState | null;
  clarifyPicking?: PickingState | null;
  schedMode?: 'idle' | 'collect';
}

const CHAT_SNAPSHOT_KEY = SNAPSHOT_V3_KEY;
/** v2 快照键：只读不写 —— clarify/clarifyPicking 合成为 topic，mode 推导。 */
const CHAT_SNAPSHOT_V2_KEY = SNAPSHOT_V2_KEY;
/** v1 快照键：只读不写 —— 旧快照的 clarifySlots 没有 asked 清单，按 missing 推导。 */
const CHAT_SNAPSHOT_V1_KEY = 'usst.libao.chat.v1';
/** 清空标记：本标签页内清空过后不再自动恢复（后端已删则历史本就为空，双保险） */
const CHAT_CLEARED_KEY = 'usst.libao.chat.cleared';

function loadChatSnapshot(): ChatSnapshot | null {
  try {
    // v3 主路：对话管理器状态（mode/topic）原样恢复；坏数据当没有
    const raw = sessionStorage.getItem(CHAT_SNAPSHOT_KEY);
    if (raw) {
      const s = JSON.parse(raw) as ChatSnapshot;
      if (s.v === 3 && Array.isArray(s.messages) && s.messages.length > 0) {
        return {
          v: 3,
          messages: s.messages,
          pending: s.pending ?? {},
          pendingSeq: s.pendingSeq ?? 0,
          mode: s.mode === 'sched' ? 'sched' : 'chat',
          topic: sanitizeTopic(s.topic),
          missStreak: s.missStreak ?? 0,
        };
      }
      return null;
    }
    // v2 兼容：clarify/clarifyPicking 合成为 topic；mode 按 schedMode 推导
    const v2raw = sessionStorage.getItem(CHAT_SNAPSHOT_V2_KEY);
    if (v2raw) {
      const s = JSON.parse(v2raw) as ChatSnapshot;
      if (!Array.isArray(s.messages) || s.messages.length === 0) return null;
      return {
        messages: s.messages,
        pending: s.pending ?? {},
        pendingSeq: s.pendingSeq ?? 0,
        mode: modeFromV2(s.mode, s.schedMode),
        topic: topicFromV2(s.clarify ?? null, s.clarifyPicking ?? null),
        missStreak: s.missStreak ?? 0,
      };
    }
    // v1 兼容：clarifySlots → { slots, asked: missing }，无排程态
    const v1raw = sessionStorage.getItem(CHAT_SNAPSHOT_V1_KEY);
    if (!v1raw) return null;
    const v1 = JSON.parse(v1raw) as Omit<ChatSnapshot, 'clarify' | 'schedMode' | 'missStreak' | 'mode' | 'topic'> & { clarifySlots: IntentSlots | null };
    if (!Array.isArray(v1.messages) || v1.messages.length === 0) return null;
    return {
      messages: v1.messages,
      pending: v1.pending ?? {},
      pendingSeq: v1.pendingSeq ?? 0,
      mode: 'chat',
      topic: v1.clarifySlots ? topicFromV2({ slots: v1.clarifySlots, asked: [...v1.clarifySlots.missing] }, null) : null,
      missStreak: 0,
    };
  } catch {
    return null; // 坏数据当没有，别让一条坏快照挡死整个聊天页
  }
}

/** 将本地排程建议和校园资料问答放进同一段对话，而不混用两种数据来源。 */
export function LbaoChat({ profile, schedule, onGoProfile, seedQuestion }: {
  profile: PersonaProfile | null;
  schedule: Schedule;
  onGoProfile?: () => void;
  /** V0-3：checklist 跳转时的预填提示（App 用 nonce 作 key 保证只在进入时注入一次） */
  seedQuestion?: string;
}) {
  /** 挂载时读一次快照；下面的 state 初始化都从它取 —— 切 tab 回来即恢复。 */
  const [boot] = useState(loadChatSnapshot);
  const [messages, setMessages] = useState<Msg[]>(
    () => boot?.messages ?? [{ role: 'lbao', text: GREETING }],
  );
  const [input, setInput] = useState(seedQuestion ?? '');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** 待确认的目标草稿。键是消息下标递增号 —— 确认前不写任何状态。 */
  const [pending, setPending] = useState<Record<number, PendingGoal>>(() => boot?.pending ?? {});
  /** WP11：等确认的重要日提案（确认才写 deadlineStore，且不触发自动重排） */
  const [pendingDeadlines, setPendingDeadlines] = useState<Record<number, DeadlineProposal>>({});
  const pendingSeq = useRef(boot?.pendingSeq ?? 0);
  /** D1：对话管理器单一状态容器 —— 当前议题（collect/picking/draft/blocked 四相）。
   *  原先散在 clarify / clarifyPicking / schedMode 三个 state 里的会话态收敛于此：
   *  规则链路通过下面的派生兼容层照常消费，D3 起对话管理器 LLM 读到的也是这一份。 */
  const [topic, setTopic] = useState<DialogTopic | null>(() => boot?.topic ?? null);

  // ── WP9：侧栏排程预览卡 —— 「必须跟随最新进度」的落点 ──────────────
  // 任何落盘（确认排/取消/挪/替换）都 bumpPlanVersion() → 重算引擎 → 卡片刷新。
  // 有未确认草稿时按「草稿态」算（pending 的任务一起喂引擎），caption 如实标注。
  const [planVersion, setPlanVersion] = useState(0);
  const bumpPlanVersion = useCallback(() => setPlanVersion((v) => v + 1), []);
  const [previewPlan, setPreviewPlan] = useState<WeekPlan | null>(null);
  const pendingTasksKey = useMemo(
    () => Object.values(pending).map((g) => g.tasks.map((t) => t.id).join(',')).join('|'),
    [pending],
  );
  useEffect(() => {
    let alive = true;
    const weekNo = currentWeekNo(schedule.termStart, todayISO());
    const tasks = Object.values(pending).flatMap((g) => g.tasks);
    (async () => {
      try {
        const plan = tasks.length > 0
          ? await planWeekWithTasks(schedule, profile, weekNo, tasks)
          : await planWeekForChat(schedule, profile, weekNo);
        if (alive) setPreviewPlan(plan);
      } catch {
        if (alive) setPreviewPlan(null);
      }
    })();
    return () => { alive = false; };
  }, [schedule, profile, pendingTasksKey, planVersion]);

  /** ── D1 派生兼容层 ──────────────────────────────────────────────
   *  规则链路（send / run* / v2 源码断言）继续用旧形状：clarify / clarifyPicking /
   *  schedMode 都是 topic 的只读投影，写入只走 updateClarify / updatePicking（落 topic）。 */
  const clarify: ClarifyState | null = useMemo(
    () => (topic?.phase === 'collect' ? { slots: topic.slots, asked: [...topic.asked] } : null),
    [topic],
  );

  const clarifyPicking: PickingState | null = useMemo(() => {
    if (!topic || topic.phase !== 'picking' || !topic.candidates?.length) return null;
    return {
      kind: topic.pickKind ?? 'cancel',
      slots: topic.slots,
      candidates: topic.candidates.map((o) => o.target),
    };
  }, [topic]);

  /** S 批 S2 · 排程会话状态机：collect = 正在等用户的排程回应。D1 起为 topic 的投影。 */
  const schedMode: SchedMode = topic ? 'collect' : 'idle';
  const [missStreak, setMissStreak] = useState(() => boot?.missStreak ?? 0);

  /** D0 双模式（问答/排程硬区分）：问答模式只答问题，排程意图出切换提示不静默改道；
   *  排程模式内所有输入走排程流（D3 起 dialog 裁决 → 执行器，离线走规则链）。 */
  const [mode, setMode] = useState<'chat' | 'sched'>(() => boot?.mode ?? 'chat');

  /** clarify 的唯一写入口：落 topic{collect}（missStreak 清零语义不变）。 */
  const updateClarify = useCallback((next: ClarifyState | null) => {
    setTopic(next ? collectTopic(next.slots, next.asked) : null);
    if (next) setMissStreak(0);
  }, []);

  /** picking 的唯一写入口：落 topic{picking}（与 updateClarify 同一套状态机纪律）。 */
  const updatePicking = useCallback((next: PickingState | null) => {
    setTopic(next ? pickingTopic(next.kind, next.slots, next.candidates) : null);
    if (next) setMissStreak(0);
  }, []);

  /** D3 topic 生命周期：出草稿卡 → topic{draft,draftKey}（保留 priorFailed——
   *  confirm_draft 的 voice 通道、B① 议题续用都靠它）。 */
  const markDraft = useCallback((key: number, slots: IntentSlots) => {
    setTopic((prev) => {
      const base = prev ?? draftTopic(slots, key);
      return transitionTopic(base, { phase: 'draft', draftKey: key, intent: slots.intent, slots });
    });
  }, []);

  /** D3 topic 生命周期：conflict/infeasible → topic{blocked} + priorFailed 记录。
   *  blockingBlocks 由引擎干跑给出（D4）；LLM 协商（negotiate_block）只许引用这些事实。 */
  const markBlocked = useCallback((slots: IntentSlots, kind: 'no_placement' | 'partial_placed' | 'conflict', verdict: GoalVerdict) => {
    setTopic((prev) => {
      const base = prev ?? blockedTopic(slots, { kind, verdict, blockingBlocks: [] });
      return transitionTopic(base, {
        phase: 'blocked',
        intent: slots.intent,
        slots,
        blocking: {
          kind,
          verdict,
          blockingBlocks: (verdict.blockingBlocks ?? []).map((b, i) => ({
            idx: i, title: b.title, hint: b.hint, origin: 'plan' as const,
            target: { blockId: b.blockId, title: b.title, origin: 'plan' as const, hint: b.hint },
          })),
        },
        priorFailed: { title: slots.title, slots },
      });
    });
  }, []);

  /** D0：模式切换唯一入口。切回问答 = 显式退出排程态（复用退出回执语义，不静默清态）。 */
  const switchMode = useCallback((to: 'chat' | 'sched') => {
    setMode(to);
    if (to === 'chat') {
      setTopic(null);
      setMessages((current) => [...current, { role: 'lbao', text: EXIT_ACK }]);
    }
  }, [updateClarify, updatePicking]);

  /** 聊天状态 → sessionStorage（v3）。量小（纯文本 + 数字），任何一层变了整体重写。 */
  useEffect(() => {
    try {
      const snap: ChatSnapshot = {
        v: 3,
        messages: messages.slice(-200),
        pending,
        pendingSeq: pendingSeq.current,
        mode,
        topic,
        missStreak,
      };
      sessionStorage.setItem(CHAT_SNAPSHOT_KEY, JSON.stringify(snap));
    } catch {
      /* 隐私模式 / 配额满 → 记录只活在当前挂载期，不影响功能 */
    }
  }, [messages, pending, mode, topic, missStreak]);

  // 身份在首次渲染时确定一次，之后整个会话稳定不变（惰性初始化，避免每次渲染重读 storage）
  const [identity] = useState(() => ({
    userId: getUserId(),
    sessionId: currentSessionId(),
  }));

  /** 跨会话恢复（E8）：挂载时拉一次后端历史。
   *  · 有快照 → 与历史合并去重（chatRestore.mergeHistory，快照没覆盖的更早消息排前面）；
   *  · 无快照（关过标签页）→ 用历史重建对话（问候语让位给真实记录）；
   *  · 后端没开 / 历史为空 → 什么都不动（本地快照或问候语就是全部）。
   *  服务挂了静默降级：恢复是增强能力，不能因为它在聊天页报错。 */
  useEffect(() => {
    if (!RESTORE_CHAT) return;
    let cleared = false;
    try {
      cleared = sessionStorage.getItem(CHAT_CLEARED_KEY) === '1';
    } catch { /* 隐私模式读不到就当没清过 */ }
    if (cleared) return;
    let alive = true;
    chatHistory(identity, 50)
      .then(({ messages: rows }) => {
        if (!alive || rows.length === 0) return;
        setMessages((current) => (
          boot
            ? mergeHistory(current, rows)
            // 无快照（关过标签页）→ 用历史重建；问候语让位给真实记录（点「清空对话」可取回）
            : historyToMsgs(rows)
        ));
      })
      .catch(() => { /* 后端不可用：维持现状，不打扰用户 */ });
    return () => { alive = false; };
    // 只在挂载时执行一次；identity 与 boot 都是惰性初始化的常量
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 记忆面板开关（M3） */
  const [memoryOpen, setMemoryOpen] = useState(false);

  /** 清空对话（E8 配套）：走现有 /api/memory/reset —— 删本会话全部原文/摘要，
   *  并抹掉本设备的画像与事实（后端同一套语义，按钮文案如实告知范围）。
   *  后端没开也照常清本地：残留在后端的记录会在下次挂载时被拉回来，
   *  所以同时置 CLEARED 标记，本标签页内不再自动恢复。 */
  const clearChat = async () => {
    try {
      await resetMemory(identity);
    } catch { /* 服务未连接：本地照清，标记兜底 */ }
    try {
      sessionStorage.setItem(CHAT_CLEARED_KEY, '1');
    } catch { /* 隐私模式写不进就算了 */ }
    setPending({});
    pendingSeq.current = 0;
    setTopic(null);
    setMissStreak(0);
    setMode('chat');
    setMessages([{ role: 'lbao', text: GREETING }]);
  };

  /** 用户档案摘要：画像轴值 + 本周课表 + 学期阶段 + 基础信息（M1）。
   *  每轮随请求发出，但只在 profile / schedule 变化时重算 —— 后端会把它注入 system prompt，
   *  这是「梨宝知道你是谁」这件事的全部数据来源。 */
  const profileCtx = useMemo(
    () => [buildProfileContext(profile, schedule), basicInfoContext()]
      .filter(Boolean).join('\n\n'),
    [profile, schedule],
  );

  /** 首次进入时只探测资料服务状态，不影响本地排程能力。 */
  useEffect(() => {
    lbaoHealth()
      .then((health) => setOnline(health.ok))
      .catch(() => setOnline(false));
  }, []);

  /** 对话追加后保持新消息可见，滚动仍只属于消息区域。 */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  /** 确认草稿：这一步才是**唯一**写日程的地方。
   *  写之前压一份 undo 快照（与周计划页同一套机制），排错了能一键反悔。 */
  const confirmGoal = (key: number) => {
    const g = pending[key];
    if (!g) return;

    // ── V2-2·hold：确认 → addSlot 落层 + 广播重排（被屏蔽块让位）──
    if (g.kind === 'hold' && g.holdSlot) {
      try {
        const layer = loadUserPlan();
        pushUndoSnapshot(layer);
        saveUserPlan({ ...layer, slots: addSlot(layer.slots, g.holdSlot) });
        bumpPlanVersion();
        window.dispatchEvent(new CustomEvent('usst:replan')); // WeekPlanView 监听 → replanToken+1
        setPending((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '好，这段时间空出来了，日程正在重新排。不合适按 ↩ 撤销。',
          goWeek: true,
        }]);
      } catch {
        setMessages((current) => [...current, { role: 'lbao', text: '落盘的时候出了点小状况，没写成。可以再说一遍。' }]);
      }
      return;
    }

    // ── WP9·cancel：确认 → applyCancel 落层（一次 undo 快照）──
    if (g.kind === 'cancel' && g.cancelTarget) {
      try {
        const layer = loadUserPlan();
        pushUndoSnapshot(layer);
        const nextLayer = applyCancel(layer, g.cancelTarget);
        saveUserPlan(nextLayer);
        pushPlanEvents(diffPlanEvents(layer, nextLayer)); // H8：梨宝改日程也进记忆信号
        bumpPlanVersion();
        setPending((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
        setMessages((current) => [...current, {
          role: 'lbao',
          text: `好，「${g.title}」取消了。反悔按 ↩ 撤销；要重新排一遍去周计划点「重新排一遍」。`,
          goWeek: true,
        }]);
      } catch {
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '取消的时候出了点小状况，没写成。草稿还在上面，可以再试一次。',
        }]);
      }
      return;
    }

    // ── WP9·reschedule：确认 → upsertMove 落层（source='drag'，用户明确表达）──
    if (g.kind === 'reschedule' && g.movePreview?.move) {
      try {
        const layer = loadUserPlan();
        pushUndoSnapshot(layer);
        const nextLayer = { ...layer, moves: upsertMove(layer.moves, g.movePreview.move) };
        saveUserPlan(nextLayer);
        pushPlanEvents(diffPlanEvents(layer, nextLayer)); // H8
        bumpPlanVersion();
        setPending((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
        setMessages((current) => [...current, {
          role: 'lbao',
          text: `好，「${g.title}」挪过去了（要点「重新排一遍」才会真正重排；排得不合适按 ↩ 撤销）。`,
          goWeek: true,
        }]);
      } catch {
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '挪的时候出了点小状况，没写成。草稿还在上面，可以再试一次。',
        }]);
      }
      return;
    }

    // ── WP9·replace：取消 + 新增两步一次快照（一次确认）──
    if (g.kind === 'replace' && g.cancelTarget && g.tasks.length > 0) {
      const target = g.cancelTarget;
      try {
        const layer = loadUserPlan();
        pushUndoSnapshot(layer);
        const afterCancel = applyCancel(layer, target);
        const tasks = g.tasks.reduce((acc, t) => addTask(acc, t), afterCancel.tasks);
        const nextLayer = { ...afterCancel, tasks };
        saveUserPlan(nextLayer);
        pushPlanEvents(diffPlanEvents(layer, nextLayer)); // H8
        bumpPlanVersion();
        setPending((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
        setMessages((current) => [...current, {
          role: 'lbao',
          text: `好，替换完成：取消「${target.title}」，新增「${g.title}」× ${g.tasks.length} 块。反悔按 ↩ 一步撤销。`,
          goWeek: true,
        }]);
      } catch {
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '替换的时候出了点小状况，没写成。草稿还在上面，可以再试一次。',
        }]);
      }
      return;
    }

    // ── create（原有路径）──
    if (!g || g.tasks.length === 0) return;
    try {
      const layer = loadUserPlan();
      pushUndoSnapshot(layer);
      const tasks = g.tasks.reduce((acc, t) => addTask(acc, t), layer.tasks);
      const nextLayer = { ...layer, tasks };
      saveUserPlan(nextLayer);
      pushPlanEvents(diffPlanEvents(layer, nextLayer)); // H8
      bumpPlanVersion();
      setPending((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `好，「${g.title}」写进${weeksLabel(g.weeks)}的日程了，共 ${g.tasks.length} 个块。去周计划看全貌；排得不合适可以撤销（↩），也可以直接跟我说改。`,
        goWeek: true,
      }]);
      track('plan_result', { ok: true, ms: 0, n: g.tasks.length });
    } catch {
      track('degrade', { id: 'goal-save-error' });
      setMessages((current) => [...current, {
        role: 'lbao',
        text: '写入日程的时候出了点小状况，没写成。草稿还在上面，你可以再点一次，或去周计划手动加。',
      }]);
    }
  };

  /** WP11：重要日建议卡确认 —— 用户点头才写 deadlineStore。
   *  只落库 + 回执，**不触发任何重排**（WP11 铁律：增补只问询，不自动重排）。 */
  const confirmDeadline = (key: number) => {
    const prop = pendingDeadlines[key];
    if (!prop) return;
    try {
      addUserDeadline({ title: prop.title, date: prop.date, leadDays: prop.prepDays });
      setPendingDeadlines((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `记下了：「${prop.title}」，${prop.date.slice(5).replace('-', '.')} 截止。到点前我会把它排进周计划；现在不动你这一周。`,
        goWeek: true,
      }]);
    } catch {
      setMessages((current) => [...current, {
        role: 'lbao',
        text: '记这条重要日的时候出了点小状况，没记上。你可以再说一遍，或去「总览」手动加。',
      }]);
    }
  };

  /** 记忆卡操作（M2）：confirm / reject / undo —— 只作用于用户点到的那一条。
   *  客观事实确认后同步写进本地基础信息（AI 只提议、用户拍板的最后一公里）。 */
  const handleFact = async (msgIndex: number, fact: MemoryFact, action: 'confirm' | 'reject' | 'undo') => {
    try {
      await decideFact(identity.userId, fact.id, action);
      if (action === 'confirm' && objectiveKeyToField(fact.key)) {
        applyObjectiveFact(fact.key, fact.value);
      }
    } catch {
      return; // 服务挂了：卡片留在原地，用户可重试
    }
    setMessages((current) => current.map((m, i) => (i === msgIndex ? {
      ...m,
      proposals: m.proposals?.filter((f) => f.id !== fact.id),
      applied: m.applied?.filter((f) => f.id !== fact.id),
    } : m)));
  };

  /** 目标槽位 → 干跑把关 → 追问 / 草稿 / 冲突说明。
   *  「新句子抽出的槽位」与「追问接续补齐的槽位」共用这一条通路 ——
   *  两口各写一份必然漂移（同 checkGoalFeasibility 是唯一完备性判定的道理）。 */
  /** 把目标块算出来（cancel / reschedule / replace 都要对着真实日程匹配）。
   *  引擎不可用就退化为只匹配用户待办 —— 诚实降级，不崩。 */
  const blocksForMatching = async (today: string): Promise<TimeBlock[]> => {
    try {
      const weekNo = currentWeekNo(schedule.termStart, today);
      const plan = await planWeekForChat(schedule, profile, weekNo);
      return plan?.blocks ?? [];
    } catch {
      return [];
    }
  };

  /** WP9·cancel 执行器：按名匹配（先待办后日程 activity/study 块）。
   *  找不到说清楚；命中多个走追问通道；唯一命中才出确认卡（还没动手）。 */
  const runCancel = async (slots: IntentSlots, today: string) => {
    const q = (slots.targetHint || slots.title || '').trim();
    if (!q) {
      updateClarify({ slots: { ...slots, missing: [...new Set([...slots.missing, 'target' as const])] }, asked: ['target'] });
      setMessages((current) => [...current, { role: 'lbao', text: '好，取消哪件事？说个名字我好找到它。' }]);
      setLoading(false);
      return;
    }
    const blocks = await blocksForMatching(today);
    const targets = findCancelTargets(q, loadUserPlan().tasks, blocks, {
      termStart: schedule.termStart, weekNo: currentWeekNo(schedule.termStart, today),
    });
    if (targets.length === 0) {
      updateClarify(null);
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `日程和待办里都没找到「${q}」。可能不在这周，或者叫法不一样；你也可以去周计划直接删。`,
        goWeek: true,
      }]);
      setLoading(false);
      return;
    }
    if (targets.length > 1) {
      // V2-1：候选挂进 picking —— 下一句回复按名匹配，不再依赖 applyClarifyAnswer 认 target
      updateClarify(null);
      updatePicking({ kind: 'cancel', slots, candidates: targets });
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `「${q}」对上好几件事，你要取消哪个？`,
        planPoints: targets.slice(0, 5).map((t) => `${t.origin === 'user' ? '待办' : '日程'}：${t.title}（${t.hint}）`),
      }]);
      setLoading(false);
      return;
    }
    await runCancelWithTarget(slots, targets[0]);
  };

  /** V2-2·hold 执行器：「这段时间别排」→ 不可时段草稿（写 slots 通道，确认后落盘+广播重排） */
  const runHold = async (slots: IntentSlots, today: string) => {
    const draft = holdSlotFrom(slots);
    if ('need' in draft) {
      updateClarify({ slots: { ...slots, missing: [...new Set([...slots.missing, 'when' as const])] }, asked: ['when'] });
      setMessages((current) => [...current, { role: 'lbao', text: '好，哪段时间要空出来？（比如「周三下午」「周五晚上」）' }]);
      setLoading(false);
      return;
    }
    const weekNo = currentWeekNo(schedule.termStart, today);
    const slot = holdToUnavailableSlot(draft, weekNo);
    const key = (pendingSeq.current += 1);
    setPending((p) => ({ ...p, [key]: { kind: 'hold', title: slot.title ?? '留空时段', tasks: [], weeks: [], holdSlot: slot } }));
    markDraft(key, slots); // D3：草稿卡挂 topic{draft}
    const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    setMessages((current) => [...current, {
      role: 'lbao',
      text: '把这段时间空出来（还没动手）：',
      planPoints: [`周${draft.day} ${hh(draft.fromMin)}–${hh(draft.toMin)} 不排任何事`, '确认后我会重新排，让开这段时间'],
      goalAsk: key,
    }]);
    setLoading(false);
  };

  const runCancelWithTarget = async (slots: IntentSlots, t: CancelTarget) => {
    const key = (pendingSeq.current += 1);
    setPending((p) => ({ ...p, [key]: { kind: 'cancel', title: t.title, tasks: [], weeks: [], cancelTarget: t } }));
    markDraft(key, slots); // D3：草稿卡挂 topic{draft} —— 语音「确认」也能走 confirm_draft
    setMessages((current) => [...current, {
      role: 'lbao',
      text: `找到「${t.title}」（${t.hint}）。还没动手，确认我就取消：`,
      goalAsk: key,
    }]);
    setLoading(false);
  };

  /** WP9·reschedule 执行器：定位块 → dragTo 同一条合规校验 → 涟漪预览 → 确认落层。
   *  找不到/多个/没说挪到哪天 → 一律追问，不硬猜。 */
  const runReschedule = async (slots: IntentSlots, today: string) => {
    const q = (slots.targetHint || slots.title || '').trim();
    if (!q) {
      updateClarify({ slots: { ...slots, missing: [...new Set([...slots.missing, 'target' as const])] }, asked: ['target'] });
      setMessages((current) => [...current, { role: 'lbao', text: '要挪的是哪件事？说个名字我好找到它。' }]);
      setLoading(false);
      return;
    }
    const blocks = await blocksForMatching(today);
    const targets = findMoveTargets(q, blocks);
    if (targets.length === 0) {
      updateClarify(null);
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `这周日程里没找到「${q}」。只有非课程块能这样挪；改课时间请用周计划的「调课」。`,
        goWeek: true,
      }]);
      setLoading(false);
      return;
    }
    if (targets.length > 1) {
      // V2-1：候选挂进 picking（块级候选，title+day 可辨）
      updateClarify(null);
      updatePicking({
        kind: 'reschedule', slots,
        candidates: targets.map((b) => ({ blockId: b.id, title: b.title, origin: 'plan' as const, hint: `周${b.dayOfWeek} ${b.startMin}–${b.endMin}` })),
      });
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `「${q}」对上好几块，挪哪个？`,
        planPoints: targets.slice(0, 5).map((b) => `${b.title}（周${b.dayOfWeek} ${b.startMin}–${b.endMin}）`),
      }]);
      setLoading(false);
      return;
    }
    const src = targets[0];
    const newDay = slots.when?.weekday
      ?? (slots.dateFrom ? (() => { const wd = weekdayOf(slots.dateFrom); return wd === 0 ? 7 : wd; })() : undefined);
    if (!newDay) {
      updateClarify({ slots: { ...slots, missing: [...new Set([...slots.missing, 'when' as const])] }, asked: ['when'] });
      setMessages((current) => [...current, { role: 'lbao', text: `「${src.title}」要挪到哪天？（比如「周五下午」）` }]);
      setLoading(false);
      return;
    }
    const weekNo = currentWeekNo(schedule.termStart, today);
    const startMin = slots.window?.fromMin ?? src.startMin;
    const preview = planReschedule(blocks, src.id, weekNo, newDay, startMin);
    if (!preview.ok || !preview.move) {
      updateClarify(null);
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `挪不过去 —— ${preview.reason ?? '那个时段放不下'}。换个时间试试？`,
        goWeek: true,
      }]);
      setLoading(false);
      return;
    }
    await runRescheduleWithPreview(slots, src.title, preview);
  };

  /** V2-1：候选已定块 → 按 blockId 找回块本体，直接进拖拽预览 */
  const runRescheduleWithTarget = async (slots: IntentSlots, today: string, target: CancelTarget) => {
    const blocks = await blocksForMatching(today);
    const src = blocks.find((b) => b.id === target.blockId);
    if (!src) {
      setMessages((current) => [...current, { role: 'lbao', text: '这块刚被日程刷新弄没了，再说一遍要挪的事？' }]);
      setLoading(false);
      return;
    }
    const weekNo = currentWeekNo(schedule.termStart, today);
    const preview = planReschedule(blocks, src.id, weekNo, src.dayOfWeek, src.startMin);
    await runRescheduleWithPreview(slots, src.title, preview);
  };

  const runRescheduleWithPreview = async (slots: IntentSlots, title: string, preview: ReschedulePreview) => {
    const key = (pendingSeq.current += 1);
    setPending((p) => ({ ...p, [key]: { kind: 'reschedule', title, tasks: [], weeks: [], movePreview: preview } }));
    markDraft(key, slots); // D3：草稿卡挂 topic{draft}
    const mv = preview.move!;
    const lines = [
      `${title} → 周${mv.dayOfWeek} ${String(Math.floor(mv.startMin / 60)).padStart(2, '0')}:${String(mv.startMin % 60).padStart(2, '0')} 起`,
      ...preview.displaced.map((d) => `被顺延：${d.title} → 周${d.day} ${d.start}–${d.end}`),
    ];
    setMessages((current) => [...current, {
      role: 'lbao',
      text: preview.displaced.length > 0 ? '挪后会有涟漪（还没动手）：' : '挪后不影响别的块（还没动手）：',
      planPoints: lines,
      goalAsk: key,
    }]);
    setLoading(false);
  };

  /** WP9·replace 执行器：先 cancel 后 create，两步一次确认、一次快照。 */
  const runReplace = async (slots: IntentSlots, today: string) => {
    const q = (slots.targetHint || slots.title || '').trim();
    if (!q) {
      updateClarify({ slots: { ...slots, missing: [...new Set([...slots.missing, 'target' as const])] }, asked: ['target'] });
      setMessages((current) => [...current, { role: 'lbao', text: '要替换掉哪件事？说个名字我好找到它。' }]);
      setLoading(false);
      return;
    }
    const blocks = await blocksForMatching(today);
    const targets = findCancelTargets(q, loadUserPlan().tasks, blocks, {
      termStart: schedule.termStart, weekNo: currentWeekNo(schedule.termStart, today),
    });
    if (targets.length !== 1) {
      // 0 个：没有可替换的既有块 → 走普通 create 通路
      if (targets.length === 0) {
        await runGoalSlots({ ...slots, intent: 'create' }, today);
        return;
      }
      // D3（B② 根治）：多候选改道 picking（带日期 hint 的候选挂进议题）——
      // 下一句「明天的那个」由 dialog 裁决/规则挑块接续，不再进 clarify 收槽死胡同
      updatePicking({ kind: 'replace', slots, candidates: targets });
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `「${q}」对上好几件事，替换哪个？`,
        planPoints: targets.slice(0, 5).map((t) => `${t.origin === 'user' ? '待办' : '日程'}：${t.title}（${t.hint}）`),
      }]);
      setLoading(false);
      return;
    }
    const verdict = checkGoalFeasibility({ slots, schedule, profile, today });
    if (verdict.kind !== 'ok' && verdict.kind !== 'tight') {
      markBlocked(slots, 'conflict', verdict);
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `新的安排排不进去：`,
        planPoints: [...describeVerdict(verdict)],
        goWeek: true,
      }]);
      setLoading(false);
      return;
    }
    await runReplaceWithTarget(slots, targets[0], today);
  };

  /** D3（B②）：replace 候选已定 → 取消该目标 + 新任务草稿，两步一次确认。
   *  从 runReplace（唯一命中）与 pick_candidate 执行器两处进入。 */
  const runReplaceWithTarget = async (slots: IntentSlots, target: CancelTarget, today: string) => {
    const verdict = checkGoalFeasibility({ slots, schedule, profile, today });
    if (verdict.kind !== 'ok' && verdict.kind !== 'tight') {
      markBlocked(slots, 'conflict', verdict);
      setMessages((current) => [...current, {
        role: 'lbao',
        text: '新的安排排不进去：',
        planPoints: [...describeVerdict(verdict)],
        goWeek: true,
      }]);
      setLoading(false);
      return;
    }
    const tasks = goalToTasks(slots, schedule, today);
    const weeks = [...new Set(tasks.map((t) => t.weeks?.[0]).filter((w): w is number => Number.isFinite(w)))].sort((a, b) => a - b);
    const key = (pendingSeq.current += 1);
    setPending((p) => ({ ...p, [key]: { kind: 'replace', title: slots.title, tasks, weeks, cancelTarget: target } }));
    markDraft(key, slots); // D3：草稿卡挂 topic{draft}
    setMessages((current) => [...current, {
      role: 'lbao',
      text: '一次替换，两步并作一步（还没动手）：',
      planPoints: [`取消：${target.title}（${target.hint}）`, `新增：${slots.title} × ${tasks.length} 块`, ...describeVerdict(verdict)],
      goalAsk: key,
      goWeek: true,
    }]);
    setLoading(false);
  };

  const runGoalSlots = async (slots: IntentSlots, today: string) => {
    const t0 = Date.now();
    try {
      // ── WP9 + V2-2：非 create 意图走各自执行器，不再全塞进 create 通路 ──
      if (slots.intent === 'cancel') { await runCancel(slots, today); return; }
      if (slots.intent === 'reschedule') { await runReschedule(slots, today); return; }
      if (slots.intent === 'replace') { await runReplace(slots, today); return; }
      if (slots.intent === 'hold') { await runHold(slots, today); return; }

      // ── WP11：重要日意图 → 走提案卡，不进排程干跑（记节点 ≠ 排块）──
      if (slots.intent === 'add_deadline') {
        const prop = deadlineProposal(slots);
        if ('needDate' in prop) {
          // 缺截止日 → 必追问，不猜（core §4）。补 'when' 进追问清单，让接续答案能被收进槽位。
          updateClarify({ slots: { ...slots, missing: [...new Set([...slots.missing, 'when' as const])] }, asked: ['when'] });
          setMessages((current) => [...current, {
            role: 'lbao',
            text: `想把「${slots.title || '这件重要日子'}」记成重要日，我还得问一句：`,
            planPoints: ['它哪天截止？（比如「12 月 19 号」）'],
          }]);
          setLoading(false);
          return;
        }
        updateClarify(null);
        const dKey = (pendingSeq.current += 1);
        setPendingDeadlines((p) => ({ ...p, [dKey]: prop }));
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '帮你盯着这个节点（记下不等于现在就重排日程）：',
          planPoints: [prop.message],
          deadlineAsk: dKey,
        }]);
        setLoading(false);
        return;
      }

      // 干跑把关：能不能排，由**引擎**说了算，不由 LLM 的嘴说了算。
      // （不传 weekNo —— 干跑按候选块**真正落在的周**逐周跑，见 checkGoalFeasibility。）
      const verdict = checkGoalFeasibility({ slots, schedule, profile, today });
      track('plan_result', { ok: true, ms: Date.now() - t0 });

      const lines = [...describeSlots(slots), ...describeVerdict(verdict)];

      if (verdict.kind === 'needs_clarification') {
        // 信息不全 → 只追问，绝不动手。猜一个排进去，比慢一轮更糟。
        // 半成品槽位 + **问过的槽位清单**存起来 —— 用户的下一句话是「答案」，
        // 且第 i 段答案对应第 i 问（分号批量应答协议，S 批 §3.2）。
        const pairs = topQuestionPairs(slots);
        updateClarify({ slots, asked: pairs.map((p) => p.slot) });
        setMessages((current) => [...current, {
          role: 'lbao',
          text: `想把「${slots.title}」排进日程，我还得问${pairs.length > 1 ? '两' : ''}句：`,
          planPoints: numberedQuestions(pairs),
        }]);
        setLoading(false);
        return;
      }

      // 走到这就不再等答案了：出草稿或说清冲突，都算「这轮问完了」。
      // （D3：不再 setTopic(null) —— 相位由下面的 draft/blocked 路径接管，priorFailed 保留。）

      if (verdict.kind === 'ok' || verdict.kind === 'tight') {
        // 排得下 → 出草稿，**等确认**。这是 L4 边界：梨宝不替用户拍板。
        // 窗口常跨多周 —— 落盘的周从任务本身取，不假设是「当前周」。
        const goalTasks = goalToTasks(slots, schedule, today);
        const weeks = [...new Set(goalTasks.map((t) => t.weeks?.[0]).filter((w): w is number => Number.isFinite(w)))].sort((a, b) => a - b);
        const key = (pendingSeq.current += 1);
        setPending((p) => ({ ...p, [key]: {
          title: slots.title,
          tasks: goalTasks,
          weeks,
        } }));
        markDraft(key, slots); // D3：草稿卡挂 topic{draft}
        setMessages((current) => [...current, {
          role: 'lbao',
          text: verdict.kind === 'ok'
            ? `「${slots.title}」我排了一版草稿（还没写进日程）：`
            : `「${slots.title}」排得下，但会紧一点。草稿在这（还没写进日程）：`,
          planPoints: lines,
          goalAsk: key,
          goWeek: true,
        }]);
        setLoading(false);
        return;
      }

      // conflict / infeasible → 说清楚卡在哪 + 给选项，**不出确认按钮**。
      // D3：挂 topic{blocked} + priorFailed —— B① 议题续用与 negotiate_block 的依据。
      markBlocked(
        slots,
        verdict.kind === 'infeasible'
          ? 'no_placement'
          : verdict.placedCount > 0 && verdict.placedCount < verdict.candidateCount ? 'partial_placed' : 'conflict',
        verdict,
      );
      setMessages((current) => [...current, {
        role: 'lbao',
        text: verdict.kind === 'conflict'
          ? `「${slots.title}」这么排会撞车：`
          : `「${slots.title}」我排不进去：`,
        planPoints: lines,
        goWeek: true,
      }]);
    } catch {
      track('degrade', { id: 'goal-engine-error' });
      updateClarify(null);
      setMessages((current) => [...current, {
        role: 'lbao',
        text: '排的时候出了点小状况，这次没排出来。完整时间轴在「周计划」里，可以先看着。',
        goWeek: true,
      }]);
    }
    setLoading(false);
  };

  /** 发送提问；排程意图在本地处理，其余交给校园资料问答。
   *
   *  埋点（`@/lib/telemetry`）只记**数字与枚举**，且只落本机：
   *  这里记得到的是「这一次排程/检索花了多久、成没成、召回了几条、哪条链路降级了」，
   *  记不到的（也刻意不记）是用户问了什么 —— 守 NF-2「个人数据本地优先」。 */
  /** S2：徽章上的「退出」按钮 —— 与打字说退出词同一出口（schedSession.isExitCommand 同款回执）。 */
  const exitSession = () => {
    setTopic(null);
    setMessages((current) => [...current, { role: 'lbao', text: EXIT_ACK }]);
  };

  /** T 批换向 · LLM 裁决钩子 —— 所有消息（含关键词闸判 false 的句子）先让 LLM 看一眼。
   *  返回 verdict：action=true → mergeLlmPrimary（LLM 槽位为主，规则层结构化校验）；
   *  action=false 且置信 ≥0.6 → 直接交回 RAG；null = 端点挂/离线 → 规则链路兜底。
   *  CY 2026-09-27 晚拍板：关键词闸门数学上不可穷尽，「周二晚上；6点到7点」这类
   *  续答句只有 LLM 先看才接得住。 */
  const llmJudge = useCallback(async (raw: string, seed: IntentSlots, history?: string[]) => {
    try {
      const res = await planUnderstand({
        scene: 'intent',
        q: raw,
        slots: {
          title: seed.title || undefined,
          when_text: seed.when?.text,
          perWeekCount: seed.perWeekCount,
          durationMin: seed.durationMin,
          totalHours: seed.totalHours,
          place: seed.place,
          targetHint: seed.targetHint,
        },
        today: todayISO(),
        history,
      });
      if (!res.ok) return null;
      return {
        action: !!res.action,
        intent: (res.intent ?? undefined) as IntentSlots['intent'] | undefined,
        patch: mapUnderstandPatch(res.patch),
        confidence: typeof res.confidence === 'number' ? res.confidence : 0.5,
      };
    } catch {
      return null;
    }
  }, []);

  /** S3 · 应答救援：规则 applyClarifyAnswers 没接住时，LLM 把回答按 asked 定位成
   *  「槽位 → 原话片段」，片段回规则抽取器结构化（applyClarifyFragments）。
   *  T 批：端点把回答里**任何**槽位信息都归位（asked 只是提示），带历史防指代。
   *  没接住 / 失败返回 null —— 走规则结论（保留式追问），不算错误。 */
  const rescueClarifyAnswer = useCallback(async (
    q: string, c: ClarifyState, today: string, history?: string[],
  ): Promise<ClarifyAnswersResult | null> => {
    try {
      const res = await planUnderstand({
        scene: 'answer',
        q,
        asked: c.asked.map((slot) => `${slot}: ${questionsForSlots(c.slots, [slot])[0]?.question ?? slot}`),
        today,
        history,
      });
      if (!res.ok || !res.answers) return null;
      const r = applyClarifyFragments(res.answers as Partial<Record<SlotKey, string>>, c.slots, c.asked, today);
      return r.contributed ? r : null;
    } catch {
      return null;
    }
  }, []);

  /** 问答通路（D3 从 send 主干抽出）：chit_chat act 与 RAG 兜底共用同一段。
   *  排程模式下由 chit_chat 调用时**不动 topic** —— 议题保留。 */
  const ragReply = async (q: string) => {
    const t1 = Date.now();
    try {
      const response = await lbaoChat(q, identity, profileCtx, getRecentPlanEvents());
      track('search', { ok: true, ms: Date.now() - t1, n: response.sources?.length ?? 0 });
      setMessages((current) => [...current, {
        role: 'lbao', text: response.answer, sources: response.sources,
        mode: response.mode,
        debug: response,
        proposals: response.memory_proposals?.length ? response.memory_proposals : undefined,
        applied: response.memory_applied?.length ? response.memory_applied : undefined,
      }]);
      setOnline(true);
    } catch {
      track('degrade', { id: 'chat-offline' });
      setOnline(false);
      setMessages((current) => [
        ...current,
        { role: 'lbao', text: '校园资料服务暂时未连接。启动 server/app.py 后，我就可以继续查询资料。' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  /** D3 · ACT_EXECUTORS —— dialog 裁决的 8 个动作执行器。
   *  ctx 携带发送时刻的快照（topic/confidence），执行器不读渲染态旧值以外的状态。
   *  白名单校验（validateDialogAct）已在 tryDialogAct 里前置，这里只管执行。 */
  const ACT_EXECUTORS: Record<DialogAct, (args: DialogActArgs, ctx: {
    q: string; today: string; topic: DialogTopic | null; confidence: number;
  }) => Promise<void>> = {
    ask_slot: async (args, ctx) => {
      const slot = (args.slot ?? 'when') as SlotKey;
      const t = ctx.topic;
      if (!t) return;
      if (t.phase === 'draft') {
        // 犹豫/追问 → 重列草稿要点（confirm 双闸不过时的同一口径），草稿卡不动
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '先不急 —— 草稿还没落盘，要点再对一遍：',
          planPoints: describeSlots(t.slots),
        }]);
        setLoading(false);
        return;
      }
      // collect / blocked / picking → 把该槽位挂进追问清单（落 topic{collect}）
      const slots: IntentSlots = { ...t.slots, missing: [...new Set([...t.slots.missing, slot])] };
      const asked = [...new Set([...t.asked, slot])];
      setTopic(collectTopic(slots, asked));
      setMessages((current) => [...current, {
        role: 'lbao',
        text: '好，那我还得问一句：',
        planPoints: numberedQuestions(questionsForSlots(slots, [slot])),
      }]);
      setLoading(false);
    },

    pick_candidate: async (args, ctx) => {
      const t = ctx.topic;
      if (!t?.candidates?.length) return;
      const cands = t.candidates;
      let option: PickOption | undefined;
      if (args.candidate_idx != null) {
        option = cands.find((o) => o.idx === args.candidate_idx);
      } else if (args.target_text) {
        const hits = matchCandidate(args.target_text, cands.map((o) => o.target));
        if (hits.length === 1) option = cands.find((o) => o.target === hits[0]);
      }
      if (!option) {
        // 诚实重列，不硬猜
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '没对上唯一一个，候选是这些：',
          planPoints: cands.map((o) => `${o.origin === 'user' ? '待办' : '日程'}：${o.title}（${o.hint}）`),
        }]);
        setLoading(false);
        return;
      }
      if (t.pickKind === 'reschedule') await runRescheduleWithTarget(t.slots, ctx.today, option.target);
      else if (t.pickKind === 'replace') await runReplaceWithTarget(t.slots, option.target, ctx.today);
      else await runCancelWithTarget(t.slots, option.target);
    },

    confirm_draft: async (_args, ctx) => {
      const t = ctx.topic;
      if (!t?.draftKey) return;
      // 双闸：confidence≥0.8 且整句命中确认词表；不过 → 重列草稿要点
      if (ctx.confidence >= 0.8 && CONFIRM_RE.test(ctx.q.replace(/\s+/g, ''))) {
        setTopic(null);
        confirmGoal(t.draftKey);
        return;
      }
      setMessages((current) => [...current, {
        role: 'lbao',
        text: '先别急 —— 草稿还没落盘，要点再对一遍：',
        planPoints: describeSlots(t.slots),
      }]);
      setLoading(false);
    },

    discard_topic: async () => {
      setTopic(null);
      setMessages((current) => [...current, { role: 'lbao', text: '好，这件事先放下。想排再叫我。' }]);
      setLoading(false);
    },

    resume_topic: async (_args, ctx) => {
      const pf = ctx.topic?.priorFailed;
      if (!pf) return;
      setMessages((current) => [...current, {
        role: 'lbao',
        text: pf.title ? `好，回到刚才那件事（${pf.title}）——` : '好，回到刚才那件事 ——',
      }]);
      await runGoalSlots(pf.slots, ctx.today);
    },

    new_intent: async (args, ctx) => {
      const intent = args.intent ?? 'create';
      const patch = mapUnderstandPatch(args.patch);
      const t = ctx.topic;

      // D7：用户按编号选中协商方案 → 直接用干跑过的槽位走正常草稿通路（确认卡照旧）
      if (t?.blocking?.options?.length && args.replan_id) {
        const opt = t.blocking.options.find((o) => o.id === args.replan_id);
        if (opt) {
          await runGoalSlots(opt.slots, ctx.today);
          return;
        }
      }

      // 续答（collect 相 + 同一意图）：补丁并进现有槽位，不打断
      if (t && t.phase === 'collect' && intent === t.intent) {
        const merged = mergeLlmPrimary(t.slots, patch, ctx.today);
        merged.intent = intent;
        merged.missing = missingSlots(merged);
        if (merged.missing.length === 0) {
          await runGoalSlots(merged, ctx.today);
          return;
        }
        const pairs = topQuestionPairs(merged);
        setTopic(collectTopic(merged, pairs.map((p) => p.slot)));
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '还差一点：',
          planPoints: numberedQuestions(questionsForSlots(merged, pairs.map((p) => p.slot))),
        }]);
        setLoading(false);
        return;
      }

      // 「把 X 替换掉」隐含「用刚才想排的事替换」（B① 议题续用）：
      // 替换诉求没带新事的投入信息、而刚才有一件没排成的 → 用它的槽位当新事
      let merged = mergeLlmPrimary(parseIntentSlots(ctx.q, ctx.today), patch, ctx.today);
      merged.intent = intent;
      if (intent === 'replace' && t?.priorFailed
        && merged.durationMin == null && merged.totalHours == null && merged.perWeekCount == null) {
        merged = {
          ...t.priorFailed.slots,
          intent: 'replace',
          targetHint: merged.targetHint || merged.title,
          title: t.priorFailed.title,
          raw: ctx.q,
        };
      }
      if (!merged.title && merged.targetHint
        && (merged.intent === 'reschedule' || merged.intent === 'cancel' || merged.intent === 'replace')) {
        merged.title = merged.targetHint;
      }
      merged.missing = missingSlots(merged);
      if (t) {
        // 有声打断：旧议题先放下（blocked 的 priorFailed 会被新议题的 blocked 重记）
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '好，先按新说的办 —— 刚才那件事先放下。',
        }]);
      }
      await runGoalSlots(merged, ctx.today);
    },

    negotiate_block: async (_args, ctx) => {
      const t = ctx.topic;
      const blocking = t?.blocking;
      if (!blocking) return;
      // D7：协商回复基于引擎事实（挡路块），并给出**干跑过、真排得上**的编号方案。
      // 只提议不落盘 —— 用户选中后仍走 runGoalSlots → 草稿卡 → 确认（L4 不变）。
      const options = proposeReplanOptions({
        slots: t!.slots, verdict: blocking.verdict, schedule, profile, today: ctx.today,
      });
      setTopic((prev) => (prev?.blocking
        ? transitionTopic(prev, { blocking: { ...prev.blocking, options } })
        : prev));
      setMessages((current) => [...current, {
        role: 'lbao',
        text: options.length > 0
          ? '现在这样排不进去 —— 挡路的是这些。好在有几条**真排得上**的路（回编号就行）：'
          : '现在这样排不进去 —— 挡路的是这些：',
        planPoints: [
          ...blocking.blockingBlocks.map((o) => `${o.hint} 已有「${o.title}」`),
          ...(options.length > 0
            ? options.map((o, i) => `${i + 1}. ${o.label}`)
            : ['可以：① 换个时间；② 挪到下一周；③ 换掉其中一块。你说哪个，我来改。']),
        ],
        goWeek: true,
      }]);
      setLoading(false);
    },

    chit_chat: async (_args, ctx) => {
      await ragReply(ctx.q); // 议题保留：不动 topic、不清 missStreak 之外的状态
    },
  };

  /** D3 · 对话管理器入口：一次 dialog 裁决 → 双层校验 → 执行器。
   *  返回 true = 本轮已被接管；false（端点挂/校验拒/执行器异常）= 规则链路兜底。 */
  const tryDialogAct = async (q: string, today: string, history: string[]): Promise<boolean> => {
    try {
      const res = await planUnderstand({
        scene: 'dialog',
        q,
        today,
        history,
        state: serializeDialogState({ topic, missStreak }),
      });
      if (!res.ok || !res.act) return false;
      const args = (res.args ?? {}) as DialogActArgs;
      const confidence = typeof res.confidence === 'number' ? res.confidence : 0.5;
      // 双层校验的前端层：act 枚举 / idx 必须在候选清单（防编造）/ negotiate 要有阻塞事实
      if (!validateDialogAct(res.act, args, { topic })) return false;
      // 议题轮数上限：> TOPIC_TURNS_LIMIT 自动作废并说明（不静默）
      if (topic && topicExpired({ ...topic, turns: topic.turns + 1 }) && res.act !== 'discard_topic') {
        setTopic(null);
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '这件事咱们来回聊了挺多轮，先放下歇歇 —— 想继续就重新说一遍。',
        }]);
        setLoading(false);
        return true;
      }
      await ACT_EXECUTORS[res.act as DialogAct](args, { q, today, topic, confidence });
      // 本轮已被对话管理器接管：参与过对话 → missStreak 清零；还活着的议题轮数 +1
      setMissStreak(0);
      setTopic((prev) => (prev ? bumpTurns(prev) : null));
      return true;
    } catch {
      return false;
    }
  };

  const send = async (raw?: string, opts?: { forceMode?: 'chat' | 'sched' }) => {
    const q = (raw ?? input).trim();
    if (!q || loading) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', text: q }]);
    setLoading(true);

    /** D0：本轮生效的模式。切换提示卡的「继续」按钮带着 forceMode 重发原句，
     *  避免 setMode 还没落地时 send 读到旧值。 */
    const activeMode = opts?.forceMode ?? mode;

    /** 意图分流（`libaoIntent.ts`，规则优先、可测试）：
     *  · 说得出**名字**的事 → 目标草稿路径（干跑把关 → 用户确认 → 落盘）；
     *  · 泛泛的「安排/规划一下」（没有对象）→ 维持老行为：给这一周的建议；
     *  · 都不是 → RAG 问答。
     *  老的 `isRecommendIntent` 已被 `looksLikeAction` 取代 —— 后者是它的
     *  **超集**，且有专门的超集测试守着（scripts/libaoIntent.test.ts）。 */
    const today = todayISO();

    /** T 批：最近对话尾巴随理解请求发出 —— 「周二晚上；6点到7点」这类续答句
     *  靠它接住被打断的排程上下文。只发角色+截断文本，不带 planPoints 等渲染噪音。 */
    const history = messages.slice(-8)
      .filter((m) => m.text.length > 0 && m.text.length <= 300)
      .slice(-4)
      .map((m) => `${m.role === 'user' ? '用户' : '梨宝'}: ${m.text.slice(0, 80)}`);

    // ── S2 · 状态机出口①：collect 态显式退出（最高优先，确定性，不耗 LLM）────
    // 词表与判定在 schedSession.ts；退出 = 清空追问/挑块并回 idle，不再追问。
    if (schedMode === 'collect' && isExitCommand(q)) {
      setTopic(null);
      setMessages((current) => [...current, { role: 'lbao', text: EXIT_ACK }]);
      setLoading(false);
      return;
    }

    // ── D3 · 对话管理器主干：排程模式 + 后端在线 → 每轮恰一次 dialog 裁决 ──
    // act 接管本轮（含 chit_chat，议题保留）；端点挂/超时/校验拒 → 原样落回
    // 下面的规则链路（S/T 批产出全保留为 fallback，离线可用性不变）。
    if (DIALOG_ENABLED && activeMode === 'sched' && online !== false) {
      const handled = await tryDialogAct(q, today, history);
      if (handled) return;
    }

    // ── V2-1：多目标挑块接续 —— 上一条在等「挪哪个/取消哪个」→ 这句按名匹配候选 ──
    if (clarifyPicking) {
      const hits = matchCandidate(q, clarifyPicking.candidates);
      if (hits.length === 1) {
        const target = hits[0];
        const { kind, slots } = clarifyPicking;
        updatePicking(null);
        if (kind === 'cancel') await runCancelWithTarget(slots, target);
        else if (kind === 'replace') await runReplaceWithTarget(slots, target, today);
        else await runRescheduleWithTarget(slots, today, target);
        return;
      }
      // 未命中 / 多命中 → 诚实重列，不硬猜
      const list = (hits.length > 0 ? hits : clarifyPicking.candidates).slice(0, 5)
        .map((t) => `${t.origin === 'user' ? '待办' : '日程'}：${t.title}（${t.hint}）`);
      setMessages((current) => [...current, {
        role: 'lbao',
        text: hits.length === 0 ? `没找到「${q}」。候选是这些：` : '这几条还挑不出唯一一个，再说具体点：',
        planPoints: list,
      }]);
      setLoading(false);
      return;
    }

    // ── 追问接续：上一条梨宝消息在等答案 → 这句先当「回应」解析 ──
    // 「每周 3 次、每次 2 小时」单独看不是动作句，looksLikeAction 判 false 是对的；
    // 没有这段，答案就会掉进 RAG 问答被记忆层带偏（2026-09-20 真实翻车）。
    // S 批 P2/P5：按提问时记下的 asked 清单做**位置对应**解析，支持分号一句多答。
    // S 批 P1：答非所问**不再静默丢态** —— 保留式追问（missStreak≥2 才作废并说明）。
    if (clarify) {
      let merged = applyClarifyAnswers(q, clarify.slots, clarify.asked, today);
      if (!merged.contributed) {
        // S3：规则没接住 → LLM 语义定位救援（结构化仍在规则层；救援失败静默走
        // 规则结论 —— 保留式追问，不算错误）。T 批：带历史防指代。
        const rescue = await rescueClarifyAnswer(q, clarify, today, history);
        if (rescue) merged = rescue;
      }
      if (merged.contributed) {
        if (merged.slots.missing.length > 0) {
          // 补了一半（或某段没答上）→ 只重问 failed 的槽位（asked 空时兜底重算）
          const nextAsked = merged.failed.length > 0
            ? merged.failed
            : topQuestionPairs(merged.slots).map((p) => p.slot);
          updateClarify({ slots: merged.slots, asked: nextAsked });
          setMessages((current) => [...current, {
            role: 'lbao',
            text: '还差一点：',
            planPoints: numberedQuestions(questionsForSlots(merged.slots, nextAsked)),
          }]);
          setLoading(false);
          return;
        }
        // 补齐了 → 带着完整槽位走同一条干跑通路
        updateClarify(null);
        await runGoalSlots(merged.slots, today);
        return;
      }

      // 状态机出口④前哨：完全无关 —— 先给**新动作句**一次打断机会（以新句为准）。
      // 打断是有声的：回应里说明旧追问作废，不让用户猜自己上一轮的回答去哪了。
      const interrupt = await parseGoalIntent(q, { today, llmJudge, history });
      if (interrupt.action) {
        updateClarify(null);
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '好，先按新说的办 —— 刚才那条追问先放下。',
        }]);
        await runGoalSlots(interrupt.slots, today);
        return;
      }

      // 状态机出口③前哨：保留式追问 —— 记下这句，提醒还差什么，不静默掉 RAG。
      const streak = nextMissStreak(missStreak, false);
      if (shouldExpireSession(streak)) {
        // 出口③：连续两轮无关 → 作废并说明（不静默）。本句继续走下面的普通分流。
        updateClarify(null);
        setMessages((current) => [...current, { role: 'lbao', text: EXPIRE_NOTE }]);
      } else {
        setMissStreak(streak);
        setMessages((current) => [...current, {
          role: 'lbao',
          text: HOLD_ON_PREFIX,
          planPoints: numberedQuestions(questionsForSlots(clarify.slots, clarify.asked)),
        }]);
        setLoading(false);
        return;
      }
    }

    const outcome = await parseGoalIntent(q, { today, llmJudge, history });

    // 验收修正（2026-09-27 E2E 抓到）：hold 没有 title（它是「留空一段时间」，
    // 不是一件「事」）—— 门只认 title 会把 hold 整句漏进泛泛安排分支，
    // runHold 永远到不了。放行 hold：when 槽位由 runHold 自己追问补齐。
    // S4 E2E 抓到同族缺口：add_deadline 也常无 title（「我要考驾照」——「驾照」
    // 不在目标词表），deadlineProposal 有「重要日子」缺省标题，同样放行。
    if (outcome.action && (outcome.slots.title || outcome.slots.intent === 'hold' || outcome.slots.intent === 'add_deadline')) {
      // D0 双模式：问答模式听到排程意图 → 出切换提示，**不静默改道**。
      // 「揣测用意直接排」是议题断层的来源；用户点「继续」才切排程模式并原句重发。
      if (activeMode === 'chat') {
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '看起来你是想安排日程。问答模式下我不动你的日程 —— 要排的话，切到排程模式我来接手：',
          modeHint: q,
        }]);
        setLoading(false);
        return;
      }
      await runGoalSlots(outcome.slots, today);
      return;
    }

    if (outcome.action) {
      /** 泛泛的「帮我安排这周」→ 老路径（一周建议）。
       *  这里维持原样，是因为用户没点名任何一件具体的事 ——
       *  追问「你要排什么」反而答非所问。
       *  D0：问答模式同样不静默改道 —— 出切换提示。 */
      if (activeMode === 'chat') {
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '看起来你是想安排日程。问答模式下我不动你的日程 —— 要排的话，切到排程模式我来接手：',
          modeHint: q,
        }]);
        setLoading(false);
        return;
      }
      if (!profile && schedule.courses.length === 0) {
        track('degrade', { id: 'plan-no-input' });
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '我还不了解你的作息偏好，也还没看到你的课表。完成画像或导入课表后，我就能按你的实际情况安排这一周。',
          needProfile: true,
        }]);
        setLoading(false);
        return;
      }

      const weekNo = currentWeekNo(schedule.termStart);
      const t0 = Date.now();
      try {
        const plan = await planWeekForChat(schedule, profile, weekNo);
        track('plan_result', { ok: !!plan, ms: Date.now() - t0 });
        setMessages((current) => [...current, plan ? {
          role: 'lbao',
          text: `第 ${weekNo} 周我按你的课表排了一版，你懂我意思吧：`,
          planPoints: summarizeWeekPlan(plan),
          goWeek: true,
        } : {
          // 引擎排不了（该周不在学期范围）→ 直说，不编造日程
          role: 'lbao',
          text: '这一周不在本学期的范围里，我排不出来。换一周再问我，或者直接去「周计划」翻翻看。',
          goWeek: true,
        }]);
      } catch {
        // 引擎异常 → 诚实说明。**绝不用模板兜底**，那正是我们要消灭的东西。
        track('degrade', { id: 'plan-engine-error' });
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '排的时候出了点小状况，这次没排出来。完整时间轴在「周计划」里，可以先看着。',
          goWeek: true,
        }]);
      }
      setLoading(false);
      return;
    }

    /** 问答意图经过后端检索；服务不可用时保留当前对话并给出恢复方式。
     *  D3：抽出为 ragReply —— chit_chat act 与这里共用同一段（议题保留由调用方控制）。 */
    await ragReply(q);
  };

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-ink/[0.07] bg-white shadow-[0_12px_32px_rgba(22,35,63,0.06)] lg:grid-cols-[264px_minmax(0,1fr)] lg:grid-rows-1 xl:grid-cols-[264px_minmax(0,1fr)_300px]">
      <aside className="hero-surface flex flex-col px-5 py-5 text-white sm:px-6 lg:py-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/10 text-sm font-semibold" aria-hidden="true">梨</span>
          <div>
            <h1 className="text-base font-semibold">梨宝</h1>
            <p className="mt-0.5 text-xs text-white/50">校园问答与本周建议</p>
          </div>
        </div>

        <div className="mt-5 border-y border-white/10 py-4 lg:mt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">WHAT I CAN HELP</p>
          <p className="mt-3 text-sm leading-6 text-white/72">校园公开资料的查询，或结合你的课表和画像，给这一周留出可执行的空间。</p>
        </div>

        <div className="mt-5 lg:mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">TRY ASKING</p>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {QUICK.map((question) => (
              <button
                key={question}
                onClick={() => send(question)}
                disabled={loading}
                className="min-h-11 rounded-xl border border-white/10 px-3 py-2 text-left text-sm text-white/75 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {question}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto pt-4 lg:pt-6">
          {/* 记忆入口（M3）：梨宝记住了什么，点开全部可见、可确认、可撤销、可删 */}
          <button
            onClick={() => setMemoryOpen(true)}
            className="mb-3 w-full rounded-xl border border-white/15 px-3 py-2 text-left text-xs text-white/70 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
          >
            📓 梨宝记住了什么（查看 / 确认 / 删除）
          </button>
          {/* 清空对话（E8 配套）：恢复默认开启后给用户一个「从头开始」的出口。
              范围 = 本会话记录 + 本设备记忆（/api/memory/reset 的真实语义），文案不美化。 */}
          <button
            onClick={clearChat}
            disabled={loading}
            className="mb-3 w-full rounded-xl border border-white/15 px-3 py-2 text-left text-xs text-white/70 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            🗑 清空对话与记忆（本设备，不可恢复）
          </button>
          {/* 未连接用琥珀而不是品牌靛蓝：靛蓝在这套色板里代表「正常 / 可操作」，
              拿它表示服务不可用会把告警读成常态。 */}
          <div className={`flex items-center gap-2 text-xs ${online === false ? 'text-accent' : 'text-white/55'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${online === true ? 'bg-ok' : online === false ? 'bg-accent' : 'bg-white/35'}`} aria-hidden="true" />
            {online === true ? '校园资料服务已连接' : online === false ? '校园资料服务未连接' : '正在连接校园资料服务'}
          </div>
        </div>
      </aside>

      {/* WP9：排程预览侧栏（xl 及以上显示）。只读；草稿态/落盘态由 caption 如实区分。 */}
      <aside className="hidden min-h-0 flex-col gap-2 overflow-y-auto border-l border-ink/[0.07] bg-paper/40 p-3 xl:flex" data-testid="lbao-plan-sidebar">
        <MiniWeekPreview
          draft={previewPlan}
          caption={Object.keys(pending).length > 0 ? '草稿 · 未落盘' : '本周排程 · 已落盘'}
        />
        <p className="text-[10.5px] leading-4 text-ink-faint">随你的确认实时更新；只读预览，改动去周计划或直接跟我说。</p>
      </aside>

      <section className="flex min-h-0 flex-col p-3 sm:p-5">
        {online === false && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-accent/25 bg-accent-light px-3 py-2 text-sm leading-5 text-ink-soft">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            启动 <code className="font-semibold text-ink">python server/app.py</code> 后，可继续查询校园资料；本地排程仍可使用。
          </div>
        )}

        {schedMode === 'collect' && (
          <div
            data-testid="sched-badge"
            className="mb-3 flex items-center gap-2 rounded-xl border border-brand/25 bg-brand/5 px-3 py-2 text-xs leading-5 text-ink-soft"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            {/* D3：徽章按相位说话 —— collect/picking 等回答；draft 等确认；blocked 给方向。
                草稿相位会话并未结束（可语音确认），徽章保留但换了说法，不再是「回答问题」口径。 */}
            {topic?.phase === 'draft'
              ? '草稿待确认 —— 点「就这么排」，或直接说「就这么排 / 先不排」。'
              : topic?.phase === 'blocked'
                ? '排程卡住了 —— 换个时间，或让我用别的安排顶掉挡路的块。'
                : '排程中 —— 回答上面的问题就行；多个答案用分号隔开。'}
            <button onClick={exitSession} className="shrink-0 font-medium text-brand underline underline-offset-2">
              退出
            </button>
          </div>
        )}

        <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 py-2 sm:px-2" aria-live="polite">
          {messages.map((message, index) => (
            <div key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`flex max-w-[88%] flex-col gap-2 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                {message.role === 'lbao' && (
                  <div className="flex items-center gap-2 pl-1">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-ink text-[10px] font-bold text-white" aria-hidden="true">梨</span>
                    <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-faint">梨宝{message.mode === 'llm' ? ' · AI' : ''}</span>
                  </div>
                )}
                <div className={`rounded-xl border px-3.5 py-3 text-sm leading-6 whitespace-pre-wrap ${
                  message.role === 'user' ? 'border-brand bg-brand text-white' : 'border-ink/10 bg-paper text-ink'
                }`}>
                  {message.text}
                </div>

                {message.needProfile && onGoProfile && (
                  <button onClick={onGoProfile} className="button-primary ml-1 px-3 py-2 text-xs">完成画像</button>
                )}

                {/* D0：问答模式下的排程意图提示卡 —— 点击 = 切模式 + 原句重发进排程流。
                    不自动排：切不切、排不排，决定权都在用户手里（L4）。 */}
                {message.modeHint != null && (
                  <button
                    data-testid="switch-to-sched"
                    onClick={() => {
                      const q = message.modeHint as string;
                      setMode('sched');
                      void send(q, { forceMode: 'sched' });
                    }}
                    className="button-primary ml-1 px-3 py-2 text-xs"
                  >
                    切到排程模式并继续
                  </button>
                )}

                {message.planPoints && message.planPoints.length > 0 && (
                  <ul className="w-full space-y-1 pl-1">
                    {message.planPoints.map((point, i) => (
                      <li key={i} className="text-[12.5px] leading-5 text-ink-soft">· {point}</li>
                    ))}
                  </ul>
                )}

                {/* 目标草稿卡：确认前不写任何状态 —— 执行权在用户手里 */}
                {message.goalAsk != null && pending[message.goalAsk] && (
                  <div className="flex gap-2 pl-1">
                    <button onClick={() => confirmGoal(message.goalAsk!)} className="button-primary px-3 py-2 text-xs">
                      就这么排
                    </button>
                    <button
                      onClick={() => setPending((p) => {
                        const next = { ...p };
                        delete next[message.goalAsk as number];
                        return next;
                      })}
                      className="rounded-xl border border-ink/15 px-3 py-2 text-xs text-ink-soft transition-colors hover:border-ink/30"
                    >
                      先不排
                    </button>
                  </div>
                )}

                {message.deadlineAsk != null && pendingDeadlines[message.deadlineAsk] && (
                  <div className="flex gap-2 pl-1">
                    <button onClick={() => confirmDeadline(message.deadlineAsk!)} className="button-primary px-3 py-2 text-xs">
                      好，记下来
                    </button>
                    <button
                      onClick={() => setPendingDeadlines((p) => {
                        const next = { ...p };
                        delete next[message.deadlineAsk as number];
                        return next;
                      })}
                      className="rounded-xl border border-ink/15 px-3 py-2 text-xs text-ink-soft transition-colors hover:border-ink/30"
                    >
                      先不用
                    </button>
                  </div>
                )}

                {message.goWeek && (
                  <p className="pl-1 text-[11.5px] text-ink-faint">完整时间轴在「总览 → 选一周 → 周计划」</p>
                )}

                {/* 记忆建议卡（M2）：客观事实（年级/学院/专业）只提议，点头才记 */}
                {message.proposals && message.proposals.length > 0 && (
                  <div className="w-full space-y-2 pl-1">
                    <p className="text-[11.5px] text-ink-faint">我在对话里听到了这些身份信息，你点头我才记：</p>
                    {message.proposals.map((fact) => (
                      <div key={fact.id} className="flex w-full items-center justify-between gap-2 rounded-xl border border-ink/10 bg-paper px-3 py-2 text-sm">
                        <span className="text-ink">{factLabel(fact.key)}：{fact.value}</span>
                        <span className="flex shrink-0 gap-2">
                          <button onClick={() => void handleFact(index, fact, 'confirm')} className="button-primary px-3 py-1.5 text-xs">记下来</button>
                          <button onClick={() => void handleFact(index, fact, 'reject')} className="rounded-xl border border-ink/15 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink/30">不记</button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 已自动生效的偏好（M2）：自动记下，但随时可撤销 */}
                {message.applied && message.applied.length > 0 && (
                  <div className="w-full space-y-1.5 pl-1">
                    {message.applied.map((fact) => (
                      <div key={fact.id} className="flex w-full items-center justify-between gap-2 rounded-xl border border-ok/25 bg-ok/10 px-3 py-2 text-[12.5px] text-ink-soft">
                        <span>顺手记下了：{factLabel(fact.key)} · {fact.value}</span>
                        <button onClick={() => void handleFact(index, fact, 'undo')} className="shrink-0 underline underline-offset-2">撤销</button>
                      </div>
                    ))}
                  </div>
                )}

                {message.sources && message.sources.length > 0 && (
                  <div className="w-full divide-y divide-ink/10 border-y border-ink/10 pl-1">
                    {message.sources.slice(0, 3).map((source, sourceIndex) => (
                      <a
                        key={sourceIndex}
                        href={source.url || undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="block py-3 transition-colors hover:text-brand"
                      >
                        <div className="text-sm font-semibold leading-5 text-ink">{source.title}</div>
                        <div className="mt-1 text-xs text-ink-faint">{source.account} · {source.pub_time}</div>
                      </a>
                    ))}
                  </div>
                )}

                {SHOW_DEBUG && message.debug && <ChatDebug data={message.debug} />}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 border border-ink/10 bg-paper px-3.5 py-3 text-sm text-ink-soft">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-ink text-[10px] font-bold text-white animate-pulse" aria-hidden="true">梨</span>
                梨宝掐指一算中…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* D0：输入框主模式分段切换 —— 问答/排程硬区分，消灭「揣测用意」。
            切到问答 = 显式退出排程态（switchMode 内有声回执）。 */}
        <div className="mb-2 flex items-center gap-2" data-testid="mode-switch">
          <div className="flex rounded-xl border border-ink/15 bg-paper p-0.5">
            <button
              data-testid="mode-chat"
              onClick={() => switchMode('chat')}
              aria-pressed={mode === 'chat'}
              className={`min-h-8 rounded-[10px] px-3 py-1 text-xs transition-colors ${
                mode === 'chat' ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'
              }`}
            >
              问答
            </button>
            <button
              data-testid="mode-sched"
              onClick={() => switchMode('sched')}
              aria-pressed={mode === 'sched'}
              className={`min-h-8 rounded-[10px] px-3 py-1 text-xs transition-colors ${
                mode === 'sched' ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'
              }`}
            >
              排程
            </button>
          </div>
          <span className="text-[11px] leading-4 text-ink-faint">
            {mode === 'sched' ? '排程模式：说要排的事，梨宝出草稿、你确认才落盘' : '问答模式：只查资料答问题，不动你的日程'}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-ink/10 pt-3">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && send()}
            placeholder={schedMode === 'collect'
              ? '排程中 —— 回答上面的问题，多个答案用分号隔开；说「退出排程」结束…'
              : mode === 'sched'
                ? '排程模式：说一件要安排的事（如「周四晚上出去玩一小时」）…'
                : '问梨宝，或说「帮我安排这周」…'}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-ink/15 bg-paper px-4 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
          <button onClick={() => send()} disabled={loading || !input.trim()} className="button-primary shrink-0 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40">
            发送
          </button>
        </div>
      </section>

      <MemoryPanel open={memoryOpen} userId={identity.userId} onClose={() => setMemoryOpen(false)} />
    </div>
  );
}
