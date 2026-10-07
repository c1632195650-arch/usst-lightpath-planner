/**
 * R批 Wave3（H1）· 日程评估器 —— 拿 `PlanDigest` 对权威阈值打分并给建议
 * =============================================================================
 * 评估器回答一个问题：**「这一版日程，照健康库和方法库的标准，缺什么、多了什么」**
 *
 * ── 为什么分数不是让 LLM 打的 ────────────────────────────────────────────
 *
 * 1. **可复现**。同一个日程两次评估必须同分。LLM 打分做不到。
 * 2. **可追溯**。每个结论都能指到「知识库哪一条（A 级）+ 你的哪几个块」。
 *    这是本项目的核心红线 —— 不可解释的分数会立刻失去用户信任。
 * 3. **缺项不能算 0**。用户这周没排运动，不代表他不运动。所以每个维度
 *    分两层：`coverage`（**能看到多少**，0-1）与 `score`（**在能看到的部分里
 *    达标多少**，0-100）。UI 上必须同时展示这两个数，否则用户会把
 *    「日程里看不到」误读成「你做的不够」。
 *
 * ── 三档结论的语义（严格区分，别混用）──────────────────────────────────
 *
 * | 档 | 含义 | 依据 |
 * |---|---|---|
 * | `good` | 看到的部分达标 | 该维度 confident 且满足阈值 |
 * | `gap` | 看到了，确实不够 | 该维度 confident 且不满足阈值 |
 * | `unknown` | **日程里看不到，不能判** | 该维度不 confident |
 *
 * `unknown` 绝不能降级成 `gap`。这是整个 H1 最容易写错、也最伤用户的地方：
 * 把「我看不到你今天吃了什么」说成「你饮食不健康」是造谣。
 *
 * ── 严重度与建议的分工 ─────────────────────────────────────────────────
 *
 * `severity` 决定 UI 强调程度（`info` / `warn` / `serious`），**不是**严重
 * 医学判断。健康库里 `escalate: true` 的条目（如 red-flag-exercise）不进
 * 评估器 —— 它们走对话层口径，见 `HEALTH_PARAMS.hints` 的 `escalate` 字段。
 * 评估器只做「日程结构 vs 常规参考区间」，不碰需要就医的情形。
 */
import { HEALTH_PARAMS } from './cy-data/healthParams.generated.ts';
import { METHOD_PARAMS } from './cy-data/methodParams.generated.ts';
import {
  digestThresholds,
  type DigestFact,
  type PlanDigest,
} from './planDigest.ts';

/* ============================================================
 * 结论模型
 * ========================================================== */

export type EvalStatus = 'good' | 'gap' | 'unknown';
export type Severity = 'info' | 'warn' | 'serious';

export interface EvalFinding {
  id: string;
  /** 结论一句话（≤40 字，面向用户，不含术语堆砌） */
  headline: string;
  status: EvalStatus;
  severity: Severity;
  /** 依据行：知识库条目 + 等级。`unknown` 时为 null */
  basis: EvalBasis | null;
  /** 支撑这个结论的块 id —— UI 必须能列出「是哪几个块」 */
  evidence: string[];
  /** 可执行建议（可为空数组 = 无需调整） */
  advice: string[];
  /** 日程里看不到时的说明（只在 status === 'unknown' 时有值） */
  notVisible?: string;
}

export interface EvalBasis {
  /** 知识库条目 slug */
  slug: string;
  /** 证据等级 A/B/C/D */
  tier: 'A' | 'B' | 'C' | 'D';
  /** 原始口径文字，如「每周 ≥150 分钟中等强度有氧」 */
  quote: string;
}

export interface EvalDimension {
  key: string;
  label: string;
  /** 0-1：这一维度有多少指标是有数据的（置信覆盖度） */
  coverage: number;
  /** 0-100：在有数据的部分里达标多少。coverage=0 时必为 null */
  score: number | null;
  findings: EvalFinding[];
}

