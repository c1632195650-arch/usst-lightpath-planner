/**
 * 🧪 临时诊断工具 · 画像 → 排程 影响沙盒（仅 DEV）
 * ============================================================
 * 目的：让「画像到底改了什么」肉眼可见 —— RAY 的原话是
 *      「我没有看到画像在排程里起到了什么作用」。
 *
 * 它做三件事：
 *   ① 把 8 条轴做成可拖动的滑杆，实时重算**学期阶段策略**（`buildPhases`）；
 *   ② 把同一份输入喂给**周排程引擎**（`planWeekV2`），把块排出来；
 *   ③ 与「中性画像（全 50）」逐块对照，标出**哪些块是被画像改动过的**。
 *
 * ── 为什么放在 `src/lab/` 而不是 `features/persona/` ─────────
 * · AC-8（架构护栏）规定 `features/**` 只许经 `useWeekPlan` / `weekPlanForChat`
 *   接触引擎；本工具需要**同步、可高频重复**地直呼引擎，与「唯一准入通道」
 *   这条产品约束正交（产品上要唯一通道；诊断上要能反复试）。
 * · `src/lab/` 不在 arch-guards 的扫描根（`features` / `components` / `lib`）里，
 *   放这儿不会给正式构建引入一条不该有的依赖，也不会把守卫判红。
 *
 * ⚠️ 这是**临时工具**，验收完请整体删除（本文件 + `App.tsx` 里那一处挂载）。
 *    若日后要转正，请用 `useWeekPlan` 重写，别把这条直连引擎的依赖带进 features。
 *
 * 挂载：`App.tsx` 中 `location.hash === '#persona-lab'`（仅 DEV）。
 */
import { useMemo, useState } from 'react';
import type { AxisKey, PersonaProfile, Phase, Schedule, TimeBlock } from '@/types';
import { AXIS_KEYS } from '@/lib/persona';
import { DAY_LABELS, currentWeekNo } from '@/lib/date';
import { toHHmm, periodEndMin, periodStartMin } from '@/constants/time';
import { TERM_CALENDAR } from '@/constants/term';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases';
import { toPlanRequest } from '@/lib/planner/schedule';
import { planWeekV2 } from '@/lib/planner/index';
import { useAppState } from '@/lib/storage';
import { MOCK_SCHEDULE } from '@/data/usst';

/* ============================================================
 * 轴的元信息 —— 把「哪条轴接到哪」写在界面上，而不是留在文档里
 * ========================================================== */

interface AxisMeta {
  key: AxisKey;
  label: string;
  /** 这条轴**生效时**会改什么（对应 buildPhases.applyPersona） */
  effect: string;
  /** 排程消费点数量为 0 的死轴 */
  dead?: boolean;
}

const AXIS_META: AxisMeta[] = [
  { key: 'ACH', label: '成就驱动', effect: '每日自习目标时长 ×1.2 / ×0.8' },
  { key: 'PLAN', label: '计划性', effect: '单块上限 +30 / 压到 ≤45 分' },
  { key: 'HEA', label: '健康自律', effect: '留白 +10% / −5%' },
  { key: 'RES', label: '韧性', effect: '留白 +5%（仅 ≤35 时）' },
  { key: 'EXP', label: '探索度', effect: '适应期 +1 周（仅 ≥70 时）' },
  { key: 'SOC', label: '社交', effect: '社交块每日上限 1 ↔ 2 个' },
  { key: 'RAT', label: '理性', effect: '排程消费点 0 —— 死轴，改了也不动', dead: true },
  { key: 'BOLD', label: '大胆', effect: '排程消费点 0 —— 死轴，改了也不动', dead: true },
];

/** 阈值门：`applyPersona` 只认 ≥70 / ≤35，中段等于没画 */
const GATE_HI = 70;
const GATE_LO = 35;

/**
 * 知识库关键参数**快照**（2026-09-27 实测）。
 *
 * ⚠️ 这里是快照副本，用于在**接线之前**预览效果。接线之后应改为：
 *     `import { METHOD } from '@/lib/planner/methods'` + `resolveParam(...)`。
 * `hasContext = false` 是实测结论：`blocks` 参数**没有任何适用条件**，
 * 会被无条件误用（见设计书 §10.8.3）。这一列就是用来盯这件事的。
 */
interface KbRow {
  key: string;
  value: string;
  tier: 'A' | 'B' | 'C' | 'D';
  slug: string;
  hasContext: boolean;
  note: string;
}

