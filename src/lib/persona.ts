import type {
  AnswerMap, Archetype, Axes, AxisKey, Confidence, Motives, PersonaItem,
  PersonaProfile, ScenarioFields, Traits,
} from '@/types';
import { PERSONA_ITEMS, PERSONA_VERSION } from '@/data/personaBank';

/* ============================================================
 * 元信息（展示用）
 * ========================================================== */

export const AXIS_KEYS: AxisKey[] = ['EXP', 'PLAN', 'SOC', 'RES', 'ACH', 'HEA', 'RAT', 'BOLD'];

export const AXIS_META: Record<AxisKey, { label: string; short: string; desc: string }> = {
  EXP:  { label: '🔍 探索度', short: '探索', desc: '愿不愿意尝新、走出舒适区' },
  PLAN: { label: '📋 计划性', short: '计划', desc: '提前规划 vs 随性而为' },
  SOC:  { label: '🎉 社交度', short: '社交', desc: '从与人互动中获得能量' },
  RES:  { label: '🧱 韧性',   short: '韧性', desc: '情绪稳定与抗压能力' },
  ACH:  { label: '🏆 成就驱动', short: '成就', desc: '对成绩与履历的在意程度' },
  HEA:  { label: '🌿 健康自律', short: '健康', desc: '作息、运动的自我管理' },
  RAT:  { label: '🧮 理性度', short: '理性', desc: '用数据与逻辑做决策' },
  BOLD: { label: '🚀 尝鲜敢度', short: '敢度', desc: '面对机会的冒险倾向' },
};

export const TRAIT_META: Record<string, { label: string; confidence: Confidence }> = {
  E:  { label: '外向性', confidence: 'mid' },
  C:  { label: '尽责性', confidence: 'mid' },
  ES: { label: '情绪稳定', confidence: 'mid' },
  O:  { label: '开放性', confidence: 'low' },
  A:  { label: '宜人性', confidence: 'low' },
};

export const SCENARIO_META: Record<string, { label: string; values: Record<string, string> }> = {
  meal_radius:       { label: '就餐半径', values: { near: '就近快吃', far: '愿意走远探店' } },
  planning:          { label: '计划习惯', values: { planned: '提前排满', flexible: '随性而动' } },
  event_breadth:     { label: '活动参与', values: { narrow: '只看相关的', broad: '什么都看看' } },
  social_radius:     { label: '社交半径', values: { wide: '群里喊人', close: '固定搭子' } },
  night_supply:      { label: '夜间补给', values: { delivery: '点外卖', convenience: '便利店速食', none: '忍着不吃' } },
  exercise_trigger:  { label: '运动触发', values: { with_others: '有人约才去', self_plan: '自己按计划' } },
  study_place:       { label: '自习偏好', values: { library: '图书馆', classroom: '空教室', dorm: '宿舍', cafe: '咖啡馆' } },
  info_channel:      { label: '信息入口', values: { group_chat: '班级群', wechat_mp: '公众号', word_of_mouth: '口口相传', self_search: '自己搜' } },
};

/* ============================================================
 * 校园原型（6 个，业务先验）
 * ========================================================== */

export const ARCHETYPES: Archetype[] = [
  {
    id: 'planner', name: '卷王本王', tagline: '连吃饭都提前一周排好',
    desc: '提前排课表、要确定性，脑子里住着一张 Excel。适合推政策通知、保研竞赛、效率工具。',
    axes: { EXP: 30, PLAN: 80, SOC: 45, RES: 60, ACH: 75, HEA: 55, RAT: 70, BOLD: 40 },
  },
  {
    id: 'social', name: '社交悍匪', tagline: '群里喊一声，三秒凑一桌',
    desc: '社团活动、约饭是刚需，走到哪都自带热闹氛围。适合推活动聚合、搭子匹配、群入口。',
    axes: { EXP: 70, PLAN: 45, SOC: 85, RES: 60, ACH: 45, HEA: 50, RAT: 45, BOLD: 70 },
  },
  {
    id: 'explorer', name: '独行侠', tagline: '自己逛，自己懂',
    desc: '喜欢自己找信息、爱挖小众店，一个人也能把日子过得有滋有味。适合推深度长文、小众探店、自助入口。',
    axes: { EXP: 80, PLAN: 55, SOC: 30, RES: 60, ACH: 55, HEA: 45, RAT: 75, BOLD: 65 },
  },
  {
    id: 'healthy', name: '早八战神', tagline: '早起跑步雷打不动',
    desc: '作息运动规律到让人佩服，身体是本钱的坚定信徒。适合推操场空闲、体测提醒、轻食窗口。',
    axes: { EXP: 45, PLAN: 70, SOC: 50, RES: 70, ACH: 55, HEA: 85, RAT: 60, BOLD: 50 },
  },
  {
    id: 'spontane', name: '随缘选手', tagline: '计划？随机应变',
    desc: '临时起意、说走就走，讨厌被计划框住。适合推「附近现在有什么」、即时性内容。',
    axes: { EXP: 75, PLAN: 25, SOC: 60, RES: 50, ACH: 35, HEA: 40, RAT: 40, BOLD: 70 },
  },
  {
    id: 'steady', name: '佛系躺平家', tagline: '少折腾，稳一点',
    desc: '喜欢确定、怕麻烦，稳稳当当就是福。适合推稳定口碑店、避坑提醒、明确步骤指引。',
    axes: { EXP: 25, PLAN: 65, SOC: 45, RES: 65, ACH: 50, HEA: 55, RAT: 55, BOLD: 30 },
  },
];