export interface PlanEvaluation {
  weekNo: number;
  dimensions: EvalDimension[];
  /** 汇总建议（按严重度排序，最多 5 条） */
  topAdvice: string[];
  /** 整体覆盖度：日程里有多少维度可判。低 → UI 要提示「信息不足」 */
  coverage: number;
  /** 数据稀疏 / 强度启发式等免责说明 */
  caveats: string[];
}

/* ============================================================
 * 工具
 * ========================================================== */

/**
 * 取知识库 hint 的标题作依据行。
 *
 * ⚠️ 必须**同时查两个库** —— 首版只查健康库，导致方法库条目
 * （ultradian-rhythm / spacing-effect / habit-formation-loop）的依据行
 * 直接显示成裸 slug「C 级 ultradian-rhythm」，等于没给用户任何信息。
 * 跨库共享常量已把这条教训写死：新增引用必须两库都查。
 */
function basisFrom(hintSlug: string, quote?: string): EvalBasis {
  const all = [
    ...(HEALTH_PARAMS.hints as readonly { slug: string; title: string; tier: 'A' | 'B' | 'C' }[]),
    ...(METHOD_PARAMS.hints as readonly { slug: string; title: string; tier: 'A' | 'B' | 'C' | 'D' }[]),
  ];
  const found = all.find((h) => h.slug === hintSlug);
  return {
    slug: hintSlug,
    tier: found?.tier ?? 'C',
    quote: quote ?? found?.title ?? hintSlug,
  };
}

const round = (n: number): number => Math.round(n);
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * 「达标比例 → 0-100 分」。
 *
 * 超额不额外加分（cap 100）—— 排 400 分钟有氧不叫「更好」，只会挤掉别的，
 * 超额问题由独立的 load 维度去管，不在这里奖励。
 */
function ratioScore(value: number, target: number): number {
  if (target <= 0) return 100;
  return round(clamp01(value / target) * 100);
}

/* ============================================================
 * 各维度
 * ========================================================== */

function evalExercise(d: PlanDigest): EvalDimension {
  const th = digestThresholds();
  const findings: EvalFinding[] = [];
  let withData = 0;
  let scoreSum = 0;

  /* —— 有氧 —— */
  const mod = d.moderateMin;
  const vig = d.vigorousMin;
  const hasEx = mod.confident || vig.confident;
  if (hasEx) {
    withData++;
    // 健康库口径：中强度 150 **或** 高强度 75，二者取达标者，不相加
    const modRatio = mod.confident ? clamp01(mod.value / th.weeklyModerateMin) : 0;
    const vigRatio = vig.confident ? clamp01(vig.value / th.weeklyVigorousMin) : 0;
    const best = Math.max(modRatio, vigRatio);
    scoreSum += round(best * 100);

    // 单次过短的运动不计入 —— 这是知识库明确的口径
    const short = d.shortestExerciseSessionMin.confident
      && d.shortestExerciseSessionMin.value < th.minimumSessionMin;
    if (best >= 1) {
      findings.push({
        id: 'ex-aerobic-ok',
        headline: `有氧运动量达标（本周 ${fmtMin(Math.max(mod.value, vig.value))}）`,
        status: 'good',
        severity: 'info',
        basis: basisFrom('aerobic-150'),
        evidence: [...(mod.evidence ?? []), ...(vig.evidence ?? [])],
        advice: [],
      });
    } else {
      findings.push({
        id: 'ex-aerobic-gap',
        headline: `有氧还差 ${fmtMin(th.weeklyModerateMin * (1 - modRatio))}（本周 ${fmtMin(mod.value)}）`,
        status: 'gap',
        severity: 'warn',
        basis: basisFrom('aerobic-150'),
        evidence: [...(mod.evidence ?? []), ...(vig.evidence ?? [])],
        advice: short
          ? [
              `有运动块短于 ${th.minimumSessionMin} 分钟，低于「单次有效剂量」，建议把零散运动并成更长的块`,
              `本周补 ${th.weeklyVigorousMin} 分钟高强度可替代（对时间更紧的安排更现实）`,
            ]
          : [`本周补 ${fmtMin(th.weeklyModerateMin * (1 - modRatio))} 中等强度即可达标`],
      });
    }
  } else {
    findings.push({
      id: 'ex-aerobic-unknown',
      headline: '日程里看不到运动安排',
      status: 'unknown',
      severity: 'info',
      basis: null,
      evidence: [],
      advice: [],
      notVisible: '这一版日程里没有运动块 —— 可能是线下运动没被记进来，不等于你没运动',
    });
  }

  /* —— 力量 —— */
  if (d.strengthDays.confident) {
    withData++;
    const s = ratioScore(d.strengthDays.value, th.strengthDaysPerWeek);
    scoreSum += s;
    findings.push(
      d.strengthDays.value >= th.strengthDaysPerWeek
        ? {
            id: 'ex-strength-ok',
            headline: `力量训练覆盖 ${d.strengthDays.value} 天，达标`,
            status: 'good',
            severity: 'info',
            basis: basisFrom('strength-2days'),
            evidence: d.strengthDays.evidence,
            advice: [],
          }
        : {
            id: 'ex-strength-gap',
            headline: `力量训练只排了 ${d.strengthDays.value} 天，建议 ≥${th.strengthDaysPerWeek} 天`,
            status: 'gap',
            severity: 'warn',
            basis: basisFrom('strength-2days'),
            evidence: d.strengthDays.evidence,
            advice: ['只跑步不练力量，膝踝负担会集中上来；每周加 2 天力量对跑步更友好'],
          },
    );
  } else {
    findings.push({
      id: 'ex-strength-unknown',
      headline: '日程里看不到力量训练',
      status: 'unknown',
      severity: 'info',
      basis: null,
      evidence: [],
      advice: [],
      notVisible: '这一版日程里没有力量训练块',
    });
  }

  return {
    key: 'exercise',
    label: '运动',
    coverage: withData / 2,
    score: withData === 0 ? null : round(scoreSum / withData),
    findings,
  };
}