const KB_SNAPSHOT: KbRow[] = [
  { key: 'deepBlockMin', value: '90', tier: 'D', slug: 'deep-work', hasContext: false, note: '主线块长' },
  { key: 'studyDurations', value: '[25, 50]', tier: 'D', slug: 'pomodoro', hasContext: false, note: '打底块档位' },
  { key: 'focusMin / breakMin', value: '25 / 5', tier: 'D', slug: 'pomodoro', hasContext: false, note: '番茄参数' },
  { key: 'maxDeepBlocksPerDay', value: '3', tier: 'D', slug: 'deep-work', hasContext: false, note: '每日深块上限' },
  { key: 'reviewIntervalsDays', value: '[1,3,7,15,30]', tier: 'A', slug: 'spacing-effect', hasContext: false, note: '复习间隔（最高等级）' },
  { key: 'examSprintLeadDays', value: '14', tier: 'D', slug: 'exam-strategy', hasContext: false, note: '冲刺期边界' },
  { key: 'mcmTotalHours', value: '72', tier: 'D', slug: 'mcm-playbook', hasContext: false, note: '数模总投入' },
  { key: 'habitExpectDays', value: '66', tier: 'B', slug: 'habit-formation-loop', hasContext: false, note: '习惯养成周期' },
  { key: 'sleepMinHours', value: '7', tier: 'A', slug: 'sleep-duration-adult', hasContext: false, note: '健康库 · 睡眠保底' },
  { key: 'weeklyModerateMin', value: '150', tier: 'A', slug: 'aerobic-150', hasContext: false, note: '健康库 · 每周活动量' },
  { key: 'sedentaryBreakMin', value: '60', tier: 'A', slug: 'move-more-sit-less', hasContext: false, note: '健康库 · 久坐打断' },
  { key: 'napMin–Max', value: '20–30', tier: 'B', slug: 'nap-hygiene', hasContext: false, note: '健康库 · 小睡区间' },
];

const TIER_STYLE: Record<KbRow['tier'], string> = {
  A: 'bg-green-100 text-green-800 ring-green-300',
  B: 'bg-sky-100 text-sky-800 ring-sky-300',
  C: 'bg-amber-100 text-amber-800 ring-amber-300',
  D: 'bg-red-100 text-red-800 ring-red-300',
};

const MID_AXES: Record<AxisKey, number> = Object.fromEntries(
  AXIS_KEYS.map((k) => [k, 50]),
) as Record<AxisKey, number>;

/* ============================================================
 * 工具函数
 * ========================================================== */

/** 用一个轴的取值造出完整画像；`base` 为空则全部取中性的 50 */
function makeProfile(axes: Record<AxisKey, number>, base: PersonaProfile | null): PersonaProfile {
  return {
    version: base?.version ?? 'lab',
    scoreVersion: base?.scoreVersion ?? 'lab',
    axes,
    traits: base?.traits ?? { E: 50, C: 50, ES: 50, O: 50, A: 50 },
    motives: base?.motives ?? { ACH: 50, SOC: 50, HEA: 50, EXP: 50, STA: 50 },
    scenarios: base?.scenarios ?? {
      meal_radius: '', planning: 'planned', event_breadth: '', social_radius: '',
      night_supply: '', exercise_trigger: '', study_place: 'library', info_channel: '',
    },
    archetype: base?.archetype ?? { primary: null, secondary: null, distance: 0 },
    confidence: base?.confidence ?? {},
    quality: base?.quality ?? 'ok',
    updatedAt: base?.updatedAt ?? '',
  };
}

/** 取某周所处的阶段；越界时回落到第一个阶段，保证界面上永远有东西可看 */
function phaseFor(schedule: Schedule, persona: PersonaProfile | null, weekNo: number): Phase {
  const { plan } = buildPhasesFromCalendar(schedule, persona, TERM_CALENDAR['2026-2027-1']);
  return phaseOfWeek(plan, weekNo) ?? plan.phases[0];
}

function fmtRange(b: TimeBlock): string {
  return `${toHHmm(b.startMin)}–${toHHmm(b.endMin)}`;
}

const KIND_STYLE: Record<TimeBlock['kind'], string> = {
  course: 'bg-slate-100 text-slate-700',
  meal: 'bg-amber-50 text-amber-800',
  study: 'bg-sky-50 text-sky-800',
  activity: 'bg-green-50 text-green-800',
  commute: 'bg-slate-50 text-slate-500',
  blank: 'bg-white text-slate-300',
};

