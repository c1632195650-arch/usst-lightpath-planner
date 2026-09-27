/**
 * H2 ModeSetupDialog —— 模式干跑模型测试（scripts/modeSetup.test.ts）
 * ============================================================
 * modePreview 走 construct 同步干跑（真引擎，非 mock）；六模式各出预览，
 * 同输入同输出；sport/snack 的模式语义落到 stats。
 *
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §H2）：
 *   RV1 ← modePreview 去掉 lifeModeExtras 注入 → sport/snack 用例红
 *   RV2 ← 干跑 try/catch 删掉 → error 分支用例红（且会真抛异常）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODE_OPTIONS,
  modePreview,
  modeSetupRequest,
} from '@/features/libao/modeSetup';
import { MOCK_SCHEDULE } from '@/data/usst';

const weekNo = 5;

test('H2: 模式卡元数据 = 六模式（含改名后的新 id）', () => {
  assert.deepEqual(
    MODE_OPTIONS.map((m) => m.id).sort(),
    ['balance', 'faraway', 'grind', 'mine', 'snack', 'sport'],
  );
});

test('H2: 基准请求可构造（校历链命中第 5 周）', () => {
  const req = modeSetupRequest(MOCK_SCHEDULE, null, weekNo);
  assert.ok(req, '第 5 周在学期范围内，请求不该为 null');
  assert.equal(req!.weekNo, weekNo);
});

test('H2: 六模式干跑各出 plan，两次调用完全一致（确定性）', () => {
  // 反向：modePreview 去掉 lifeModeExtras 注入 → sport/snack 两条用例红
  const req = modeSetupRequest(MOCK_SCHEDULE, null, weekNo)!;
  for (const m of MODE_OPTIONS) {
    const a = modePreview(req, m.id);
    const b = modePreview(req, m.id);
    assert.ok(!('error' in a), `${m.id} 干跑不该报错：${'error' in a ? a.error : ''}`);
    assert.deepEqual(a, b, `${m.id} 同输入必得同输出`);
    assert.ok(a.plan.blocks.length > 0, `${m.id} 预览得有块`);
  }
});

test('H2: sport 模式 sportCount=4（WP5 配额语义落到统计）', () => {
  const req = modeSetupRequest(MOCK_SCHEDULE, null, weekNo)!;
  const r = modePreview(req, 'sport');
  assert.ok(!('error' in r));
  assert.equal(r.stats.sportCount, 4, '运动模式每周四次锻炼');
  assert.equal(r.stats.studyHours < 24, true, 'studyMul 0.9 → 学习量低于均衡');
});

test('H2: snack 模式 extraMealCount≥1（下午茶/夜宵窗口）', () => {
  const req = modeSetupRequest(MOCK_SCHEDULE, null, weekNo)!;
  const r = modePreview(req, 'snack');
  assert.ok(!('error' in r));
  assert.ok(r.stats.extraMealCount >= 1, '小馋猫模式至少排出一餐加餐');
});

test('H2: faraway 模式 blankHours > 0（自由格实体化）', () => {
  const req = modeSetupRequest(MOCK_SCHEDULE, null, weekNo)!;
  const r = modePreview(req, 'faraway');
  assert.ok(!('error' in r));
  assert.ok(r.stats.blankHours > 0, '远方模式把大空档实体化成 blank 块');
});

test('H2: 干跑异常 → error 分支（调用方降级不白屏）', () => {
  // 反向：删掉 modePreview 的 try/catch → 本用例红（且直接抛异常）
  const req = modeSetupRequest(MOCK_SCHEDULE, null, weekNo)!;
  const broken = { ...req, schedule: undefined } as unknown as typeof req;
  const r = modePreview(broken, 'balance');
  assert.ok('error' in r, '坏请求必须走 error 分支而不是抛出');
  assert.ok(r.error.length > 0);
});

test('H2: 越界周次 → 基准请求为 null（调用方不渲染对话框内容）', () => {
  assert.equal(modeSetupRequest(MOCK_SCHEDULE, null, 99), null);
});