function evalSleep(d: PlanDigest): EvalDimension {
  const th = digestThresholds();
  const findings: EvalFinding[] = [];
  let withData = 0;
  let scoreSum = 0;

  if (d.sleepOpportunityHours.confident) {
    withData++;
    const h = d.sleepOpportunityHours.value;
    const [lo, hi] = th.sleepWindowHours;
    if (h >= lo && h <= hi) {
      scoreSum += 100;
      findings.push({
        id: 'sleep-ok',
        headline: `睡眠窗口 ${fmtHours(h)}，在建议区间内`,
        status: 'good',
        severity: 'info',
        basis: basisFrom('sleep-duration-adult'),
        evidence: d.sleepOpportunityHours.evidence,
        advice: [],
      });
    } else if (h < th.sleepMinHours) {
      scoreSum += round(clamp01(h / th.sleepMinHours) * 100);
      findings.push({
        id: 'sleep-short',
        headline: `睡眠窗口只有 ${fmtHours(h)}，低于 ${th.sleepMinHours} 小时`,
        status: 'gap',
        severity: 'serious',
        basis: basisFrom('sleep-duration-adult'),
        evidence: d.sleepOpportunityHours.evidence,
        advice: [
          `把最后一件事提前 ${fmtHours(th.sleepMinHours - h)}`,
          '晚间学习挪到早上，长期看效率更高 —— 记忆固化发生在睡眠中，不是熬出来的',
        ],
      });
    } else {
      // >9h 不是问题，但提示可能是排得太松
      scoreSum += 100;
      findings.push({
        id: 'sleep-long',
        headline: `睡眠窗口 ${fmtHours(h)}，偏长`,
        status: 'good',
        severity: 'info',
        basis: basisFrom('sleep-debt-weekend'),
        evidence: d.sleepOpportunityHours.evidence,
        advice: ['睡得久不总是好事；如果白天困，可以看看是不是缺了午休或运动'],
      });
    }
  } else {
    findings.push({
      id: 'sleep-unknown',
      headline: '日程里判断不了睡眠',
      status: 'unknown',
      severity: 'info',
      basis: null,
      evidence: [],
      advice: [],
      notVisible: '这一版日程的起止太分散，算不出稳定的睡眠窗口',
    });
  }

  if (d.lateNightBlockDays.confident) {
    withData++;
    const late = d.lateNightBlockDays.value;
    scoreSum += late === 0 ? 100 : round(clamp01(1 - late / 7) * 100);
    findings.push(
      late === 0
        ? {
            id: 'sleep-late-ok',
            headline: '没有 22 点后仍排事的情况',
            status: 'good',
            severity: 'info',
            basis: basisFrom('caffeine-cutoff'),
            evidence: d.lateNightBlockDays.evidence,
            advice: [],
          }
        : {
            id: 'sleep-late',
            headline: `有 ${late} 天在 22:00 后仍排事`,
            status: 'gap',
            severity: 'warn',
            basis: basisFrom('caffeine-cutoff'),
            evidence: d.lateNightBlockDays.evidence,
            advice: ['把深夜块尽量前移；实在要晚，尽量改成低认知负荷的事（整理、复盘）'],
          },
    );
  }

  // H3：作息设置真源 —— 用户 declare 的就寝/起床。没有手环数据，
  // 「你自己的节奏」就是可得的最好对照；未设置时如实 unknown，并给一句指引。
  if (d.bedtimeConflictDays.confident) {
    withData++;
    const n = d.bedtimeConflictDays.value;
    scoreSum += n === 0 ? 100 : round(clamp01(1 - n / 7) * 100);
    findings.push(
      n === 0
        ? {
            id: 'sleep-bedtime-ok',
            headline: '每天收尾都在你设置的就寝之前',
            status: 'good',
            severity: 'info',
            basis: basisFrom('sleep-duration-adult'),
            evidence: d.bedtimeConflictDays.evidence,
            advice: [],
          }
        : {
            id: 'sleep-bedtime-conflict',
            headline: `有 ${n} 天排到了你设置的就寝时间之后`,
            status: 'gap',
            severity: 'warn',
            basis: basisFrom('sleep-duration-adult'),
            evidence: d.bedtimeConflictDays.evidence,
            advice: [
              '这是和你在「我的作息」里设置的节奏对照的结果 —— 排不开就说一声，我按新节奏重排',
            ],
          },
    );
  } else {
    findings.push({
      id: 'sleep-bedtime-unknown',
      headline: '还没有你的作息设置',
      status: 'unknown',
      severity: 'info',
      basis: null,
      evidence: [],
      advice: [],
      notVisible: '在「周计划 → 我的作息」里填一下就寝/起床，评估就能对上你自己的节奏（不填也能评，只对照通用区间）',
    });
  }
  if (d.preWakeConflictDays.confident) {
    withData++;
    const n = d.preWakeConflictDays.value;
    scoreSum += n === 0 ? 100 : round(clamp01(1 - n / 7) * 100);
    findings.push(
      n === 0
        ? {
            id: 'sleep-wake-ok',
            headline: '没有早于你设置的起床时间排事',
            status: 'good',
            severity: 'info',
            basis: basisFrom('sleep-duration-adult'),
            evidence: d.preWakeConflictDays.evidence,
            advice: [],
          }
        : {
            id: 'sleep-wake-conflict',
            headline: `有 ${n} 天早于你设置的起床时间就开始排事`,
            status: 'gap',
            severity: 'warn',
            basis: basisFrom('sleep-duration-adult'),
            evidence: d.preWakeConflictDays.evidence,
            advice: ['早起赶事偶尔有之；连续几天都这样，值得把前一天晚上的一项挪过来'],
          },
    );
  }

  return {
    key: 'sleep',
    label: '睡眠',
    coverage: withData / 4,
    score: withData === 0 ? null : round(scoreSum / withData),
    findings,
  };
}