/* ============================================================
 * 主组件
 * ========================================================== */

export function PersonaLab() {
  const { state } = useAppState();
  const realPersona = state.persona;
  const schedule: Schedule = state.schedule ?? MOCK_SCHEDULE;

  const [axes, setAxes] = useState<Record<AxisKey, number>>(
    () => ({ ...(realPersona?.axes ?? MID_AXES) }),
  );
  const [useNone, setUseNone] = useState(false);
  const [weekNo, setWeekNo] = useState(() => currentWeekNo(schedule.termStart));
  /** 执行率校准系数（0.5–1.2）；0 表示「还没有数据」→ 不校准 */
  const [adherence, setAdherence] = useState(0);
  /** 已载入的真实画像（来自 public/dev-persona.json，由 工具-导出真实画像.mjs 生成） */
  const [loaded, setLoaded] = useState<{
    archetype: string; quality: string; answers: number; stored: string; onboarded: boolean;
  } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  /**
   * 从本地库**现算**的真实画像载入。
   * 为什么不是"登录后同步"：画像的唯一真源是 `answers`，而它就在本地
   * `data/lightpath.db` 里；`buildProfile` 是纯函数 → 重算比登录更直接。
   */
  const loadRealPersona = async () => {
    setLoadErr(null);
    try {
      const res = await fetch('/dev-persona.json', { cache: 'no-store' });
      if (!res.ok) {
        setLoadErr('没找到 public/dev-persona.json —— 先在仓库根跑一次「工具-导出真实画像.mjs」');
        return;
      }
      const j = await res.json() as {
        _source: { answersCount: number; storedPersona: string; onboarded: boolean };
        persona: { axes: Record<AxisKey, number>; archetype: { primary: { name: string } | null }; quality: string };
      };
      setAxes({ ...j.persona.axes });
      setUseNone(false);
      setLoaded({
        archetype: j.persona.archetype?.primary?.name ?? '（无）',
        quality: j.persona.quality,
        answers: j._source.answersCount,
        stored: j._source.storedPersona,
        onboarded: j._source.onboarded,
      });
    } catch (e) {
      setLoadErr(`读取失败：${String(e)}`);
    }
  };

  /**
   * 本周自由容量 —— 与 `useWeekPlan.ts:220` 同一口径，用来展示
   * 「引擎其实自己算得出容量」（分解层的 `void freeMinutes` 是个真缺口）。
   */
  const freeMinutes = useMemo(() => {
    let booked = 0;
    for (const c of schedule.courses) {
      for (const s of c.slots) booked += periodEndMin(s.endPeriod) - periodStartMin(s.startPeriod);
    }
    return 16 * 60 * 7 - booked;
  }, [schedule]);

  const sandboxProfile = useMemo(
    () => (useNone ? null : makeProfile(axes, realPersona)),
    [axes, realPersona, useNone],
  );
  const neutralProfile = useMemo(() => makeProfile(MID_AXES, realPersona), [realPersona]);

  /** 三条对照线的阶段策略 */
  const phases = useMemo(() => ({
    sandbox: phaseFor(schedule, sandboxProfile, weekNo),
    neutral: phaseFor(schedule, neutralProfile, weekNo),
    none: phaseFor(schedule, null, weekNo),
  }), [schedule, sandboxProfile, neutralProfile, weekNo]);

  /**
   * ② 因子贡献分解用：`nb` = 基线（全 50 时 `applyPersona` 不改动任何项，
   * 所以它就是 `BASE_POLICY[kind]`），`sb` = 画像生效后的值。
   */
  const nb = phases.neutral.policy;
  const sb = phases.sandbox.policy;

  /** 沙盒计划 与 中性基线计划 —— 用来做块的差异高亮 */
  const plans = useMemo(() => {
    const run = (p: PersonaProfile | null) => planWeekV2(toPlanRequest({
      schedule,
      weekNo,
      policy: phaseFor(schedule, p, weekNo).policy,
      scenarios: p?.scenarios ?? null,
      tasks: [],
    })).plan;
    return { sandbox: run(sandboxProfile), neutral: run(neutralProfile) };
  }, [schedule, sandboxProfile, neutralProfile, weekNo]);

  /** id → 位置指纹；用于判断某个块在沙盒里「动了没有」 */
  const diffOf = useMemo(() => {
    const fp = (b: TimeBlock) => `${b.dayOfWeek}|${b.startMin}|${b.place ?? ''}`;
    const base = new Map(plans.neutral.blocks.map((b) => [b.id, fp(b)]));
    const mine = new Map(plans.sandbox.blocks.map((b) => [b.id, fp(b)]));
    const added = new Set<string>();
    const moved = new Set<string>();
    for (const b of plans.sandbox.blocks) {
      const was = base.get(b.id);
      if (was === undefined) added.add(b.id);
      else if (was !== fp(b)) moved.add(b.id);
    }
    const removed = plans.neutral.blocks.filter((b) => !mine.has(b.id));
    return { added, moved, removed };
  }, [plans]);

  const resetToReal = () => {
    setAxes({ ...(realPersona?.axes ?? MID_AXES) });
    setUseNone(false);
  };

  const crossGate = AXIS_META.filter((m) => {
    const v = axes[m.key];
    return !m.dead && !useNone && (v >= GATE_HI || v <= GATE_LO);
  });

  return (
    <div className="min-h-screen bg-paper px-4 py-6 text-ink sm:px-8">
      <div className="mx-auto max-w-5xl space-y-4">

        {/* ── 头部 ───────────────────────────────────────── */}
        <header className="panel px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-[16px] font-semibold">画像 → 排程 · 影响沙盒</h1>
            <span className="text-[11.5px] text-ink-faint">临时诊断工具（仅 DEV）· #persona-lab</span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
            拖任何一条轴，下面的「阶段策略」和「周计划」会立刻重算。
            <span className="text-ink-faint"> 绿色＝画像多排出来的块，琥珀＝被画像挪过位置的块。</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={resetToReal} className="button-primary px-3 py-1.5 text-[12px]">
              重置为我的真实画像
            </button>
            <button
              type="button"
              onClick={() => { void loadRealPersona(); }}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700"
            >
              📥 从本地库载入真实画像
            </button>
            <button
              type="button"
              onClick={() => { setAxes({ ...MID_AXES }); setUseNone(false); }}
              className="rounded-md bg-white px-3 py-1.5 text-[12px] ring-1 ring-ink/15 hover:bg-slate-50"
            >
              全 50（中性）
            </button>
            <button
              type="button"
              onClick={() => setUseNone((v) => !v)}
              className={`rounded-md px-3 py-1.5 text-[12px] ring-1 transition ${
                useNone ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white ring-ink/15 hover:bg-slate-50'
              }`}
            >
              {useNone ? '✓ 无画像（persona = null）' : '模拟无画像'}
            </button>
            <span className="ml-auto flex items-center gap-2 text-[12px] text-ink-soft">
              第
              <input
                type="number"
                min={1}
                max={schedule.totalWeeks}
                value={weekNo}
                onChange={(e) => setWeekNo(Math.max(1, Math.min(schedule.totalWeeks, Number(e.target.value) || 1)))}
                className="w-16 rounded-md border border-ink/15 px-2 py-1 text-[12px]"
              />
              周 / 共 {schedule.totalWeeks} 周
            </span>
            {/* ③ 执行率：数据来自 behaviorLog，目前**未接**到目标分解（见设计书 §9 S3） */}
            <span className="flex items-center gap-2 rounded-md bg-amber-50 px-2.5 py-1 text-[12px] text-amber-800 ring-1 ring-amber-200">
              执行率（待接线）
              <input
                type="range" min={0} max={1.2} step={0.05} value={adherence}
                onChange={(e) => setAdherence(Number(e.target.value))}
                className="w-24"
              />
              <span className="w-14 font-mono text-[11px]">
                {adherence === 0 ? '无数据' : `×${adherence.toFixed(2)}`}
              </span>
            </span>
          </div>
          {useNone && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-800">
              当前按「没有画像」排 —— 这就是你做完问卷之前的样子，可以用来对照。
            </p>
          )}
          {loadErr && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-[11.5px] text-red-800">{loadErr}</p>
          )}
          {loaded && (
            <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-ink-soft">
              <b className="text-ink">已载入真实画像</b>：原型「{loaded.archetype}」· 质量 {loaded.quality} ·
              由 {loaded.answers} 道作答现算。
              {loaded.stored === 'null' && (
                <span className="mt-1 block rounded bg-red-50 px-2 py-1 text-red-800">
                  ⚠️ 但库里存的 <code className="font-mono">persona</code> 是 <code className="font-mono">null</code>、
                  <code className="font-mono">onboarded=false</code> ——
                  <b>说明问卷流程没走完最后一步，画像从未生成</b>，课表一直按「无画像」在排。
                  这也是「看不出画像作用」的直接原因。
                </span>
              )}
            </div>
          )}
        </header>

        {/* ── ① 八轴 ─────────────────────────────────────── */}
        <section className="panel px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-medium">① 八条轴</h2>
            <span className="text-[11.5px] text-ink-faint">
              阈值门：只有 ≥{GATE_HI} 或 ≤{GATE_LO} 才会改变排程 ·
              当前跨过 {crossGate.length} / 6 条有效轴
              {crossGate.length > 0 && <>（{crossGate.map((m) => m.label).join('、')}）</>}
            </span>
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {AXIS_META.map((m) => {
              const v = axes[m.key];
              const hi = v >= GATE_HI;
              const lo = v <= GATE_LO;
              const fired = !m.dead && !useNone && (hi || lo);
              return (
                <div key={m.key} className={`rounded-lg px-3 py-2 ring-1 ${
                  m.dead ? 'bg-red-50/60 ring-red-200' : fired ? 'bg-green-50/60 ring-green-200' : 'bg-white ring-ink/10'
                }`}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12.5px] font-medium">{m.label}</span>
                    <span className="font-mono text-[15px] font-medium tabular-nums">{v}</span>
                    {m.dead && <span className="text-[10.5px] text-red-700">死轴</span>}
                    {!m.dead && fired && <span className="text-[10.5px] text-green-700">已生效</span>}
                    {!m.dead && !fired && <span className="text-[10.5px] text-ink-faint">中段 · 不生效</span>}
                  </div>
                  <input
                    type="range" min={0} max={100} value={v}
                    onChange={(e) => setAxes((prev) => ({ ...prev, [m.key]: Number(e.target.value) }))}
                    className="mt-1.5 w-full"
                  />
                  <div className="mt-0.5 flex items-baseline justify-between">
                    <span className="text-[11px] text-ink-faint">{m.effect}</span>
                    <span className="font-mono text-[10px] text-ink-faint">{GATE_LO}│{GATE_HI}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── ② 因子贡献分解 ─────────────────────────────── */}
        <section className="panel px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-medium">② 因子贡献分解 · 第 {weekNo} 周</h2>
            <span className="text-[11.5px] text-ink-faint">
              最终值 = ① 基线 × ② 画像 × ③ 执行率 —— <b>任一层恒定，输出就塌回一个数</b>
            </span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-ink-faint">
                  <th className="py-1.5 pr-3 font-normal">目标量</th>
                  <th className="py-1.5 pr-3 font-normal">① 基线（来源）</th>
                  <th className="py-1.5 pr-3 font-normal">② 画像</th>
                  <th className="py-1.5 pr-3 font-normal">③ 执行率 / 负荷</th>
                  <th className="py-1.5 font-normal">= 最终</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {([
                  ['每日自习目标', nb.dailyStudyMin, `${nb.dailyStudyMin} 分`, sb.dailyStudyMin,
                    `ACH=${useNone ? '—' : axes.ACH} → ×${(sb.dailyStudyMin / nb.dailyStudyMin).toFixed(2)}`,
                    '—', `${sb.dailyStudyMin} 分`],
                  ['单块时长上限', nb.maxBlockMin, `${nb.maxBlockMin} 分`, sb.maxBlockMin,
                    `PLAN=${useNone ? '—' : axes.PLAN} → ×${(sb.maxBlockMin / nb.maxBlockMin).toFixed(2)}`,
                    '—', `${sb.maxBlockMin} 分`],
                  ['留白比例', nb.blankRatio, `${Math.round(nb.blankRatio * 100)}%`, sb.blankRatio,
                    `HEA=${useNone ? '—' : axes.HEA} → ×${(sb.blankRatio / nb.blankRatio).toFixed(2)}`,
                    '—', `${Math.round(sb.blankRatio * 100)}%`],
                ] as const).map(([label, , baseTxt, , personaTxt, adhTxt, finalTxt]) => (
                  <tr key={label} className="border-t border-ink/10">
                    <td className="py-1.5 pr-3 text-ink-soft">{label}</td>
                    <td className="py-1.5 pr-3">
                      {baseTxt}
                      <span className="ml-1 text-[10.5px] text-ink-faint">BASE_POLICY · 拍值</span>
                    </td>
                    <td className="py-1.5 pr-3 text-green-700">{personaTxt}</td>
                    <td className="py-1.5 pr-3 text-ink-faint">{adhTxt}</td>
                    <td className="py-1.5 font-medium">{finalTxt}</td>
                  </tr>
                ))}
                <tr className="border-t border-ink/10">
                  <td className="py-1.5 pr-3 text-ink-soft">当日本周容量系数</td>
                  <td className="py-1.5 pr-3">
                    1.00
                    <span className="ml-1 text-[10.5px] text-ink-faint">roll.ts 基准</span>
                  </td>
                  <td className="py-1.5 pr-3 text-ink-faint">—</td>
                  <td className="py-1.5 pr-3 text-amber-700">
                    负荷高 → ×0.90
                    <span className="ml-1 text-[10.5px] text-ink-faint">已接（软降档）</span>
                  </td>
                  <td className="py-1.5 font-medium">0.90</td>
                </tr>
                <tr className="border-t border-ink/10 bg-amber-50/40">
                  <td className="py-1.5 pr-3 text-amber-800">目标周预算（待接线）</td>
                  <td className="py-1.5 pr-3">
                    {(freeMinutes / 60).toFixed(1)} h
                    <span className="ml-1 text-[10.5px] text-ink-faint">16h×7 − 课表（引擎已算）</span>
                  </td>
                  <td className="py-1.5 pr-3 text-ink-faint">意愿份额 20%（示意）</td>
                  <td className={`py-1.5 pr-3 ${adherence === 0 ? 'text-ink-faint' : 'text-amber-700'}`}>
                    {adherence === 0 ? '无数据 → 不校准' : `×${adherence.toFixed(2)}`}
                  </td>
                  <td className="py-1.5 font-medium">
                    {(freeMinutes * 0.2 * (adherence === 0 ? 1 : adherence) / 60).toFixed(1)} h
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="mt-3 space-y-1 border-t border-ink/10 pt-2 text-[11.5px] leading-relaxed text-ink-soft">
            <li>
              <b className="text-ink">已接的只有两列</b>：基线（`BASE_POLICY` 硬编码 = 拍值）与画像（`buildPhases` → `PhasePolicy`）。
            </li>
            <li>
              <b className="text-ink">执行率未接</b>：`useWeekPlan.ts:220` 早就算好了自由容量并传给了
              `goalTasksOf`，但那边写的是 <code className="font-mono">void freeMinutes</code> —— 引擎知道，分解层没用。
            </li>
            <li>
              <b className="text-ink">基线也还不是知识库</b>：接线后 `<code className="font-mono">BASE_POLICY</code>`
              的取值应改由 `resolveParam('deepBlockMin', ctx, fallback)` 提供（见 ⑤ 与设计书 §9 S3）。
            </li>
          </ul>
        </section>

        {/* ── ③ 阶段策略对照 ─────────────────────────────── */}
        <section className="panel px-5 py-4">
          <h2 className="text-[14px] font-medium">
            ③ 阶段策略对照 · 第 {weekNo} 周（{phases.sandbox.name}）
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-ink-faint">
                  <th className="py-1.5 pr-3 font-normal">参数</th>
                  <th className="py-1.5 pr-3 font-normal">沙盒（当前拖的）</th>
                  <th className="py-1.5 pr-3 font-normal">中性（全 50）</th>
                  <th className="py-1.5 pr-3 font-normal">无画像</th>
                  <th className="py-1.5 font-normal">判读</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {([
                  ['每日自习目标', 'dailyStudyMin', (p: Phase) => `${p.policy.dailyStudyMin} 分`],
                  ['单块时长上限', 'maxBlockMin', (p: Phase) => `${p.policy.maxBlockMin} 分`],
                  ['留白比例', 'blankRatio', (p: Phase) => `${Math.round(p.policy.blankRatio * 100)}%`],
                  ['晚间可排', 'eveningAllowed', (p: Phase) => (p.policy.eveningAllowed ? '可以' : '不排')],
                  ['周末可排', 'weekendWork', (p: Phase) => (p.policy.weekendWork ? '排' : '不排')],
                  ['自习地点池', 'studyPlaces', (p: Phase) => p.policy.studyPlaces.join('、') || '（默认）'],
                ] as const).map(([label, key, fmt]) => {
                  const a = fmt(phases.sandbox);
                  const b = fmt(phases.neutral);
                  const c = fmt(phases.none);
                  const diff = a !== b;
                  return (
                    <tr key={key} className="border-t border-ink/10">
                      <td className="py-1.5 pr-3 text-ink-soft">{label}</td>
                      <td className={`py-1.5 pr-3 font-medium ${diff ? 'text-green-700' : ''}`}>{a}</td>
                      <td className="py-1.5 pr-3 text-ink-faint">{b}</td>
                      <td className="py-1.5 pr-3 text-ink-faint">{c}</td>
                      <td className="py-1.5 text-[11px] text-ink-faint">
                        {diff ? '← 画像改了这一项' : '与中性一致'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 border-t border-ink/10 pt-2.5">
            <h3 className="text-[12.5px] font-medium">引擎给出的理由（界面正式版只显示前 3 条，这里全给）</h3>
            <ul className="mt-1.5 space-y-0.5">
              {phases.sandbox.reasons.map((r, i) => (
                <li key={i} className="text-[11.5px] leading-relaxed text-ink-soft">
                  <span className="text-ink-faint">{i < 3 ? '①②③'[i] : '·'} </span>{r}
                  {i >= 3 && <span className="ml-1 text-[10px] text-ink-faint">（正式界面不显示）</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── ④ 周计划差异 ───────────────────────────────── */}
        <section className="panel px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-medium">④ 第 {weekNo} 周的块 · 与中性画像对照</h2>
            <span className="text-[11.5px] text-ink-faint">
              画像多排 <b className="text-green-700">{diffOf.added.size}</b> 块 ·
              挪动 <b className="text-amber-700">{diffOf.moved.size}</b> 块 ·
              少排 <b className="text-red-700">{diffOf.removed.length}</b> 块 ·
              共 {plans.sandbox.blocks.length} 块
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {DAY_LABELS.map((name, i) => {
              const day = (i + 1) as TimeBlock['dayOfWeek'];
              const blocks = plans.sandbox.blocks
                .filter((b) => b.dayOfWeek === day && b.kind !== 'blank')
                .sort((a, b) => a.startMin - b.startMin);
              return (
                <div key={name} className="rounded-lg bg-white px-2.5 py-2 ring-1 ring-ink/10">
                  <div className="text-[11.5px] font-medium text-ink-soft">{name}</div>
                  <ul className="mt-1.5 space-y-1">
                    {blocks.map((b) => {
                      const isNew = diffOf.added.has(b.id);
                      const isMoved = diffOf.moved.has(b.id);
                      return (
                        <li key={b.id} className={`rounded px-1.5 py-1 text-[11px] leading-snug ${
                          isNew ? 'bg-green-100 ring-1 ring-green-300'
                            : isMoved ? 'bg-amber-100 ring-1 ring-amber-300'
                            : KIND_STYLE[b.kind]
                        }`}>
                          <span className="font-mono text-[10px] opacity-70">{fmtRange(b)}</span>
                          <span className="ml-1">{b.title}</span>
                          {b.place && <span className="block text-[10px] opacity-70">@ {b.place}</span>}
                          {isNew && <span className="ml-1 text-[10px] font-medium text-green-800">＋新增</span>}
                          {isMoved && <span className="ml-1 text-[10px] font-medium text-amber-800">↔挪位</span>}
                        </li>
                      );
                    })}
                    {blocks.length === 0 && <li className="text-[11px] text-ink-faint">（无）</li>}
                  </ul>
                </div>
              );
            })}
          </div>
          {diffOf.removed.length > 0 && (
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2">
              <div className="text-[11.5px] font-medium text-red-800">中性画像会排、现在不排的块</div>
              <ul className="mt-1 space-y-0.5">
                {diffOf.removed.map((b) => (
                  <li key={b.id} className="text-[11px] text-red-700">
                    {DAY_LABELS[b.dayOfWeek - 1]} {fmtRange(b)} {b.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 border-t border-ink/10 pt-2 text-[11px] leading-relaxed text-ink-faint">
            注：块的位置还受课表、作息窗口、锁与转场时间的约束，画像只是其中一股力量 ——
            所以「改轴 → 块全变」不是必然，多数时候变的是密度与地点，不是骨架。
          </p>
        </section>

        {/* ── ⑤ 知识库参数一览 ───────────────────────────── */}
        <section className="panel px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-medium">⑤ 知识库参数 · 能不能接</h2>
            <span className="text-[11.5px] text-ink-faint">
              等级：A 元分析 · B 一致实证 · C 教科书共识 · <b className="text-red-700">D 从业者经验</b>
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-soft">
            这些值目前**一个都没接进排程**。右下角那一列是硬阻断 ——
            <b>「缺适用条件」意味着引擎会把只对数模成立的参数用到学吉他上</b>。
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-ink-faint">
                  <th className="py-1.5 pr-3 font-normal">参数</th>
                  <th className="py-1.5 pr-3 font-normal">值</th>
                  <th className="py-1.5 pr-3 font-normal">等级</th>
                  <th className="py-1.5 pr-3 font-normal">出处条目</th>
                  <th className="py-1.5 pr-3 font-normal">说明</th>
                  <th className="py-1.5 font-normal">适用条件</th>
                </tr>
              </thead>
              <tbody>
                {KB_SNAPSHOT.map((r) => (
                  <tr key={r.key} className="border-t border-ink/10">
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-ink">{r.key}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">{r.value}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ${TIER_STYLE[r.tier]}`}>
                        {r.tier}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[10.5px] text-ink-faint">{r.slug}</td>
                    <td className="py-1.5 pr-3 text-[11px] text-ink-soft">{r.note}</td>
                    <td className="py-1.5">
                      {r.hasContext
                        ? <span className="text-[10.5px] text-green-700">有</span>
                        : <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10.5px] font-medium text-red-700 ring-1 ring-red-200">缺 · 会被无条件误用</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 space-y-1 border-t border-ink/10 pt-2 text-[11.5px] leading-relaxed text-ink-soft">
            <li>
              <b className="text-ink">D 级占了多数</b>：`deepBlockMin` / `studyDurations` / `examSprintLeadDays` /
              `mcmTotalHours` 都来自从业者经验（`deep-work` / `pomodoro` / `mcm-playbook`），**不是实证**。
              用法应为「默认档 + 可覆盖 + 标注等级」，而不是定论。
            </li>
            <li>
              <b className="text-ink">唯一 A 级且直接可用于排程的是</b> `reviewIntervalsDays`（间隔效应）——
              这也是最该先接的一个。
            </li>
            <li>
              <b className="text-ink">健康库那批都是 A/B 级</b>（睡眠 7h、每周 150 分钟、久坐 60 分钟），
              且**已有 provenance**，是四个库里质量最高的。
            </li>
            <li className="text-ink-faint">
              快照值取自 2026-09-27 的 `feat/method-kb` / `feat/health-kb`；接线后本表应改为
              直接读 <code className="font-mono">resolveAll(ctx)</code>（含 applied / reason）。
            </li>
          </ul>
        </section>

        {/* ── ⑥ 为什么你之前看不出变化 ───────────────────── */}
        <section className="panel px-5 py-4">
          <h2 className="text-[14px] font-medium">⑥ 为什么之前看不出变化</h2>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-ink-soft">
            <li>
              <b className="text-ink">阈值门</b> —— 轴落在 {GATE_LO}–{GATE_HI} 之间时，无论 36 还是 69，引擎输出完全一样。
              你现在跨过 {crossGate.length} 条；把滑杆拖到两端才会看到 ③④ 动。
            </li>
            <li>
              <b className="text-ink">最根本的一条：同一个值被用于所有情况</b> ——
              现状是 <code className="font-mono">perDay = 预算 ÷ 天数</code>，一个值发给整周每一天。
              避免扁平靠的是 <b>② 那三层乘法</b>：知识库给基线 · 画像给偏移 · 执行率给校准。
              <span className="text-ink-faint">（光接知识库会更扁平 —— 只是把"拍的固定值"换成"有出处的固定值"。）</span>
            </li>
            <li>
              <b className="text-ink">死轴</b> —— <code className="font-mono">RAT</code> 与{' '}
              <code className="font-mono">BOLD</code> 在排程代码里的消费次数是 0，怎么拖都不会有反应。
            </li>
            <li>
              <b className="text-ink">落点不对</b> —— 画像主要改「学期阶段」（适应期几周、每日目标、留白%），
              而不是周视图里块的位置。盯着周视图看，本来就看不出来。
            </li>
            <li>
              <b className="text-ink">出口太小</b> —— 正式界面只在周计划页头部显示一行参数 + 前 3 条理由，
              其余全部静默生效。
            </li>
          </ul>
        </section>

      </div>
    </div>
  );
}
