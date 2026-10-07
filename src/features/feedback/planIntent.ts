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
import { matchDays, matchWindow, parseCorrection, relDayOffsets, type CorrectionDraft } from './parseCorrection.ts';
import { weekdayOf } from '@/lib/date';
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
  | { type: 'remove-block'; days: DayOfWeek[]; blockKind?: BlockKind; titleKw?: string }
  | { type: 'explain'; topic: string }
  | { type: 'unknown'; text: string };

/** 解释类意图的触发词 */
const EXPLAIN = /(为什么|为啥|怎么|为何|啥原因|什么原因)/;

/** 删除类意图的触发词 */
const REMOVE = /(删掉|删除|删去|删了|去掉|取消|不要这|拿掉|移除)/;

/** 添加类意图的触发词（2026-10-07 补「填」族 —— UI 示例 chip 自己就在用「帮我填个晚上自习」；
 *  18:36 再补「要玩/想玩/要打/想打」愿望句族 —— 「我周四下午要玩两个小时游戏」之前三处全漏） */
const ADD = /(?:帮我)?(?:加|添加|安排|安排上|加上|加个|加一个|添|填个|填上|填进|填满|填|要玩|想玩|要打|想打|玩会|玩会儿|玩一下|玩一局)/;

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
  const m = t.match(/(?:帮我)?(?:加|添加|安排|安排上|加上|加个|加一个|添|填个|填上|填进|填满|填|要玩|想玩|要打|想打|玩会|玩会儿|玩一下|玩一局)\s*(?:一个|一件|个)?\s*(.+)$/);
  if (!m) return '';
  const raw = m[1].trim();

  const DAY = '(?:周|星期|礼拜)[一二三四五六日天]';
  const PERIOD = '(?:早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)';
  const SEPS = '[，,。.、\\s]*';
  // 时长短语（含中文数字）——「玩两个小时游戏」的标题里不该带着「两个小时」
  const DUR = '[\\d一两二三四五六七八九十]+\\s*(?:个)?\\s*(?:小时|钟头|分钟|分)';

  const stripped = raw
    // 头部：日期、时段（`周X` 不吃后面的字，避免把事件名一起吃掉）
    .replace(new RegExp(`^${SEPS}(?:到|在)?\\s*${DAY}${SEPS}`), '')
    .replace(new RegExp(`^${SEPS}(?:到|在)?\\s*${PERIOD}(?:\\d{1,2}\\s*点)?${SEPS}`), '')
    .replace(new RegExp(`^${SEPS}${DUR}${SEPS}`), '')
    .replace(/^的\s*/, '')
    // 2026-10-07：动词落在句中时（「周四下午没安排，帮我填个晚上自习」），
    // 头部会残留「帮我填个」这类二次动词短语 —— 剥掉，别让它混进标题。
    .replace(new RegExp(`^${SEPS}帮我(?:填|加|排|添)?[个上]?${SEPS}`), '')
    // 尾部：再说一遍日期/时段
    .replace(new RegExp(`${SEPS}(?:到|在)?\\s*${DAY}.*$`), '')
    .replace(new RegExp(`${SEPS}(?:到|在)?\\s*${PERIOD}.*$`), '')
    .replace(/[，,。.、\s]+$/, '')
    .trim();

  // 2026-10-07：兜底前的二次清理 —— 「晚上自习」里的「晚上」会被尾部时段
  // 剥离误吃成空（时间词与标题词重叠），此时退回的 raw 若还挂着「帮我填个」
  // 这类动词前缀就太难看。先剥前缀再兜底，标题至少是干净的内容词。
  const cleanedRaw = raw.replace(new RegExp(`^${SEPS}帮我(?:填|加|排|添)?[个上]?${SEPS}`), '');

  return stripped || cleanedRaw || raw;
}

/** 从句子里提时长；提不到给默认值。中文数字（两个小时/三小时）也认 ——
 *  2026-10-07：之前只认阿拉伯数字，「要玩两个小时游戏」会静默退回 60 分钟。 */
