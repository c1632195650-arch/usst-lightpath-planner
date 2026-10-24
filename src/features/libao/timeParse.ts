/**
 * 梨宝 · 时间表达式解析（从 libaoIntent.ts 拆出的纯解析域，D1-批1）
 * ============================================================
 * 来历（2026-10-24，重构偿债 r2-d1a-libao-time-split）：
 *   libaoIntent.ts 曾是 2100+ 行的单文件，五批次（S/T/D/H/交互升级）把
 *   「听懂时间」的全部正则与换算叠在一起。本文件把**时间表达式解析族**
 *   逐字节搬运过来 —— 行为不变，只是文件组织变化：
 *     · 听（extract*：从一句话里抽出 时间/时长/频率/地点/时段/钟点/目标定位）
 *     · 换算（resolveWhen / termAnchorsFrom：时间表达 → ISO 区间，纯函数不读时钟）
 *   libaoIntent.ts 保留意图/槽位/追问域，并从这里 re-export 全部公开符号，
 *   所有既有 import 面（LbaoChat / weekPlanForChat / 测试）零变化。
 *
 * 纪律（继承 libaoIntent 四条，此处相关的两条）：
 *   · 抽不到就说抽不到，绝不编 —— 换算不了的锚点原样上抛，不造日期；
 *   · 函数逐字节来自 libaoIntent（含注释），**不顺手优化** —— 行为漂移零容忍，
 *     存量断言（scripts/libao-intent-*.test.ts 全套）是回归安全网。
 *
 * 共享符号说明：cnToInt / cnAmount / WD_NUM / extractConcreteWhile… 中的
 *   cnToInt / cnAmount / WD_NUM / extractConcreteWhen 同时被 libaoIntent
 *   的快筛（looksLikeAction）使用，故在本文件 export，由 libaoIntent 回引。
 */

/** 时间的确定程度 —— 决定后面走哪条出口。
 *   exact   明确到日（「10月8日」）
 *   window  只有区间（「九月中旬」）→ 照排，但必须标注是窗口
 *   unknown 用户明说没定（「具体时间也没定」）→ 按锚点排默认窗口，并**如实标注待定**
 */
export type TimeCertainty = 'exact' | 'window' | 'unknown';

/** 时间表达的结构化形状。**只描述听到什么，不做日期换算** —— 换算在 `resolveWhen`。 */
export interface WhenHint {
  /** 原话片段，用于回显核对 */
  text: string;
  kind: 'exact' | 'window' | 'relative' | 'vague';
  /** 月份 1–12 */
  month?: number;
  /** 日 1–31 */
  day?: number;
  /** 上旬 / 中旬 / 下旬 */
  decade?: 'early' | 'middle' | 'late';
  /** 相对天数偏移：明天 = 1、后天 = 2 */
  relativeDays?: number;
  /** 相对周偏移：下周 = 1、这周 = 0 */
  relativeWeeks?: number;
  /** 相对月锚（批 1.3）：本月 = 0、下月 = 1、下下月 = 2；与 decade（旬）正交 ——「下月底」 */
  relativeMonths?: number;
  /** 星期几（1=周一…7=周日），配合 `relativeWeeks` 表示「下周三」 */
  weekday?: number;
  /** 学期周次（批 1.2）：「第10周」= 10；配合 weekday 表示「第10周周五」。换算需 termStart。 */
  weekNo?: number;
  /** 用户明说「时间没定」。与「没提到时间」是两回事 —— 前者要标注，后者要追问。 */
  unspecified?: boolean;
  /** 「每周三」这类循环约定 —— 不是某一天，不享受单日事件的投入豁免（hasEffort）。 */
  recurring?: boolean;
}

/** 时段窗（「只在晚上」）。分钟口径，与引擎一致。 */
export interface TimeWindow {
  fromMin: number;
  toMin: number;
  /** 原话（「晚上」），用于回显 */
  text: string;
}

/**
 * 钟点起止（交互升级方案批次 1 · 4.1）：「晚上6点到8点」→ 1080/1200。
 *
 * 与 `TimeWindow`（时段窗，粗粒度）互补：clock 是用户**点名**的时刻。
 * 单端点形态（「打到8点」）只填一端；`ambig` = 有钟点原子没带时段语境
 * （「6点」）→ 按上午口径落，界面必须如实说明，不许装作听懂了。
 */
export interface ClockHint {
  startMin?: number;
  endMin?: number;
  /** 原话片段（容词「大概/左右」剥除后的干净形态），用于回显 */
  text: string;
  /** 24 小时歧义：某端点没带「上午/下午/晚上」语境 */
  ambig?: boolean;
  /** 与时段窗矛盾（钟点在窗外）→ 记录被让位的 window 原话，草稿卡如实说明「按钟点排」 */
  conflicted?: string;
}

/** 时段词 → 分钟窗。与作息口径一致（早 7 点起、夜 23 点止）。 */
const PERIOD_WORDS: Array<{ re: RegExp; fromMin: number; toMin: number; text: string }> = [
  { re: /(早上|早晨|一早)/, fromMin: 7 * 60, toMin: 12 * 60, text: '早上' },
  { re: /(上午)/, fromMin: 8 * 60, toMin: 12 * 60, text: '上午' },
  { re: /(中午)/, fromMin: 11 * 60, toMin: 13 * 60 + 30, text: '中午' },
  { re: /(下午)/, fromMin: 13 * 60, toMin: 18 * 60, text: '下午' },
  { re: /(晚上|晚间|夜里|夜晚)/, fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' },
  { re: /(白天)/, fromMin: 8 * 60, toMin: 18 * 60, text: '白天' },
];

/** 中文数字 → 整数（覆盖 一~十二，够用于月份/次数） */
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  十一: 11, 十二: 12,
};

