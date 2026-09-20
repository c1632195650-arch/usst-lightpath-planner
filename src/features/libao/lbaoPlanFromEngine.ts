/**
 * 把**引擎算出的周计划**转成梨宝的展示模型
 * ============================================================
 * 这是「双轨」的终点：过去周程页的「生成建议」走的是 `lib/lbao.ts` 里那套
 * 硬编码时段的模板，而梨宝对话侧早已并轨真引擎 —— 同一个应用里两套排程答案。
 * 现在两边共用同一个引擎，只是**呈现分层**：
 *   · 周计划页 / 时间轴  → 铺开执行细节
 *   · 梨宝方案卡 / 对话  → 一屏速览、能对话
 * 这是产品设计上该有的分工，不是妥协；但**数据必须同源**。
 *
 * ⚠️ 这里只做**映射**，不做任何取舍决策：
 *   不筛掉「不重要」的块、不替用户加建议、不重排顺序。少显示一个块，
 *   用户就少看到一件本该知道的事 —— 引擎排了 9 件事，卡片就该有 9 张。
 */
import type { BlockKind, TimeBlock, WeekPlan } from '@/types';
import type { LbaoBlock, LbaoPlan, LbaoShell } from '@/lib/lbao';
import { WEEKDAY_CN, weekdayOf } from '@/lib/date';
import { toHHmm } from '@/constants/time';

/**
 * 块类别 → 展示类别。
 * 引擎有 6 种 `BlockKind`，卡片只有 5 种样式，因此 `commute` 并入 `activity`。
 * ⚠️ `blank`（刻意留白）**不映射** —— 它不是一件"事"，而是一段"没事的时间"，
 *    列成卡片会与「留白」的本意相反（见 `toLbaoPlan` 的过滤）。
 */
function displayKind(kind: BlockKind): LbaoBlock['kind'] {
  switch (kind) {
    case 'course': return 'course';
    case 'meal': return 'meal';
    case 'study': return 'study';
    case 'activity': return 'activity';
    case 'commute': return 'activity';
    default: return 'rest';
  }
}

/** 没有 emoji 时的兜底图标（与 `KIND_STYLE` 的语义一致，但那是 UI 层的东西，这里自带一份） */
const KIND_ICON: Record<LbaoBlock['kind'], string> = {
  course: '🏫',
  study: '📖',
  meal: '🍜',
  activity: '🎯',
  rest: '🛋️',
};

/**
 * 一张卡片的说明文字。
 *
 * 优先用引擎给的 `reason`（「为什么排在这儿」），它就是这个产品最想让人看到的东西；
 * 没有就退回地点，再退回类别名 —— **不编**。
 */
function noteOf(b: TimeBlock, kind: LbaoBlock['kind']): string {
  if (b.reason) return b.reason;
  if (b.place) return b.room ? `${b.place} ${b.room}` : b.place;
  if (b.kind === 'course') return '上课';
  const fallback: Record<LbaoBlock['kind'], string> = {
    course: '上课', study: '自习', meal: '用餐', activity: '活动', rest: '休息',
  };
  return fallback[kind];
}

/** 单个块 → 卡片 */
export function blockToCard(b: TimeBlock): LbaoBlock {
  const kind = displayKind(b.kind);
  return {
    icon: b.emoji ?? KIND_ICON[kind],
    time: toHHmm(b.startMin),
    title: b.title,
    note: noteOf(b, kind),
    kind,
  };
}

/**
 * 引擎计划 → 梨宝方案展示模型。
 *
 * @param plan  引擎输出的周计划（真实来源）
 * @param shell 画像侧的外壳（模式 / 开场白 / 依据），见 `lib/lbao.ts::lbaoShell`
 * @param dates 要展示的日期（ISO，通常是用户选中的那几天）
 */
export function toLbaoPlan(plan: WeekPlan, shell: LbaoShell, dates: string[]): LbaoPlan {
  const days = dates.map((date) => {
    const wd = weekdayOf(date);
    const courseDay = wd === 0 ? 7 : wd; // 周日 → 7（引擎用 1..7）
    const blocks = plan.blocks
      .filter((b) => b.dayOfWeek === courseDay && b.kind !== 'blank')
      .sort((a, b) => a.startMin - b.startMin)
      .map(blockToCard);
    return { date, label: WEEKDAY_CN[wd], blocks };
  });

  return { mode: shell.mode, headline: shell.headline, reasons: shell.reasons, days };
}
