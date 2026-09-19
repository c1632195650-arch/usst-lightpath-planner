/**
 * 偏好校正层 · 语义映射（自然语言 → 结构化规则）
 * ============================================================
 * 把用户一句话（「周四下午别排东西」）解析成 `CorrectionDraft`，
 * 由 UI 回显「我理解成：周四 13:00–18:00 不排任何事」，用户确认后才落库。
 *
 * ── 三条设计取舍 ──────────────────────────────────────────────
 * 1. **纯函数、确定性、零依赖**：不调 LLM、不 fetch、不读时钟、不用随机。
 *    因此可以在零依赖的 `node --test` 里完整覆盖。
 * 2. **解析不出来返回 `null`，绝不瞎猜**（延续项目「不猜」纪律）：
 *    UI 会退回结构化表单让用户手选；同时**原话仍会被保存**进 `utterance`，
 *    所以即使解析失败，信号也不会丢。
 * 3. **它是「预填助手」而不是主路径**：中文表达无穷，正则必然覆盖不全。
 *    结构化表单才是保底入口，本模块只负责「让常见说法少点几下」。
 */
import type { AxisKey, BlockKind, DayOfWeek, ScenarioFields } from '@/types';
import type { CorrectionKind, CorrectionPayload, CorrectionRule } from '@/lib/planner/corrections';
import { toMinutes } from '@/constants/time';

/**
 * 「长期」的**唯一判定入口**（R3.5 / 计划书 §1.5-1）
 * ============================================================
 * 🔴 硬性：全仓只有这一处判断「这句话是不是长期」。
 *    S1（长期锁）与 R3（语言输入）都调它 —— 各写一份会出现
 *    「说『每周』被记成长期锁、说『以后都』被记成校正规则」的分裂，
 *    界面上出现两条自相矛盾的记录。这不是复杂度问题，是同一概念只有一个出处的纪律。
 *
 * @returns
 *   · `'long'` 命中「每周 / 以后都 / 长期 / 一直 / 每天 / 以后」等明确信号
 *   · `'once'` 命中「这次 / 这周 / 今天 / 下周」等一次性信号；
 *              **或**没提长期但已经说清了是哪一天（「周四下午别排」= 这一周的周四）
 *   · `'ask'`  连哪一天都没说（「下午有实验」）—— 这种既缺时间也缺范围，
 *              问一次比连着弹两个框好；调用方拿到它就**必须问**（不猜）
 */
const LONG_WORDS: readonly string[] = [
  '每周', '每星期', '以后都', '长期', '一直', '每天', '今后', '从今以后', '往后', '以后别', '常态',
];
const ONCE_WORDS: readonly string[] = [
  '这次', '这周', '本周', '今天', '明天', '下周', '只这一次', '仅此一次', '临时',
];

export function detectScope(text: string): 'once' | 'long' | 'ask' {
  const t = (text ?? '').trim();
  if (!t) return 'ask';
  const hasLong = LONG_WORDS.some((w) => t.includes(w));
  const hasOnce = ONCE_WORDS.some((w) => t.includes(w));
  // 两种信号同时出现（「这周开始每周都…」）→ 长期更可能是用户的本意，但拿不准就该问
  if (hasLong && hasOnce) return 'ask';
  if (hasLong) return 'long';
  if (hasOnce) return 'once';

  /**
   * 没明说长期，但**说清了是哪一天** → 按一次性处理（T-R3-8：「周四下午别排」= 一次性）。
   * 理由：周计划里的临时说法绝大多数指的就是接下来这一周；
   * 为它再弹一次框属于打扰，而猜成长期是**不可逆的错**（会污染之后每一周）。
   * 反过来，连哪天都没说（「下午有实验」）就必须问 —— 那既缺时间也缺范围。
   */
  const dayKnown = matchDays(t).length > 0 || /(今天|明天|后天|当天|周末)/.test(t);
  return dayKnown ? 'once' : 'ask';
}

/** 给 UI 用的一句话解释（解释为什么得到这个判定） */
export function scopeReason(scope: 'once' | 'long' | 'ask'): string {
  if (scope === 'long') return '听出来你说的是长期安排（每周 / 以后都）';
  if (scope === 'once') return '听出来你说的是这一次（这周 / 今天）';
  return '没听出是不是长期的 —— 你自己选一下，不替你猜';
}

/** 解析结果草稿（与 `CorrectionRule` 的区别：还没有 id / active / createdAt） */
export interface CorrectionDraft {
  kind: CorrectionKind;
  payload: CorrectionPayload;
  mapsTo: CorrectionRule['mapsTo'];
  axisKey?: AxisKey;
  scenarioKey?: keyof ScenarioFields;
}

/* ---------- 词表 ---------- */

/**
 * 中文星期 → DayOfWeek（1 = 周一）。
 * ⚠️ 顺序有讲究：`周一` 必须排在 `一` 前面，否则「周一」会被先命中「一」。
 *    这里用「长串优先」的排序保证正确性（见 `matchDays`）。
 */
