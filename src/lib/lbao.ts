import type { LifeMode, PersonaProfile, Schedule } from '@/types';
import { AXIS_META, SCENARIO_META } from '@/lib/persona';
import { ACTIVITY_TYPES, DINING_SPOTS, LIFE_MODES, STUDY_SPOTS } from '@/data/usst';
import { WEEKDAY_CN, weekdayOf } from '@/lib/date';

export interface LbaoBlock {
  icon: string;
  time: string;
  title: string;
  note: string;
  kind: 'course' | 'study' | 'meal' | 'activity' | 'rest';
}

export interface LbaoPlan {
  mode: LifeMode;
  headline: string;
  reasons: string[];
  days: { date: string; label: string; blocks: LbaoBlock[] }[];
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

function pickMode(p: PersonaProfile): LifeMode {
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

/** 某天该吃什么（结合就餐半径 + 探索度） */
function mealFor(p: PersonaProfile): LbaoBlock {
  const far = p.scenarios.meal_radius === 'far' || p.axes.EXP >= 60;
  const spot = far ? DINING_SPOTS[1] : DINING_SPOTS[0];
  return {
    icon: '🍜', time: '11:45', kind: 'meal',
    title: `午餐 · ${spot.name}`,
    note: far ? '你愿意为好吃的多走几步，去窗口多的那家逛一逛' : '40 分钟速战，就近出餐快的那家最稳',
  };
}

function studyFor(p: PersonaProfile, courseName?: string): LbaoBlock {
  const place = SCENARIO_META.study_place.values[p.scenarios.study_place] ?? '图书馆';
  const spot = STUDY_SPOTS.find((s) => s.name.includes(place === '图书馆' ? '图书馆' : place === '宿舍' ? '宿舍' : place === '咖啡馆' ? '咖啡馆' : '空教室')) ?? STUDY_SPOTS[2];
  return {
    icon: '📖', time: '19:00', kind: 'study',
    title: courseName ? `复习 / 作业 · ${courseName}` : '自习 · 自由安排',
    note: `你的自习偏好是「${place}」，建议去 ${spot.name}`,
  };
}

function activityFor(p: PersonaProfile): LbaoBlock {
  const social = p.axes.SOC >= 60;
  const broad = p.scenarios.event_breadth === 'broad';
  const act = social ? ACTIVITY_TYPES[0] : broad ? ACTIVITY_TYPES[1] : ACTIVITY_TYPES[3];
  return {
    icon: '🎯', time: '16:00', kind: 'activity',
    title: act.name,
    note: social ? '你习惯在群里喊人，约上搭子一起更热闹' : '低强度活动，一个人也能自在参与',
  };
}

function restFor(p: PersonaProfile): LbaoBlock {
  const night = p.scenarios.night_supply;
  return {
    icon: '🛋️', time: '21:30', kind: 'rest',
    title: '留白 · 回血',
    note: night === 'delivery' ? '晚自习回来可点份宵夜犒劳自己' : night === 'convenience' ? '去便利店带点小零食' : '早点休息，明天满血',
  };
}

/** 梨宝：结合课表 + 画像 + 选中日期，一键生成生活方案。
 *  @param modeId 可选——用户手动指定的生活模式（周程页选择）；缺省则按画像自动选。 */
export function lbaoRecommend(
  profile: PersonaProfile,
  schedule: Schedule,
  selectedDays: string[],
  modeId?: string | null,
): LbaoPlan {
  const autoMode = pickMode(profile);
  const mode = modeId
    ? (LIFE_MODES.find((m) => m.id === modeId) ?? autoMode)
    : autoMode;
  const reasons = [
    axisReason(profile, 'ACH'),
    axisReason(profile, mode.id === 'social' ? 'SOC' : mode.id === 'food' ? 'EXP' : mode.id === 'grind' ? 'PLAN' : mode.id === 'health' ? 'HEA' : 'RES'),
    `场景字段：${SCENARIO_META.meal_radius.label}「${SCENARIO_META.meal_radius.values[profile.scenarios.meal_radius] ?? '未设置'}」`,
  ];

  const headlineMap: Record<string, string> = {
    grind: '这周火力全开，把空余时间都留给重点课程',
    health: '稳住作息，用规律的运动和睡眠给身体充能',
    food: '每天给自己安排一顿「值得期待」的饭',
    social: '把空档留给人和活动，日子过得热闹些',
    slack: '允许自己慢下来，张弛有度才能走得远',
    balance: '保持你的节奏，学习休息两不误',
  };

  const days = selectedDays.map((date) => {
    const wd = weekdayOf(date);
    const courseDay = wd === 0 ? 7 : wd;
    const todaysCourses = schedule.courses.filter((c) => c.slots.some((s) => s.dayOfWeek === courseDay));
    const blocks: LbaoBlock[] = [];

    // 上午课程
    if (todaysCourses.length > 0) {
      const c = todaysCourses[0];
      blocks.push({
        icon: '🏫', time: '08:00', kind: 'course',
        title: `上课 · ${c.name}`,
        note: `${c.building || ''}${c.room ? ' ' + c.room : ''} · ${todaysCourses.length} 门课`,
      });
    }

    if (mode.id === 'grind') {
      const focus = todaysCourses[0];
      blocks.push(studyFor(profile, focus?.name));
      if (todaysCourses.length > 1) blocks.push(studyFor(profile, todaysCourses[1].name));
    } else if (mode.id === 'social') {
      blocks.push(activityFor(profile));
    } else if (mode.id === 'food') {
      blocks.push(mealFor(profile));
      blocks.push(restFor(profile));
    } else if (mode.id === 'health') {
      blocks.push({ icon: '🏃', time: '17:30', kind: 'activity', title: '运动 · 操场 / 体育馆', note: '你习惯按计划运动，晚饭前跑一跑最舒服' });
    } else if (mode.id === 'slack') {
      blocks.push({ icon: '🎮', time: '16:00', kind: 'rest', title: '放松 · 追剧 / 游戏 / 发呆', note: '今天不给自己加码，怎么舒服怎么来' });
    }

    blocks.push(mealFor(profile));
    blocks.push(restFor(profile));

    return { date, label: WEEKDAY_CN[wd], blocks: blocks.slice(0, 5) };
  });

  return { mode, headline: headlineMap[mode.id], reasons, days };
}