/** 星期字 → 数字 */
export const WD_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

export function cnToInt(s: string): number | undefined {
  const t = (s || '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (CN_NUM[t] != null) return CN_NUM[t];
  const m = /^(十?)([一二三四五六七八九]?)(十?)$/.exec(t);
  if (m && (m[1] || m[3])) {
    const v = (m[1] ? 10 : 0) + (m[2] ? (CN_NUM[m[2]] ?? 0) : 0) + (m[3] ? 10 : 0);
    return v > 0 ? v : undefined;
  }
  return undefined;
}

/**
 * 中文 / 阿拉伯数字 → 数值，覆盖 一~九十九（时长、总量的口语表达）。
 *
 * 为什么不复用 `cnToInt`：后者只服务月份与次数（一~十二），进位逻辑把
 * 「二十」解成 **12**（0 + 2 + 10），而时长里「二十小时」「三十分钟」都是
 * 正常说法 —— 拿它算会安静地算错，比抽不到更危险。两个函数服务两种量纲，
 * 刻意分开：改这里不会动摇既有月份/次数的解析。
 *
 * ⚠️ 放宽数字形态的动机（2026-09-22 真机抓到）：原实现只认阿拉伯数字，
 *    于是「这周我要准备英语六级，**每天两小时**」的时长被整段丢掉 ——
 *    梨宝反过来追问「打算投入多少？」，而用户明明已经说了。
 *    真实用户说「两小时」远多于「2 小时」；测试用例却全用阿拉伯数字，
 *    所以 67 条全绿也没兜住（见 scripts/libaoIntent.test.ts 新增用例）。
 */
export function cnAmount(s: string): number | undefined {
  const t = (s || '').trim();
  if (!t) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  const m = /^([一二两三四五六七八九]?)(十?)([一二三四五六七八九]?)$/.exec(t);
  if (!m) return undefined;
  const [, a, shi, b] = m;
  if (shi) {
    // 「十」= 10、「十五」= 15、「二十」= 20、「九十九」= 99
    const tens = a ? (CN_NUM[a] ?? 0) : 1;
    return tens * 10 + (b ? (CN_NUM[b] ?? 0) : 0);
  }
  return a && !b ? CN_NUM[a] : undefined;
}

/** 「时间没定」的判据（含各种口语说法）。 */
const VAGUE_WHEN = /(?:具体)?(?:时间|日期)[^，。！？,.]{0,4}?(?:没|未)(?:有)?(?:定|确定)|未定|待定|没定|不确定/;

/**
 * 抽一个**具体**的时间表达（不含「没定」判定）。
 * 优先级：月+日 > 月+旬 > 只有月 > 相对日 > 相对周 > 星期 > 学期词。
 */
export function extractConcreteWhen(s: string): WhenHint | undefined {
  // 月 + 日
  const md = /(\d{1,2}|[一二三四五六七八九十]{1,3})月(\d{1,2}|[一二三四五六七八九十]{1,3})[日号]/.exec(s);
  if (md) {
    const month = /^\d+$/.test(md[1]) ? Number(md[1]) : cnToInt(md[1]);
    const day = /^\d+$/.test(md[2]) ? Number(md[2]) : cnToInt(md[2]);
    if (month && day) return { text: md[0], kind: 'exact', month, day };
  }

  // 月 + 旬
  const dec = /([一二三四五六七八九十\d]{1,2})月([上中下]旬)/.exec(s);
  if (dec) {
    const month = cnToInt(dec[1]);
    const decade = dec[2] === '上旬' ? 'early' : dec[2] === '中旬' ? 'middle' : 'late';
    if (month) return { text: dec[0], kind: 'window', month, decade };
  }

  // 相对月锚（批 1.3）：「下月底 / 月初 / 月中 / 下下个月初」。必须在「只有月」
  // 之前拦；负向环视挡住「12月底」这类数字月份（那是明确月份不是相对锚）。
  // 「周末」没有「月」字，不受影响。
  const relMonth = /(?<![一二三四五六七八九十\d年])(下下|下|这|本)?个?月(上旬|中旬|下旬|底|末|初|中)/.exec(s);
  if (relMonth) {
    const rm = relMonth[1] === '下下' ? 2 : relMonth[1] === '下' ? 1 : 0;
    const decade = relMonth[2] === '上旬' || relMonth[2] === '初' ? 'early'
      : relMonth[2] === '中旬' || relMonth[2] === '中' ? 'middle'
      : 'late';
    return { text: relMonth[0], kind: 'window', relativeMonths: rm, decade };
  }

  // 只有月
  const mo = /([一二三四五六七八九十\d]{1,2})月/.exec(s);
  if (mo) {
    const month = cnToInt(mo[1]);
    if (month) return { text: mo[0], kind: 'window', month };
  }

  // 相对日
  const relDay = /(今天|明天|后天|大后天)/.exec(s);
  if (relDay) {
    const off = relDay[1] === '今天' ? 0 : relDay[1] === '明天' ? 1 : relDay[1] === '后天' ? 2 : 3;
    return { text: relDay[1], kind: 'relative', relativeDays: off };
  }

  // 第 N 周（可带周X）—— 教务口径的学期周次（批 1.2）。必须在裸「周X」之前拦：
  // 否则「第10周周五」会被当成最近的周五（探针实录：→ 错 4 周）。
  const wk = /第\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*周(?:\s*(周[一二三四五六日天]|星期[一二三四五六日天]))?/.exec(s);
  if (wk) {
    const n = /^\d+$/.test(wk[1]) ? Number(wk[1]) : cnToInt(wk[1]);
    if (n != null && n >= 1 && n <= 30) {
      const wdIn = wk[2] ? WD_NUM[wk[2].slice(1)] : undefined;
      return {
        text: wk[0],
        kind: wdIn != null ? 'exact' : 'window',
        weekNo: n,
        ...(wdIn != null ? { weekday: wdIn } : {}),
      };
    }
  }

  // 相对周 + 星期
  const relWeek = /(下周|下星期|这周|本周|这星期|本星期)/.exec(s);
  const wd = /(周[一二三四五六日天]|星期[一二三四五六日天])/.exec(s);
  const wdNum = wd ? WD_NUM[wd[1].slice(1)] : undefined;
  // 「每周三」= 循环约定，不是「这周三」—— 必须在相对周判定**之前**拦下，
  // 否则单日豁免（hasEffort）会把「每周三复习 2 小时」错当成只排一块。
  if (wd && wdNum != null && wd.index > 0 && s[wd.index - 1] === '每') {
    return { text: '每' + wd[0], kind: 'window', recurring: true, weekday: wdNum };
  }
  if (relWeek) {
    const isNext = relWeek[1].startsWith('下');
    // 别拼出「下周周一」这种碎片（批 1.1，金标 i29 when_text 对齐）。
    let text = relWeek[0];
    if (wd) {
      const wStart = wd.index ?? 0;
      const wEnd = wStart + wd[0].length;
      const rEnd = relWeek.index + relWeek[0].length;
      if (wStart <= rEnd && wEnd >= rEnd - 1) text = s.slice(relWeek.index, wEnd);
      else text = relWeek[0] + wd[0];
    }
    return {
      text,
      kind: 'relative',
      relativeWeeks: isNext ? 1 : 0,
      weekday: wdNum,
    };
  }
  if (wd && wdNum != null) return { text: wd[0], kind: 'relative', relativeWeeks: 0, weekday: wdNum };
  if (/周末/.test(s)) return { text: '周末', kind: 'relative', relativeWeeks: 0, weekday: 6 };

  // 学期词 —— 有校历锚点时由 resolveWhen 落地；本层记**完整原话**（含「之前/前」，
  // 批 1.4：语义在 resolveWhen 分流）。「期中」裸词补入（原先只认「期中考试」）。
  const term = /(期末考试周?|期末周?|期中考试周?|期中|开学|学期末|结课|考试周|寒假|暑假|毕业前)(之前|以前|前)?/.exec(s);
  if (term) return { text: term[0], kind: 'window' };

  return undefined;
}

/**
 * 抽时间表达。
 *
 * ⚠️ **纪律③ 的落点**：这里刻意让「有锚点」与「说了没定」**共存**，
 * 而不是像第一版那样互相覆盖。用户说「大概是九月中旬开始，具体时间也没定」时，
 * 丢掉「九月中旬」等于丢掉唯一可用的排程依据；而把 `unspecified` 抹掉，
 * 又会让我们理直气壮地按一个假日期排。两者都要留下。
 *
 * @returns `undefined` = 用户**完全没提**时间（该追问，不是「没定」）
 */
export function extractWhen(q: string): WhenHint | undefined {
  const s = q || '';
  const unspecified = VAGUE_WHEN.test(s);
  const concrete = extractConcreteWhen(s);

  if (concrete) {
    if (unspecified) concrete.unspecified = true;
    return concrete;
  }
  if (unspecified) return { text: '时间待定', kind: 'vague', unspecified: true };
  return undefined;
}

/**
 * 抽投入量。总小时与单次时长**分开** —— 前者是「备赛总量」，
 * 后者是「单个块多长」，混在一起会把 20 小时的备赛排成一个 20 小时的块。
 *
 * 2026-10-02 语义修正（强化计划 B）：此前**裸**时长（前面没有「每」）一律归总量，
 * 于是「周四晚上出去玩一小时」被解析成「总投入 1 小时」→ 块长回退默认 90 分钟，
 * 草稿卡显示与实际自相矛盾。修正后的口径：
 *   · 带「每」（每次/每天/每小时…）→ 单次时长 `durationMin`（不变）；
 *   · 带总量词（一共/总共/要花/投入…）→ 备赛总量 `totalHours`（备赛语义不丢）；
 *   · **裸** N 小时/分钟（两者都没有）→ 单次时长 `durationMin` —— 口语里孤立给出
 *     的时长几乎总是「这一件事多长」，不是「备赛总预算」。
 */
export function extractEffort(q: string): { totalHours?: number; durationMin?: number } {
  const s = q || '';
  const out: { totalHours?: number; durationMin?: number } = {};
  const PER = /每(?:次|回|天|日)/;
  // 总量口径词（出现在数字前 6 字内才算）——「一共 20 小时」是总量，「玩一小时」不是。
  const TOTAL_PRE = /一共|总共|总计|累计|合计|要花|要投入|投入|花费|花/;
  // 数字一律「阿拉伯 **或** 中文」：真实口语是「每天两小时 / 半小时 / 一共二十小时」，
  // 只认阿拉伯数字会让用户的投入量整段白说（2026-09-22 真机抓到）。
  const NUM = '([0-9]+(?:\\.[0-9]+)?|[一二两三四五六七八九十]+)';

  const perMin = new RegExp(`每(?:次|回|天|日)?\\s*${NUM}\\s*分钟`).exec(s);
  if (perMin) {
    const v = cnAmount(perMin[1]);
    if (v != null) out.durationMin = Math.round(v);
  }

  const perHour = new RegExp(`每(?:次|回|天|日)?\\s*${NUM}\\s*(?:个)?\\s*(?:小时|h|H)`, 'i').exec(s);
  if (perHour) {
    const v = cnAmount(perHour[1]);
    if (v != null) out.durationMin = Math.round(v * 60);
  }

  // 「半小时」：口语高频，但「半」不在数字类正则里，单列一条。
  // 只在没算出单次时长时才兜 —— 「每次一小时，路上半小时」不该把 60 改成 30。
  if (out.durationMin == null && /半\s*(?:个)?\s*小时/.test(s)) out.durationMin = 30;

  // 裸「N 小时」：按前文口径词分流总量/单次；「每天两小时」这类已被 ① 覆盖的
  // （PER 命中前文）不重复计。
  const bareHour = new RegExp(`${NUM}\\s*(?:个)?\\s*(?:小时|h|H)`, 'i').exec(s);
  if (bareHour) {
    const idx = bareHour.index ?? 0;
    const before = s.slice(Math.max(0, idx - 6), idx);
    const v = cnAmount(bareHour[1]);
    if (v != null && !PER.test(before)) {
      if (TOTAL_PRE.test(before)) {
        out.totalHours = v;
      } else if (out.durationMin == null) {
        out.durationMin = Math.round(v * 60);
      }
    }
  }

  // 裸「N 分钟」：分钟量级天然是单次口径（「一共 600 分钟」不是真实口语），
  // 有总量词也归单次 —— 90 分钟的「总量」经 goalToTasks 的 nBlocks=1 本来就落成一块。
  const bareMin = new RegExp(`${NUM}\\s*分钟`).exec(s);
  if (bareMin && out.durationMin == null) {
    const idx = bareMin.index ?? 0;
    const before = s.slice(Math.max(0, idx - 6), idx);
    const v = cnAmount(bareMin[1]);
    if (v != null && !PER.test(before)) out.durationMin = Math.round(v);
  }

  return out;
}

/** 抽频率（每周几次）。「每周」但没给次数 → `undefined`，由上层追问。 */
export function extractFrequency(q: string): number | undefined {
  const s = q || '';
  // 批次 1 互斥（方案 4.3）：「每天两小时」是**时长节奏**不是频率承诺 ——
  // 「每天」后面**紧跟**时长单位（可隔一个数字/「个」）→ 不算频率，否则草稿
  // 会幻觉出「频率：每周 7 次」。注意必须**紧邻**：「每天晚上背半小时」隔着
  // 「晚上背」→ 不拦（金标 i14「每天晚上…=7」口径）。
  if (/(每天|每日|天天)\s*(?:[0-9.]+|[一二两三四五六七八九十]+)?\s*(?:个)?\s*(?:小时|分钟|h(?![a-zA-Z0-9]))/.test(s)) return undefined;
  if (/每天|每日|天天/.test(s)) return 7;
  if (/(隔天|每两天|每2天)/.test(s)) return 4; // 近似：一周约 3–4 次，取 4
  const m = /每(?:周|星期|礼拜)\s*([一二三四五六七八九十\d]{1,3})\s*次/.exec(s);
  if (m) return cnToInt(m[1]);
  return undefined;
}

/** 抽地点。只认「在/去/到 + X楼/馆/厅/室/中心/食堂」这种可判定的形态。 */
export function extractPlace(q: string): string | undefined {
  const s = q || '';
  // 「在」优先（批 1.1，金标 i15）：「两点到四点在图书馆自习」里「到」是时间
  // 连词，先试「在 X」再退「去/到/往」，避免吃进「四点在图书馆」这种碎片。
  const m = /在\s*([\u4e00-\u9fff]{1,14}?(?:楼|馆|厅|室|中心|食堂|苑|广场|场|舍|房))/.exec(s);
  if (m) return m[1];
  const m2 = /(?:去|到|往|前往)\s*([\u4e00-\u9fff]{1,14}?(?:楼|馆|厅|室|中心|食堂|苑|广场|场|舍|房))/.exec(s);
  return m2 ? m2[1] : undefined;
}

/** 抽时段窗（「只在晚上」）。 */
export function extractWindow(q: string): TimeWindow | undefined {
  const s = q || '';
  for (const w of PERIOD_WORDS) {
    if (w.re.test(s)) return { fromMin: w.fromMin, toMin: w.toMin, text: w.text };
  }
  const m = /(\d{1,2}):(\d{2})\s*(?:之后|以后|开始)/.exec(s);
  if (m) {
    return { fromMin: Number(m[1]) * 60 + Number(m[2]), toMin: 23 * 60, text: m[0] };
  }
  return undefined;
}

/* ============================================================
 * 批次 1（交互升级方案 4.1-4.2）· 钟点时刻通道
 * ============================================================
 * 真机问题：「周六晚上大概6点左右；大概打到8点」→ 仍重问「大概占多久？」
 * —— WhenHint 只有日粒度，唯一认识钟点的 spanDurationMin 只折时长不产起止。
 *
 * **加法通道**：句中没有钟点词 → 本函数返回 undefined → clock 不产出 →
 * 后续所有代码路径与引入前逐位一致（方案 §〇.2 原则 1）。
 */

/** 批次 1 逃生门：`LIBAO_CLOCK=0`/`'false'` → 钟点通道整体关闭（回批次 0 行为）。
 *  读法沿用 G 批三开关惯例：Node 读 `process.env`，Vite 读 `import.meta.env.VITE_*`；
 *  每次调用都读（不在 import 期定死），测试可在用例内翻开关再复原。 */
export function clockChannelOn(): boolean {
  const off = (v: string | undefined) => v === '0' || v === 'false';
  let v: string | undefined;
  try {
    v = typeof process !== 'undefined'
      ? (process as unknown as { env?: Record<string, string | undefined> }).env?.LIBAO_CLOCK
      : undefined;
  } catch {
    v = undefined;
  }
  if (v == null) {
    try {
      v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_LIBAO_CLOCK;
    } catch {
      v = undefined;
    }
  }
  return !off(v);
}

/** 钟点原子：「6点」「六点半」「6点30分」。**必须带「点」** —— 纯数字（「每周3次」）不是钟点。 */
const CLOCK_ATOM_RE = /(\d{1,2}|[一二两三四五六七八九十]{1,2})\s*点(?:\s*半|(\d{1,2}|[一二三四五]{1,2})\s*分)?/g;
/** 区间连接词：「到|至|—|~」与动结式「打到/玩到/学到/弄到/干到」（动结式后端标记为 end）。 */
const CLOCK_RANGE_RE = /^\s*(?:到|至|[~～－—-]{1,2})\s*$/;
const CLOCK_VERB_TO_RE = /(?:打|玩|学|弄|干|忙|搞)到\s*$/;

/**
 * 中文钟点 → 起止分钟。产**起止**不产时长（时长在 parseIntentSlots 由区间推导）。
 *
 * · 语境提升：「下午3点」→ 15:00；回看原子前 ≤6 字取**最近**的时段词
 *   （「早上10点到晚上8点」两端各自归位）；
 * · 无语境（「6点」）→ 按上午口径落并标 `ambig`，由调用方向用户如实说明；
 * · 容词「大概/大约/左右/前后」剥除后再解析（原话回显用剥后形态，见 ClockHint.text）。
 */
export function extractClockRange(q: string): ClockHint | undefined {
  const s = (q || '').replace(/大概|大约|左右|前后/g, '');
  if (!/点/.test(s) && !/\d{1,2}\s*[:：]\s*\d{2}/.test(s)) return undefined;

  type Atom = { start: number; end: number; min: number; ambig: boolean };
  const atoms: Atom[] = [];
  for (const m of s.matchAll(CLOCK_ATOM_RE)) {
    const hour = /^\d+$/.test(m[1]) ? Number(m[1]) : cnToInt(m[1]);
    if (hour == null || hour < 0 || hour > 24) continue;
    const minutes = m[0].includes('半') ? 30 : m[2] != null ? (/^\d+$/.test(m[2]) ? Number(m[2]) : cnToInt(m[2]) ?? 0) : 0;
    // 语境：取原子**前面**最近的时段词（全文回看，不限窗）。口语里离钟点最近
    // 的时段词几乎总是它的语境 ——「晚上6点；打到8点」的「8点」要继承「晚上」
    // 才能落到 20:00（窄窗回看会跨过前一个原子把语境弄丢，真机实录）。
    const prefix = s.slice(0, m.index ?? 0);
    const period = getLatestPeriodWord(prefix);
    let min = hour * 60 + minutes;
    if (period === 'pm' && hour <= 11) min += 12 * 60;
    // 无语境：1-11 点可能是 13-23 点 → 按上午口径落并标注，由调用方如实说明
    const ambig = period == null && hour >= 1 && hour <= 11;
    atoms.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, min, ambig });
  }
  // 冒号形态（2026-10-07，按确切时间定位）：「14:00」「21:30」—— 课表口习惯。
  // 视作 24 小时制直接落（14:00 不歧义）；≤12 点的冒号值无时段语境时同样标 ambig。
  for (const m of s.matchAll(/(^|[^\d:])(\d{1,2})\s*[:：]\s*(\d{2})(?!\d)/g)) {
    const hour = Number(m[2]);
    const minutes = Number(m[3]);
    if (hour > 23 || minutes > 59) continue;
    const start = (m.index ?? 0) + m[1].length; // m[1] 是非数字前缀，数字从它之后起
    atoms.push({
      start,
      end: (m.index ?? 0) + m[0].length,
      min: hour * 60 + minutes,
      ambig: hour >= 1 && hour <= 11,
    });
  }
  atoms.sort((a, b) => a.start - b.start);
  if (atoms.length === 0) return undefined;

  // 成对：两原子之间只隔区间连接词，或后一原子紧跟动结式「X到」
  for (let i = 0; i + 1 < atoms.length; i++) {
    const between = s.slice(atoms[i].end, atoms[i + 1].start);
    if (CLOCK_RANGE_RE.test(between) || CLOCK_VERB_TO_RE.test(between)) {
      return {
        startMin: atoms[i].min,
        endMin: atoms[i + 1].min,
        text: s.slice(atoms[i].start, atoms[i + 1].end),
        ...(atoms[i].ambig || atoms[i + 1].ambig ? { ambig: true } : {}),
      };
    }
  }

  // 单端点：紧跟动结式「X到」→ 只有 end（「打到8点」）；否则只有 start（「晚上6点」）
  const last = atoms[atoms.length - 1];
  const before = s.slice(Math.max(0, last.start - 4), last.start);
  const verbTo = CLOCK_VERB_TO_RE.exec(before)?.[0];
  if (verbTo) {
    return {
      endMin: last.min,
      text: verbTo + s.slice(last.start, last.end),
      ...(last.ambig ? { ambig: true } : {}),
    };
  }
  return {
    startMin: last.min,
    text: s.slice(last.start, last.end),
    ...(last.ambig ? { ambig: true } : {}),
  };
}

