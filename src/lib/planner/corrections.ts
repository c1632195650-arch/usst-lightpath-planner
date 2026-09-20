/**
 * 偏好校正层（用户改进建议的结构化载体）
 * ============================================================
 * 解决什么问题：排程是一次性的 —— 用户对排法的意见（「周四下午别排东西」）
 * 只影响当次、不沉淀。本模块把这类意见变成**结构化、可叠加、可撤销**的校正规则，
 * 为「让画像越用越准」提供数据载体。
 *
 * ── 与画像的边界（最关键的一条）──────────────────────────────
 * `PersonaProfile` 由 35 题答卷经 `buildProfile(answers)` **纯函数整体重算**，
 * `answers` 是唯一真源。所以**绝不能改写画像数值** —— 下次重算就被覆盖。
 * 校正层是**独立的叠加层**：画像回答「你是谁」，校正层回答
 * 「你对上次排法有什么意见」。两者正交、叠加使用；本模块**永不回写**
 * `answers` / `persona`。
 *
 * 一个直接推论：`「周四下午别排东西」` **无法反推成 35 题的任何一题答案**
 * （题库里没有这道题）。所以绝大多数干预映射到的是**排程策略**或**黑名单**，
 * 而不是 8 条人格轴 —— 这正是两套信号正交的工程体现。
 *
 * ── 为什么类型定义在引擎侧，而不是 features 侧 ─────────────────
 * `PlanRequest.corrections` 需要引用它。若类型定义在 `features/**`，
 * `lib/planner → features` 就成了**反向依赖**。故类型落在本文件（lib 层），
 * features 层 import 它 —— 依赖方向正确（features → lib）。
 *
 * 设计纪律：**纯函数** —— 不读时钟、不 fetch、不用随机。
 * `id` 与 `createdAt` 由调用方生成后传入，故本模块完全确定、可单测。
 */
import type { AxisKey, BlockKind, DayOfWeek, PhasePolicy, ScenarioFields } from '@/types';

/* ============================================================
 * 一、数据模型
 * ========================================================== */

/** 干预类型 —— 可枚举，是「语义映射」的落点 */
export type CorrectionKind =
  /** 某天某时段不排（可指定块类型） */
  | 'unavailable_slot'
  /** 某天整体别排 */
  | 'avoid_day'
  /** 目标时长调整（每天 +/- 分钟） */
  | 'target_duration'
  /** 某类块的密度系数（<1 变稀疏） */
  | 'block_density'
  /** 回避某地点 */
  | 'avoid_place'
  /** 不排某类块（可限时段） */
  | 'avoid_kind'
  /** 偏好某时段 */
  | 'prefer_time'
  /** 纯文字备注（不映射任何维度） */
  | 'manual_note';

/**
 * 时段窗 —— 用**分钟数**而非 "HH:mm" 字符串。
 *
 * 理由：引擎内部一律用「自 00:00 起的绝对分钟」（`TimeBlock.startMin` 同口径），
 * 存字符串会在每个消费点都要解析一次，且 "9:00" / "09:00" 两种写法都要防。
 */
export interface TimeWindow {
  startMin: number;
  endMin: number;
  /** 给人看的标签，如「下午」 */
  label?: string;
}

/** 各类干预的载荷（判别联合：`kind` 决定字段形状） */
export type CorrectionPayload =
  | { kind: 'unavailable_slot'; days: DayOfWeek[]; window: TimeWindow; blockKinds?: BlockKind[] }
  | { kind: 'avoid_day'; days: DayOfWeek[] }
  | { kind: 'target_duration'; deltaMinPerDay: number; scope: 'study' | 'all' }
  | { kind: 'block_density'; blockKind: BlockKind; factor: number }
  | { kind: 'avoid_place'; placeId: string }
  | { kind: 'avoid_kind'; blockKind: BlockKind; window?: TimeWindow }
  | { kind: 'prefer_time'; window: TimeWindow; blockKind?: BlockKind }
  | { kind: 'manual_note'; text: string };

/**
 * 一条「偏好校正」—— 可撤销叠加层的最小单元。
 *
 * ⚠️ 本结构**绝不回写** `answers` / `persona`。`mapsTo` 只是**展示分组标签**
 * （「这条归到『排程策略』类」），不表示它改写了对应维度。
 */