const DAY_WORDS: Array<[string, DayOfWeek]> = [
  ['周一', 1], ['星期一', 1], ['礼拜一', 1],
  ['周二', 2], ['星期二', 2], ['礼拜二', 2],
  ['周三', 3], ['星期三', 3], ['礼拜三', 3],
  ['周四', 4], ['星期四', 4], ['礼拜四', 4],
  ['周五', 5], ['星期五', 5], ['礼拜五', 5],
  ['周六', 6], ['星期六', 6], ['礼拜六', 6],
  ['周日', 7], ['周天', 7], ['星期日', 7], ['星期天', 7], ['礼拜日', 7], ['礼拜天', 7],
];

/** 日期词的简写：只有当句中**没有**「周X」时才启用，避免「周三」被拆成「三」 */
const DAY_CHARS: Array<[string, DayOfWeek]> = [
  ['一', 1], ['二', 2], ['三', 3], ['四', 4], ['五', 5], ['六', 6], ['日', 7], ['天', 7],
];

/** 时段词 → 分钟区间（长词优先，避免「上午」被「上」抢先） */
const HALF_WORDS: Array<[string, [number, number], string]> = [
  ['早上', [toMinutes('06:00'), toMinutes('09:00')], '早上'],
  ['早晨', [toMinutes('06:00'), toMinutes('09:00')], '早上'],
  ['早八', [toMinutes('06:00'), toMinutes('09:00')], '早上'],
  ['清晨', [toMinutes('06:00'), toMinutes('09:00')], '早上'],
  ['上午', [toMinutes('08:00'), toMinutes('12:00')], '上午'],
  ['中午', [toMinutes('11:00'), toMinutes('13:00')], '中午'],
  ['午间', [toMinutes('11:00'), toMinutes('13:00')], '中午'],
  ['下午', [toMinutes('13:00'), toMinutes('18:00')], '下午'],
  ['傍晚', [toMinutes('17:00'), toMinutes('19:00')], '傍晚'],
  ['晚上', [toMinutes('18:00'), toMinutes('23:00')], '晚上'],
  ['夜里', [toMinutes('18:00'), toMinutes('23:00')], '晚上'],
  ['晚间', [toMinutes('18:00'), toMinutes('23:00')], '晚上'],
];

/** 块类型词 */
const KIND_WORDS: Array<[string, BlockKind]> = [
  ['自习', 'study'], ['学习', 'study'], ['看书', 'study'],
  ['课', 'course'], ['上课', 'course'],
  ['运动', 'activity'], ['锻炼', 'activity'], ['跑步', 'activity'], ['健身', 'activity'],
  ['吃饭', 'meal'], ['用餐', 'meal'], ['午饭', 'meal'], ['晚饭', 'meal'],
];

/** 地点词 → Place 语义 key（与 `SCENARIO_META.study_place` 的取值对齐） */
const PLACE_WORDS: Array<[string, string]> = [
  ['图书馆', 'library'], ['宿舍', 'dorm'], ['空教室', 'classroom'], ['咖啡馆', 'cafe'],
];

/** 否定词 —— 命中才认为用户是在「提要求」而不是普通陈述 */
const NEGATION = /(别|不要|不用|不想|不去|不排|别再|起不来|受不了)/;

/* ---------- 匹配工具 ---------- */

/**
 * 找出句中出现的所有星期。
 *
 * 算法：**先抽长词并从剩余文本里删掉，再在剩余部分找单字简写**。
 * 为什么要这样两段式：
 *   · 直接找单字会把「周三」拆成「三」；
 *   · 只找长词又漏掉「周一三五」里的「三五」（口语里常见）。
 * 单字简写**仅在句中出现了「周/星期/礼拜」时才启用** ——
 * 否则「第三教学楼别排自习」的「三」会被误判成周三。
 */
