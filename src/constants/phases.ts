import type { Phase, PhaseId, SemesterType } from '@/types';

/**
 * 学期五阶段模型 —— 本产品最核心的产品哲学载体
 *
 * 设计要点（答辩会被问，务必理解）：
 *   1. 留白率随学期推进「递减」，但 **考试周 S4 不降反升（22% → 30%）**。
 *      理由：考试周再压缩休息只会降低发挥。这是反直觉但正确的设计，
 *      也是本产品区别于所有"帮你塞满日程"的竞品的核心记忆点。
 *   2. 短学期（上理工三学期制）单独一套配置，不能被当成假期。
 *   3. blankRate 是「建议值」，最终以用户手工调的滑块为准。
 *      产品不替用户做道德判断 —— 想多休息就多休息。
 */

type PhaseTemplate = Omit<Phase, 'startWeek' | 'endWeek'> & {
  /** 占学期的比例 0–1，用于按总周数换算具体周次 */
  ratio: number;
};

/** 长学期（秋/春，约 18 周）的六阶段 */
const LONG_TERM_TEMPLATES: PhaseTemplate[] = [
  { id: 'S0', name: '适应期',  ratio: 0.12, blankRate: 0.45, focus: '建立节奏、摸清难度，不背硬指标' },
  { id: 'S1', name: '积累期',  ratio: 0.38, blankRate: 0.35, focus: '主线推进，作业与项目齐头并进' },
  { id: 'S2', name: '加压期',  ratio: 0.17, blankRate: 0.28, focus: '期中考核与课程集中交付' },
  { id: 'S3', name: '冲刺期',  ratio: 0.22, blankRate: 0.22, focus: '期末复习：T-21 / T-14 / T-7 / T-3' },
  { id: 'S4', name: '考试周',  ratio: 0.11, blankRate: 0.30, focus: '只做维持，不新增任务，保住睡眠' },
];

/** 短学期（1–2 周）：节奏紧凑但总量小，留白给足 */
const SHORT_TERM_TEMPLATES: PhaseTemplate[] = [
  { id: 'S5', name: '短学期冲刺', ratio: 0.6, blankRate: 0.30, focus: '集中授课/重读，强度高但周期短' },
  { id: 'S0', name: '收尾与复盘', ratio: 0.4, blankRate: 0.45, focus: '收尾、复盘、准备下一个长学期' },
];

/**
 * 根据学期类型与总周数，生成完整阶段划分。
 *
 * @param type   学期类型
 * @param totalWeeks 该学期总周数（长学期一般 18，短学期 1–2）
 */
export function buildPhases(type: SemesterType, totalWeeks: number): Phase[] {
  const templates = type === 'short' ? SHORT_TERM_TEMPLATES : LONG_TERM_TEMPLATES;

  const phases: Phase[] = [];
  let cursor = 1;

  templates.forEach((tpl, idx) => {
    const span = Math.max(1, Math.round(totalWeeks * tpl.ratio));
    const startWeek = cursor;
    // 最后一段兜底到总周数，避免比例取整造成缺漏
    const endWeek = idx === templates.length - 1 ? totalWeeks : Math.min(totalWeeks, cursor + span - 1);
    phases.push({
      id: tpl.id,
      name: tpl.name,
      startWeek,
      endWeek,
      blankRate: tpl.blankRate,
      focus: tpl.focus,
    });
    cursor = endWeek + 1;
  });

  return phases.filter((p) => p.startWeek <= p.endWeek);
}

/** 根据当前周次找到所处阶段 */
export function findPhase(phases: Phase[], week: number): Phase {
  const hit = phases.find((p) => week >= p.startWeek && week <= p.endWeek);
  // 越界时给最接近的一端，而不是抛错 —— 用户可能在假期打开
  if (!hit) return week < (phases[0]?.startWeek ?? 1) ? phases[0] : phases[phases.length - 1];
  return hit;
}

/** 阶段展示色（Tailwind class，供 UI 直接用） */
export const PHASE_STYLE: Record<PhaseId, { bg: string; text: string; bar: string }> = {
  S0: { bg: 'bg-ok-light',     text: 'text-ok',     bar: 'bg-ok' },
  S1: { bg: 'bg-accent-light', text: 'text-accent', bar: 'bg-accent' },
  S2: { bg: 'bg-warn-light',   text: 'text-warn',   bar: 'bg-warn' },
  S3: { bg: 'bg-brand-light',  text: 'text-brand',  bar: 'bg-brand' },
  S4: { bg: 'bg-danger-light', text: 'text-danger', bar: 'bg-danger' },
  S5: { bg: 'bg-paper',        text: 'text-ink-soft', bar: 'bg-ink-faint' },
};
