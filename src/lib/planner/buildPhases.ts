/**
 * 学期阶段规划（buildPhases）
 * ============================================================
 * 回答一个问题：**这个学期，什么时候该松、什么时候该紧？**
 *
 * 为什么不直接用「课表 + 任务」实时求解：
 *   课表只管「哪几节有课」，管不了「第 3 周还在适应、第 16 周要冲刺」。
 *   阶段是学生自己就能说清的东西（开学别急着排满 / 期末提前两周收心），
 *   所以它应该是**显式、可解释、可改**的，而不是调度器里的隐式权重。
 *
 * 设计约束（与项目其它纯函数模块一致）：
 *   1. 纯函数：不读时钟、不 fetch、不用随机数 —— 同理测试可复现。
 *   2. 依赖注入：校历由调用方传入（buildPhasesFromCalendar 做了这层封装），
 *      这样本文件只依赖类型，node --test 能直接跑。
 *   3. 每个决策都给出 reasons：用户能看懂「为什么给我排成这样」，
 *      也能据此反驳。这是「引擎给倾向 + 理由，不替用户拍板」的落点。
 */
import type {
  PersonaProfile, Phase, PhaseKind, PhasePolicy, Schedule, SemesterPlan,
} from '@/types';
// 阶段 C：用户自己的改进建议（偏好校正层）要能叠加到阶段策略上。
// 依赖方向 `buildPhases → corrections` 是 lib 内部同层引用，不引入反向依赖。
import { applyCorrectionsToPolicy, composeEffectivePrefs, summarizeCorrections } from './corrections.ts';
import type { CorrectionRule } from './corrections.ts';

/** 校历里与本模块相关的最小信息（从 constants/term.ts 的 TermCalendar 取） */
export interface PhaseCalendar {
  /** 理论教学开始周 */
  theoryFromWeek?: number;
  /** 考试周开始周 */
  examFromWeek?: number;
}

/** 无画像时的基准策略：不激进、不空转 */
const BASE_POLICY: Record<PhaseKind, PhasePolicy> = {
  adapt:   { dailyStudyMin: 90,  maxBlockMin: 45, blankRatio: 0.40, eveningAllowed: false, weekendWork: false, studyPlaces: [] },
  normal:  { dailyStudyMin: 120, maxBlockMin: 90, blankRatio: 0.25, eveningAllowed: false, weekendWork: false, studyPlaces: [] },
  midterm: { dailyStudyMin: 150, maxBlockMin: 90, blankRatio: 0.15, eveningAllowed: true,  weekendWork: false, studyPlaces: [] },
  sprint:  { dailyStudyMin: 180, maxBlockMin: 60, blankRatio: 0.20, eveningAllowed: true,  weekendWork: true,  studyPlaces: [] },
  exam:    { dailyStudyMin: 150, maxBlockMin: 45, blankRatio: 0.30, eveningAllowed: true,  weekendWork: true,  studyPlaces: [] },
};

const PHASE_NAME: Record<PhaseKind, string> = {
  adapt: '开学适应期',
  normal: '常规学习期',
  midterm: '期中密集期',
  sprint: '期末冲刺期',
  exam: '考试周',
};

/**
 * 自习偏好 → 校园 POI **池**（名字取自 campus_map.json，可直接喂给 route()）。
 *
 * 为什么是「池」而不是单值：单值时引擎永远取第一个，于是「说喜欢图书馆」
 * 就天天同一个图书馆 —— 可生活不是一成不变的。给池子后引擎按天轮换。
 *
 * ⚠️ **T8（2026-09-19）：每个池子都补足备选，不再「选了什么就锁死在那一个地方」。**
 *
 * 用户的原话：「自习为什么一定在宿舍里呢？每个人有倾向的，我就偏向于去空教室，
 * 也可以去图书馆。**这是一个动态的偏向**。」
 *
 * 原来的映射是单值导向的 —— 选了 `dorm` 就只有「第二学生公寓」一个候选，
 * 一周七天全排在那儿。但「我想在宿舍学」的真实含义是**倾向**，不是**排他**：
 * 状态不好、室友在打游戏的时候，人自然会去图书馆。
 *
 * 现在每个偏好都是「首选 + 若干合理的备选」，由 `construct` 的 `rotateFrom` 按天轮换。
 * 首选仍在最前面 —— 轮换是**从首选开始**转，不改变偏好的优先级。
 *
 * ⚠️ 若将来要让用户**自己**勾选这组地点（而不是由画像的单选题推导），
 *    那属于画像层改动（`features/persona/**`，CY 地盘），需先协调。
 *    当前这版是「不改画像也能让偏好不再排他」的最小改动。
 */
