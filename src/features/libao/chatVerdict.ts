/**
 * chatVerdict —— 梨宝话术生成域（从 weekPlanForChat 拆出，D1-批3/r9，2026-10-24）
 * ============================================================
 * 来历：weekPlanForChat.ts 曾是 1300+ 行的防腐层单文件，引擎调用与「数字→人话」
 * 的话术翻译混在一起。本文件承接**纯话术族**（行为不变搬运，逐字节来自原文件）；
 * weekPlanForChat 保留引擎调用（planWeek/checkGoalFeasibility/干跑）并从本文件
 * re-export 全部公开符号——**既有导出面零变化**。
 *
 * 接缝红线（AGENTS §三.6）：本文件**零 planner import**（源码锁在
 * tests/variants.test.ts 与本文件头的依赖声明双重把守）——话术只消费已求解的
 * 数据形状（WeekPlan / GoalVerdict / ChatVariantLike），不触碰引擎。
 */
import type { PlanIssue, WeekPlan } from '@/types';
import { WEEKDAY_CN, weekdayOf } from '@/lib/date';
import { isSingleDayEvent, type IntentSlots, type SlotKey } from './libaoIntent';
import { classifyGoal, evidenceLine, type GoalCategory, TAXONOMY } from './taxonomy';

/* ============================================================
 * 一、类型（GoalVerdict 族 —— 干跑结论的数据形状）
 * ========================================================== */

export type GoalVerdictKind =
  | 'ok'                    // 排得下，无新增问题
  | 'tight'                 // 排得下，但会变紧 or 挤占自习
  | 'conflict'              // 排得下但引入冲突 → 出方案 A/B
  | 'infeasible'            // 排不进去 → 说明卡点 + 给可选项
  | 'needs_clarification';  // 槽位不齐 → 追问

/** 新增的问题（按 `code` 归并计数后的增量） */
export interface GoalAddedIssue {
  code: string;
  level: PlanIssue['level'];
  count: number;
  sample: string;
}

export interface GoalVerdict {
  kind: GoalVerdictKind;
  /** `needs_clarification` 时的追问话术（≤2 条） */
  questions: string[];
  /** 相对基线**新增**的问题 */
  added: GoalAddedIssue[];
  /** 自习时长变化（分钟，负数 = 被挤掉） */
  studyDeltaMin: number;
  /** 真正落进计划的块数 */
  placedCount: number;
  /** 候选块数 —— `placedCount < candidates` 就说明有块排不进去 */
  candidateCount: number;
  /** 落点的人类可读描述，供草稿卡逐条显示 */
  placedAt: string[];
  /** 必须如实告知用户的口径（用了默认窗口 / 时间待定…） */
  caveats: string[];
  /** 结论的一句话理由，供梨宝回话直接引用 */
  reasons: string[];
  /**
   * D4：排不进去时**挡路的既有块**（引擎干跑扫出，≤5 条，hint 含 `周X(M.D) HH:MM–HH:MM`）。
   * 有了它，describeVerdict 列事实而不是硬编码「①②③」，协商话术才有依据（B③）。
   */
  blockingBlocks?: BlockingBlockInfo[];
  /** D4：用户真的给了投入量吗 —— 没给就不该出现「降一档目标量」这类话术 */
  canReduceScope?: boolean;
}

/** 挡路块的最小描述（PickOption 的素材；blockId 供「顶掉这块」的 replace 语义用） */
export interface BlockingBlockInfo {
  title: string;
  hint: string;
  blockId?: string;
  /** 批次 2（交互升级方案 5.4）：与目标块时段窗的重叠分钟数 —— 反馈精简按它
   *  排序取「最相关」的 top1-2，其余并入「另有 N 处时段被占」。 */
  overlapMin?: number;
}

/**
 * F4⑥ 的变体形状（结构化声明，**不 import planner 的 PlanVariant**——接缝红线；
 * PlanVariant 结构上可赋值给它，调用侧无感）。
 */
export interface ChatVariantLike {
  id: string;
  label?: string;
  plan: WeekPlan;
  cost: number;
}

/* ============================================================
 * 二、周计划摘要 / 变体摘要（纯读侧）
 * ========================================================== */