function evalNutrition(d: PlanDigest): EvalDimension {
  const th = digestThresholds();
  const findings: EvalFinding[] = [];

  if (!d.mealDays.confident) {
    findings.push({
      id: 'diet-unknown',
      headline: '日程里看不到饮食安排',
      status: 'unknown',
      severity: 'info',
      basis: null,
      evidence: [],
      advice: [],
      notVisible: '这一版日程里没有用餐块 —— 食堂三餐通常在课表之外，不等于你没按时吃',
    });
    return { key: 'nutrition', label: '饮食', coverage: 0, score: null, findings };
  }

  // 排 meal 块的天数 vs 阈值：把「没排」读成「没吃」是错的，所以只说
  // 「日程里没体现」，不直接指控。
  const days = d.mealDays.value;
  const full = days >= th.mealsPerDay;
  findings.push(
    full
      ? {
          id: 'diet-meals-ok',
          headline: `${days} 天有明确用餐安排`,
          status: 'good',
          severity: 'info',
          basis: basisFrom('regular-meals-breakfast'),
          evidence: d.mealDays.evidence,
          advice: [],
        }
      : {
          id: 'diet-meals-gap',
          headline: `只有 ${days} 天排了用餐（建议 ${th.mealsPerDay} 天都固定）`,
          status: 'gap',
          severity: 'info',
          basis: basisFrom('regular-meals-breakfast'),
          evidence: d.mealDays.evidence,
          advice: ['把三餐当固定锚点排进去，漏掉的早餐最容易变成夜宵'],
        },
  );

  if (d.mealGapHours.confident && d.mealGapHours.value != null && d.mealGapHours.value > 6) {
    findings.push({
      id: 'diet-gap-long',
      headline: `有 ${fmtHours(d.mealGapHours.value)} 的空档没安排吃饭`,
      status: 'gap',
      severity: 'info',
      basis: basisFrom('regular-meals-breakfast'),
      evidence: d.mealGapHours.evidence,
      advice: ['长时间空腹后暴食的风险更高，空档里插一个简餐或加餐位'],
    });
  }

  // 分数要反映 gap：既然说了「6.2 小时空档没安排吃饭」却仍打 100 分，
  // 用户会认为系统在自相矛盾。有 gap 时按「有 gap 的条目占比」扣分，
  // 且**不为 0**（饮食信息在日程里普遍不完整，见 notVisible 口径）。
  const gaps = findings.filter((f) => f.status === 'gap').length;
  const base = round(clamp01(days / th.mealsPerDay) * 100);
  const score = gaps === 0 ? base : Math.max(60, base - gaps * 20);
  return { key: 'nutrition', label: '饮食', coverage: 1, score, findings };
}

