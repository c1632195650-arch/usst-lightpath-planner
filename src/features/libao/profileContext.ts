/**
 * 用户档案摘要（路线 B：状态注入）
 * ============================================================
 * 把「你是谁」压缩成一段可以进 system prompt 的文本。
 *
 * 为什么需要它：后端此前**完全不知道用户是谁** —— 证据是测试报告 C2 组那句
 * 「课表还得看你自己的」，而用户明明录了课表、也做完了 8 轴画像。
 *
 * 三条原则：
 *  1. 摘要是**压缩**，不是转储。全量 AppState 会撑爆 prompt、拖慢首字延迟。
 *  2. 给**语义标签 + 数值**（「计划性 72（偏高）」），比裸的「PLAN=72」对模型有用得多。
 *  3. **不带任何可识别个人的信息**。只输出画像轴值、场景偏好与课表结构，
 *     不含学号 / 姓名 / 手机号。后端还会再过一层 desensitize()，
 *     但信任边界不该只靠下游兜底。
 *
 * 与后端的分工：prompt 的**结构**（【用户档案】块与行为约束）归后端；
 * 这里只负责产出内容本身，不自带标题、不写指令。
 */
import type { AxisKey, PersonaProfile, ScenarioFields, Schedule } from '@/types';
import { AXIS_META, SCENARIO_META } from '@/lib/persona';
import { TERM_CALENDAR } from '@/constants/term';
import { currentWeekNo, todayISO, WEEKDAY_CN } from '@/lib/date';

/** 后端会在 1200 字符处截断，这里在源头就守住，避免被切掉的正好是最有用的课表段。 */
const MAX_LEN = 1200;

/** 轴值 → 水平词。口径与 `lib/lbao.ts::axisReason` 保持一致 ——
 *  同一个数字在两处说法不同，是最容易让用户失去信任的那类小毛病。 */
function level(v: number): string {
  return v >= 65 ? '偏高' : v <= 40 ? '偏低' : '中等';
}

/** 8 轴 → 「计划性 72（偏高）、健康自律 38（偏低）…」
 *  按**偏离中位的幅度**排序：最显著的特征排最前面，模型前几十个 token 就能抓住重点。 */
function axesLine(p: PersonaProfile): string {
  const items = (Object.keys(AXIS_META) as AxisKey[]).map((k) => ({
    short: AXIS_META[k].short,
    v: p.axes[k] ?? 50,
  }));
  items.sort((a, b) => Math.abs(b.v - 50) - Math.abs(a.v - 50));
  return items.map((i) => `${i.short} ${Math.round(i.v)}（${level(i.v)}）`).join('、');
}

/** 场景字段 → 「就餐半径：愿意走远探店｜自习偏好：图书馆」。
 *  只输出**有值**的字段：未设置的不编，猜出来的偏好比没有偏好更糟。 */
function sceneLine(p: PersonaProfile): string {
  const out: string[] = [];
  // SCENARIO_META 是 Record<string, …>，而 scenarios 是固定字段的 interface ——
  // 把键收窄到 ScenarioFields 的键上，两侧就都类型安全，不需要 as 硬转。
  const keys = Object.keys(SCENARIO_META) as Array<keyof ScenarioFields>;
  for (const key of keys) {
    const meta = SCENARIO_META[key];
    const field = p.scenarios[key];
    const text = field ? meta.values[field] : undefined;
    if (text) out.push(`${meta.label}：${text}`);
  }
  return out.join('｜');
}

/** 学期阶段的中文名（与 `constants/term.ts` 的 kind 一一对应）。 */
const SEG_NAME: Record<string, string> = {
  short: '短学期',
  normal: '教学周',
  theory: '理论教学',
  exam: '考试周',
  break: '假期',
};

interface DayCourse {
  name: string;
  from: number;
  to: number;
  place: string;
}

/**
 * 第 weekNo 周、星期 day 真正要上的课。
 * **必须按 `slots[].weeks` 过滤** —— 不按周次过滤就会把整学期课表当成每周都上，
 * 这正是「日程看起来假」的根源之一。
 */
function coursesOn(schedule: Schedule, weekNo: number, day: number): DayCourse[] {
  const out: DayCourse[] = [];
  for (const c of schedule.courses) {
    for (const s of c.slots) {
      if (s.dayOfWeek !== day) continue;
      if (s.weeks.length > 0 && !s.weeks.includes(weekNo)) continue;
      out.push({
        name: c.name,
        from: s.startPeriod,
        to: s.endPeriod,
        place: [c.building, c.room].filter(Boolean).join(' '),
      });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/**
 * 生成用户档案摘要。
 *
 * @param profile  画像（未完成画像时传 null）
 * @param schedule 课表（未导入时传 null）
 * @param today    基准日期，默认今天；显式传入便于测试与「看别的周」
 * @returns 可直接作为 `profile_ctx` 传给后端的文本；无可用信息时返回空串（后端据此跳过注入）
 */
export function buildProfileContext(
  profile: PersonaProfile | null,
  schedule: Schedule | null,
  today: string = todayISO(),
): string {
  const blocks: string[] = [];

  // ---- 学期位置：让「现在该松还是该紧」有依据，而不是凭空建议 ----
  let weekNo = 1;
  if (schedule?.termStart) {
    weekNo = currentWeekNo(schedule.termStart, today);
    const cal = Object.values(TERM_CALENDAR).find((c) => c.termStart === schedule.termStart);
    const seg = cal?.phases?.find((p) => weekNo >= p.fromWeek && weekNo <= p.toWeek);
    const stage = seg ? SEG_NAME[seg.kind] ?? seg.name : '';
    blocks.push(
      `【学期】${schedule.semesterName}，第 ${weekNo} 周 / 共 ${schedule.totalWeeks} 周` +
        (stage ? `（${stage}）` : ''),
    );
  }

  // ---- 画像：8 轴 + 生活偏好 + 原型 ----
  if (profile) {
    blocks.push(`【画像】${axesLine(profile)}`);
    const scene = sceneLine(profile);
    if (scene) blocks.push(`【生活偏好】${scene}`);
    if (profile.archetype?.primary) {
      const { name, tagline } = profile.archetype.primary;
      blocks.push(`【原型】${name}${tagline ? ` —— ${tagline}` : ''}`);
    }
  }

  // ---- 课表：按天聚合。这是断点 2 最直接的证据面 ——
  //      「课表还得看你自己的」这句话，有这段之后就不该再出现。
  if (schedule && schedule.courses.length > 0) {
    const lines: string[] = [];
    let slotCount = 0;
    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      const items = coursesOn(schedule, weekNo, day);
      const label = WEEKDAY_CN[day % 7];
      if (items.length === 0) {
        lines.push(`${label} 无课`);
        continue;
      }
      slotCount += items.length;
      const text = items
        .map((i) => `${i.name}(${i.from}-${i.to}节${i.place ? ` ${i.place}` : ''})`)
        .join('、');
      lines.push(`${label} ${text}`);
    }
    if (slotCount === 0) {
      blocks.push(`【本周课表】第 ${weekNo} 周没有课（已结课或处在考试周）`);
    } else {
      blocks.push(`【本周课表】共 ${slotCount} 次课\n${lines.join('\n')}`);
    }
  }

  if (blocks.length === 0) return '';

  // 画像可信度低时明确标注 —— 避免模型把不完整的答卷当成确凿事实去推理
  if (profile?.quality === 'low') {
    blocks.push('（画像基于不完整答卷，仅供参考）');
  }

  const text = blocks.join('\n\n');
  return text.length > MAX_LEN ? text.slice(0, MAX_LEN) : text;
}
