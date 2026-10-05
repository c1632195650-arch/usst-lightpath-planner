/**
 * 方法论 → 排程的纯消费层（Method params consumer）
 * ============================================================
 * 数据来源：`@/data/methodParams.generated`（由 scripts/compile_method_params.py
 * 从 data/method_kb.db **构建期**编译而来）。运行时**不查库、不 fetch、不读时钟** ——
 * 这是排程引擎「纯函数 + 确定性」铁律在知识侧的对应实现。
 *
 * 边界与归属：
 *   · 本文件是**新增的叶子模块**：不 import `templates.ts`，也不被它 import；
 *     想让排程真的用上这些档位，由 `planWeek` / UI 侧显式接入（见 docs/method-kb-plan.md）。
 *   · `lib/planner/` 目录当前属 B（Ray）所有；本文件为 CY 新增、内容只读数据，
 *     归属与命名请 B 复核（AGENTS.md 的文件红线）。
 *
 * 「知识」与「参数」的分工：
 *   - 解释为什么 → `method_kb.db`（梨宝对话走 study_ctx）
 *   - 决定排成什么样 → 本文件暴露的常量与纯函数
 */

import { METHOD_PARAMS } from '@/data/methodParams.generated';

export type MethodPhase = '适应期' | '常规' | '期末' | 'any';
export type MethodTask = 'mcm' | 'guangdianbei' | 'cet' | 'final-exam' | 'grad-school';

export interface MethodHint {
  slug: string;
  title: string;
  summary: string;
  /** A 元分析 | B 一致实证 | C 教科书共识 | D 专家经验 */
  tier: string;
  /** verified | contested（contested 的只能作提示，不可当定论） */
  status: string;
}

/** 编译自方法库的机器参数（含出处，见 generated 文件头部） */
export const METHOD = METHOD_PARAMS;

/** 自习块时长档位 —— 番茄工作法的 durations（25/50），替代拍脑袋的 [45,60,90] */
export const STUDY_DURATIONS: readonly number[] = METHOD.blocks.studyDurations;

/** 复习间隔（天）—— 间隔重复的 1/3/7/15/30，供展开复习类 Commit 的 deps */
export const REVIEW_INTERVALS: readonly number[] = METHOD.blocks.reviewIntervalsDays;

/** 应试冲刺参数：提前多少天进入冲刺、多久一次模考、至少几次 */
export const EXAM_SPRINT = {
  leadDays: METHOD.blocks.examSprintLeadDays,
  mockIntervalDays: METHOD.blocks.examMockIntervalDays,
  minMockCount: METHOD.blocks.examMinMockCount,
  errorTaxonomy: METHOD.blocks.examErrorTaxonomy,
} as const;

/** 作息红线：最少睡眠 / 午睡区间（来自睡眠巩固条目） */
export const SLEEP_GUARD = {
  minHours: METHOD.blocks.minSleepHours,
  napMin: METHOD.blocks.napMin,
  napMax: METHOD.blocks.napMaxMin,
} as const;

/** 深度工作块：单块分钟与每日上限（深度工作 + 超日节律） */
export const DEEP_WORK = {
  blockMin: METHOD.blocks.deepBlockMin,
  perDay: METHOD.blocks.maxDeepBlocksPerDay,
  cycleMin: METHOD.blocks.ultradianCycleMin,
  breakMin: METHOD.blocks.ultradianBreakMin,
} as const;

/** 番茄参数（⚠️ D 级证据，见 contraindications —— 仅作默认档，不强制） */
export const POMODORO = {
  focusMin: METHOD.blocks.focusMin,
  breakMin: METHOD.blocks.breakMin,
} as const;

/* ================================================================
 * v2 扩域（2026-10-06）：习惯 / 目标 / 执行力三块消费层
 * ================================================================
 *🔴 为什么没有 WILLPOWER 块：
 *   自控肌力（ego depletion）已进入复制危机—— Vohs 等 2021 用 36 个实验室、
 *   N=3531 做预注册范式检验，确认性结果 d=0.06 不显著。因此**不编译任何
 *   「意志力资源量」类参数**，编译链也在 `FORBIDDEN_STATUS` 处拦住了
 *   contested条目。诱惑捆绑等可观察行为参数放在 EXECUTION 里，
 *   它有独立的现场实验证据，不依赖耗竭模型。
 */