/** 时段词回看：返回 'pm'（下午/晚上族）| 'am'（上午/早上/中午族）| undefined。 */
function getLatestPeriodWord(s: string): 'pm' | 'am' | undefined {
  const PM = /(晚上|晚间|夜里|夜晚|傍晚|下午)/;
  const AM = /(早上|早晨|上午|中午)/;
  const pm = PM.exec(s);
  const am = AM.exec(s);
  if (pm && (!am || pm.index > am.index)) return 'pm';
  if (am) return 'am';
  return undefined;
}

/** 抽「对哪一块动手」（换时间 / 取消用）。 */
export function extractTarget(q: string): string | undefined {
  const s = q || '';
  const m = /把\s*([\u4e00-\u9fffA-Za-z0-9]{2,16}?)\s*(?:挪|移|改|调|取消|删|换)/.exec(s);
  if (m) return m[1];
  const m2 = /(?:取消|删掉|退掉)\s*([\u4e00-\u9fffA-Za-z0-9]{2,16})/.exec(s);
  if (m2) return m2[1];
  // 带定位时间的把字句 / 删除句（2026-10-07，按确切时间定位）：
  // 「把周三 14:00 的自习换成…」「删掉周三下午两点那个自习」—— 冒号/点/数字/「的」
  // 会打断上面两条正则的连续捕获，先把时间表达归一成占位符再抽名词。
  const stripped = (q || '')
    .replace(/\d{1,2}\s*[:：]\s*\d{2}/g, 'T')
    .replace(/[上下]午|早上|早晨|凌晨|晚上|夜里|中午|点半|点/g, 'T');
  const m3 = /把\s*(?:这|本|下)?\s*周?[一二三四五六日天]?\s*T?[^，。；！？]{0,6}?\s*的?\s*([\u4e00-\u9fffA-Za-z0-9]{2,10}?)\s*(?:挪|移|改成|换成|换到|替换|删|取消|改到|改)/.exec(stripped);
  if (m3) return m3[1];
  const m4 = /(?:取消|删掉|退掉)\s*(?:这|本|下)?\s*周?[一二三四五六日天]?\s*T?[^，。；！？]{0,6}?\s*的?\s*(?:那个|那个叫|叫)?\s*([\u4e00-\u9fffA-Za-z0-9]{2,10})/.exec(stripped);
  if (m4) return m4[1];
  return undefined;
}

