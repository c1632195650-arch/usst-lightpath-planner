/**
 * 光溯移动端 · 执行力评估 · 每日答题存储（任务书 P3-2）
 * ============================================================
 * 「每天首次打开弹一次、当日不重复」的落点：只要当天**出现过**采集弹窗
 * （答没答都算），当天就不再弹 —— 弹出记录即日期戳。
 * 7 天去重的依据也在这里：slug → 最近一次出现日。
 * KV 注入（同 behaviorLog），副作用不进 compute。
 */
import type { QuizQuestion } from './questionBank.ts';
import type { SelfReportAnswer } from './model.ts';
import type { KV } from './behaviorLog.ts';

/** 答题记录的本地存储 key */
export const ANSWER_KEY = 'usst.mobile.evalAnswers';
/** 上限：≤5 题/天 × 一学年也远用不满，800 只是防呆 */
export const ANSWER_CAP = 800;

/** 一次「题目被弹出」的记录（answer=false = 用户跳过/未答） */
export interface ShownRecord {
  dayKey: string;
  questionId: string;
  slug: string;
  answered: boolean;
  /** answered=true 时的选项序号与该选项的行为锚定得分（0..4） */
  optionIdx?: number;
  score?: number;
}

function readRecords(kv: KV): ShownRecord[] {
  try {
    const raw = kv.getItem(ANSWER_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ShownRecord[]) : [];
  } catch {
    return [];
  }
}

function writeRecords(kv: KV, records: ShownRecord[]): void {
  kv.setItem(ANSWER_KEY, JSON.stringify(records.slice(-ANSWER_CAP)));
}

export function loadShown(kv: KV): ShownRecord[] {
  return readRecords(kv);
}

/** 今天是否已经弹过（任务书 P3-2 验收：当天已答过则不再弹） */
export function hasOfferedToday(kv: KV, todayKey: string): boolean {
  return readRecords(kv).some((r) => r.dayKey === todayKey);
}

/** 弹窗出现时整批登记（含被跳过的题 —— 它们同样占用 7 天去重窗口） */
export function recordShown(kv: KV, args: { todayKey: string; questions: readonly QuizQuestion[] }): void {
  const rows: ShownRecord[] = args.questions.map((q) => ({
    dayKey: args.todayKey,
    questionId: q.id,
    slug: q.sourceSlug,
    answered: false,
  }));
  if (rows.length === 0) return;
  writeRecords(kv, [...readRecords(kv), ...rows]);
}

/** 登记一次作答（覆盖同题当天的 answered=false 占位；找不到占位则追加） */
export function recordAnswer(kv: KV, args: { todayKey: string; question: QuizQuestion; optionIdx: number }): void {
  const score = args.question.options[args.optionIdx]?.score;
  if (score === undefined) return;
  const records = readRecords(kv);
  const row = records.find(
    (r) => r.dayKey === args.todayKey && r.questionId === args.question.id,
  );
  if (row) {
    row.answered = true;
    row.optionIdx = args.optionIdx;
    row.score = score;
  } else {
    records.push({
      dayKey: args.todayKey,
      questionId: args.question.id,
      slug: args.question.sourceSlug,
      answered: true,
      optionIdx: args.optionIdx,
      score,
    });
  }
  writeRecords(kv, records);
}

/** 记录 → 维度 5 的原料（只取实际作答的） */
export function toSelfReportAnswers(records: readonly ShownRecord[]): SelfReportAnswer[] {
  return records
    .filter((r) => r.answered && typeof r.score === 'number')
    .map((r) => ({ questionId: r.questionId, slug: r.slug, dayKey: r.dayKey, score: r.score! }));
}

/** slug → 最近一次弹出日（抽取器 7 天去重的依据） */
export function slugLastShown(records: readonly ShownRecord[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const r of records) {
    const prev = last.get(r.slug);
    if (!prev || prev < r.dayKey) last.set(r.slug, r.dayKey);
  }
  return last;
}
