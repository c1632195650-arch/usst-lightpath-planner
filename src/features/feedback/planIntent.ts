/**
 * 计划意图解析（阶段 E）—— 「跟梨宝说一句」的统一入口
 * ============================================================
 * 把用户的一句自然语言归类成**四类可执行的意图**：
 *
 *   · `constraint`   提要求（「周四下午别排东西」）→ 存成偏好校正规则
 *   · `add-task`     加一件事（「周三晚上加个实验」）→ 存成 UserTask
 *   · `remove-block` 拿掉一块（「删掉周三下午的自习」）→ 记进排除清单
 *   · `explain`      问原因（「为什么周三排这么多」）→ 用引擎现成的 reason 回答
 *
 * ── 为什么不做成「丢给大模型」────────────────────────────────
 * 1. 这四类意图**全都能落到已有的结构化通道上**（校正规则 / UserTask /
 *    excludedBlockIds / PlanIssue），根本不需要模型参与；
 * 2. 规则解析**确定、可测、零依赖**，而且失败时不猜（返回 `unknown` 让 UI 兜）；
 * 3. 真接了模型，还得处理「模型理解错了怎么办」——而现在用户在回显框里
 *    当场就能看见「我理解成什么」并改掉。
 *
 * ── 设计纪律 ──────────────────────────────────────────────────
 * 纯函数、确定性、不 fetch、不读时钟、不用随机。
 * 生成 id / 时间戳是**调用方**的事（本模块只产出草稿）。
 */
import type { BlockKind, DayOfWeek } from '@/types';
import { matchDays, matchWindow, parseCorrection, type CorrectionDraft } from './parseCorrection.ts';
import { toMinutes } from '@/constants/time';

/** 「加一件事」的草稿（还没有 id） */
export interface TaskDraft {
  title: string;
  kind: BlockKind;
  /** 指定了星期才可能同时有开始时间 */
  dayOfWeek?: DayOfWeek;
  startMin?: number;
  durationMin: number;
  /**
   * R3.5：产出这条草稿的**原话**。
   * 「长期 vs 一次性」由 `detectScope(text)` 用这句话判，
   * 若这里是空的，调用方就只能猜 —— 与「不猜」纪律冲突，所以宁可存下来。
   */
  utterance?: string;
}

export type PlanIntent =
  | { type: 'constraint'; draft: CorrectionDraft }
  | { type: 'add-task'; task: TaskDraft }
  | { type: 'remove-block'; days: DayOfWeek[]; blockKind?: BlockKind }
  | { type: 'explain'; topic: string }
  | { type: 'unknown'; text: string };

/** 解释类意图的触发词 */
const EXPLAIN = /(为什么|为啥|怎么|为何|啥原因|什么原因)/;

/** 删除类意图的触发词 */
const REMOVE = /(删掉|删除|去掉|取消|不要这|拿掉|移除)/;

/** 添加类意图的触发词 */
const ADD = /(?:帮我)?(?:加|添加|安排|加上|加个|加一个|添)/;

/**
 * 从「加一个 X」里把 X 抠出来。
 *
 * 这是本模块最"脏"的一处 —— 中文的「加」后面可以跟任意长度的描述，
 * 而且时间修饰**可能在句首也可能在句尾**（「周三晚上的实验」/「实验，周三晚上」）。
 * 策略：两头都各剥一轮，剥完以「的」开头也去掉；
 * **剥没了就退回原文** —— 宁可多带几个字，也别把用户想加的事弄丢。
 * 最终答案由 UI 回显给用户确认，这里只是预填。
 */
function extractTitle(t: string): string {
  const m = t.match(/(?:帮我)?(?:加|添加|安排|加上|加个|加一个|添)\s*(?:一个|一件|个)?\s*(.+)$/);
  if (!m) return '';
  const raw = m[1].trim();

  const DAY = '(?:周|星期|礼拜)[一二三四五六日天]';
  const PERIOD = '(?:早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)';
  const SEPS = '[，,。.、\\s]*';

  const stripped = raw
    // 头部：日期、时段（`周X` 不吃后面的字，避免把事件名一起吃掉）
    .replace(new RegExp(`^${SEPS}(?:到|在)?\\s*${DAY}${SEPS}`), '')
    .replace(new RegExp(`^${SEPS}(?:到|在)?\\s*${PERIOD}(?:\\d{1,2}\\s*点)?${SEPS}`), '')
    .replace(/^的\s*/, '')
    // 尾部：再说一遍日期/时段
    .replace(new RegExp(`${SEPS}(?:到|在)?\\s*${DAY}.*$`), '')
    .replace(new RegExp(`${SEPS}(?:到|在)?\\s*${PERIOD}.*$`), '')
    .replace(/[，,。.、\s]+$/, '')
    .trim();

  return stripped || raw;
}

/** 从句子里提时长；提不到给默认值 */
function extractDuration(t: string, fallback = 60): number {
  const half = t.match(/半\s*(?:个)?\s*小时/);
  if (half) return 30;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(小时|钟头|分钟|分|h|min)/i);
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = m[2];
  const isHour = unit === '小时' || unit === '钟头' || unit.toLowerCase() === 'h';
  const min = Math.round(isHour ? n * 60 : n);
  // 夹到合理区间：太短没意义，太长一定是解析错了
  return Math.min(600, Math.max(5, min));
}