/** 导出供 `planIntent.ts` 复用（「加一件事」同样要认出星期） */
export function matchDays(t: string): DayOfWeek[] {
  const out: DayOfWeek[] = [];
  let rest = t;
  for (const [w, d] of DAY_WORDS) {
    while (rest.includes(w)) {
      out.push(d);
      rest = rest.replace(w, '');
    }
  }
  if (/周|星期|礼拜/.test(t)) {
    for (const [w, d] of DAY_CHARS) {
      if (rest.includes(w)) out.push(d);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** 找出句中出现的第一种时段（长词优先，词表已按此排序）。导出供 `planIntent.ts` 复用。 */
export function matchWindow(t: string): { win: [number, number]; label: string } | null {
  for (const [w, win, label] of HALF_WORDS) {
    if (t.includes(w)) return { win, label };
  }
  return null;
}

/** 找出第一种块类型 */
function matchKind(t: string): BlockKind | undefined {
  for (const [w, k] of KIND_WORDS) if (t.includes(w)) return k;
  return undefined;
}

/* ---------- 主入口 ---------- */

/**
 * 解析一句自然语言要求。
 *
 * @returns 解析成功返回草稿；解析不出返回 `null`（调用方退回结构化表单）
 */
export function parseCorrection(text: string): CorrectionDraft | null {
  const t = (text ?? '').trim();
  if (!t) return null;

  const days = matchDays(t);
  const win = matchWindow(t);
  const kind = matchKind(t);
  const negated = NEGATION.test(t);

  /* ── 规则 1：目标时长调整（「我想每天多学 1 小时」）──
     必须放在否定规则之前：句中有「不想」时也不该被当成禁排。 */
  const durM = t.match(/(多|少)\s*学?\s*(\d+)\s*(个)?\s*(小时|钟头|分钟|分|h|min)/i);
  if (durM) {
    const dir = durM[1] === '多' ? 1 : -1;
    const n = Number(durM[2]);
    const unit = durM[4];
    const base = unit === '小时' || unit === '钟头' || unit.toLowerCase() === 'h' ? 60 : 1;
    const delta = dir * n * base;
    if (delta !== 0) {
      return {
        kind: 'target_duration',
        payload: { kind: 'target_duration', deltaMinPerDay: delta, scope: 'study' },
        mapsTo: 'policy',
      };
    }
  }

  /* ── 规则 2：密度调整（「自习别排太密」「别排太满」）── */
  if (/(太密|太满|太挤|排太密|排太满|稀疏点|少排点)/.test(t)) {
    return {
      kind: 'block_density',
      payload: { kind: 'block_density', blockKind: kind ?? 'study', factor: 0.7 },
      mapsTo: 'policy',
    };
  }

  /* ── 规则 3：地点回避（「图书馆别排了」）── */
  if (negated) {
    for (const [w, pid] of PLACE_WORDS) {
      if (t.includes(w)) {
        return {
          kind: 'avoid_place',
          payload: { kind: 'avoid_place', placeId: pid },
          // 语义上它"反向修正"自习偏好场景 —— 但注意：这只是**展示分组**，
          // 实际是覆盖层，不会改写 `scenarios.study_place`
          mapsTo: 'scenario',
          scenarioKey: 'study_place',
        };
      }
    }
  }

  /* ── 规则 4：时段 + 块类型禁排（「周四下午别排自习」）── */
  if (negated && days.length > 0 && win) {
    if (kind) {
      return {
        kind: 'avoid_kind',
        payload: {
          kind: 'avoid_kind', blockKind: kind,
          window: { startMin: win.win[0], endMin: win.win[1], label: win.label },
        },
        mapsTo: 'policy',
      };
    }
    return {
      kind: 'unavailable_slot',
      payload: {
        kind: 'unavailable_slot', days,
        window: { startMin: win.win[0], endMin: win.win[1], label: win.label },
      },
      mapsTo: 'policy',
    };
  }

  /* ── 规则 5：整天禁排（「周日别排」）── */
  if (negated && days.length > 0 && !win) {
    return {
      kind: 'avoid_day',
      payload: { kind: 'avoid_day', days },
      mapsTo: 'policy',
    };
  }

  /* ── 规则 6：不带星期的时段禁排（「下午别排东西」→ 每天都适用）──
     用「全周」表示：用户没说哪天，就是每天。 */
  if (negated && !days.length && win) {
    const allDays: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7];
    if (kind) {
      return {
        kind: 'avoid_kind',
        payload: {
          kind: 'avoid_kind', blockKind: kind,
          window: { startMin: win.win[0], endMin: win.win[1], label: win.label },
        },
        mapsTo: 'policy',
      };
    }
    return {
      kind: 'unavailable_slot',
      payload: {
        kind: 'unavailable_slot', days: allDays,
        window: { startMin: win.win[0], endMin: win.win[1], label: win.label },
      },
      mapsTo: 'policy',
    };
  }

  /* ── 规则 7：只提了块类型、没说星期也没说时段（「别排自习」）──
     语义是「这类东西整体少来点」→ 全周不限时段地避开。 */
  if (negated && kind && !days.length && !win) {
    return {
      kind: 'avoid_kind',
      payload: { kind: 'avoid_kind', blockKind: kind },
      mapsTo: 'policy',
    };
  }

  /* 解析不出 → null（调用方退回表单；原话仍会被保存） */
  return null;
}

/**
 * 纯文字备注的兜底构造 —— 当 `parseCorrection` 返回 null，
 * 且用户仍想留下这句话时用。**信号不丢**优先于「结构漂亮」。
 */
export function asNoteDraft(text: string): CorrectionDraft {
  return {
    kind: 'manual_note',
    payload: { kind: 'manual_note', text: (text ?? '').trim() },
    mapsTo: 'none',
  };
}

/** 解析失败时提示用户「可以怎么说」—— 提高下一句的成功率 */
export const PARSE_HINTS: readonly string[] = [
  '周四下午别排东西',
  '周日别排',
  '我想每天多学 1 小时',
  '自习别排太密',
  '图书馆别排了',
  '早八我起不来',
];