export interface CorrectionRule {
  id: string;
  kind: CorrectionKind;
  payload: CorrectionPayload;
  /** 撤销 = false，但**保留记录**（支持「再打开」与审计） */
  active: boolean;
  /** 来源：界面结构化操作 vs 自然语言解析 */
  source: 'ui' | 'text';
  /** 用户原话（透明展示用；解析失败时也必存，保证信号不丢） */
  utterance?: string;
  /** ISO 时间戳，由调用方传入（本模块不读时钟） */
  createdAt: string;
  updatedAt?: string;
  /** **仅供 UI 分组展示**，不参与任何计算 */
  mapsTo: 'axis' | 'scenario' | 'policy' | 'none';
  axisKey?: AxisKey;
  scenarioKey?: keyof ScenarioFields;
}

/* ============================================================
 * 二、生效偏好（画像 + 校正的合成产物）
 * ========================================================== */

/**
 * 生效偏好 —— 画像**原样透传** + 激活规则叠加出的覆盖项。
 *
 * 本期（阶段 B）只给 UI 透明展示用；阶段 C 起由
 * `applyCorrectionsToPolicy` 对接排程引擎。
 */
export interface EffectivePrefs {
  /** 画像原样引用，**不修改** */
  persona: import('@/types').PersonaProfile | null;
  /** 叠加到 `PhasePolicy` 的覆盖项（`dailyStudyMin` 为**增量**，非绝对值） */
  policyOverrides: Partial<PhasePolicy>;
  /** 星期几 → 不可用时段 */
  unavailableByDay: Partial<Record<DayOfWeek, TimeWindow[]>>;
  avoidDays: DayOfWeek[];
  avoidPlaces: string[];
  /** 块类型 → 密度系数 */
  densityByKind: Partial<Record<BlockKind, number>>;
  avoidKindWindows: Array<{ blockKind: BlockKind; window?: TimeWindow }>;
  preferWindows: TimeWindow[];
  /** 备注类（不映射，仅供展示） */
  notes: string[];
}

const DAY_CN: Record<number, string> = {
  1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日',
};

const KIND_CN: Record<BlockKind, string> = {
  course: '课程', meal: '用餐', study: '自习',
  activity: '活动', commute: '通勤', blank: '留白',
};

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 把一串星期几压成「周一、周三」（确定性，按数值升序） */
function daysLabel(days: readonly DayOfWeek[]): string {
  return [...new Set(days)].sort((a, b) => a - b).map((d) => DAY_CN[d] ?? `周${d}`).join('、');
}

/* ============================================================
 * 三、合成（纯函数）
 * ========================================================== */

/**
 * 把激活的校正规则叠加到画像上，得到「生效偏好」。
 *
 * 关键：**只聚合 `active === true` 的规则** —— 撤销的必须完全不影响结果，
 * 这是「可撤销」语义的落点（有单测守着）。
 */
export function composeEffectivePrefs(
  persona: import('@/types').PersonaProfile | null,
  rules: readonly CorrectionRule[],
): EffectivePrefs {
  const eff: EffectivePrefs = {
    persona,
    policyOverrides: {},
    unavailableByDay: {},
    avoidDays: [],
    avoidPlaces: [],
    densityByKind: {},
    avoidKindWindows: [],
    preferWindows: [],
    notes: [],
  };

  for (const r of rules) {
    if (!r.active) continue; // ← 撤销的不参与（可撤销语义）
    const p = r.payload;
    switch (p.kind) {
      case 'unavailable_slot': {
        for (const d of p.days) {
          const list = eff.unavailableByDay[d] ?? (eff.unavailableByDay[d] = []);
          list.push(p.window);
        }
        break;
      }
      case 'avoid_day':
        eff.avoidDays.push(...p.days);
        break;
      case 'target_duration':
        // 多条累加（用户可能先加 30 分、后来又加 30 分）
        eff.policyOverrides.dailyStudyMin =
          (eff.policyOverrides.dailyStudyMin ?? 0) + p.deltaMinPerDay;
        break;
      case 'block_density':
        eff.densityByKind[p.blockKind] = p.factor;
        break;
      case 'avoid_place':
        eff.avoidPlaces.push(p.placeId);
        break;
      case 'avoid_kind':
        eff.avoidKindWindows.push({ blockKind: p.blockKind, window: p.window });
        break;
      case 'prefer_time':
        eff.preferWindows.push(p.window);
        break;
      case 'manual_note':
        eff.notes.push(p.text);
        break;
    }
  }

  // 去重（保序，确定性）
  eff.avoidDays = [...new Set(eff.avoidDays)].sort((a, b) => a - b);
  eff.avoidPlaces = [...new Set(eff.avoidPlaces)];
  return eff;
}

