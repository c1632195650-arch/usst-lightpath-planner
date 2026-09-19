/**
 * 梨宝生活方案的**展示模型**与**画像侧口吻**
 * ============================================================
 * 这里曾经还有一套「规则模板引擎」`lbaoRecommend()`：它用硬编码时段
 * （08:00 / 11:45 / 19:00 …）拼出一份「建议」，与真正的排程引擎**各说各的**。
 * 同一个页面因此可能给出两套口径不同的答案 —— 这就是项目里说的「双轨」。
 *
 * 现在那份模板已经删除（2026-09-19），职责切干净：
 *   · **本文件**：类型 + 与排程无关的那一半 —— 取哪个生活模式、头条说什么、依据是什么；
 *   · **`features/libao/lbaoPlanFromEngine.ts`**：把引擎算出的 `WeekPlan` 转成展示模型。
 * 于是「块从哪来」只有一个答案：**引擎**。
 *
 * 为什么保留模式/口吻这一半：它由**画像**决定，与排程无关；
 * 引擎不知道「你更喜欢哪种生活节奏」，那是用户自己的选择（见项目记忆 §1 的智能边界）。
 */
import type { LifeMode, PersonaProfile } from '@/types';
import { AXIS_META, SCENARIO_META } from '@/lib/persona';
import { LIFE_MODES } from '@/data/usst';

/** `LbaoPlanView` 的渲染单位（一个卡片） */
export interface LbaoBlock {
  icon: string;
  time: string;
  title: string;
  note: string;
  kind: 'course' | 'study' | 'meal' | 'activity' | 'rest';
}

/** 生活方案的展示模型 */
export interface LbaoPlan {
  mode: LifeMode;
  headline: string;
  reasons: string[];
  days: { date: string; label: string; blocks: LbaoBlock[] }[];
}

/** 与排程无关的那一半：模式 + 口吻 + 依据。块的内容一律由引擎提供 */
export interface LbaoShell {
  mode: LifeMode;
  headline: string;
  reasons: string[];
}

/** 按画像给每种生活模式打分，取最高 */
function scoreModes(p: PersonaProfile): Record<string, number> {
  const a = p.axes;
  return {
    grind: 0.5 * a.ACH + 0.3 * a.PLAN + 0.2 * a.RES,
    health: 0.6 * a.HEA + 0.4 * a.PLAN,
    food: 0.5 * a.EXP + 0.3 * a.SOC + 0.2 * (100 - a.ACH),
    social: 0.6 * a.SOC + 0.4 * a.EXP,
    slack: 0.5 * (100 - a.RES) + 0.3 * (100 - a.PLAN) + 0.2 * a.BOLD,
    balance: 0.4 * a.RES + 0.4 * a.PLAN + 0.2 * a.HEA,
  };
}

/** 由画像自动选出最贴合的生活模式（导出供测试与别处复用） */
export function pickMode(p: PersonaProfile): LifeMode {
  const scores = scoreModes(p);
  const best = Object.entries(scores).sort((x, y) => y[1] - x[1])[0][0];
  return LIFE_MODES.find((m) => m.id === best) ?? LIFE_MODES[0];
}

function axisReason(p: PersonaProfile, key: keyof typeof AXIS_META): string {
  const v = p.axes[key];
  const m = AXIS_META[key];
  const level = v >= 65 ? '偏高' : v <= 40 ? '偏低' : '中等';
  return `${m.label} ${level}（${Math.round(v)}）`;
}

/** 每种模式的开场白 —— 说的是「这周打算怎么过」，不是「几点做什么」 */
const HEADLINES: Record<string, string> = {
  grind: '这周火力全开，把空余时间都留给重点课程',
  health: '稳住作息，用规律的运动和睡眠给身体充能',
  food: '每天给自己安排一顿「值得期待」的饭',
  social: '把空档留给人和活动，日子过得热闹些',
  slack: '允许自己慢下来，张弛有度才能走得远',
  balance: '保持你的节奏，学习休息两不误',
};

/**
 * 画像 → 生活方案的「外壳」（模式 + 开场白 + 依据）。
 *
 * @param modeId 用户手动指定的生活模式（周程页选择）；缺省按画像自动选。
 */
export function lbaoShell(profile: PersonaProfile, modeId?: string | null): LbaoShell {
  const autoMode = pickMode(profile);
  const mode = modeId
    ? (LIFE_MODES.find((m) => m.id === modeId) ?? autoMode)
    : autoMode;

  const focusAxis = mode.id === 'social' ? 'SOC'
    : mode.id === 'food' ? 'EXP'
      : mode.id === 'grind' ? 'PLAN'
        : mode.id === 'health' ? 'HEA'
          : 'RES';

  const reasons = [
    axisReason(profile, 'ACH'),
    axisReason(profile, focusAxis),
    `场景字段：${SCENARIO_META.meal_radius.label}「${
      SCENARIO_META.meal_radius.values[profile.scenarios.meal_radius] ?? '未设置'}」`,
  ];

  return { mode, headline: HEADLINES[mode.id] ?? '', reasons };
}