/**
 * 抽「要动的那块」的**定位时间**（2026-10-07，按确切时间定位）。
 *
 * 分段规则（调用方按意图选段）：
 *   · move/replace（「把…换成/挪到…」）→ 取**动词之前**的片段（旧时间在「把」字结构里）
 *   · cancel（「删掉周三下午两点的自习」）→ 取**动词之后**的片段（旧时间跟在动词后）
 *
 * 片段内找「周X」与钟点（复用 extractClockRange，含冒号形态）。
 * ⚠️ 抽不到时返回 undefined —— 调用方按「只有块名」的老路径走，行为不变。
 */
export function extractTargetWhen(
  q: string,
  scope: 'before-verb' | 'after-verb',
): { day?: number; clock?: ClockHint } | undefined {
  const s = q || '';
  const verb = /(?:挪到|挪去|换到|改成|换成|替换|改到|移动到|改到|取消|删掉|退掉|挪|移|换|改|删)/.exec(s);
  const seg = scope === 'before-verb'
    ? (verb ? s.slice(0, verb.index) : s)
    : (verb ? s.slice(verb.index + verb[0].length) : '');
  if (!seg) return undefined;
  const wm = /(?:这|本|下)?周([一二三四五六日天])/.exec(seg);
  const day = wm ? WD_NUM[wm[1]] : undefined;
  const clock = extractClockRange(seg);
  if (day == null && !clock) return undefined;
  return { ...(day != null ? { day } : {}), ...(clock ? { clock } : {}) };
}

