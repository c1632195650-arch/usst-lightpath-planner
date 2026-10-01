/**
 * WP1 基础信息前置 —— 纯逻辑层测试（scripts/basicInfo.test.ts）
 * ============================================================
 * 覆盖：冷启动视图闸门（onboarded × hasBasicInfo） / 必填校验 / campus 值域 / 数字域 /
 *       宿舍禁坐标 / 草稿解析。校验实现在 src/features/welcome/basicInfo.ts
 *       （纯函数，不碰 React/storage）。
 *
 * ⚠️ 反向验证纪律：每条带「反向」注释的用例，关掉对应实现必须变红 ——
 *    实验记录见 docs/wp-ledger-v2.md §WP1。
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_DRAFT,
  initialView,
  parseBasicInfo,
  validateBasicInfo,
  type BasicInfoDraft,
} from '@/features/welcome/basicInfo';

function installStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as Record<string, unknown>).localStorage = stub;
  (globalThis as Record<string, unknown>).sessionStorage = stub;
  return store;
}

beforeEach(() => {
  installStorageStub();
});

const VALID: BasicInfoDraft = {
  ...EMPTY_DRAFT,
  nickname: '阿 C',
  grade: '2',
  college: '光电学院',
  campus: '军工路本部',
};

/* ---------------- 冷启动视图闸门 ---------------- */

test('initialView：引导走完 + 信息齐 → 直进 main；没走完 → 回欢迎页', () => {
  // 反向：把 initialView 改成恒 return 'welcome'（删掉读取）→ 本用例红
  assert.equal(
    initialView({ onboarded: true, hasBasicInfo: true }),
    'main',
    '完成过引导的用户刷新不该再回欢迎页',
  );
  assert.equal(
    initialView({ onboarded: false, hasBasicInfo: true }),
    'welcome',
    '基础信息填过、引导没走完 → 回欢迎页继续',
  );
});

test('initialView：onboarded=true 却没填过基础信息 → 落 basicinfo 补齐（RAY 报的问题）', () => {
  // 反向：删掉 `if (!gate.hasBasicInfo) return 'basicinfo'` 那条分支 → 本用例红
  assert.equal(
    initialView({ onboarded: true, hasBasicInfo: false }),
    'basicinfo',
    '老账号 / 并入的旧快照：有画像却从没填过基础信息 —— 不许被 onboarded 直接送进 main',
  );
  assert.equal(
    initialView({ onboarded: false, hasBasicInfo: false }),
    'welcome',
    '全新账号仍从欢迎页进入（「先浏览应用」捷径不受影响）',
  );
});

/* ---------------- 必填校验 ---------------- */

test('必填缺失禁下一步：四项必填逐项缺失都产出错误', () => {
  // 反向：删掉 validateBasicInfo 里任一必填检查 → 对应断言红
  const errs = validateBasicInfo(EMPTY_DRAFT);
  assert.ok(errs.nickname, '称呼必填');
  assert.ok(errs.grade, '年级必填');
  assert.ok(errs.college, '学院必填');
  assert.ok(errs.campus, '校区必填');
});

test('必填齐全 → 零错误（可下一步）', () => {
  assert.deepEqual(validateBasicInfo(VALID), {});
});

test('可选字段空着不产出错误', () => {
  assert.deepEqual(validateBasicInfo({ ...VALID, major: '', dorm: '', sleepMin: '', exercisePerWeek: '' }), {});
});

/* ---------------- campus 值域（数据红线） ---------------- */

test('campus 非法值被拒：只认 军工路本部 | 1100', () => {
  // 反向：放开 campus 校验（删掉那两行判断）→ 本用例红
  assert.ok(validateBasicInfo({ ...VALID, campus: '徐汇校区' }).campus, '值域外的校区必须被拒');
  assert.ok(validateBasicInfo({ ...VALID, campus: '' }).campus, '未选择也必须被拒');
  assert.ok(!validateBasicInfo({ ...VALID, campus: '1100' }).campus);
});

/* ---------------- 可选数字域 ---------------- */