/** 原型 → 头像 emoji（展示用） */
export const ARCH_EMOJI: Record<string, string> = {
  planner: '📅', social: '🎪', explorer: '🧭', healthy: '🌅', spontane: '🎲', steady: '🧘',
};

const CONF_WEIGHT: Record<Confidence, number> = { high: 1.0, mid: 0.8, low: 0.5 };

/* ============================================================
 * 归一化
 * ========================================================== */

function l5Score(raw: number, reverse?: boolean): number {
  const v = reverse ? 6 - raw : raw;
  return ((v - 1) / 4) * 100;
}

/** E 层 FC 题：哪一侧 output 算「高」（100） */
const HIGH_OUTPUT: Record<string, string> = {
  E01: 'far', E02: 'planned', E03: 'broad', E04: 'wide', E06: 'self_plan',
};

const HELP_SELF: Record<string, number> = { search_self: 100, try_self: 80, ask_friend: 30, defer: 0 };

/** 单题归一化分数 0-100（未答/缺失 → null） */
function itemScore(item: PersonaItem, ans: AnswerMap): number | null {
  const a = ans[item.id];
  if (a === undefined || a === null) return null;
  switch (item.type) {
    case 'L5': {
      const raw = typeof a === 'number' ? a : Number(a);
      if (Number.isNaN(raw)) return null;
      return l5Score(raw, item.reverse);
    }
    case 'FC': {
      const opt = item.options?.find((o) => o.key === a);
      if (!opt) return null;
      if (opt.value !== undefined) return opt.value;
      // E 层：output 语义 → 0/100
      if (opt.output !== undefined && item.output_field) {
        return opt.output === HIGH_OUTPUT[item.id] ? 100 : 0;
      }
      return null;
    }
    case 'MC': {
      if (item.id === 'C05') {
        const opt = item.options?.find((o) => o.key === a);
        return opt?.output ? HELP_SELF[opt.output] ?? null : null;
      }
      return null; // E05/E07/E08 只产字段，不计轴
    }
    case 'SORT':
      return null; // B05 单独处理
  }
}

function sortScore(order: string[], key: string): number {
  const idx = order.indexOf(key);
  if (idx < 0) return 50; // 未参与排序，取中性
  return ((5 - 1 - idx) / 4) * 100; // 第 1 名(0) → 100，第 5 名(4) → 0
}

/* ============================================================
 * 合成
 * ========================================================== */

