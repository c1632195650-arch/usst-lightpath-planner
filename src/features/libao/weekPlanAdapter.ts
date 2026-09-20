/**
 * `WeekPlan`（v2 引擎产物）→ `LbaoPlan`（梨宝展示形状）的适配层
 * ============================================================
 * 为什么需要这一层：`LbaoPlanView` 只认 `LbaoPlan`，而 `LbaoPlan` 原本是
 * `lib/lbao.ts::lbaoRecommend` 那个**硬编码模板**的产物。P2 的 T2.5 要做的是
 * 「两轨并轨」—— 让周程页的梨宝建议也用真引擎（`planWeek`）算，
 * 但展示组件不该为了这件事重写。
 *
 * 所以：**数据换成引擎的，展示形状保持不变**。区别只在下面这些「翻译」上。
 *
 * ⚠️ 这个文件里**没有任何排程逻辑**，全是字段改名。一旦这里开始出现
 *    「如果……就……否则……」的规则判断，说明适配层被误用成业务层了 ——
 *    那些判断本该在引擎里，输出的差异只是「同一事实的两种排版」。
 */
import type { LifeMode, TimeBlock, WeekPlan } from '@/types';
import type { LbaoBlock, LbaoPlan } from '@/lib/lbao';
import { LIFE_MODES } from '@/data/usst';
import { toHHmm } from '@/constants/time';
import { addDays, weekdayOf, WEEKDAY_CN } from '@/lib/date';

/** 引擎的 `BlockKind` → 展示用的 icon。README 里那套 emoji 口径保持一致。 */
const ICON: Record<string, string> = {
  course: '📚',
  study: '✏️',
  meal: '🍚',
  activity: '🏃',
  commute: '🚶',
  user: '📌',
  blank: '·',
};

/**
 * 引擎的 `BlockKind` → `LbaoBlock.kind`。
 *
 * `LbaoBlock.kind` 只有 5 个值（course/study/meal/activity/rest），
 * 而引擎有 7 个（多了 commute/user/blank）。多出来的归到 `activity`：
 * 「走路」和「自己加的事」在展示上都是「一段要占时间的安排」，
 * 不像课/自习/吃饭那样有明确语义 —— 硬塞进 `rest` 反而会被读成「休息」。
 */
function toLbaoKind(kind: TimeBlock['kind']): LbaoBlock['kind'] {
  if (kind === 'course' || kind === 'study' || kind === 'meal') return kind;
  return 'activity';
}

/**
 * 一个块的说明文字。
 *
 * 优先用引擎给的 `reason`（那是 explain 层保证「每个软块 100% 有理由」的产物），
 * 退而用地点，最后退回空串 —— 不编内容。
 */
function noteOf(b: TimeBlock): string {
  if (b.reason) return b.reason;
  if (b.place) return b.room ? `${b.place} ${b.room}` : b.place;
  return '';
}

/**
 * 把「生活模式 id」落成展示用的 `LifeMode` 对象。
 *
 * 为什么 id 要从外面传而不是从画像里读：生活模式是**用户当下选的**
 * （`AppState.lifeMode`，周程页上那个切换器），不是画像算出来的固定属性。
 * 从画像里猜会让「用户刚切到猛攻模式」这个动作在展示上不生效。
 *
 * 拿不到（null / 不认识的 id）时退回第一个 —— 展示层需要一个确定的模式对象
 * 来取名字和颜色，不能是 undefined。
 */
function modeOf(lifeModeId: string | null | undefined): LifeMode {
  return LIFE_MODES.find((m) => m.id === lifeModeId) ?? LIFE_MODES[0];
}

/** 一句话概括这一周 —— 只陈述引擎算出的事实，不做建议 */
function headlineOf(plan: WeekPlan): string {
  const h = (min: number) => Math.round((min / 60) * 10) / 10;
  const n = plan.blocks.length;
  if (n === 0) return '这一周没有可排的内容 —— 检查一下课表是否已导入。';
  const tight = plan.issues.filter((i) => i.level === 'error' || i.level === 'warn').length;
  return [
    `共 ${n} 个块`,
    `上课 ${h(plan.stats.courseMin)}h`,
    `自习 ${h(plan.stats.studyMin)}h`,
    tight > 0 ? `${tight} 处时间偏紧` : '转场余量安全',
  ].join(' · ');
}

/**
 * 把引擎的一周计划翻成梨宝展示形状。
 *
 * @param plan       引擎产物（`planWeek().plan`）
 * @param lifeModeId 用户当前选的生活模式 id（`AppState.lifeMode`）—— 只影响展示的配色与名称
 * @param termStart  学期首日（ISO）—— 把「第几周 + 星期几」还原成具体日期
 */
export function weekPlanToLbaoPlan(
  plan: WeekPlan,
  lifeModeId: string | null | undefined,
  termStart: string,
): LbaoPlan {
  const mode = modeOf(lifeModeId);

  // 本周周一 → 逐日展开。用引擎给的 `weekNo` 而不是外部传的周次：
  // 两者不一致时（比如异步竞态里换了周）以**计划自己声明的周次**为准，
  // 否则日期列会和张贴的块对不上。
  const monday = addDays(termStart, (plan.weekNo - 1) * 7);

  const days = [1, 2, 3, 4, 5, 6, 7]
    .map((dayOfWeek) => {
      const date = addDays(monday, dayOfWeek - 1);
      const blocks = plan.blocks
        .filter((b) => b.dayOfWeek === dayOfWeek)
        .sort((a, b) => a.startMin - b.startMin)
        .map<LbaoBlock>((b) => ({
          icon: ICON[b.kind] ?? '·',
          time: `${toHHmm(b.startMin)}–${toHHmm(b.endMin)}`,
          title: b.title,
          note: noteOf(b),
          kind: toLbaoKind(b.kind),
        }));
      return { date, label: WEEKDAY_CN[weekdayOf(date)], blocks };
    })
    .filter((d) => d.blocks.length > 0); // 空的那天不列出来 —— 列表里一行「（空）」没有信息量

  return {
    mode,
    headline: headlineOf(plan),
    reasons: plan.issues.slice(0, 5).map((i) => i.message),
    days,
  };
}