/** 「加」的句子通常含具体钟点（「19:00」「晚上7点」），尽力取一个 */
function extractClock(t: string): number | null {
  const hm = t.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (hm) {
    const h = Number(hm[1]);
    const mi = Number(hm[2]);
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return h * 60 + mi;
  }
  const cn = t.match(/(早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)?\s*(\d{1,2})\s*点/);
  if (cn) {
    let h = Number(cn[2]);
    const period = cn[1] ?? '';
    if (h >= 0 && h <= 23) {
      // 「晚上 7 点」= 19:00；「下午 3 点」= 15:00
      if ((period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里' || period === '晚间') && h < 12) {
        h += 12;
      }
      return h * 60;
    }
  }
  return null;
}

/** 识别块类型（与 parseCorrection 的词表保持一致的语义） */
function kindOf(t: string): BlockKind | undefined {
  if (/实验|报告|作业|复习|预习|学习|自习|看书/.test(t)) return 'study';
  if (/运动|跑步|健身|锻炼|球/.test(t)) return 'activity';
  if (/吃饭|午饭|晚饭|聚餐/.test(t)) return 'meal';
  if (/社团|活动|约|玩|聚会/.test(t)) return 'activity';
  return undefined;
}

/**
 * 解析一句自然语言。**永不抛错**：认不出就返回 `unknown`，
 * 由 UI 决定是退回表单还是记为备注（信号不丢）。
 */
export function parsePlanIntent(text: string): PlanIntent {
  const t = (text ?? '').trim();
  if (!t) return { type: 'unknown', text: '' };

  /* ① 解释类 —— 问「为什么」不是要改计划，优先识别，免得被当成约束 */
  if (EXPLAIN.test(t)) {
    return { type: 'explain', topic: t };
  }

  /* ② 删除类 */
  if (REMOVE.test(t)) {
    const days = matchDays(t);
    const win = matchWindow(t);
    const kind = kindOf(t);
    // 完全说不出删什么 → 交给上层追问（不猜）
    if (days.length === 0 && !kind) return { type: 'unknown', text: t };
    void win; // 时段可留待下一步细化；本版先按「哪几天 + 哪类」删
    return kind ? { type: 'remove-block', days, blockKind: kind } : { type: 'remove-block', days };
  }

  /* ③ 添加类 */
  if (ADD.test(t)) {
    const title = extractTitle(t);
    if (title) {
      const days = matchDays(t);
      const clock = extractClock(t);
      const win = matchWindow(t);
      const dayOfWeek = days[0];
      // 有钟点用钟点；没有但说了「下午」这类时段，用该时段的起点
      const startMin = clock ?? (win ? win.win[0] : undefined);
      const task: TaskDraft = {
        title,
        kind: kindOf(t) ?? 'activity',
        durationMin: extractDuration(t),
        ...(dayOfWeek != null ? { dayOfWeek } : {}),
        // 指定了星期才带开始时间 —— 否则会变成「固定块」，反而把引擎的手脚捆住
        ...(dayOfWeek != null && startMin != null ? { startMin } : {}),
        // R3.5：带上原话 —— 「是不是长期」要让 `detectScope()` 用同一句话判，
        //       而不是 UI 另猜一遍（计划书 §1.5-1：长期判定只有一处）
        utterance: t,
      };
      return { type: 'add-task', task };
    }
  }

  /* ④ 约束类（复用阶段 B 的解析器） */
  const draft = parseCorrection(t);
  if (draft) return { type: 'constraint', draft };

  /* ⑤ 认不出 —— 不猜 */
  return { type: 'unknown', text: t };
}

/** 给用户的示例（UI 展示「可以这么说」） */
export const INTENT_HINTS: readonly string[] = [
  '周四下午别排东西',
  '帮我加个周三晚上的实验',
  '删掉周日下午的自习',
  '我想每天多学 1 小时',
  '为什么周三排这么多',
];

/** 把意图翻译成一句回显，让用户确认「引擎理解成什么」 */
export function describeIntent(intent: PlanIntent): string {
  switch (intent.type) {
    case 'constraint':
      return '记成一条排程要求';
    case 'add-task': {
      const d = intent.task.dayOfWeek;
      const dayCn = d ? `周${'一二三四五六日'[d - 1]}` : '（时间交给引擎）';
      const when = intent.task.startMin != null
        ? ` ${Math.floor(intent.task.startMin / 60)}:${String(intent.task.startMin % 60).padStart(2, '0')}`
        : '';
      return `加一件事：「${intent.task.title}」${dayCn}${when} · ${intent.task.durationMin} 分钟`;
    }
    case 'remove-block': {
      const days = intent.days.map((d) => `周${'一二三四五六日'[d - 1]}`).join('、');
      return `拿掉${days}${intent.blockKind ? '的部分安排' : '的安排'}`;
    }
    case 'explain':
      return '回答一个「为什么」';
    case 'unknown':
      return '没看懂这句话';
  }
}