/**
 * 抽单日重排的目标天（批 3，5A-②）：「重排周四」「重新排一下这周五」「把周三
 * 重新排一版」。动词在前/在后两种语序都认；没点名天 = undefined（走老路径问对象）。
 */
export function extractReplanDays(q: string): number[] | undefined {
  const s = q || '';
  const days: number[] = [];
  // 动词在前：「重排(一下)周四」「只重排这周五」「重新排周三和周四」——
  // 动词后取一个短窗口（截断在标点），窗口内全局收集星期词（捕获组 + 重复
  // 只留最后一次，不能直接用带 + 的单正则）。
  const leadVerb = /(?:重新?排|重排)(?:一?下|一版|一遍)?/.exec(s);
  if (leadVerb) {
    const restStart = leadVerb.index + leadVerb[0].length;
    const window = s.slice(restStart, restStart + 12).split(/[，。！？,.!?；;、]/)[0];
    for (const m of window.matchAll(/(?:这|本|下)?周([一二三四五六日天])/g)) {
      const d = WD_NUM[m[1]];
      if (d && !days.includes(d)) days.push(d);
    }
  }
  // 动词在后：「把周四重新排一版」「把周五重排一下」
  if (days.length === 0) {
    const tail = /(?:把|将)?\s*(?:这|本|下)?周([一二三四五六日天])[^，。！？？]{0,4}(?:重新?排|重排)/.exec(s);
    if (tail) {
      const d = WD_NUM[tail[1]];
      if (d) days.push(d);
    }
  }
  return days.length > 0 ? days : undefined;
}

