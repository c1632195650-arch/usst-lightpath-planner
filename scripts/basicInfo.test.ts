/**
 * WP1 基础信息前置 —— 纯逻辑层测试（scripts/basicInfo.test.ts）
 * ============================================================
 * 覆盖：冷启动视图闸门（onboarded） / 必填校验 / campus 值域 / 数字域 / 宿舍禁坐标 /
 *       草稿解析。校验实现在 src/features/welcome/basicInfo.ts（纯函数，不碰 React/storage）。
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

test('initialView：onboarded=true 冷启动直进 main，false 回欢迎页', () => {
  // 反向：把 initialView 改成恒 return 'welcome'（删掉 onboarded 读取）→ 本用例红
  assert.equal(initialView(true), 'main', '完成过引导的用户刷新不该再回欢迎页');
  assert.equal(initialView(false), 'welcome');
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