export function summarizeWeekPlan(plan: WeekPlan): string[] {
  const out: string[] = [];
  const byDay = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    label: WEEKDAY_CN[day % 7],
    blocks: plan.blocks.filter((b) => b.dayOfWeek === day),
  }));

  // 1) 哪天最满 —— 这是「结合你的课表」最直观的证据
  const busiest = [...byDay].sort((a, b) => b.blocks.length - a.blocks.length)[0];
  if (busiest && busiest.blocks.length > 0) {
    out.push(`${busiest.label}最满，排了 ${busiest.blocks.length} 个块`);
  }

  // 2) 时间紧张的地方。直接引用引擎的判定（转场是实测出来的），不在这里重复判断 ——
  //    否则就成了「两处各算一遍」，正是双轨问题的翻版。
  const tight = plan.issues.filter((i) => i.level === 'error' || i.level === 'warn');
  for (const t of tight.slice(0, 2)) out.push(t.message);
  if (tight.length === 0) out.push('走路和转场的余量都在安全范围内');

  // 3) 整天空着的天 —— 对「那我能干点啥」这类追问最有用
  const free = byDay.filter((d) => d.blocks.length === 0).map((d) => d.label);
  if (free.length > 0) out.push(`${free.join('、')}基本空着`);

  // 4) 量的口径：自习总量 + **日均**留白。
  //    刻意不报留白总时长 —— 实测一周能到 63 小时，那个数字看着像系统压根没干活，
  //    日均才是人读得懂的（「每天留出 9 小时」）。
  const h = (min: number) => Math.round((min / 60) * 10) / 10;
  out.push(
    `自习 ${h(plan.stats.studyMin)}h · 日均留白 ${h(plan.stats.blankMin / 7)}h · 共 ${plan.stats.blockCount} 个块`,
  );

  return out;
}

/**
 * F4⑥（2026-10-24，CY 点名批）：三档变体的梨宝话术摘要 ——「换个节奏」场景。
 *
 * 设计边界：
 *   · **纯函数、零引擎调用**：数据来自已求解的变体列表（planWeek 的
 *     `variants: true` 产物），本函数只做「数字 → 人话」的翻译；
 *   · **不替用户拍板**（智能边界 L3/L4 红线）：只并列三版事实，选择权在用户
 *     —— 尾行给的是「怎么说就换」，不是「建议你选哪版」；
 *   · 接缝合规：形状用本文件的 ChatVariantLike（零 planner import）。
 *
 * @param variants planWeek 变体编排的产物（balanced/compact/relaxed；空数组 → 空）
 * @returns 每版一行 + 一条切换提示；行序与输入一致（balanced 在首，由编排保证）
 */
export function variantSummariesForChat(
  variants: ReadonlyArray<ChatVariantLike>,
): string[] {
  if (variants.length === 0) return [];
  const hourOf = (min: number) => {
    const h = Math.round((min / 60) * 10) / 10;
    return Number.isInteger(h) ? String(h) : h.toFixed(1);
  };
  const out = variants.map((v) => {
    const name = v.label ?? v.id;
    const s = v.plan.stats;
    return `${name}版：这周自习约 ${hourOf(s.studyMin)} 小时、留白约 ${hourOf(s.blankMin)} 小时`;
  });
  out.push('三版是同一批课和锁定，只是节奏不同 —— 想换直接说「换紧凑 / 换松弛」，周计划页顶部也能一键切');
  return out;
}

/* ============================================================
 * 三、草稿卡话术（verdict → 人话；只陈述事实 + 给选项，不拍板）
 * ========================================================== */

/**
 * 批次 2（交互升级方案 5.4）· 类型标签：冲突反馈每条带「卡在哪一类」的标签。
 * 按语义关键词映射（issue 的中文 sample 本来就带这些词），不引入新数据依赖。
 */
export function tagLine(line: string): string {
  const body = line.replace(/^·\s*/, '');
  if (/放不下|装得下|挤掉|挤占|容量|目标量/.test(body)) return `· 📦 量放不下：${body}`;
  if (/撞|重叠|已有「/.test(body)) return `· ⏰ 时间撞：${body}`;
  if (/转场|步行|来不及/.test(body)) return `· 🚶 转场不够：${body}`;
  if (/时段|窗口|晚上|下午|早上|中午/.test(body)) return `· 🪟 时段窗卡住：${body}`;
  return line;
}