/**
 * 把生效偏好叠加到一份阶段策略上 —— **未来反哺排程的唯一出口**。
 *
 * 语义：`policyOverrides.dailyStudyMin` 是**增量**（+30 / -30），
 * 叠加在 `base.dailyStudyMin` 之上，而非绝对值覆盖。理由：阶段策略本身
 * 已由画像调过（`applyPersona`），校正层应在其之上做「用户的额外要求」，
 * 而不是把它推倒重来。
 */
export function applyCorrectionsToPolicy(base: PhasePolicy, eff: EffectivePrefs): PhasePolicy {
  const out: PhasePolicy = { ...base };
  const delta = eff.policyOverrides.dailyStudyMin;
  if (delta != null) {
    // 下限 0：不能因为用户说「少学点」就把目标变成负数
    out.dailyStudyMin = Math.max(0, Math.round(base.dailyStudyMin + delta));
  }
  return out;
}

/* ============================================================
 * 四、人话生成（供 UI 透明展示）
 * ========================================================== */

/** 一条规则的展示形态 */
export interface LearnedItem {
  id: string;
  /** 人话标题，如「周四下午不排自习」 */
  title: string;
  /** 结构化细节，让用户能看出「引擎理解成什么」 */
  detail: string;
  /** 分组徽标文案 */
  group: string;
  active: boolean;
  source: 'ui' | 'text';
  utterance?: string;
}

const GROUP_CN: Record<CorrectionRule['mapsTo'], string> = {
  axis: '性格倾向',
  scenario: '场景偏好',
  policy: '排程策略',
  none: '备注',
};

/**
 * 把规则翻译成人话 —— **透明性的落点**。
 *
 * 用户必须能一眼看出「引擎理解成了什么」，理解错了才好撤销。
 * 纯函数、确定性，可直接单测。
 */
export function summarizeCorrections(rules: readonly CorrectionRule[]): LearnedItem[] {
  return rules.map((r) => {
    const p = r.payload;
    let title = '一条说明';
    let detail = '';

    switch (p.kind) {
      case 'unavailable_slot': {
        const kinds = p.blockKinds?.length
          ? `不排${p.blockKinds.map((k) => KIND_CN[k] ?? k).join('/')}`
          : '不排任何事';
        title = `${daysLabel(p.days)} ${hhmm(p.window.startMin)}–${hhmm(p.window.endMin)} ${kinds}`;
        detail = `该时段不会安排内容`;
        break;
      }
      case 'avoid_day':
        title = `${daysLabel(p.days)}整天不排`;
        detail = '这几天留空';
        break;
      case 'target_duration': {
        const sign = p.deltaMinPerDay >= 0 ? '+' : '';
        title = `每天自习目标 ${sign}${p.deltaMinPerDay} 分钟`;
        detail = p.scope === 'study' ? '只影响自习' : '影响全部安排';
        break;
      }
      case 'block_density':
        title = `${KIND_CN[p.blockKind] ?? p.blockKind}密度 ×${p.factor}`;
        detail = p.factor < 1 ? '排得更稀疏' : p.factor > 1 ? '排得更密集' : '保持原样';
        break;
      case 'avoid_place':
        title = `不排「${p.placeId}」`;
        detail = '该地点不再作为落点';
        break;
      case 'avoid_kind': {
        const w = p.window ? `（${hhmm(p.window.startMin)}–${hhmm(p.window.endMin)}）` : '';
        title = `不排${KIND_CN[p.blockKind] ?? p.blockKind}${w}`;
        detail = '这类内容会被跳过';
        break;
      }
      case 'prefer_time':
        title = `偏好 ${hhmm(p.window.startMin)}–${hhmm(p.window.endMin)}`;
        detail = p.blockKind ? `倾向安排${KIND_CN[p.blockKind] ?? p.blockKind}` : '倾向安排在这个时段';
        break;
      case 'manual_note':
        title = p.text || '（空备注）';
        detail = '仅记录，不影响排程';
        break;
    }

    return {
      id: r.id,
      title,
      detail,
      group: GROUP_CN[r.mapsTo] ?? '其它',
      active: r.active,
      source: r.source,
      utterance: r.utterance,
    };
  });
}

/** 统计：生效中 / 已撤销（供面板头部显示） */
export function countCorrections(rules: readonly CorrectionRule[]): { active: number; revoked: number } {
  let active = 0;
  for (const r of rules) if (r.active) active += 1;
  return { active, revoked: rules.length - active };
}
