/**
 * 梨宝改动（路线 A / B / C0 / C2）的回归测试
 * ============================================================
 * 重点覆盖**此前完全没被测到**的东西：
 *   - 用户档案摘要的内容与边界（路线 B）
 *   - 排程要点的人话口径（路线 C2）
 *
 * 不覆盖：`lib/api.ts` 的请求体（需起后端）、`LbaoChat.tsx` 的交互（需 DOM）。
 * 那两处的验证方式写在 PR 说明里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileContext } from '@/features/libao/profileContext';
import { summarizeWeekPlan } from '@/features/libao/weekPlanForChat';
import { MOCK_SCHEDULE } from '@/data/usst';
import type { PersonaProfile, WeekPlan } from '@/types';

/** 固定日期：2026-09-15 是周二，相对 MOCK 课表的 termStart(2026-08-31) 属第 3 周 */
const TODAY = '2026-09-15';

const profile = {
  version: '1.0',
  scoreVersion: '1.0',
  axes: { EXP: 72, PLAN: 41, SOC: 68, RES: 55, ACH: 80, HEA: 30, RAT: 62, BOLD: 47 },
  traits: { E: 55, C: 60, ES: 50, O: 65, A: 50 },
  motives: { ACH: 70, SOC: 60, HEA: 35, EXP: 65, STA: 50 },
  scenarios: {
    meal_radius: 'far',
    planning: 'flexible',
    event_breadth: 'broad',
    social_radius: 'wide',
    night_supply: 'delivery',
    exercise_trigger: 'self_plan',
    study_place: 'library',
    info_channel: 'self_search',
  },
  archetype: { primary: null, secondary: null, distance: 0 },
  confidence: {},
  quality: 'ok',
  updatedAt: TODAY,
} as unknown as PersonaProfile;

/* ---------------- 路线 B：档案摘要 ---------------- */

test('画像与课表都为空 → 返回空串，后端据此跳过注入', () => {
  assert.equal(buildProfileContext(null, null, TODAY), '');
});

test('只有课表时也能给出摘要（不依赖画像）', () => {
  const ctx = buildProfileContext(null, MOCK_SCHEDULE, TODAY);
  assert.match(ctx, /【本周课表】/);
  assert.match(ctx, /【学期】/);
  assert.doesNotMatch(ctx, /【画像】/);
});

test('课表按天聚合，带周次与教室', () => {
  const ctx = buildProfileContext(null, MOCK_SCHEDULE, TODAY);
  assert.match(ctx, /第 3 周/);
  assert.match(ctx, /周一 /);
  assert.match(ctx, /节/); // 含「1-2节」这类节次标注
});

test('有画像时输出 8 轴与生活偏好', () => {
  const ctx = buildProfileContext(profile, MOCK_SCHEDULE, TODAY);
  assert.match(ctx, /【画像】/);
  assert.match(ctx, /【生活偏好】/);
  // 8 轴全在（用 short 名）
  for (const short of ['探索', '计划', '社交', '韧性', '成就', '健康', '理性', '敢度']) {
    assert.ok(ctx.includes(short), `缺少轴：${short}`);
  }
});

test('不携带可识别个人信息的形态（与后端 desensitize 的规则对齐）', () => {
  const ctx = buildProfileContext(profile, MOCK_SCHEDULE, TODAY);
  assert.doesNotMatch(ctx, /1[3-9]\d{9}/);      // 手机号
  assert.doesNotMatch(ctx, /20\d{11}/);          // 学号
  assert.doesNotMatch(ctx, /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/); // 邮箱
});

test('长度不超过后端截断阈值 —— 否则被切掉的正好是最有用的课表段', () => {
  const ctx = buildProfileContext(profile, MOCK_SCHEDULE, TODAY);
  assert.ok(ctx.length > 0);
  assert.ok(ctx.length <= 1200, `实际 ${ctx.length} 字符`);
});

test('周次变化时课表内容随之变化（不是照搬整学期）', () => {
  // MOCK 课表的 weeks 为空数组 = 全学期，故两周都应列出课；
  // 关键是「周次」这一行必须跟着走 —— 否则「第几周」就是假的。
  const w1 = buildProfileContext(null, MOCK_SCHEDULE, '2026-09-01');
  const w5 = buildProfileContext(null, MOCK_SCHEDULE, '2026-09-29');
  assert.match(w1, /第 1 周/);
  assert.match(w5, /第 5 周/);
});

/* ---------------- 路线 C2：排程要点 ---------------- */

function fakePlan(over: Partial<WeekPlan['stats']> = {}, issues: WeekPlan['issues'] = []): WeekPlan {
  return {
    weekNo: 1,
    blocks: [
      { id: 'b1', kind: 'course', dayOfWeek: 1, startMin: 480, endMin: 520, title: '课', source: 'course' },
      { id: 'b2', kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660, title: '自习', source: 'template' },
    ],
    stats: { courseMin: 40, studyMin: 60, blankMin: 700, blockCount: 2, ...over },
    issues,
  } as unknown as WeekPlan;
}

test('要点报**日均**留白而非总时长（一周 63h 那种数字会被误读成系统没干活）', () => {
  const lines = summarizeWeekPlan(fakePlan({ blankMin: 3800 }));
  const joined = lines.join('\n');
  assert.match(joined, /日均留白/);
  assert.doesNotMatch(joined, /留白 63/);
});

test('要点会指出哪天最满', () => {
  const lines = summarizeWeekPlan(fakePlan());
  assert.ok(lines.some((l) => l.includes('周一')));
});

test('没有紧张项时明确说「余量安全」，而不是留空', () => {
  const lines = summarizeWeekPlan(fakePlan());
  assert.ok(lines.some((l) => l.includes('安全范围')));
});

test('有紧张项时如实引用引擎的判定', () => {
  const lines = summarizeWeekPlan(fakePlan({}, [
    { level: 'warn', message: '第三教学楼 → 第一教学楼 余量只剩 2 分钟' },
  ]));
  assert.ok(lines.some((l) => l.includes('余量只剩 2 分钟')));
});