/**
 * 草稿卡的文案（**只陈述事实 + 给选项，不替用户拍板** —— core §4 的 L3/L4 边界）。
 *
 * 批次 2 反馈精简（交互升级方案 5.4）：
 *   · 总行数 ≤6 —— 口径说明合并成一行；conflict/infeasible 不再平铺落点
 *     （版面让给卡点与选项，落点在重排后的草稿卡里如实展示）；
 *   · 挡路块按与目标块的重叠时长排序取 top2，其余并入「另有 N 处时段被占」；
 *   · 每条卡点带类型标签（tagLine）。
 */
export function describeVerdict(v: GoalVerdict): string[] {
  const out: string[] = [];
  const blocked = v.kind === 'conflict' || v.kind === 'infeasible';

  // 口径说明合并成一行（默认窗口/没地点/待定/钟点歧义 共用一条）
  if (v.caveats.length > 0) out.push(`· ${v.caveats.slice(0, 3).join('；')}`);

  // 落点：排上了才谈落点（ok/tight）；blocked 的版面让给卡点与选项
  if (!blocked && v.placedAt.length > 0) {
    for (const p of v.placedAt.slice(0, 2)) out.push(`· 排到：${p}`);
    const rest = v.placedAt.length - 2;
    if (rest > 0) out.push(`· 另有 ${rest} 块排在后面的周`);
  }

  // 理由：blocked 只说最相关的一条，其余进选项的 hint
  for (const r of v.reasons.slice(0, blocked ? 1 : 2)) out.push(tagLine(`· ${r}`));

  // 挡路事实：按重叠度取 top2 + 一行汇总
  const blocks = [...(v.blockingBlocks ?? [])].sort((a, b) => (b.overlapMin ?? 0) - (a.overlapMin ?? 0));
  for (const b of blocks.slice(0, 2)) out.push(`· ⏰ 时间撞：${b.hint} 已有「${b.title}」`);
  const restBlocks = blocks.length - 2;
  if (restBlocks > 0) out.push(`· 另有 ${restBlocks} 处时段被占`);

  if (v.kind === 'needs_clarification') {
    for (const q of v.questions) out.push(`· ${q}`);
  }
  if (v.kind === 'conflict') {
    // 强化计划 D（2026-10-02）：不再硬编码「①②③」承诺 —— 真编号选项由
    // `proposeReplanOptions` 干跑产出、在 LbaoChat 侧追加；这里只给**说得出口**的
    // 方向，避免「承诺了编号、实际一个都拿不出」的脱节（真机实录）。
    out.push('· 可以说「换个时间」「缩短或拆分」，或者告诉我愿意让出哪一块 —— 我来改。');
  }
  if (v.kind === 'infeasible') {
    // D4：去硬编码 —— 有挡路事实时给「顶掉其中一块」的方向；
    // 用户根本没给投入量时，不说「降一档目标量」（对「出去玩」说这话很荒谬）。
    if (v.blockingBlocks?.length) {
      out.push('· 可以：① 用新安排顶掉其中一块（说「把X替换掉」就行）；② 换个日子或下一周；③ 换个时间段。你说哪个，我来改。');
    } else if (v.canReduceScope) {
      out.push('· 可以：① 挪到下一周；② 降一档目标量；③ 先告诉我你愿意让出哪一块。');
    } else {
      out.push('· 可以：① 挪到下一周；② 换个时间段；③ 先告诉我你愿意让出哪一块。');
    }
  }
  return out;
}

/* ============================================================
 * 四、快捷选项（能按钮不打字）
 * ========================================================== */

/**
 * 批次 3（交互升级方案 6.2）· 本周类目分钟统计。
 * 照 `summarizeWeekPlan` 的读侧范式：不改锁死的 types.ts、不给 TimeBlock 加字段
 * —— 分类只是读侧视图（kind + title 关键词 → taxonomy）。
 */
export function categoryMinutesOfWeek(plan: WeekPlan, cat: GoalCategory): number {
  let total = 0;
  for (const b of plan.blocks) {
    if (b.kind !== 'activity' && b.kind !== 'study') continue;
    if (classifyGoal(b.title) === cat) total += b.endMin - b.startMin;
  }
  return total;
}

