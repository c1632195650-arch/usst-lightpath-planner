/**
 * 基础信息前置（v2 方案 WP1）—— 纯逻辑层
 * =====================================
 * 组件（BasicInfoStep.tsx）与测试（scripts/basicInfo.test.ts）共用这里：
 *  · `initialView`：冷启动视图闸门 —— onboarded=true 才直进 main（App.tsx :39 消费）；
 *  · `validateBasicInfo`：必填 + 值域校验，必填缺失禁「下一步」；
 *  · `parseBasicInfo`：草稿 → BasicInfo（只收合法字段）。
 * 本文件不碰 localStorage、不 import React —— 保持 node --test 可直跑。
 */
import { gradeFromLabel, type BasicInfo, type Campus, type Grade } from '@/lib/identity';

/** 表单草稿：全部字符串（受控输入的原生形态） */
export interface BasicInfoDraft {
  nickname: string;
  grade: string; // '1'..'4'（select 值）或「大二」式标签
  college: string;
  major: string;
  campus: string; // '军工路本部' | '1100'，未选为 ''
  dorm: string;
  sleepMin: string;
  exercisePerWeek: string;
}

export const EMPTY_DRAFT: BasicInfoDraft = {
  nickname: '',
  grade: '',
  college: '',
  major: '',
  campus: '',
  dorm: '',
  sleepMin: '',
  exercisePerWeek: '',
};

export type BasicInfoErrors = Partial<Record<keyof BasicInfoDraft, string>>;

/** 宿舍只收楼号文本；带 2 位以上小数的数字一律视为坐标拒收（数据红线：落盘无 lat/lon） */
const COORD_RE = /[+-]?\d+\.\d{2,}/;

export function validateBasicInfo(d: BasicInfoDraft): BasicInfoErrors {
  const errors: BasicInfoErrors = {};
  // —— 必填四项 ——
  if (!d.nickname.trim()) errors.nickname = '先告诉我们怎么称呼你';
  if (!d.college.trim()) errors.college = '学院是必填项';
  if (!gradeFromLabel(d.grade)) errors.grade = '请选择年级（大一到大四）';
  if (d.campus !== '军工路本部' && d.campus !== '1100') errors.campus = '请选择校区（军工路本部或 1100）';
  // —— 可选项：填了才校验值域 ——
  if (d.sleepMin.trim()) {
    const n = Number(d.sleepMin);
    if (!Number.isInteger(n) || n < 0 || n > 1440) errors.sleepMin = '就寝时间填 0-1440 的分钟数';
  }
  if (d.exercisePerWeek.trim()) {
    const n = Number(d.exercisePerWeek);
    if (!Number.isInteger(n) || n < 0 || n > 7) errors.exercisePerWeek = '每周运动填 0-7 次';
  }
  if (d.dorm.trim() && COORD_RE.test(d.dorm)) errors.dorm = '宿舍只填楼号文本，不要填坐标';
  return errors;
}

/** 草稿 → BasicInfo：只收合法字段，可选项空 = 不写（不给落盘留垃圾） */
export function parseBasicInfo(d: BasicInfoDraft): BasicInfo {
  const out: BasicInfo = {};
  const nickname = d.nickname.trim();
  if (nickname) out.nickname = nickname;
  const grade: Grade | null = gradeFromLabel(d.grade);
  if (grade) out.grade = grade;
  const college = d.college.trim();
  if (college) out.college = college;
  const major = d.major.trim();
  if (major) out.major = major;
  if (d.campus === '军工路本部' || d.campus === '1100') out.campus = d.campus as Campus;
  const dorm = d.dorm.trim();
  if (dorm && !COORD_RE.test(dorm)) out.dorm = dorm;
  if (d.sleepMin.trim()) {
    const n = Number(d.sleepMin);
    if (Number.isInteger(n) && n >= 0 && n <= 1440) out.sleepMin = n;
  }
  if (d.exercisePerWeek.trim()) {
    const n = Number(d.exercisePerWeek);
    if (Number.isInteger(n) && n >= 0 && n <= 7) out.exercisePerWeek = n;
  }
  return out;
}

/** 冷启动视图闸门：完整走完引导（含画像）才有 onboarded=true → 直进 main；
 *  否则一律从欢迎页开始。App.tsx 的 useState 初始化器消费这里。 */
export function initialView(onboarded: boolean): 'main' | 'welcome' {
  return onboarded ? 'main' : 'welcome';
}