function evalStudy(d: PlanDigest): EvalDimension {
  const findings: EvalFinding[] = [];
  let withData = 0;
  let scoreSum = 0;

  if (d.overlongStudyBlocks.confident) {
    withData++;
    const over = d.overlongStudyBlocks.value;
    if (over === 0) {
      scoreSum += 100;
    } else {
      scoreSum += round(clamp01(1 - over / Math.max(1, d.blocks.length)) * 100);
      findings.push({
        id: 'study-overlong',
        headline: `有 ${over} 个学习块超过 ${METHOD_PARAMS.blocks.maxConsecutiveBlockMin} 分钟`,
        status: 'gap',
        severity: 'warn',
        basis: basisFrom('ultradian-rhythm'),
        evidence: d.overlongStudyBlocks.evidence,
        advice: [
          `超过 ${METHOD_PARAMS.blocks.ultradianCycleMin} 分钟注意力会陡降，建议在中间插 ${METHOD_PARAMS.blocks.ultradianBreakMin} 分钟休息`,
        ],
      });
    }
  }

  if (d.reviewDays.confident) {
    withData++;
    // 间隔效应：复习要分散。「一周集中 1 天复习」不如「每天 25 分钟」
    const days = d.reviewDays.value;
    scoreSum += round(clamp01(days / 3) * 100);
    findings.push(
      days === 0
        ? {
            // ⚠️ 0 天不能说「只集中在 0 天」—— 那句话读起来荒谬，
            // 而且会让人以为「复习日=0」是某种缺陷计数。实情是
            // 「这一版日程里没有标为复习的块」，措辞必须如实。
            id: 'study-review-none',
            headline: '日程里没有标为「复习」的安排',
            status: 'unknown',
            severity: 'info',
            basis: null,
            evidence: [],
            advice: [],
            notVisible: '复习往往在课表之外发生，这里看不到不等于你没复习',
          }
        : days >= 3
        ? {
            id: 'study-review-ok',
            headline: `复习分散在 ${days} 天（间隔效应要求的就是分散）`,
            status: 'good',
            severity: 'info',
            basis: basisFrom('spacing-effect'),
            evidence: d.reviewDays.evidence,
            advice: [],
          }
        : {
            id: 'study-review-gap',
            headline: `复习只集中在 ${days} 天`,
            status: 'gap',
            severity: 'warn',
            basis: basisFrom('spacing-effect'),
            evidence: d.reviewDays.evidence,
            advice: [
              `把同样的复习量拆到 3 天以上（${METHOD_PARAMS.blocks.studyDurations.join(' / ')} 分钟档）`,
              `复习总量建议控制在每天 ${METHOD_PARAMS.blocks.dailyReviewCapMin} 分钟内，多了反而记不住`,
            ],
          },
    );
  }

  if (findings.length === 0) {
    findings.push({
      id: 'study-unknown',
      headline: '日程里没有可评估的学习块',
      status: 'unknown',
      severity: 'info',
      basis: null,
      evidence: [],
      advice: [],
      notVisible: '这一版日程里没有 study / course 块',
    });
  }

  return {
    key: 'study',
    label: '学习',
    coverage: withData / 2,
    score: withData === 0 ? null : round(scoreSum / withData),
    findings,
  };
}

