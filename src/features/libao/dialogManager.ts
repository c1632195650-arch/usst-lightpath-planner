/**
 * 梨宝 · 对话管理器（D 批 D1 · 纯逻辑层）
 * ============================================================
 * ── 为什么要有这个文件 ────────────────────────────────────────
 * D 批之前，排程会话的状态散在三处 React state 里（clarify / clarifyPicking /
 * schedMode），各自带一套写入口与生命周期 ——「上一句在等什么」没有单一答案，
 * LLM 对话管理器（D2/D3）也就没有一份可以整体递给它的状态。
 *
 * 本文件把「对话状态」收敛为一个 `DialogTopic`（当前议题）+ `DialogState`
 * （议题 + 无关轮计数 + 输入模式），并提供四件纯逻辑能力：
 *
 *   ① topic 构造器（collect / picking / draft / blocked 四相）——
 *      LbaoChat 的状态迁移全部走这里，不再手拼对象；
 *   ② 序列化白名单（`serializeDialogState`）—— 递给 LLM 的状态是有界的：
 *      slots 只给 9+1 个键、候选/阻塞块 ≤5 条、总体 ≤4KB（防状态膨胀）；
 *   ③ `validateDialogAct` —— LLM 裁决的前端复核（防编造：candidate_idx
 *      必须真的在候选清单里；confirm 只在草稿在场时放行）；
 *   ④ 快照 v3 迁移 —— 写 v3、读失败回读 v2 合成（clarify→collect、
 *      clarifyPicking→picking），v1 链保留在 LbaoChat；坏数据当没有。
 *
 * 纪律：本文件**不碰 React**（不 import react）、不碰引擎 —— 组件侧的
 * 派生兼容（`clarify` / `clarifyPicking`）在 LbaoChat.tsx，为的是让
 * tests/v2.test.ts 的源码字面量断言与既有规则链路原样存活。
 */

import type { GoalIntent, IntentSlots, SlotKey } from './libaoIntent';
import type { CancelTarget, GoalVerdict } from './weekPlanForChat';

/* ============================================================
 * 一、状态形状
 * ========================================================== */

/** 议题四相：收集槽位 → 挑候选 → 草稿待确认 → 被阻塞（排不进去） */
export type TopicPhase = 'collect' | 'picking' | 'draft' | 'blocked';

/** 候选块（挑块/阻塞协商共用）：idx 是 LLM 引用的唯一可信编号 */
export interface PickOption {
  idx: number;
  title: string;
  origin: 'user' | 'plan';
  /** 人类可读的位置线索（阻塞块必须含 `周X(M.D) HH:MM–HH:MM`） */
  hint: string;
  /** 规则执行器要的原始目标 —— LLM 只传 idx，执行靠它 */
  target: CancelTarget;
}

/** 被阻塞的事实（B③：协商话术要基于事实，不硬编码模板） */
export interface BlockingFacts {
  kind: 'no_placement' | 'partial_placed' | 'conflict';
  verdict: GoalVerdict;
  blockingBlocks: PickOption[];
}

/** 当前议题：一次排程诉求从听到、问清、到草稿/被阻塞的全程载体 */
export interface DialogTopic {
  phase: TopicPhase;
  intent: GoalIntent;
  slots: IntentSlots;
  /** collect 相：问过的槽位清单（第 i 问 ↔ 第 i 段答，S 批协议） */
  asked: SlotKey[];
  /** picking 相：候选清单（防编造的锚 —— LLM 只许引用这里的 idx） */
  candidates?: PickOption[];
  pickKind?: 'cancel' | 'reschedule' | 'replace';
  /** draft 相：确认卡在 pending 里的键（确认执行走 confirmGoal） */
  draftKey?: number;
  /** blocked 相：挡路的事实 */
  blocking?: BlockingFacts;
  /** B① 议题续用：上一件没排成的事 ——「还是把刚才那个排上」靠它拉起 */
  priorFailed?: { title: string; slots: IntentSlots };
  /** 创建时刻（毫秒）—— 诊断用，不作过期判据 */
  createdAt: number;
  /** 该议题已经历的轮数；> TOPIC_TURNS_LIMIT 自动作废并说明（防无限占用） */
  turns: number;
}