const CN_NUM: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5,
};
function extractDuration(t: string, fallback = 60): number {
  const half = t.match(/半\s*(?:个)?\s*小时/);
  if (half) return 30;
  const m = t.match(/([\d一两二三四五六七八九十]+(?:\.\d+)?)\s*(?:个)?\s*(小时|钟头|分钟|分|h|min)/i);
  if (!m) return fallback;
  const tok = m[1];
  const n = /^[\d.]/.test(tok) ? Number(tok) : CN_NUM[tok];
  if (n == null || !Number.isFinite(n)) return fallback;
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

/**
 * 删除句的**标题关键词**：「删除所有德语自习」→「德语自习」。
 * 剥掉 量词前缀（所有/全部/都/把）与头部日期/时段、尾部「的安排」类词。
 * 空串 = 没有可用的标题词（调用方退回 天数+类型 匹配）。
 */
function removeTitleKw(t: string): string {
  const m = t.match(/(?:删掉|删除|删去|删了|去掉|取消|不要这|拿掉|移除)\s*(?:所有|全部|都|把)?\s*(.+)$/);
  if (!m) return '';
  let kw = m[1].trim();
  kw = kw
    .replace(/^(?:周|星期|礼拜)[一二三四五六日天]的?/, '')
    .replace(/^(?:早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)的?/, '')
    .replace(/(的)?(安排|块|日程)$/, '');
  kw = kw.trim();
  // 模糊指代（「删掉一些东西」）不是标题 —— 交回调用方要求补充，而不是乱删
  if (!kw || /^(?:一些)?(?:东西|它们|他们|这[些个]|那[些个]|全部)$/.test(kw)) return '';
  return kw;
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
export function parsePlanIntent(text: string, today?: string): PlanIntent {
  const t = (text ?? '').trim();
  if (!t) return { type: 'unknown', text: '' };

  /* 相对日（今天/明天/后天/大后天）→ 星期几。today 由调用方注入
   * （CorrectionCapture 传 todayISO()），纯函数不读时钟。 */
  const rels = relDayOffsets(t);
  const withRel = (base: DayOfWeek[]): DayOfWeek[] => {
    if (base.length > 0 || !today || rels.length === 0) return base;
    return rels.map((o) => ((((weekdayOf(today) - 1) + o) % 7) + 1) as DayOfWeek);
  };

  /* ① 解释类 —— 问「为什么」不是要改计划，优先识别，免得被当成约束 */
  if (EXPLAIN.test(t)) {
    return { type: 'explain', topic: t };
  }

  /* ② 删除类。2026-10-07 补 titleKw：「删除所有德语自习」是**按标题**删
   *    （含没挂星期的任务），光靠 天数+类型 匹配不到 —— 抽出标题关键词。 */
  if (REMOVE.test(t)) {
    const days = withRel(matchDays(t));
    const win = matchWindow(t);
    const kind = kindOf(t);
    const kw = removeTitleKw(t);
    // 完全说不出删什么 → 交给上层追问（不猜）
    if (days.length === 0 && !kind && !kw) return { type: 'unknown', text: t };
    void win; // 时段可留待下一步细化；本版先按「哪几天 + 哪类 + 标题」删
    return {
      type: 'remove-block', days, ...(kind ? { blockKind: kind } : {}),
      ...(kw ? { titleKw: kw } : {}),
    } as PlanIntent;
  }

  /* ③ 添加类 */
  if (ADD.test(t)) {
    const title = extractTitle(t);
    if (title) {
      const days = withRel(matchDays(t));
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
  const draft = parseCorrection(t, today);
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
      if (intent.titleKw) {
        const days = intent.days.map((d) => `周${'一二三四五六日'[d - 1]}`).join('、');
        return `删掉${days ? `${days}的` : '所有'}「${intent.titleKw}」`;
      }
      const days = intent.days.map((d) => `周${'一二三四五六日'[d - 1]}`).join('、');
      return `拿掉${days}${intent.blockKind ? '的部分安排' : '的安排'}`;
    }
    case 'explain':
      return '回答一个「为什么」';
    case 'unknown':
      return '没看懂这句话';
  }
}