test('sleepMin/exercisePerWeek 填了才校验，越界被拒', () => {
  assert.ok(validateBasicInfo({ ...VALID, sleepMin: '2000' }).sleepMin, '就寝 >1440 必须被拒');
  assert.ok(validateBasicInfo({ ...VALID, sleepMin: '-5' }).sleepMin);
  assert.ok(validateBasicInfo({ ...VALID, exercisePerWeek: '8' }).exercisePerWeek, '运动 >7 必须被拒');
  assert.ok(!validateBasicInfo({ ...VALID, sleepMin: '1380', exercisePerWeek: '3' }).sleepMin);
  assert.ok(!validateBasicInfo({ ...VALID, sleepMin: '1380', exercisePerWeek: '3' }).exercisePerWeek);
});

/* ---------------- 宿舍禁坐标（数据红线：落盘无 lat/lon） ---------------- */

test('dorm 收楼号文本，坐标形状一律拒收', () => {
  // 反向：删掉 COORD_RE 检查 → 本用例红
  assert.ok(validateBasicInfo({ ...VALID, dorm: '31.25, 121.5' }).dorm, '坐标必须被拒');
  assert.ok(validateBasicInfo({ ...VALID, dorm: '121.505' }).dorm, '带 3 位小数的数字视为坐标');
  assert.ok(!validateBasicInfo({ ...VALID, dorm: '五公寓 302' }).dorm);
});

/* ---------------- 草稿解析 ---------------- */

test('parseBasicInfo：只收合法字段，非法/空字段不落盘', () => {
  const info = parseBasicInfo({ ...VALID, grade: '大二', major: '光电信息', dorm: '五公寓', sleepMin: '1380', exercisePerWeek: '3' });
  assert.deepEqual(info, {
    nickname: '阿 C',
    grade: 2,
    college: '光电学院',
    major: '光电信息',
    campus: '军工路本部',
    dorm: '五公寓',
    sleepMin: 1380,
    exercisePerWeek: 3,
  });
});

test('parseBasicInfo：非法输入（坏年级/坏校区/坐标宿舍）不产生对应字段', () => {
  const info = parseBasicInfo({ ...VALID, grade: '研一', campus: '徐汇校区', dorm: '121.505' });
  assert.equal(info.grade, undefined, '解析不了的年级不许猜');
  assert.equal(info.campus, undefined);
  assert.equal(info.dorm, undefined);
  assert.ok(info.nickname && info.college, '合法字段照常收');
});

/* ---------------- 接线 B（三线融合 2026-10-01）：未导入课表 → 落「导入课表」 ----------------
 * MOCK_SCHEDULE 降级为演示兜底，不再是默认落点；引导齐了却从没导入过真实课表的
 * 冷启动（老账号 / 并入快照 / 换号）落 import 页引导「从教务系统导出 PDF 上传」。
 * 反向验证：删掉 `if (gate.hasSchedule === false) return 'import'` 分支 → 本用例红；
 * 把引用判别改回只比真值 → App.tsx 侧 v3 用例红（hasRealSchedule 的定义被钉在源码锁里）。 */
test('initialView：引导齐了但没导入过真实课表 → 落 import 引导上传（接线 B）', () => {
  // hasSchedule 缺省 = 视为已导入（不强行拦人），老调用方行为零变化
  assert.equal(
    initialView({ onboarded: true, hasBasicInfo: true }),
    'main',
    '不传 hasSchedule 时维持原三输入行为',
  );
  assert.equal(
    initialView({ onboarded: true, hasBasicInfo: true, hasSchedule: false }),
    'import',
    '引导齐了、只有 MOCK 兜底 → 落导入页引导上传',
  );
  assert.equal(
    initialView({ onboarded: true, hasBasicInfo: true, hasSchedule: true }),
    'main',
    '有真实课表 → 直进 main',
  );
  assert.equal(
    initialView({ onboarded: false, hasBasicInfo: true, hasSchedule: false }),
    'welcome',
    '引导没走完仍优先回欢迎页（导入分支不抢在引导之前）',
  );
});
