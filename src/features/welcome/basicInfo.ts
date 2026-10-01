/**
 * 基础信息前置（v2 方案 WP1）—— 纯逻辑层
 * =====================================
 * 组件（BasicInfoStep.tsx）与测试（scripts/basicInfo.test.ts）共用这里：
 *  · `initialView`：冷启动视图闸门 —— 缺基础信息先补、画像没完回欢迎页、
 *    都齐了才直进 main（App.tsx 的组合根消费）；
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

/**
 * 冷启动视图闸门的输入（都是布尔，纯函数层不读存储 —— 由组合根现算后注入）。
 *  · `onboarded`    —— AppState 里「引导是否走完（含画像）」；
 *  · `hasBasicInfo` —— 是否**提交过基础信息**（`usst.libao.basic_info` 有必填四项）；
 *  · `hasSchedule`  —— 是否**导入过真实课表**（三线融合 2026-10-01 新增，接线 B）。
 *    判别口径沿用 beta-v2 V0-2 的**引用判别**：`state.schedule && state.schedule !== MOCK_SCHEDULE`
 *    —— MOCK 演示兜底不算「已有课表」。缺省 true（调用方没给就当有，不强行拦人去导入）。
 *
 * 为什么三者都要：`onboarded` 单独一条不足以决定落点。老数据 / 「并入旧账号」
 * 的场景里 `onboarded=true` 但 `basic_info` 从没写过（那一步是后加的），
 * 于是会被 `onboarded` 直接送进 main —— 用户就再也见不到基础信息界面。
 * `hasSchedule` 则把「引导都齐了、但一台真实课表都没有」的冷启动也接住：
 * 引导用户「从教务系统导出 PDF 上传」，MOCK_SCHEDULE 降级为演示兜底而非默认落点。
 */
export interface OnboardingGate {
  onboarded: boolean;
  hasBasicInfo: boolean;
  /** 未导入过真实课表 → 落「导入课表」页引导上传（接线 B，2026-10-01）。缺省视为已导入。 */
  hasSchedule?: boolean;
}

/**
 * 冷启动视图闸门（App.tsx 的 useState 初始化器消费这里）：
 *  ① 引导没走完 → 回欢迎页（首次入口不变，「先浏览应用」这条捷径也不受影响）；
 *  ② 引导走完了、却**从没填过基础信息** → 落 `basicinfo` 补齐。
 *     这一条是为「老账号 / 并入的旧快照」准备的：`onboarded` 是后加的引导步之前
 *     就存在的字段，所以完全可能出现「有画像、有 onboarded，却没有基础信息」，
 *     旧闸门只看 `onboarded` 会把这种人直接放进 main —— 基础信息界面再也见不到；
 *  ③ 都齐了、但**从没导入过真实课表** → 落 `import` 引导上传（接线 B）；
 *  ④ 都齐了 → 直进 main。
 */
export function initialView(gate: OnboardingGate): 'main' | 'welcome' | 'basicinfo' | 'import' {
  if (!gate.onboarded) return 'welcome';
  if (!gate.hasBasicInfo) return 'basicinfo';
  if (gate.hasSchedule === false) return 'import';
  return 'main';
}