/** 习惯养成参数（v2）—— 线索、追踪窗口、中断容忍 */
export const HABIT = {
  /** 形成线索联结所需的最少天数（用于提示「别太早判失败」） */
  minCueDays: METHOD.blocks.habitMinCueDays,
  /** 追踪窗口（天）：滚动统计而非逐日打卡 */
  trackingWindowDays: METHOD.blocks.habitTrackingWindowDays,
  /** 回看频率（天）：不要每天检查 */
  reviewIntervalDays: METHOD.blocks.habitReviewIntervalDays,
  /** 每个习惯只保留一个主线索 */
  oneCuePerHabit: METHOD.blocks.habitOneCuePerHabit,
  /** 叠加法要求锚点必须稳定 */
  anchorRequired: METHOD.blocks.habitAnchorRequired,
  /** 每周豁免额度：漏一天不作失败处理 */
  missGracePerWeek: METHOD.blocks.habitMissGracePerWeek,
  /** 中断后应在多少小时内重排 */
  relapseResumeHours: METHOD.blocks.habitRelapseResumeHours,
  /** 这么多天之前不评价成败 */
  noJudgeBeforeDays: METHOD.blocks.habitNoJudgeBeforeDays,
  /** 一致性统计窗口（天） */
  consistencyWindowDays: METHOD.blocks.habitConsistencyWindowDays,
  /** 锚点可靠性观察天数 */
  anchorCheckDays: METHOD.blocks.habitAnchorCheckDays,
  /** 是否要求情境稳定（换环境时须准备替代线索） */
  stableContextRequired: METHOD.blocks.habitStableContextRequired,
} as const;

/** 目标达成参数（v2）—— 里程碑、检查点、退出条件 */
export const GOAL = {
  /** 单周期内最多几个里程碑（过多会变打卡） */
  milestoneMax: METHOD.blocks.goalMilestoneMax,
  /** 检查点间隔（天） */
  checkInIntervalDays: METHOD.blocks.goalCheckInIntervalDays,
  /** 心理对照的建议视界（天） */
  wishHorizonDays: METHOD.blocks.goalWishHorizonDays,
  wishHorizonMinDays: METHOD.blocks.goalWishHorizonMinDays,
  /** 目标复核周期（天）：目标本身也要被复核 */
  reviewIntervalDays: METHOD.blocks.goalReviewIntervalDays,
  /** 允许在周期内调整方向 */
  allowDirectionChange: METHOD.blocks.goalAllowDirectionChange,
  /** 预设放弃条件的条数 */
  killCriteriaCount: METHOD.blocks.goalKillCriteriaCount,
  /** 放弃条件必须是客观可观察的（非感受型） */
  killRequireObjective: METHOD.blocks.goalKillRequireObjective,
  /** 决策时忽略过往投入（沉没成本） */
  ignorePriorInvestment: METHOD.blocks.goalIgnorePriorInvestment,
  /** 展示剩余量而非已完成量 */
  showRemaining: METHOD.blocks.goalShowRemaining,
  /** 达标时立刻规划下一个（防成功后松懈） */
  planNextMilestoneOnSuccess: METHOD.blocks.goalNextMilestoneOnSuccess,
  /** 规划缓冲比例（规划谬误：系统性低估耗时） */
  planningBufferRatio: METHOD.blocks.goalPlanningBufferRatio,
} as const;

/** 执行力参数（v2）—— 启动门槛、最小行动、if-then */
export const EXECUTION = {
  /** 两分钟启动阈值 */
  twoMinuteThreshold: METHOD.blocks.execTwoMinuteThreshold,
  /** 最小行动下限（分钟）：低能量日的保底动作 */
  minActionFloorMin: METHOD.blocks.execMinActionFloorMin,
  /** 是否定义了保底动作 */
  fallbackDefined: METHOD.blocks.execFallbackDefined,
  /** 时间线缓冲比例 */
  bufferRatio: METHOD.blocks.execBufferRatio,
  /** 碎片事务批处理时长（分钟） */
  batchMin: METHOD.blocks.execBatchMin,
  /** 能量观察期（天）：少于这个天数得到的能量曲线不可靠 */
  observeDays: METHOD.blocks.execObserveDays,
  /** 第一个动作应在几分钟内可启动 */
  firstActionStartMin: METHOD.blocks.execFirstActionStartMin,
  /** 同时生效的 if-then 条数上限 */
  ifThenMax: METHOD.blocks.execIfThenMax,
  /** if-then 的障碍必须是内在的（外部约束应走环境设计） */
  requireInnerObstacle: METHOD.blocks.execRequireInnerObstacle,
  /** 诱惑捆绑的捆绑项数 */
  bundlingSteps: METHOD.blocks.execBundlingSteps,
  /** 捆绑必须真的限制使用（只靠自律提示的效果显著更弱） */
  bundlingRestrictAccess: METHOD.blocks.execBundlingRestrictAccess,
  /** 拖延任务的三分类数 */
  taskTypeCount: METHOD.blocks.execTaskTypeCount,
  /** 目标行为启动步骤数上限（超过则先削摩擦） */
  frictionStepsMax: METHOD.blocks.execFrictionStepsMax,
  /** 自我宽恕：宽恕的是失误，不免行动 */
  forgivenessForgives: METHOD.blocks.execForgetgivenessForgives,
  /** 先说出情绪名，再处理任务 */
  nameEmotionFirst: METHOD.blocks.execNameEmotionFirst,
  /** 优先降低任务厌恶而非加约束 */
  reduceAversion: METHOD.blocks.execReduceAversion,
} as const;