function evalLoad(d: PlanDigest): EvalDimension {
  const th = digestThresholds();
  const findings: EvalFinding[] = [];
  const maxRun = d.longestRunMin;
  const maxBlock = d.longestBlockMin;

  if (maxRun.confident) {
    const h = maxRun.value / 60;
    if (h > 6) {
      findings.push({
        id: 'load-run-long',
        headline: `有一段连续 ${fmtHours(h)} 没有中断`,
        status: 'gap',
        severity: 'warn',
        basis: basisFrom('move-more-sit-less'),
        evidence: [],
        advice: [`久坐是独立风险因素，每 ${HEALTH_PARAMS.blocks.sedentaryBreakMin} 分钟起来动一下最划算`],
      });
    }
  }

  if (maxBlock.confident && maxBlock.value > th.maxConsecutiveBlockMin) {
    findings.push({
      id: 'load-block-long',
      headline: `最长的单块 ${fmtMin(maxBlock.value)}`,
      status: 'gap',
      severity: 'info',
      basis: basisFrom('ultradian-rhythm'),
      evidence: maxBlock.evidence,
      advice: [],
    });
  }

  // 习惯：只在「一周出现 ≥2 天」时给结论（单次出现是事件，不是习惯）
  const weakHabits = d.habits.filter((h) => h.days.length < 3);
  if (weakHabits.length > 0) {
    findings.push({
      id: 'habit-weak',
      // 说出**是哪几个**习惯：只报数量的话用户无从核对，也无从下手
      headline: `${weakHabits.map((h) => h.title).join('、')} 只排了 1-2 天，容易断`,
      status: 'gap',
      severity: 'info',
      basis: basisFrom('habit-formation-loop'),
      evidence: weakHabits.flatMap((h) =>
        d.blocks.filter((b) => (b.title || '').trim() === h.title).map((b) => b.id),
      ),
      advice: [
        `习惯平均需要约 ${METHOD_PARAMS.blocks.habitExpectDays} 天才稳定，先求「不断」而不是「多」`,
        '把习惯绑在固定情境上（同一个时间、同一个位置）比靠意志力有效',
      ],
    });
  }

  const status: EvalStatus = findings.some((f) => f.status === 'gap') ? 'gap' : 'good';
  return {
    key: 'load',
    label: '负荷与习惯',
    coverage: d.blocks.length === 0 ? 0 : 1,
    score: d.blocks.length === 0 ? null : status === 'good' ? 100 : 60,
    findings:
      findings.length > 0
        ? findings
        : [{
            id: 'load-ok',
            headline: '负荷分布没有明显问题',
            status: 'good',
            severity: 'info',
            basis: null,
            evidence: [],
            advice: [],
          }],
  };
}