/* ============================================================
 * 批次 2（交互升级方案 5.1-5.3）· 快捷选项（能按钮不打字）
 * ============================================================
 * 每个追问都配 2-4 个快捷项 + 永远保留自由输入（「其他」路径 = 输入框本体）。
 * **value 必须是规则层解析得动的原话** —— 按钮点击 = send(value)，
 * 走既有解析与编号兜底，双保险；这里用测试锁死「value 可解析」的互通性。
 */
export interface QuickOption {
  /** 按钮上的人话 */
  label: string;
  /** 点击后作为用户消息发出的文本（必须可被 parseIntentSlots / parseOptionChoice 解析） */
  value: string;
  /** 次行小字（干跑事实 / 依据），可缺省 */
  hint?: string;
}

/**
 * 追问快捷项生成器（纯函数）。
 * · when：按今天日期给「还没过去的」说法 —— 周日不推「这周六」；
 * · effort：单日事件给单次时长档位，长期诉求给频率档位（口径见 5.3）；
 * · place：高频校园点（value 带「在」以喂 extractPlace）。
 * 批次 3 叠加类目/依据后在此扩 hint。
 */
export function quickOptionsFor(
  slot: SlotKey | 'place',
  slots: IntentSlots,
  opts?: { today?: string; plan?: WeekPlan | null; exercisePerWeek?: number },
): QuickOption[] {
  switch (slot) {
    case 'when': {
      const out: QuickOption[] = [
        { label: '今天晚上', value: '今天晚上' },
        { label: '明天下午', value: '明天下午' },
        { label: '明天晚上', value: '明天晚上' },
      ];
      // weekdayOf：0=周日。周六已过（周日）→ 推下周六
      const dow = opts?.today ? weekdayOf(opts.today) : undefined;
      out.push(dow != null && dow >= 1 && dow <= 6
        ? { label: '这周六晚上', value: '这周六晚上' }
        : { label: '下周六晚上', value: '下周六晚上' });
      return out;
    }
    case 'effort': {
      // 批次 3（6.3/6.4）：按钮卡次行小字 = 时长概念锚（tips 轮换）；
      // 推荐档（第二项）的次行给**带来源的依据行**（健康库/方法库 + 本周已排量）。
      const cat = classifyGoal(slots.title);
      const tips = cat === 'generic' ? TAXONOMY_TIPS_FALLBACK : null;
      const catTips = tips ?? TAXONOMY_TIPS(cat);
      const evidence = evidenceLine(cat, {
        ...(opts?.plan ? { weekMinutes: categoryMinutesOfWeek(opts.plan, cat) } : {}),
        ...(opts?.exercisePerWeek != null ? { exercisePerWeek: opts.exercisePerWeek } : {}),
      });
      if (isSingleDayEvent(slots)) {
        const items = [
          { label: '45 分钟', value: '45分钟' },
          { label: '60 分钟', value: '60分钟' },
          { label: '90 分钟', value: '90分钟' },
          { label: '2 小时', value: '2小时' },
        ];
        return items.map((it, i) => ({
          ...it,
          hint: i === 1 && evidence ? evidence : catTips[i % catTips.length],
        }));
      }
      const items = [
        { label: '每周 1-2 次', value: '每周2次' },
        { label: '每周 3-4 次', value: '每周4次' },
        { label: '每天 30 分钟', value: '每天都来，每次30分钟' },
      ];
      return items.map((it, i) => ({
        ...it,
        hint: i === 0 && evidence ? evidence : catTips[i % catTips.length],
      }));
    }
    case 'place':
      return [
        { label: '图书馆', value: '在图书馆' },
        { label: '操场', value: '在操场' },
        { label: '体育馆', value: '在体育馆' },
        { label: '空教室', value: '在空教室' },
      ];
    default:
      return [];
  }
}

const TAXONOMY_TIPS = (cat: GoalCategory): string[] => TAXONOMY[cat].tips;
const TAXONOMY_TIPS_FALLBACK: string[] = ['说个大概时长就行，我按你的日历找空档'];

/** blocked 编号方案 → 按钮卡。value 用「方案N」—— parseOptionChoice 确定性接住，
 *  不经 LLM（强化计划 D 的兜底通道原样复用）。 */
export function replanOptionButtons(options: ReadonlyArray<{ label: string }>): QuickOption[] {
  return options.map((o, i) => ({ label: o.label, value: `方案${i + 1}`, hint: '引擎干跑过，真排得上' }));
}