function getTrait(norm: Record<string, number>, ids: string[]): number {
  const vals = ids.map((id) => norm[id]).filter((v): v is number => v != null);
  if (vals.length === 0) return 50;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function getByVar(norm: Record<string, number>, id: string): number {
  return norm[id] ?? 50;
}

export function buildProfile(answers: AnswerMap): PersonaProfile {
  // 1. 逐题归一化
  const norm: Record<string, number> = {};
  for (const item of PERSONA_ITEMS) {
    const s = itemScore(item, answers);
    if (s != null) norm[item.id] = s;
  }

  // B05 排序 → 动机排序分
  const sortOrder = Array.isArray(answers.B05) ? (answers.B05 as string[]) : [];
  const sortScoreOf = (key: string) => sortScore(sortOrder, key);

  // 2. 底层特质
  const traits: Traits = {
    E: getTrait(norm, ['A01', 'A02', 'A03']),
    C: getTrait(norm, ['A04', 'A05', 'A06']),
    ES: getTrait(norm, ['A07', 'A08', 'A09']),
    O: getTrait(norm, ['A10', 'A11']),
    A: getTrait(norm, ['A12']),
  };

  // 3. 动机 = 0.6 人像 + 0.4 排序
  const motive = (portraitId: string, key: string): number =>
    0.6 * getByVar(norm, portraitId) + 0.4 * sortScoreOf(key);
  const motives: Motives = {
    ACH: motive('B01', 'ACH'),
    SOC: motive('B02', 'SOC'),
    HEA: motive('B03', 'HEA'),
    EXP: motive('B04', 'EXP'),
    STA: sortScoreOf('STA'),
  };

  // 4. 八轴合成（权重来自 persona-items.json scoring.axes）
  const E03_broad = norm.E03 ?? 50;
  const E01_far = norm.E01 ?? 50;
  const E02_planned = norm.E02 ?? 50;
  const E04_wide = norm.E04 ?? 50;
  const E06_self = norm.E06 ?? 50;
  const nightness = norm.D05 ?? 50;
  const morningness = 100 - nightness;
  const nfcc = norm.C03 ?? 50;

  const exp = 0.40 * traits.O + 0.30 * E03_broad + 0.15 * E01_far + 0.15 * motives.EXP;
  const axes: Axes = {
    EXP:  exp,
    PLAN: 0.45 * traits.C + 0.25 * E02_planned + 0.20 * nfcc + 0.10 * (norm.C04 ?? 50),
    SOC:  0.40 * traits.E + 0.25 * E04_wide + 0.20 * (norm.D04 ?? 50) + 0.15 * motives.SOC,
    RES:  0.55 * traits.ES + 0.25 * (norm.D01 ?? 50) + 0.20 * (norm.D02 ?? 50),
    ACH:  0.40 * motives.ACH + 0.20 * (100 - E03_broad) + 0.20 * (norm.D03 ?? 50) + 0.20 * (norm.D02 ?? 50),
    HEA:  0.35 * motives.HEA + 0.35 * E06_self + 0.15 * morningness + 0.15 * traits.C,
    RAT:  0.35 * (norm.C01 ?? 50) + 0.35 * (norm.C02 ?? 50) + 0.20 * (norm.C04 ?? 50) + 0.10 * (norm.C05 ?? 50),
    BOLD: 0.35 * (norm.D01 ?? 50) + 0.25 * (norm.D03 ?? 50) + 0.25 * (100 - nfcc) + 0.15 * exp,
  };
  const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
  (Object.keys(axes) as AxisKey[]).forEach((k) => { axes[k] = clamp(axes[k]); });

  // 5. 场景字段
  const field = (itemId: string): string => {
    const item = PERSONA_ITEMS.find((i) => i.id === itemId);
    const a = answers[itemId];
    const opt = item?.options?.find((o) => o.key === a);
    return opt?.output ?? 'unknown';
  };
  const scenarios: ScenarioFields = {
    meal_radius: field('E01'),
    planning: field('E02'),
    event_breadth: field('E03'),
    social_radius: field('E04'),
    night_supply: field('E05'),
    exercise_trigger: field('E06'),
    study_place: field('E07'),
    info_channel: field('E08'),
  };

  // 6. 置信度（核心轴 PLAN/RAT/RES 较高）
  const confidence: Partial<Record<AxisKey, Confidence>> = {
    EXP: 'mid', PLAN: 'high', SOC: 'mid', RES: 'high', ACH: 'mid', HEA: 'mid', RAT: 'high', BOLD: 'mid',
  };

  // 7. 原型匹配（加权欧氏距离）
  let primary: Archetype | null = null;
  let secondary: Archetype | null = null;
  let minDist = Infinity;
  let secondDist = Infinity;
  let wsum = 0;
  for (const k of AXIS_KEYS) wsum += CONF_WEIGHT[confidence[k] ?? 'mid'];

  for (const arch of ARCHETYPES) {
    let sum = 0;
    for (const k of AXIS_KEYS) {
      const w = CONF_WEIGHT[confidence[k] ?? 'mid'];
      sum += w * Math.pow(arch.axes[k] - axes[k], 2);
    }
    const d = Math.sqrt(sum / wsum) / 100; // 归一 0-1
    if (d < minDist) { secondDist = minDist; secondary = primary; minDist = d; primary = arch; }
    else if (d < secondDist) { secondDist = d; secondary = arch; }
  }
  const NO_MATCH = 0.45;
  const matchedPrimary = minDist <= NO_MATCH ? primary : null;
  const matchedSecondary = secondDist <= NO_MATCH ? secondary : null;

  // 8. 一致性校验（A01 与 A03 同测外向，差 ≥3 分则标记）
  const a01 = answers.A01, a03 = answers.A03;
  let quality: 'ok' | 'low' = 'ok';
  if (typeof a01 === 'number' && typeof a03 === 'number' && Math.abs(a01 - a03) >= 3) {
    quality = 'low';
  }

  return {
    version: PERSONA_VERSION,
    scoreVersion: PERSONA_VERSION,
    axes, traits, motives, scenarios,
    archetype: { primary: matchedPrimary, secondary: matchedSecondary, distance: minDist },
    confidence, quality,
    updatedAt: new Date().toISOString(),
  };
}

/** 判断某题是否已作答 */
export function isAnswered(answers: AnswerMap, id: string): boolean {
  const a = answers[id];
  return a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && a.length === 0);
}