/**
 * WOOP（愿望—结果—障碍—计划）参数。
 *🔴 `requireObstacle: true` 是**硬要求**：只做正向想象会降低能量，
 *   故任何目标提示都不得只给愿景而不给障碍。
 *⚠️ 期望过低时心理对照会促disengagement（而非激励），
 *   故使用前须做可行性检查 —— 见 hints 里的 `psychological-counterfactual-neg`。
 */
export const WOOP = {
  steps: METHOD.blocks.woopSteps,
  outcomeImagerySec: METHOD.blocks.woopOutcomeImagerySec,
  wishMaxWords: METHOD.blocks.woopWishMaxWords,
  requireObstacle: METHOD.blocks.woopRequireObstacle,
} as const;

const HINT_INDEX: ReadonlyMap<string, MethodHint> = new Map(
  METHOD_PARAMS.hints.map((h) => [h.slug, h]),
);

/* generated 文件用了 `as const`，键只在「实际出现过的阶段/任务」上；
 * 而调用方传入的是开放的 MethodPhase/MethodTask 字面量（可能尚无数据）。
 * 因此这里把映射放宽为 Record<string, readonly string[]>：缺键返回空数组，
 * 语义是「该阶段暂无方法建议」，而不是类型错误。 */
const PHASE_INDEX = METHOD_PARAMS.byPhase as unknown as Record<string, readonly string[]>;
const TASK_INDEX = METHOD_PARAMS.byTask as unknown as Record<string, readonly string[]>;

/** 按阶段取适用的方法条目（期末 → 应试三板斧 + 模考复盘 + 应激管理…） */
export function methodSlugsForPhase(phase: MethodPhase): readonly string[] {
  return PHASE_INDEX[phase] ?? [];
}

/** 按任务取适用的方法条目（mcm → 打法 + 72h 时间线 + 文献检索…） */
export function methodSlugsForTask(task: MethodTask): readonly string[] {
  return TASK_INDEX[task] ?? [];
}

/** 取某条目的展示信息（含证据等级与争议状态） */
export function methodHint(slug: string): MethodHint | undefined {
  return HINT_INDEX.get(slug);
}

/**
 * 某阶段建议展示的方法卡（排序：争议置底、证据等级高优先）。
 * 纯函数：同输入同输出；contested 恒排最后（守「懂分寸」——不当定论推给人）。
 */
export function methodCardsForPhase(phase: MethodPhase, limit = 6): MethodHint[] {
  const tierRank: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  return methodSlugsForPhase(phase)
    .map((s) => HINT_INDEX.get(s))
    .filter((h): h is MethodHint => !!h)
    .sort((a, b) => {
      const ca = (a.status === 'contested' ? 1 : 0) - (b.status === 'contested' ? 1 : 0);
      if (ca !== 0) return ca;
      return (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9);
    })
    .slice(0, limit);
}

/**
 * 考前第 n 天该做什么（供事件准备块/冲刺页用）。
 * 纯函数：不读时钟；n 由调用方传入（距考试的天数）。
 */
export function examSprintStep(daysLeft: number): { stage: string; action: string } {
  const { leadDays, mockIntervalDays, minMockCount } = EXAM_SPRINT;
  if (daysLeft > leadDays) {
    return { stage: '平时', action: '按间隔重复节奏推进，不需要进入冲刺模式' };
  }
  if (daysLeft > mockIntervalDays * minMockCount) {
    return { stage: '冲刺前期', action: `真题驱动定位薄弱点，每 ${mockIntervalDays} 天一次限时模考` };
  }
  if (daysLeft > 1) {
    return { stage: '冲刺后期', action: '只过错题本与高频考点，不再灌新知识' };
  }
  return { stage: '考前', action: '固定作息 + 简短回顾，把紧张解读为身体在备战' };
}