const STUDY_PLACES: Record<string, string[]> = {
  // 图书馆派：安静为主，备选是同样能坐下来的地方
  library: ['图书馆（图文信息中心）', '湛恩纪念图书馆', '老图书馆', '第三教学楼'],
  // 空教室派：能摊开资料就行
  classroom: ['第三教学楼', '第一教学楼', '图书馆（图文信息中心）'],
  // 宿舍派：**不再锁死在宿舍** —— 这是 T8 修的那一条
  dorm: ['第二学生公寓', '图书馆（图文信息中心）', '第三教学楼'],
  // 咖啡厅派：换个环境，备选回到图书馆
  cafe: ['1906咖啡厅', '图书馆（图文信息中心）', '第三教学楼'],
};

const DEFAULT_STUDY_PLACES = ['图书馆（图文信息中心）', '第三教学楼'];

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function clampRange(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 轴 → 倾向强度的**连续映射**（P1，2026-09-27）
 * ============================================================
 * 旧版是**二元跳变**：`轴 ≥ 70` 跳一档、`轴 ≤ 35` 跳反向一档，
 * 中间 35–70 完全无响应 —— 实测轴 36 与 69 的输出逐字节相同。
 * 结果是「画像只在极端作答上起作用」，中段用户做了 35 题却看不到任何变化。
 *
 * 新版把中间那段"悬崖"改成斜坡，但**以旧阈值为饱和点**：
 *   · `轴 ≤ 35` → 与旧版**逐点一致**（原本已生效的人，体验不变）
 *   · `轴 ≥ 70` → 与旧版**逐点一致**（同上，绝不被削弱）
 *   · `轴 = 50` → 中性（不变）
 * 于是"原来有反应的人"不受影响，"原来没反应的人"第一次获得响应。
 *
 * 为什么中性点取 50 而不是 35/70 的中点 —— 中性作答就该给出中性结果，
 * 否则「全 50 的人」会莫名吃到一个偏移。
 *
 * ⚠️ 两侧**操作不同**的轴（如 PLAN：高端 +30、低端封顶 45）必须分段处理，
 *    不能硬套 `±a*side` 的齐次式 —— 详情见 `applyPersona` 里 PLAN 那段注释。
 */
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 高分侧强度：50 → 0，70 → 1（≥70 恒为 1） */
function hiSide(v: number): number {
  return clamp01((v - 50) / 20);
}

/** 低分侧强度：50 → 0，35 → 1（≤35 恒为 1） */
function loSide(v: number): number {
  return clamp01((50 - v) / 15);
}

/* ── P3（2026-09-27）：quality / confidence 逐轴降级 ──────────
 * 质量低 → 整体收缩 50%；某轴置信度低 → 该轴额外收缩。
 * 默认（quality='ok' 且无 confidence 告警）→ 不变，P1 测试不受影响。
 */
type Confidence = 'high' | 'mid' | 'low';
const CONF_WEIGHT: Record<Confidence, number> = { high: 1.0, mid: 1.0, low: 0.5 };

function axisShrink(
  k: string,
  quality: string | undefined,
  confidence: Partial<Record<string, unknown>> | undefined,
): number {
  if (quality === 'low') return 0.5;
  const conf = confidence?.[k];
  if (conf === 'low') return 0.5;
  return 1.0;
}

/**
 * 依据画像微调基准策略。返回改后的 policy 与**逐条理由**。
 * 每条规则都刻意写得能读出来「哪一项画像 → 哪个参数变化」。
 */
function applyPersona(kind: PhaseKind, base: PhasePolicy, persona: PersonaProfile | null): {
  policy: PhasePolicy;
  reasons: string[];
} {
  const policy: PhasePolicy = { ...base };
  const reasons: string[] = [];
  if (!persona) {
    reasons.push('还没有画像，先用保守的默认值 —— 做完画像测评可以再来看看差异');
    policy.studyPlaces = DEFAULT_STUDY_PLACES;
    return { policy, reasons };
  }

  const { axes, scenarios } = persona;

  // P3（§10.7.6 / 设计书）：逐轴 quality + confidence 降级
  // 默认（quality='ok' 且 confidence 无告警）→ 不变，P1 测试不受影响
  const ax = (k: string): number => {
    const raw = (axes as Record<string, number>)[k] ?? 50;
    const s = axisShrink(k, persona.quality, persona.confidence);
    return s === 1.0 ? raw : 50 + (raw - 50) * s;
  };

  // 成就驱动 → 每天目标时长（幅度 ±20%，与旧版上限一致）
  const achBefore = policy.dailyStudyMin;
  policy.dailyStudyMin = clampInt(
    achBefore * (1 + 0.20 * hiSide(ax('ACH')) - 0.20 * loSide(ax('ACH'))),
    60,
    240,
  );
  {
    const pct = Math.round((policy.dailyStudyMin / achBefore - 1) * 100);
    if (pct > 0) reasons.push(`成就驱动偏高（${axes.ACH}），每天目标时长上调 ${pct}%`);
    else if (pct < 0) reasons.push(`成就驱动偏低（${axes.ACH}），目标时长下调 ${-pct}%，先保住节奏`);
  }

  // 计划性 → 单块长度。
  // ⚠️ 两侧是**不同操作**：高端是「+30」，低端是「封顶到 45」。
  //    写成 `Math.min(base + 30*hi, base - 45*lo)` 会让 Math.min 把高端
  //    无条件压回 base（实测 v=70 时输出 90 而非 120）—— 必须分段。
  const planBefore = policy.maxBlockMin;
  if (ax('PLAN') < 50) {
    const loTarget = Math.min(planBefore, 45);
    policy.maxBlockMin = clampInt(planBefore + (loTarget - planBefore) * loSide(ax('PLAN')), 30, 150);
  } else {
    policy.maxBlockMin = clampInt(planBefore + 30 * hiSide(ax('PLAN')), 30, 150);
  }
  if (policy.maxBlockMin < planBefore) {
    reasons.push(`计划性偏低（${axes.PLAN}），单块压到 ${policy.maxBlockMin} 分钟以内，靠短块推进`);
  } else if (policy.maxBlockMin > planBefore) {
    reasons.push(`计划性高（${axes.PLAN}），单块可以放长到 ${policy.maxBlockMin} 分钟`);
  }

  // 健康自律 / 韧性 → 留白（越不需要留白的人越要强制留）
  const heaLo = loSide(ax('HEA'));
  const heaHi = hiSide(ax('HEA'));
  const resLo = loSide(ax('RES'));
  const blankBefore = policy.blankRatio;
  policy.blankRatio = clampRange(
    blankBefore + 0.10 * heaLo - 0.05 * heaHi + 0.05 * resLo,
    0.10,
    0.60,
  );
  if (policy.blankRatio > blankBefore) {
    const drivers: string[] = [];
    if (heaLo > 0) drivers.push(`健康自律偏低（${axes.HEA}）`);
    if (resLo > 0) drivers.push(`韧性偏低（${axes.RES}）`);
    reasons.push(`${drivers.join('、')}，留白提到 ${Math.round(policy.blankRatio * 100)}%，别把自己排满`);
  } else if (policy.blankRatio < blankBefore) {
    reasons.push(`健康自律高（${axes.HEA}），留白降到 ${Math.round(policy.blankRatio * 100)}%，你可以承受更密的安排`);
  }

  // 自习偏好 → 地点池（多值：引擎会按天轮换，不再永远是同一个）
  const place = scenarios.study_place;
  policy.studyPlaces = STUDY_PLACES[place] ?? DEFAULT_STUDY_PLACES;
  if (STUDY_PLACES[place]) {
    const label = place === 'library' ? '图书馆' : place === 'classroom' ? '空教室' : place === 'dorm' ? '宿舍' : '咖啡馆';
    const pool = STUDY_PLACES[place];
    const alt = pool.slice(1);
    reasons.push(
      `自习偏好是「${label}」，首选 ${pool[0]}`
      + (alt.length ? `，备选 ${alt.join('、')} —— 会轮着来，不总待一处` : ''),
    );
  }
  return { policy, reasons };
}

/** 画像决定的阶段长度（周） */
function phaseLengths(persona: PersonaProfile | null) {
  let adapt = 2;
  const reasons: string[] = [];
  if (persona) {
    if (persona.axes.EXP >= 70) {
      adapt += 1;
      reasons.push(`探索度高（${persona.axes.EXP}），适应期多给一周，先到处看看再定节奏`);
    }
    if (persona.scenarios.planning === 'flexible') {
      adapt += 1;
      reasons.push('习惯随性而动，适应期拉长一周，不急着上强度');
    }
  }
  return { adapt: Math.min(adapt, 4), reasons };
}

export interface BuildPhasesResult {
  plan: SemesterPlan;
  /** 生成过程中的整体说明（阶段划分的依据） */
  notes: string[];
}

/**
 * 生成学期阶段规划。
 *
 * @param schedule 课表（用 termStart/totalWeeks，以及课程周次算实际有课区间）
 * @param persona  画像，可为 null
 * @param calendar 校历（可选）：给了就用官方的理论教学/考试周边界
 * @param corrections 用户的偏好校正（阶段 C，可选）：在其上叠加用户自己提的要求。
 *        **缺省 = 旧行为**（不带校正），故既有调用方零改动。
 */
export function buildPhases(
  schedule: Schedule,
  persona: PersonaProfile | null = null,
  calendar?: PhaseCalendar,
  corrections?: readonly CorrectionRule[] | null,
): BuildPhasesResult {
  const totalWeeks = Math.max(1, schedule.totalWeeks);
  const notes: string[] = [];

  // 实际有课的周次区间 —— 比校历更贴近这份课表（有的课 3-18 周，有的 7-15 周）
  let minWeek = Number.POSITIVE_INFINITY;
  let maxWeek = 0;
  for (const c of schedule.courses) {
    for (const s of c.slots) {
      for (const w of s.weeks) {
        if (w < minWeek) minWeek = w;
        if (w > maxWeek) maxWeek = w;
      }
    }
  }
  const theoryFrom = calendar?.theoryFromWeek ?? (Number.isFinite(minWeek) ? minWeek : 1);
  if (Number.isFinite(minWeek)) {
    notes.push(`你的课从第 ${minWeek} 周排到第 ${maxWeek} 周`);
  }
  if (maxWeek > 0 && !Number.isFinite(minWeek)) {
    notes.push('课表缺少周次信息，按整学期处理');
  }

  // 考试周起点：校历优先；否则留最后 2 周
  const examFrom = clampInt(calendar?.examFromWeek ?? Math.max(totalWeeks - 1, theoryFrom + 1), theoryFrom, totalWeeks);

  // 三个段的长度
  const { adapt: adaptLen, reasons: adaptReasons } = phaseLengths(persona);
  let midLen = 2;

  // 排段：adapt → （normal/midterm 交替）→ sprint → exam
  const segs: Array<{ kind: PhaseKind; from: number; to: number }> = [];
  let cur = 1;

  // 1) 适应期（覆盖短学期 + 开学头两周）
  const adaptTo = Math.min(cur + adaptLen - 1, examFrom - 2);
  if (adaptTo >= cur) {
    segs.push({ kind: 'adapt', from: cur, to: adaptTo });
    cur = adaptTo + 1;
  }

  // 2) 理论教学主体：midterm 插在中间的 2 周
  const bodyEnd = examFrom - 1;
  const sprintLen = persona && persona.axes.ACH >= 70 ? 4 : 3;
  const sprintFrom = Math.max(bodyEnd - sprintLen + 1, cur);
  const midCenter = Math.round((cur + sprintFrom - 1) / 2);
  const midFrom = Math.max(cur, midCenter - Math.floor(midLen / 2));
  const midTo = Math.min(midFrom + midLen - 1, sprintFrom - 1);

  if (cur <= midFrom - 1) {
    segs.push({ kind: 'normal', from: cur, to: midFrom - 1 });
    cur = midFrom;
  }
  if (midTo >= cur) {
    segs.push({ kind: 'midterm', from: cur, to: midTo });
    cur = midTo + 1;
  }
  if (cur <= sprintFrom - 1) {
    segs.push({ kind: 'normal', from: cur, to: sprintFrom - 1 });
    cur = sprintFrom;
  }
  if (cur <= bodyEnd) {
    segs.push({ kind: 'sprint', from: cur, to: bodyEnd });
    cur = bodyEnd + 1;
  }
  // 3) 考试周
  if (cur <= totalWeeks) {
    segs.push({ kind: 'exam', from: cur, to: totalWeeks });
  }

  if (persona && persona.axes.ACH >= 70) {
    notes.push(`成就驱动高（${persona.axes.ACH}），期末冲刺提前到第 ${sprintFrom} 周开始`);
  }
  notes.push('阶段划分依据：校历的教学周结构 + 你课表的实际周次区间 + 画像');
  notes.push(...adaptReasons);
  // 阶段 D：把原型**说出来**。
  //
  // 为什么只解释、不额外调 policy：原型本质是 8 轴的一种聚类概括，
  // 而 `applyPersona` 已经把每条轴逐个消费过了 —— 再拿原型调一遍就是**重复计价**，
  // 会让「按画像排」悄悄变成「按画像排两次」，日后偏离基准时无从归因。
  // 让它在理由里出现，画像页那张卡片就不再是装饰，用户也能对得上号。
  const arch = persona?.archetype.primary;
  if (arch) notes.push(`整体节奏参照你的原型「${arch.name}」：${arch.tagline}`);

  /**
   * 阶段 C：把用户的偏好校正合成**一次**，供每个阶段复用。
   *
   * 位置刻意选在 `applyPersona` **之后** —— 画像先给出「你这个阶段该多紧」的基线，
   * 校正层再在其上叠加「用户的额外要求」。反过来（先校正、后画像）会让画像的
   * 自动调整把用户明确说过的话又推回去，用户会觉得「我说了不算」。
   */
  const eff = composeEffectivePrefs(persona, corrections ?? []);
  const correctionReason = (() => {
    const active = (corrections ?? []).filter((r) => r.active);
    if (active.length === 0) return null;
    return `已应用你的要求：${summarizeCorrections(active).map((i) => i.title).join('；')}`;
  })();

  const phases: Phase[] = segs.map(({ kind, from, to }) => {
    const { policy: personaPolicy, reasons } = applyPersona(kind, BASE_POLICY[kind], persona);
    // 叠加顺序：画像基线 → 用户校正。
    // 生活模式（原阶段 D）已于 2026-09-30 移除：六个模式最终只等价于一个乘数，
    // 结构维度一个都够不着，留着只会让 UI 承诺引擎做不到的事。
    const policy = applyCorrectionsToPolicy(personaPolicy, eff);
    const rs = [...reasons];
    // 生效了就必须**说出来**。否则用户提了要求却看不到任何痕迹，
    // 会以为功能坏了 —— 这是本项目一直坚持的「可解释」纪律。
    if (correctionReason) rs.push(correctionReason);
    if (kind === 'exam') rs.unshift(`第 ${from}-${to} 周是考试周，课已结束，重点是复习节奏与睡眠`);
    return {
      kind,
      name: PHASE_NAME[kind],
      fromWeek: from,
      toWeek: to,
      policy,
      reasons: rs,
    };
  });

  return {
    plan: {
      semesterName: schedule.semesterName,
      totalWeeks,
      phases,
      personaVersion: persona?.version,
    },
    notes,
  };
}

/** 便捷封装：从校历常量取边界（会给本模块注入数据，保持 buildPhases 本身纯函数） */
export function buildPhasesFromCalendar(
  schedule: Schedule,
  persona: PersonaProfile | null,
  calendar?: { phases?: Array<{ kind: string; fromWeek: number; toWeek: number }> },
  corrections?: readonly CorrectionRule[] | null,
): BuildPhasesResult {
  const theory = calendar?.phases?.find((p) => p.kind === 'theory');
  const exam = calendar?.phases?.find((p) => p.kind === 'exam');
  return buildPhases(schedule, persona, {
    theoryFromWeek: theory?.fromWeek,
    examFromWeek: exam?.fromWeek,
  }, corrections);
}

/** 查某周落在哪个阶段（周计划生成时用） */
export function phaseOfWeek(plan: SemesterPlan, weekNo: number): Phase | undefined {
  return plan.phases.find((p) => weekNo >= p.fromWeek && weekNo <= p.toWeek);
}