/** 对话管理器整体状态（快照 v3 的核心，也是递给 LLM 的 state 段） */
export interface DialogState {
  v: 3;
  mode: 'chat' | 'sched';
  topic: DialogTopic | null;
  missStreak: number;
}

/** 议题轮数上限：超过就当作废处理（调用方负责说明，不静默丢弃） */
export const TOPIC_TURNS_LIMIT = 8;

const PHASES: readonly TopicPhase[] = ['collect', 'picking', 'draft', 'blocked'];
const INTENTS: readonly GoalIntent[] = [
  'create', 'replace', 'reschedule', 'cancel', 'query', 'add_deadline', 'hold',
];

/* ============================================================
 * 二、topic 构造器（LbaoChat 状态迁移的唯一来源）
 * ========================================================== */

function baseTopic(slots: IntentSlots, now: number): DialogTopic {
  return {
    phase: 'collect',
    intent: slots.intent,
    slots,
    asked: [],
    createdAt: now,
    turns: 0,
  };
}

/** 追问相：把「半成品槽位 + 问过的清单」挂成议题 */
export function collectTopic(slots: IntentSlots, asked: SlotKey[], now = Date.now()): DialogTopic {
  return { ...baseTopic(slots, now), phase: 'collect', asked: [...asked] };
}

/** 挑块相：候选挂进议题（每个候选编号 = 数组下标，LLM 引用的就是这个 idx） */
export function pickingTopic(
  kind: 'cancel' | 'reschedule' | 'replace',
  slots: IntentSlots,
  candidates: CancelTarget[],
  now = Date.now(),
): DialogTopic {
  return {
    ...baseTopic(slots, now),
    phase: 'picking',
    pickKind: kind,
    candidates: candidates.slice(0, 5).map((t, i) => ({
      idx: i,
      title: t.title,
      origin: t.origin,
      hint: t.hint,
      target: t,
    })),
  };
}

/** 草稿相：草稿卡键挂进议题（确认前什么都不写 —— L4 边界不变） */
export function draftTopic(slots: IntentSlots, draftKey: number, now = Date.now()): DialogTopic {
  return { ...baseTopic(slots, now), phase: 'draft', draftKey };
}

/** 阻塞相：排不进去的事实 + 议题续用记录 */
export function blockedTopic(
  slots: IntentSlots,
  facts: BlockingFacts,
  now = Date.now(),
): DialogTopic {
  return {
    ...baseTopic(slots, now),
    phase: 'blocked',
    blocking: facts,
    priorFailed: { title: slots.title, slots },
  };
}

/** 相位迁移：保留 priorFailed 等历史字段，只换相位与新增字段（组件侧用） */
export function transitionTopic(topic: DialogTopic, patch: Partial<DialogTopic>): DialogTopic {
  return { ...topic, ...patch };
}

/** 轮数推进：每轮对话结束后 +1（调用方在 send 收尾处调） */
export function bumpTurns(topic: DialogTopic): DialogTopic {
  return { ...topic, turns: topic.turns + 1 };
}

/** 议题是否已过期（turns 超限）。纯函数，RV 锚点：删掉超限判断 → 用例红。 */
export function topicExpired(topic: DialogTopic): boolean {
  return topic.turns > TOPIC_TURNS_LIMIT;
}

/* ============================================================
 * 三、序列化白名单（递给 LLM 的状态，有界）
 * ========================================================== */

/**
 * slots 白名单：9 个结构键 + when_text + targetHint（原话线索）。
 * 刻意不给 missing/unclear/raw —— LLM 只需要「已知道什么」，缺口的判断在前端。
 */
const SLOT_SERIAL_KEYS = [
  'title', 'when_text', 'month', 'day', 'weekday',
  'perWeekCount', 'durationMin', 'totalHours', 'place', 'targetHint',
] as const;