/* ================================================================
 * P2-1 · tips 消费接口
 * ================================================================
 * 🔴 **口径红线（CY 明确要求）**：tips 只从**方法论 / 价值观 / 认识论**出，
 *    **不按学科走**。理由：大学学科太多，按学科覆盖不可能完整；方法论跨学科通用。
 *    故`methodTipForBlock` **不接受学科参数** —— 这不是遗漏，是设计决定。
 *
 * 无匹配时返回 `null`（**宁缺毋滥**，不硬凑）。
 */

/** 块的类目 —— 只按「做什么性质的事」分，不按学科 */
export type MethodBlockKind =
  | 'assignment'   // 作业 / 练习
  | 'review'       // 复习 / 预习
  | 'exam'         // 考试 / 模考
  | 'exercise'     // 运动 / 身体活动
  | 'rest';        // 休息 / 睡眠

/** 块的时长特征（纯数值，不含学科） */
export interface MethodTipContext {
  kind: MethodBlockKind;
  /** 计划时长（分钟）；缺省视为未知 */
  durationMin?: number;
  /** 是否已排了 if-then 计划（避免重复提示） */
  hasIfThen?: boolean;
  /** 当前是低能量状态（自报） */
  lowEnergy?: boolean;
}

export interface MethodTip {
  slug: string;
  title: string;
  tip: string;
  /** A 元分析 | B 一致实证 | C 教科书共识 | D 专家经验 */
  tier: string;
  /** verified | contested（contested 的只能作提示，不可当定论） */
  status: string;
}

/**
 * 块级tips 的候选表（v2 扩域）。
 *
 * ⚠️ 为什么用「候选 + 条件」而不是「直接映射」：
 *   同一块类目在不同上下文下该说的话不同（如低能量时给最小行动、
 *   已有 if-then 时不再重复提示）。条件不满足就**不出这条**，
 *   全部不满足则返回 null —— 这是「宁缺毋滥」的落地方式。
 *
 * 每条 tip 的口径要求：**只讲怎么做/为什么，不讲学科内容**。
 */
const TIP_TABLE: ReadonlyArray<{
  kind: MethodBlockKind;
  when?: (c: MethodTipContext) => boolean;
  slug: string;
  tip: string;
  /**
   * 情境优先级（越大越优先）—— v2 新增。
   *
   * 🔴 为什么不能只按证据等级排：单测抓到过真实反例 ——
   *   低能量做作业时，`implementation-cue-spec`（B 级，写 if-then）
   *   会凭tier 压过 `two-minute-start`（C 级，先做两分钟），
   *   结果是**证据等级最高的那条恰好不是当下最该说的**。
   * 排序改为：**先情境优先级，后证据等级，contested 仍恒置底**。
   * 语义：同一块类目下，越具体匹配当前状态的提示越优先；
   * 条件式提示（when命中）天然比无条件提示更具体，故给base=10。
   */
  prio?: number;
}> = [
  // ---- 休息块：最该说的一条，因为休息最容易被当成可牺牲的 ----
  {
    kind: 'rest',
    slug: 'sleep-memory-consolidation',
    tip: '记忆巩固主要发生在睡眠里。今天没记住的，多半不是方法问题，是没睡够。',
  },
  {
    kind: 'rest',
    when: (c) => (c.durationMin ?? 0) >= 90,
    slug: 'retrospective-peak-end-rule',
    tip: '这段休息的体验你主要会记住「最舒服的那一刻」和「结束时的感觉」——所以开始别铺开太多事，结束时留个舒服的收尾。',
  },

  // ---- 运动块 ----
  {
    kind: 'exercise',
    slug: 'habit-cue-routine-reward',
    tip: '把运动挂在固定线索后面（下班后/晚饭后），固定时间地点比「想起来就去做」有效得多。',
  },
  {
    kind: 'exercise',
    when: (c) => c.lowEnergy === true,
    slug: 'minimum-action-floor',
    tip: '今天能量低就先做保底动作（换衣服出门走 10 分钟也算完成）——重点是不清零，不是强度。',
    prio: 100,
  },
  {
    kind: 'exercise',
    slug: 'temptation-bundling',
    tip: '把你想做的事绑在运动上：只有运动时才能刷剧/听播客。只靠自律提示的效果明显更弱——要真的限制使用。',
  },

  // ---- 考试块 ----
  {
    kind: 'exam',
    slug: 'test-anxiety-skill-vs-cbt',
    tip: '缓解考试焦虑最有效的是练技能（真的会安排时间、真的会答题），不是只调整心态。两手一起做才有效。',
  },
  {
    kind: 'exam',
    when: (c) => (c.durationMin ?? 0) >= 60,
    slug: 'stress-performance-inverse',
    tip: '难任务在压力太高时更容易崩。开场先用 1 分钟把呼吸放慢，比继续灌新知识有用。',
  },
  {
    kind: 'exam',
    slug: 'planning-fallacy',
    tip: '「今晚能复习完」几乎总是低估。建议按同类任务的历史耗时 ×1.3 来估。',
  },

  // ---- 作业块 ----
  {
    kind: 'assignment',
    when: (c) => c.lowEnergy === true,
    slug: 'two-minute-start',
    tip: '先承诺只做 2 分钟。启动的阻力在开始之前，不在过程里——开始后想停的人很少。',
    // 低能量是当前最强的情境信号：任何「提前规划类」提示都不如「先动起来」有用
    prio: 100,
  },
  {
    kind: 'assignment',
    slug: 'task-ambiguity-fog',
    tip: '不知道从哪下手比任务本身更难。先写下「下一个物理动作」（如「打开文档写标题」），别写「做报告」。',
    prio: 50,
  },
  {
    kind: 'assignment',
    when: (c) => (c.durationMin ?? 0) >= 60,
    slug: 'retrospective-peak-end-rule',
    tip: '这段学习你最后记住的是收尾那几分钟。别把最讨厌的题留到最后——换到前面做，结尾留个轻松的回顾。',
  },
  {
    kind: 'assignment',
    when: (c) => c.hasIfThen !== true,
    slug: 'implementation-cue-spec',
    tip: '给这件事补一条 if-then：「如果__，那么我就__」。写清时间和地点，执行率会明显不一样。',
  },

  // ---- 复习块 ----
  {
    kind: 'review',
    when: (c) => c.lowEnergy === true,
    slug: 'minimum-action-floor',
    tip: '状态差的日子先做保底版（只看不做题/只翻一遍），别清零。习惯怕断，不怕少。',
    prio: 100,
  },
  {
    kind: 'review',
    slug: 'retrieval-practice',
    tip: '合上书先自测一遍再翻答案。重读会制造「我懂了」的错觉，自测不会。',
  },
  {
    kind: 'review',
    when: (c) => (c.durationMin ?? 0) >= 45,
    slug: 'interleaving',
    tip: '别一口气只刷一类题。混着做练习时正确率会降，但延迟测验分数会涨——「更累更错」是正常的。',
  },
  {
    kind: 'review',
    slug: 'goal-gradient-is-not-willpower',
    tip: '接近目标时动力会上升，这是正常的（目标梯度），不代表你意志力变强了——别把后期冲刺归因于自控力。',
  },
];

