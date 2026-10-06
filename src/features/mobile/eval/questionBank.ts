/**
 * 光溯移动端 · 执行力评估 · 题库与抽取器（任务书 P2-1 / P2-2）
 * ============================================================
 * 🔴 P2-1（题库内容 ≥60 道）当前 **BLOCKED**：题目必须从任务一升格后的习惯库抽
 * （每题 sourceSlug 指向真实条目，且六类领域每类 ≥10 道）。任务一 method_kb v2
 * 已于 2026-10-06 验收通过（method_kb.db 实际入库 **160 条**，金标 126 条独立复跑
 * PASS——「42 条」是升格前的旧数，2026-10-06 收官批次 6.2 更正此处注释），
 * 题库内容补做已解锁、按 R8① 另批执行。
 * 按任务书 P0-1 的裁决「不用现有条目凑合建题库」：本文件先交付**类型、抽取器
 * 与空题库**，题库内容待任务一验收后补入 QUESTION_BANK —— 空题库 = 每日弹窗
 * 静默不弹（优雅降级，见 DailyQuizSheet），全链路已由单测（fixture 题目）验证。
 *
 * 抽取规则（P2-2，可测）：
 *   · 按今日待办类型映射到六类，从对应类抽题，轮转填满 ≤ QUIZ_MAX 道；
 *   · 同一 sourceSlug 在 DEDUP_DAYS 天内不再出（答案历史由 answerStore 提供）；
 *   · 无待办 → 「无待办」类照常出题（任务书 §3.2）；
 *   · 确定性：同输入同输出（不随机），保证单测可断言。
 */

/** 六类待办（任务书 §3.2 定死：作业/复习/运动/作息/社交/无待办） */
export type QuizCategory = 'homework' | 'review' | 'exercise' | 'routine' | 'social' | 'none';

export const QUIZ_CATEGORIES: readonly QuizCategory[] = ['homework', 'review', 'exercise', 'routine', 'social', 'none'];

export const CATEGORY_LABELS: Record<QuizCategory, string> = {
  homework: '作业',
  review: '复习',
  exercise: '运动',
  routine: '作息',
  social: '社交',
  none: '无待办',
};

export interface QuizOption {
  label: string;
  /** 行为锚定得分 0..4（越「做到」越高）；自评只喂维度 5，可与客观维交叉验证 */
  score: number;
}

export interface QuizQuestion {
  id: string;
  category: QuizCategory;
  /** 题干 —— 必须行为锚定（问「实际做了什么」，不问「你觉得如何」，任务书 §3.1） */
  text: string;
  options: QuizOption[];
  /** 来源习惯库条目 slug（存 slug 不存副本；必须能在 method_kb 检索到，红线 8） */
  sourceSlug: string;
}

/**
 * 题库本体。当前为空（BLOCKED，见文件头）—— 任务一验收后由后续批次填充：
 * 六类各 ≥10 道、全部行为锚定、sourceSlug 经 method_rag.search() 验证。
 */
export const QUESTION_BANK: readonly QuizQuestion[] = [];

/** 每日最多题数（CY 原话「题目不宜多最多5道」） */
export const QUIZ_MAX = 5;
/** 同一条目（sourceSlug）的重复出现间隔（天） */
export const DEDUP_DAYS = 7;

/** 待办类型关键词 → 题目类别（任务三 todos[] 的 kind 语义落地前先按关键词匹配） */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [QuizCategory, readonly string[]]> = [
  ['review', ['复习', '备考', '考试', 'exam', 'review', '刷题', '背诵']],
  ['exercise', ['运动', '锻炼', '跑步', '健身', 'exercise', 'workout']],
  ['routine', ['作息', '早睡', '睡眠', '起床', 'sleep', '午休']],
  ['social', ['社交', '社团', '聚会', '回复', 'social', '消息']],
  ['homework', ['作业', ' homework', 'homework', 'assignment', '实验报告', '论文', '项目', '写']],
];

/**
 * 待办 kind 关键词 → 题目类别（去重、保序）。
 * 匹配不上的 kind 不映射（宁缺毋滥）；整体映射为空 → 调用方落到「无待办」类。
 */
export function categoriesFromTodoKinds(kinds: readonly string[]): QuizCategory[] {
  const out: QuizCategory[] = [];
  for (const raw of kinds) {
    const kind = (raw ?? '').toLowerCase();
    if (!kind) continue;
    for (const [cat, words] of CATEGORY_KEYWORDS) {
      if (out.includes(cat)) continue;
      if (words.some((w) => kind.includes(w.trim().toLowerCase()))) {
        out.push(cat);
        break;
      }
    }
  }
  return out;
}

export interface PickQuestionsArgs {
  bank: readonly QuizQuestion[];
  /** 今日待办映射出的类别；空数组 = 无待办 → ['none'] */
  categories: readonly QuizCategory[];
  todayKey: string;
  /** slug → 最近一次弹出日（answerStore.slugLastShown） */
  slugLastShown: ReadonlyMap<string, string>;
  max?: number;
}

/**
 * 按类别轮转抽题（P2-2）：
 *   · 各类别依次出第 1 题、再依次出第 2 题…… 直到 max 道或抽干；
 *   · 同 sourceSlug 七天内出过 → 跳过（答案里跳过的题同样占窗口，见 answerStore）；
 *   · slug 查不到 = 从未出过 → 可用。
 */
export function pickQuestions(args: PickQuestionsArgs): QuizQuestion[] {
  const max = args.max ?? QUIZ_MAX;
  const cats: readonly QuizCategory[] = args.categories.length > 0 ? [...new Set(args.categories)] : ['none'];
  const picked: QuizQuestion[] = [];
  const pickedIds = new Set<string>();
  let round = 0;
  while (picked.length < max) {
    let offeredThisRound = false;
    for (const cat of cats) {
      if (picked.length >= max) break;
      const inCat = args.bank.filter((q) => q.category === cat);
      const candidate = inCat
        .filter((q) => !pickedIds.has(q.id))
        .find((q) => {
          const last = args.slugLastShown.get(q.sourceSlug);
          if (!last) return true;
          const diff = dayDiffForDedup(last, args.todayKey);
          return diff === null || diff >= DEDUP_DAYS;
        });
      if (candidate) {
        picked.push(candidate);
        pickedIds.add(candidate.id);
        offeredThisRound = true;
      }
    }
    if (!offeredThisRound) break; // 六类都抽干了
    round += 1;
    if (round > args.bank.length + 1) break; // 防御性上限
  }
  return picked;
}

function dayDiffForDedup(a: string, b: string): number | null {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
}

/** 无待办时的类别（独立导出便于测试与 UI 文案统一） */
export function fallbackCategory(): QuizCategory[] {
  return ['none'];
}