/* ============================================================
 * 主入口
 * ========================================================== */

const SEV_ORDER: Record<Severity, number> = { serious: 0, warn: 1, info: 2 };

/**
 * 评估一版日程。**纯函数** —— 同样的 plan 必然给出同样的结论。
 */
/**
 * H4（R批 Wave3）· 成长维度 —— 习惯覆盖（R5.2 recurring × 学期周）+ 目标进度（GoalsPage）。
 *
 * 数据全部来自 DigestContext（WeekPlanView 注入 routine/goals/recurring spans）：
 * 没接 GoalsPage 之前这里是两个永远 unknown 的占位，现在是真接线。
 * 依据：habit-formation-loop（方法库 B 级：习惯靠稳定线索-行为-奖励循环固化）
 * + mcm-3day-timeline（先搭时间线再铺块）。
 */
function evalGrowth(d: PlanDigest): EvalDimension {
  const findings: EvalFinding[] = [];
  let withData = 0;
  let scoreSum = 0;

  /* —— 习惯覆盖（recurring × 学期周）—— */
  if (d.habitSpans.length > 0) {
    withData++;
    for (const h of d.habitSpans) {
      const total = h.totalWeeks;
      const ratio = total && total > 0 ? h.weeksCovered / total : null;
      if (ratio == null) {
        findings.push({
          id: `growth-habit-${h.title}`,
          headline: `「${h.title}」是每周重复安排（覆盖 ${h.weeksCovered} 周）`,
          status: 'good',
          severity: 'info',
          basis: basisFrom('habit-formation-loop'),
          evidence: [],
          advice: [],
        });
        scoreSum += 100;
        continue;
      }
      const pct = Math.round(ratio * 100);
      findings.push(
        ratio >= 0.8
          ? {
              id: `growth-habit-${h.title}`,
              headline: `「${h.title}」覆盖到第 ${total} 周（学期 ${pct}%），习惯有整段跑道`,
              status: 'good',
              severity: 'info',
              basis: basisFrom('habit-formation-loop'),
              evidence: [],
              advice: [],
            }
          : {
              id: `growth-habit-${h.title}`,
              headline: `「${h.title}」只覆盖了学期的 ${pct}%`,
              status: ratio < 0.5 ? 'gap' : 'good',
              severity: ratio < 0.5 ? 'warn' : 'info',
              basis: basisFrom('habit-formation-loop'),
              evidence: [],
              advice: ratio < 0.5
                ? [`习惯要整段跑道才养得成 —— 说「把「${h.title}」延续到学期末」我就补齐剩余的周`]
                : [],
            },
      );
      scoreSum += round(clamp01(ratio) * 100);
    }
  } else {
    findings.push({
      id: 'growth-habit-unknown',
      headline: '还没有长期重复的安排',
      status: 'unknown',
      severity: 'info',
      basis: null,
      evidence: [],
      advice: [],
      notVisible: '想养成的习惯（比如「每周 3 次晨跑」）落进日程后，这里会显示它的学期覆盖进度',
    });
  }

  /* —— 目标进度（GoalsPage）—— */
  const activeGoals = d.goals.filter((g) => !!g.title);
  if (activeGoals.length > 0) {
    withData++;
    for (const g of activeGoals) {
      const weeksTxt = g.weeksLeft != null ? `还有约 ${g.weeksLeft} 周` : '未设截止';
      const related = g.relatedBlocks;
      if (related === 0 && g.weeksLeft != null && g.weeksLeft <= 6) {
        scoreSum += 0;
        findings.push({
          id: `growth-goal-${g.title}`,
          headline: `目标「${g.title}」${weeksTxt}到期，本周日程里还没有相关安排`,
          status: 'gap',
          severity: g.weeksLeft <= 2 ? 'serious' : 'warn',
          basis: basisFrom('mcm-3day-timeline', '先搭时间线再铺块 —— 越近截止，块越要提前铺'),
          evidence: [],
          advice: [`直接跟我说「帮我排「${g.title}」」，我把准备块铺进接下来的周`],
        });
      } else if (related === 0) {
        scoreSum += 60;
        findings.push({
          id: `growth-goal-${g.title}`,
          headline: `目标「${g.title}」${weeksTxt}，本周暂无相关安排`,
          status: 'unknown',
          severity: 'info',
          basis: null,
          evidence: [],
          advice: [],
          notVisible: '相关的事可能没排进这一周，也可能在日程之外 —— 不等于没推进',
        });
      } else {
        scoreSum += 100;
        findings.push({
          id: `growth-goal-${g.title}`,
          headline: `目标「${g.title}」${weeksTxt}，本周排了 ${related} 个相关块`,
          status: 'good',
          severity: 'info',
          basis: basisFrom('implementation-intentions'),
          evidence: [],
          advice: [],
        });
      }
    }
  } else {
    findings.push({
      id: 'growth-goal-unknown',
      headline: '目标页还没有目标',
      status: 'unknown',
      severity: 'info',
      basis: null,
      evidence: [],
      advice: [],
      notVisible: '在「目标」页建一个（比如「四六级」「数模国赛」），评估会对照它的截止日期看这一周的推进',
    });
  }

  return {
    key: 'growth',
    label: '成长',
    coverage: withData / 2,
    score: withData === 0 ? null : round(scoreSum / withData),
    findings,
  };
}