/* ============================================================
 * 四、日期换算（与「听」分开 —— 听到什么 vs 落到哪一天）
 * ========================================================== */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 日期换算的学期锚点（批 1.2/1.4）：weekNo 换算要 termStart；「期中/期末」这类
 * 学期词要校历日期。由调用方（LbaoChat，手里有 schedule 与 TERM_CALENDAR）构造，
 * 本层保持纯函数 —— 不 import 校历、不读时钟。
 */
export interface ResolveTermOpts {
  /** 学期第一周周一（ISO）—— weekNo 换算的锚点 */
  termStart?: string;
  /** 校历锚点（ISO）—— 学期词落地用（1.4） */
  term?: {
    midterm?: string;
    finalsFrom?: string;
    finalsTo?: string;
  };
}

/** 校历条目的结构化最小接口（与 constants/term.ts 的 TermCalendar 天然兼容） */
export interface TermCalendarLike {
  termStart: string;
  phases?: Array<{ name: string; fromWeek: number; toWeek: number; kind: string }>;
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

/**
 * 校历 → 学期词锚点（批 1.4）。
 * 期中 = 理论教学**中点周**的周一（校历没有「期中」相位，取 round((from+to)/2)——
 * 2026-2027-1：round((3+18)/2)=11 → 与 DEADLINES 的「期中考试周」日期互证）；
 * 期末 = 第一个 exam 相位的 [周一, 周日]。缺相位就缺锚点，不编。
 */
export function termAnchorsFrom(entry: TermCalendarLike | undefined): ResolveTermOpts['term'] {
  if (!entry) return undefined;
  const theory = entry.phases?.find((p) => p.kind === 'theory');
  const exam = entry.phases?.find((p) => p.kind === 'exam');
  const out: NonNullable<ResolveTermOpts['term']> = {};
  if (theory) {
    out.midterm = addDaysISO(entry.termStart, 7 * (Math.round((theory.fromWeek + theory.toWeek) / 2) - 1));
  }
  if (exam) {
    out.finalsFrom = addDaysISO(entry.termStart, 7 * (exam.fromWeek - 1));
    out.finalsTo = addDaysISO(entry.termStart, 7 * (exam.toWeek - 1) + 6);
  }
  return out.midterm || out.finalsFrom ? out : undefined;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 时间表达 → ISO 区间。
 *
 * **为什么单独一层**：`extractWhen` 的产物是「原话的语义」（九月中旬），
 * 换算成日期要依赖「今天是几号」。把两者分开，规则层就能在不注入时钟的情况下
 * 被确定性测试 —— 与项目里 `buildPhases` / `events` 「纯函数、不读时钟」的纪律一致。
 *
 * @param today 基准日（ISO）。由调用方传，**不在这里读 `new Date()`**。
 */
export function resolveWhen(
  hint: WhenHint | undefined,
  today: string,
  opts?: ResolveTermOpts,
): { from?: string; to?: string; certainty: TimeCertainty } {
  if (!hint) return { certainty: 'unknown' };
  if (hint.kind === 'vague') return { certainty: 'unknown' };

  const base = new Date(`${today}T00:00:00`);
  if (Number.isNaN(base.getTime())) return { certainty: 'unknown' };

  // 学期周次（批 1.2）：「第N周(周X)?」= 学期绝对坐标，必须在 month/relative
  // 分支之前处理。没有 termStart 就**不换算**（不编日期），降级为 window。
  if (hint.weekNo != null) {
    const ts = opts?.termStart;
    const tsDate = ts ? new Date(`${ts}T00:00:00`) : null;
    if (!tsDate || Number.isNaN(tsDate.getTime())) return { certainty: 'window' };
    const monday = new Date(tsDate);
    monday.setDate(tsDate.getDate() + 7 * (hint.weekNo - 1));
    if (hint.weekday != null) {
      const one = new Date(monday);
      one.setDate(monday.getDate() + (hint.weekday - 1));
      const iso = isoOf(one);
      return { from: iso, to: iso, certainty: 'exact' };
    }
    const sun = new Date(monday);
    sun.setDate(monday.getDate() + 6);
    return { from: isoOf(monday), to: isoOf(sun), certainty: 'window' };
  }

  if (hint.kind === 'exact' && hint.month && hint.day) {
    // 没写年份 → 取下一次发生（批 1.3：**整日早于今天 → 滚年**。旧 90 天规则会把
    // 「10 月说九月中旬」留在已过去的 9 月，铺块落进过去 = 用户看到一块灰色回忆）
    let year = base.getFullYear();
    const mk = (y: number) => new Date(y, hint.month! - 1, hint.day!);
    if (mk(year).getTime() < base.getTime()) year += 1;
    const iso = isoOf(mk(year));
    return { from: iso, to: iso, certainty: 'exact' };
  }

  // 相对月锚（批 1.3）：本月/下月/下下月 + 旬窗。旬窗用**真实月末**（11 月 30、
  // 12 月 31），不是旧代码的 28 截断 —— 「下月底」排到 28 号等于偷走两三天。
  if (hint.relativeMonths != null) {
    let year = base.getFullYear();
    let m0 = base.getMonth() + hint.relativeMonths;
    while (m0 > 11) {
      m0 -= 12;
      year += 1;
    }
    const monthLen = new Date(year, m0 + 1, 0).getDate();
    const span: [number, number] =
      hint.decade === 'early' ? [1, 10] :
      hint.decade === 'middle' ? [11, 20] :
      hint.decade === 'late' ? [21, monthLen] : [1, 28];
    return {
      from: isoOf(new Date(year, m0, span[0])),
      to: isoOf(new Date(year, m0, span[1])),
      certainty: 'window',
    };
  }

  if (hint.month) {
    let year = base.getFullYear();
    const span: [number, number] =
      hint.decade === 'early' ? [1, 10] :
      hint.decade === 'middle' ? [11, 20] :
      hint.decade === 'late' ? [21, 28] : [1, 28];
    // 批 1.3：滚年条件从「早于今天 90 天」改为「**整个窗口**早于今天」——
    // 窗口还含着今天（10 月说「10月」）就不滚。
    if (new Date(year, hint.month - 1, span[1]).getTime() < base.getTime()) year += 1;
    return {
      from: isoOf(new Date(year, hint.month - 1, span[0])),
      to: isoOf(new Date(year, hint.month - 1, span[1])),
      certainty: 'window',
    };
  }

  if (hint.kind === 'relative') {
    const d = new Date(base);
    if (hint.relativeDays != null) {
      d.setDate(d.getDate() + hint.relativeDays);
      return { from: isoOf(d), to: isoOf(d), certainty: 'exact' };
    }
    if (hint.relativeWeeks != null) {
      // 周一为一周之始 —— 与 `currentWeekNo` 的口径一致
      const monday = new Date(d);
      const dow = (monday.getDay() + 6) % 7; // 0 = 周一
      monday.setDate(monday.getDate() - dow + hint.relativeWeeks * 7);
      if (hint.weekday != null) {
        const one = new Date(monday);
        one.setDate(monday.getDate() + (hint.weekday - 1));
        // 周日说「周四」→ 算出来是昨天：人指的是**下一个**周四，滚一周。
        // （过去的日子排进日程 = 用户看到一块灰色回忆，比不排更迷惑。）
        if (one.getTime() < base.getTime()) one.setDate(one.getDate() + 7);
        return { from: isoOf(one), to: isoOf(one), certainty: 'exact' };
      }
      const sun = new Date(monday);
      sun.setDate(monday.getDate() + 6);
      return { from: isoOf(monday), to: isoOf(sun), certainty: 'window' };
    }
  }

  // 学期词（批 1.4）：有校历锚点 → 落到真实窗口；没有 → 维持 window（不编日期）。
  // 「…之前/前」= 目标窗口止于锚点前一日（「期末考试前把高数复习完」要的是
  // [今天, 考试周前] 的复习窗，不是考试周里那一块）；裸学期词 = 锚点本身
  // （「期中考试」是重要日，落当天；「期末」是考试周整段）。
  if (opts?.term && /(期中|期末|考试周|学期末|结课)/.test(hint.text)) {
    const t = opts.term;
    const isBefore = /(之前|以前|前)$/.test(hint.text);
    if (/期中/.test(hint.text) && t.midterm) {
      if (isBefore) {
        const to = addDaysISO(t.midterm, -1);
        return { from: isoOf(base), to: to >= isoOf(base) ? to : undefined, certainty: 'window' };
      }
      return { from: t.midterm, to: t.midterm, certainty: 'window' };
    }
    if (/(期末|考试周|学期末|结课)/.test(hint.text) && t.finalsFrom && t.finalsTo) {
      if (isBefore) {
        const to = addDaysISO(t.finalsFrom, -1);
        return { from: isoOf(base), to: to >= isoOf(base) ? to : undefined, certainty: 'window' };
      }
      return { from: t.finalsFrom, to: t.finalsTo, certainty: 'window' };
    }
  }

  // 学期词 / 只有原话 → 交给上层用校历换算
  return { certainty: 'window' };
}

/**
 * 「6点到7点」「六点半到八点」→ 时长分钟。
 *
 * ⚠️ 只在**回答投入追问**的语境里调用（`fillOneSlot` 的 effort 分支）——
 * 事件陈述里的「下午2点到4点」是**时间窗**不是时长（「明天下午两点到四点
 * 在图书馆自习」排的是那个时段，不是 120 分钟的运动量），全局套用会污染
 * 正常解析。CY 真机翻车（2026-09-27 晚）：追问「占多久」，用户答
 * 「6点到7点」被整段丢弃。
 */
export function spanDurationMin(text: string): number | undefined {
  const s = text || '';
  const m = /([0-9]+(?:\.[0-9]+)?|[一二两三四五六七八九十]+)\s*点(半)?\s*[到至~～－—-]\s*([0-9]+(?:\.[0-9]+)?|[一二两三四五六七八九十]+)\s*点(半)?/.exec(s);
  if (!m) return undefined;
  const val = (num: string, half?: string): number | undefined => {
    const base = cnAmount(num);
    if (base == null) return undefined;
    return base + (half ? 0.5 : 0);
  };
  const a = val(m[1], m[2]);
  const b = val(m[3], m[4]);
  if (a == null || b == null || b <= a || b > 24) return undefined;
  return Math.round((b - a) * 60);
}