/**
 * 块级方法论 tips —— 纯函数，同输入同输出。
 *
 * 🔴 **不接受学科参数**（CY 明确红线）：只按块类目与时长/能量特征选。
 *    方法论跨学科通用；按学科覆盖既不可能完整，也会让同一件事给出矛盾建议。
 *
 * 行为约定：
 *   · **宁缺毋滥**：无任何候选命中时返回 `null`，不硬凑。
 *   · **contested恒排最后**：争议条目只能作提示，不能当定论推给用户。
 *   · 不 fetch、不读时钟（引擎纯函数铁律）。
 */
export function methodTipForBlock(ctx: MethodTipContext): MethodTip | null {
  const matched = TIP_TABLE.filter((r) => r.kind === ctx.kind && (!r.when || r.when(ctx)));
  if (matched.length === 0) return null;

  const tierRank: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  const scored = matched
    .map((r) => ({ r, hint: HINT_INDEX.get(r.slug) }))
    .filter((x): x is { r: (typeof TIP_TABLE)[number]; hint: MethodHint } => !!x.hint)
    .sort((a, b) => {
      // ① contested 恒置底（守「懂分寸」——不当定论推给人）
      const ca = (a.hint.status === 'contested' ? 1 : 0) - (b.hint.status === 'contested' ? 1 : 0);
      if (ca !== 0) return ca;
      // ② 情境优先级（条件式提示默认 10，见 TIP_TABLE 注释）
      const pa = a.r.when ? a.r.prio ?? 10 : a.r.prio ?? 0;
      const pb = b.r.when ? b.r.prio ?? 10 : b.r.prio ?? 0;
      if (pa !== pb) return pb - pa;
      // ③ 同优先级比证据等级
      return (tierRank[a.hint.tier] ?? 9) - (tierRank[b.hint.tier] ?? 9);
    });

  // ⚠️ 候选里的 slug 若全部在库中缺失（数据未重建），返回 null 而不是编造
  const top = scored[0];
  if (!top) return null;
  return {
    slug: top.r.slug,
    title: top.hint.title,
    tip: top.r.tip,
    tier: top.hint.tier,
    status: top.hint.status,
  };
}