export function serializeSlots(slots: IntentSlots): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const w = slots.when;
  const flat: Record<string, unknown> = {
    title: slots.title || undefined,
    when_text: w?.text,
    month: w?.month,
    day: w?.day,
    weekday: w?.weekday,
    perWeekCount: slots.perWeekCount,
    durationMin: slots.durationMin,
    totalHours: slots.totalHours,
    place: slots.place,
    targetHint: slots.targetHint,
  };
  for (const k of SLOT_SERIAL_KEYS) {
    const v = flat[k];
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

/** 候选/阻塞块给 LLM 看的形状：只有 idx + title + hint，target 绝不外发 */
function pickOptionLite(o: PickOption): { idx: number; title: string; hint: string } {
  return { idx: o.idx, title: o.title, hint: o.hint };
}

/** topic → LLM 可读对象（白名单 + 上限；blocking.verdict 不外发） */
export function serializeTopic(topic: DialogTopic | null): Record<string, unknown> | null {
  if (!topic) return null;
  const out: Record<string, unknown> = {
    phase: topic.phase,
    intent: topic.intent,
    slots: serializeSlots(topic.slots),
    asked: topic.asked,
  };
  if (topic.candidates?.length) {
    out.candidates = topic.candidates.slice(0, 5).map(pickOptionLite);
  }
  if (topic.pickKind) out.pick_kind = topic.pickKind;
  if (topic.draftKey != null) out.draft_key = topic.draftKey;
  if (topic.blocking) {
    out.blocking = {
      kind: topic.blocking.kind,
      blocks: topic.blocking.blockingBlocks.slice(0, 5).map(pickOptionLite),
    };
  }
  if (topic.priorFailed) out.prior_failed_title = topic.priorFailed.title;
  return out;
}

/** 序列化体积上限：超了先砍候选/阻塞清单，再超就只发 missStreak（宁缺勿爆） */
const STATE_SERIAL_LIMIT = 4 * 1024;

export function serializeDialogState(
  state: Pick<DialogState, 'topic' | 'missStreak'>,
): { topic: Record<string, unknown> | null; missStreak: number } {
  const full = { topic: serializeTopic(state.topic), missStreak: state.missStreak };
  if (JSON.stringify(full).length <= STATE_SERIAL_LIMIT) return full;
  const trimmed = full.topic ? { ...full.topic, candidates: undefined, blocking: undefined } : null;
  if (JSON.stringify({ topic: trimmed, missStreak: state.missStreak }).length <= STATE_SERIAL_LIMIT) {
    return { topic: trimmed, missStreak: state.missStreak };
  }
  return { topic: null, missStreak: state.missStreak };
}

/* ============================================================
 * 四、LLM 裁决的前端复核（防编造；D2/D3 消费）
 * ========================================================== */

export type DialogAct =
  | 'ask_slot' | 'pick_candidate' | 'confirm_draft' | 'discard_topic'
  | 'resume_topic' | 'new_intent' | 'negotiate_block' | 'chit_chat';

export const DIALOG_ACTS: readonly DialogAct[] = [
  'ask_slot', 'pick_candidate', 'confirm_draft', 'discard_topic',
  'resume_topic', 'new_intent', 'negotiate_block', 'chit_chat',
];

export const ASKABLE_SLOTS = ['title', 'when', 'effort', 'target'] as const;
export const NEGOTIATE_OPTIONS = ['swap_block', 'move_next_week', 'reduce_scope', 'give_time'] as const;

/** LLM 给的 act 参数（服务端 _clean_dialog 已清过一遍，这里再验一层） */
export interface DialogActArgs {
  slot?: string;
  candidate_idx?: number;
  target_text?: string;
  pick_kind?: 'cancel' | 'reschedule' | 'replace';
  option?: (typeof NEGOTIATE_OPTIONS)[number];
  intent?: GoalIntent;
  /** new_intent 的槽位补丁（_clean_patch 产物，结构与 understand 端点 patch 一致） */
  patch?: Record<string, unknown>;
}

/**
 * act 白名单校验。返回 false = 视同端点失败，走规则链路（不报错、不硬执行）。
 *
 * 防编造三闸：
 *   ① pick_candidate 的 candidate_idx 必须真的在议题候选清单里；
 *   ② confirm_draft 必须有活跃草稿（双闸的另一闸是确认词表，在执行器里）;
 *   ③ negotiate_block 必须有阻塞事实在场。
 */
export function validateDialogAct(
  act: unknown,
  args: DialogActArgs,
  state: { topic: DialogTopic | null },
): boolean {
  if (typeof act !== 'string' || !(DIALOG_ACTS as readonly string[]).includes(act)) return false;
  const t = state.topic;
  switch (act as DialogAct) {
    case 'ask_slot':
      return t != null && !!args.slot && (ASKABLE_SLOTS as readonly string[]).includes(args.slot);
    case 'pick_candidate': {
      if (!t || t.phase !== 'picking' || !t.candidates?.length) return false;
      if (args.candidate_idx != null) {
        return Number.isInteger(args.candidate_idx)
          && t.candidates.some((c) => c.idx === args.candidate_idx);
      }
      return typeof args.target_text === 'string' && args.target_text.trim().length > 0;
    }
    case 'confirm_draft':
      return !!t && t.phase === 'draft' && t.draftKey != null;
    case 'discard_topic':
      return t != null;
    case 'resume_topic':
      return t?.priorFailed != null;
    case 'new_intent':
      return !!args.intent && (INTENTS as readonly string[]).includes(args.intent);
    case 'negotiate_block':
      return !!t?.blocking
        && !!args.option && (NEGOTIATE_OPTIONS as readonly string[]).includes(args.option);
    case 'chit_chat':
      return true;
    default:
      return false;
  }
}

/* ============================================================
 * 五、快照 v3 迁移（写 v3、读 v2 合成、坏数据当没有）
 * ========================================================== */

export const SNAPSHOT_V3_KEY = 'usst.libao.chat.v3';
export const SNAPSHOT_V2_KEY = 'usst.libao.chat.v2';
export const SNAPSHOT_V1_KEY = 'usst.libao.chat.v1';

/** v2 快照里追问态的形状（迁移读取用；与 LbaoChat 旧 ClarifyState 同构） */
export interface V2ClarifyShape {
  slots: IntentSlots;
  asked: SlotKey[];
}

/** v2 快照里挑块态的形状（与 LbaoChat 旧 PickingState 同构；D3 起 kind 含 replace） */
export interface V2PickingShape {
  kind: 'cancel' | 'reschedule' | 'replace';
  slots: IntentSlots;
  candidates: CancelTarget[];
}

/** v2 接续态 → 议题（picking 优先：它比 collect 更「靠前」——正在挑块说明槽位已齐） */
export function topicFromV2(
  clarify: V2ClarifyShape | null,
  picking: V2PickingShape | null,
): DialogTopic | null {
  if (picking && picking.candidates.length > 0) {
    return pickingTopic(picking.kind, picking.slots, picking.candidates);
  }
  if (clarify) return collectTopic(clarify.slots, clarify.asked);
  return null;
}

/** v2 快照 → 输入模式：显式记过就用记的；没记过按活跃排程态推导 */
export function modeFromV2(
  mode: 'chat' | 'sched' | undefined,
  schedMode: string | undefined,
): 'chat' | 'sched' {
  if (mode === 'chat' || mode === 'sched') return mode;
  return schedMode === 'collect' ? 'sched' : 'chat';
}

/**
 * 读 v3 快照时的议题防御：形状不对就当没有（坏数据当没有，别让一条坏快照挡死聊天页）。
 * 只做形状级校验（phase/intent 枚举、slots 是对象、asked 是数组），不做深度重建 ——
 * 写入方是自己，防的是跨版本脏数据。
 */
export function sanitizeTopic(raw: unknown): DialogTopic | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<DialogTopic>;
  if (!t.phase || !(PHASES as readonly string[]).includes(t.phase)) return null;
  if (!t.intent || !(INTENTS as readonly string[]).includes(t.intent)) return null;
  if (!t.slots || typeof t.slots !== 'object') return null;
  return {
    ...(t as DialogTopic),
    asked: Array.isArray(t.asked) ? t.asked : [],
    slots: { ...(t.slots as IntentSlots), missing: t.slots.missing ?? [], unclear: t.slots.unclear ?? [] },
  };
}