export function evaluateDigest(d: PlanDigest): PlanEvaluation {
  const dimensions: EvalDimension[] = [
    evalExercise(d),
    evalSleep(d),
    evalNutrition(d),
    evalStudy(d),
    evalLoad(d),
    evalGrowth(d),
  ];

  const coverage = round(
    (dimensions.reduce((s, dim) => s + dim.coverage, 0) / dimensions.length) * 100,
  ) / 100;

  const caveats: string[] = [
    '运动强度是按标题关键词判的，不一定准 —— 换个名字就不会被计入',
    '这是日程结构层面的参考，不是医学评估；有身体不适请就医',
  ];
  if (d.sparseData) caveats.unshift('这一版日程的块比较少，结论的可靠性有限');
  if ((d.unclassifiedExerciseMin.value ?? 0) > 0) {
    caveats.push(
      `有 ${fmtMin(d.unclassifiedExerciseMin.value)} 运动没算进达标判断（强度判不出来）`,
    );
  }

  const topAdvice = dimensions
    .flatMap((dim) => dim.findings)
    .filter((f) => f.status === 'gap' && f.advice.length > 0)
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
    .flatMap((f) => f.advice)
    .filter((a, i, arr) => arr.indexOf(a) === i)
    .slice(0, 5);

  return { weekNo: d.weekNo, dimensions, topAdvice, coverage, caveats };
}

/* ============================================================
 * 文案工具
 * ========================================================== */

export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分`;
}

export function fmtHours(h: number): string {
  const v = Math.round(h * 10) / 10;
  return `${v} 小时`;
}

/** 免责声明原文（直接来自知识库编译产物，不自己编） */
export const HEALTH_DISCLAIMER = HEALTH_PARAMS._meta.disclaimer;

/** 评估依据引用的知识库条目清单（UI 的「这些结论从哪来」区） */
export function citedSlugs(e: PlanEvaluation): { slug: string; tier: string; quote: string }[] {
  const seen = new Set<string>();
  const out: { slug: string; tier: string; quote: string }[] = [];
  for (const f of e.dimensions.flatMap((d) => d.findings)) {
    if (!f.basis || seen.has(f.basis.slug)) continue;
    seen.add(f.basis.slug);
    out.push(f.basis);
  }
  return out;
}
