/**
 * 光溯移动端 E2E 冒烟（M2 · 方案 §7.4）
 * ============================================================
 * 视口 390×844（Mate 40E 量级）。流程：
 *   打开 /m.html → 注册 → 云端演示状态注入（route 桩）→ 本地重算 → 今日块渲染
 *   → F5 横幅 / F7 明日 / F10 本周 / F6 ICS 节点存在
 *   → 点块 → EditSheet 顺延 +15 → 覆盖层 localStorage 断言 + PUT state 请求体断言
 *   → 完成勾选 → 覆盖层 done 断言
 *
 * 网络层用 page.route 打桩（GUI 是真实的、后端契约由 _smoke_*_api.py 用真实
 * SQLite+TestClient 覆盖，约束文档 §4.3 的分工口径）：night 起后端属禁区，
 * 这里桩掉 /api/* 才能在「不起常驻服务」前提下跑真实浏览器闭环。
 */
import { test, expect, type Page } from '@playwright/test';

/** 与 M1 冒烟同款演示课表：termStart=2026-09-07（周一），周六 1-2 节高数（全学期） */
const DEMO_SCHEDULE = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: '2026-09-07',
  totalWeeks: 20,
  source: 'demo',
  courses: [
    {
      id: 'c1',
      name: '高等数学AI',
      teacher: '王老师',
      credit: 4,
      category: '公共基础',
      campus: 'main',
      slots: [{ dayOfWeek: 6, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] }],
    },
  ],
};

const EMPTY_LAYER = {
  schemaVersion: 2,
  tasks: [], excluded: [], moves: [], slots: [],
  courseOverrides: [], mealPlaces: {}, assignments: [],
};

async function stubApi(page: Page) {
  const putStateBodies: Array<Record<string, unknown>> = [];
  const putPlanBodies: Array<Record<string, unknown>> = [];
  const nowIso = () => new Date().toISOString();

  await page.route('**/api/auth/register', (route) =>
    route.fulfill({ json: { userId: 7, token: 'e2e-token', icsToken: 'ics-e2e-token' } }));
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ json: { userId: 7, token: 'e2e-token', icsToken: 'ics-e2e-token' } }));

  await page.route('**/api/sync/state', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      putStateBodies.push(req.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { accepted: true, updatedAt: nowIso() } });
      return;
    }
    await route.fulfill({
      json: {
        found: true,
        schemaVer: 1,
        updatedAt: nowIso(),
        state: {
          schemaVer: 1,
          termStart: '2026-09-07',
          weekNo: 4,
          schedule: DEMO_SCHEDULE,
          planState: null,
          userOverrides: EMPTY_LAYER,
          clientUpdatedAt: nowIso(),
        },
      },
    });
  });

  await page.route('**/api/sync/plan*', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      putPlanBodies.push(req.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { updatedAt: nowIso() } });
      return;
    }
    await route.fulfill({ json: { found: false, plan: null, updatedAt: null } });
  });

  // 转场批量问路：桩空 routes → 引擎走兜底估算（其既有降级路径）
  await page.route('**/api/route/batch*', (route) => route.fulfill({ json: { routes: {} } }));
  // F18：没有版本信息 → 不出更新横幅
  await page.route('**/api/version', (route) => route.fulfill({ status: 404, json: { error: 'version_unavailable' } }));

  return { putStateBodies, putPlanBodies };
}

test('移动今日页闭环：注册 → 今日块渲染 → 顺延/完成写覆盖层 → PUT 上报', async ({ page }) => {
  const { putStateBodies, putPlanBodies } = await stubApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/m.html');

  // F1 注册（新建账号路径）
  await page.getByTestId('m-login-user').fill('端到端宝');
  await page.getByTestId('m-login-pass').fill('e2e-pass-123');
  await page.getByTestId('m-register-submit').click();

  // F2 今日时间轴渲染（本地重算成功 = 课表块出现）
  await expect(page.getByTestId('m-today-list')).toBeVisible({ timeout: 30_000 });
  const firstBlock = page.getByTestId('m-block').first();
  await expect(firstBlock).toBeVisible({ timeout: 30_000 });
  const blockId = await firstBlock.getAttribute('data-block-id');
  expect(blockId, '块 id 必须存在（语义键）').toBeTruthy();
  await expect(page.getByTestId('m-block-title').first()).toContainText(/./);

  // F5 「现在」横幅（进行中 / 下一块 / 收工 三态其一）
  await expect(page.getByTestId('m-now-banner').or(page.getByTestId('m-next-banner'))).toBeVisible();
  // F7 / F10 节点
  await expect(page.getByTestId('m-tomorrow')).toBeVisible();
  await expect(page.getByTestId('m-week-glance')).toBeVisible();

  // F6 ICS 引导：展开 → 链接含 icsToken → 复制按钮可点
  await page.getByTestId('m-ics').getByRole('button').first().click();
  await expect(page.getByTestId('m-ics-url')).toHaveValue(/\/api\/sync\/plan\.ics\?token=ics-e2e-token/);
  await expect(page.getByTestId('m-ics-copy')).toBeVisible();

  // F17 白名单引导：展开 → 三家机型路径渲染
  await page.getByTestId('m-whitelist-toggle').click();
  await expect(page.getByTestId('m-whitelist-guide')).toContainText('华为 / 鸿蒙');
  await expect(page.getByTestId('m-whitelist-guide')).toContainText('小米 / Redmi');
  await expect(page.getByTestId('m-whitelist-guide')).toContainText('重启后提醒排程会清空');

  // F4 顺延 +15：写覆盖层（唯一写法）→ debounce 上报
  await firstBlock.click();
  await expect(page.getByTestId('m-edit-sheet')).toBeVisible();
  await page.getByTestId('m-shift-15').click();
  const layerRaw1 = await page.evaluate(() => localStorage.getItem('usst-user-plan-v1'));
  const layer1 = JSON.parse(layerRaw1 ?? '{}');
  const move = (layer1.moves as Array<Record<string, unknown>>).find((m) => m.blockId === blockId);
  expect(move, '顺延必须落覆盖层 moves').toBeTruthy();
  expect(move?.source).toBe('edit');

  // debounce 1s → PUT /api/sync/state 请求体必须带上这条 move 与 clientUpdatedAt
  await expect.poll(async () => putStateBodies.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const stateBody = putStateBodies[0] as {
    clientUpdatedAt: string;
    state: { schemaVer: number; termStart: string; userOverrides: { moves: Array<Record<string, unknown>> } };
  };
  expect(stateBody.clientUpdatedAt).toBeTruthy();
  // schemaVer=2：2026-10-06 契约扩展（commit 5884027，todos/goals/persona 上车）后的正确口径
  expect(stateBody.state.schemaVer).toBe(2);
  expect(stateBody.state.termStart).toBe('2026-09-07');
  expect(stateBody.state.userOverrides.moves.some((m) => m.blockId === blockId)).toBe(true);
  // PUT /api/sync/plan（整周副本，仅 ICS 素材）
  await expect.poll(async () => putPlanBodies.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const planBody = putPlanBodies[0] as { plan: { weekNo: number; blocks: unknown[] } };
  expect(planBody.plan.blocks.length).toBeGreaterThan(0);

  // F4 完成勾选：done 落覆盖层
  await firstBlock.click();
  await page.getByTestId('m-edit-done').click();
  const layer2 = JSON.parse(await page.evaluate(() => localStorage.getItem('usst-user-plan-v1') ?? '{}'));
  const move2 = (layer2.moves as Array<Record<string, unknown>>).find((m) => m.blockId === blockId);
  expect(move2?.done).toBe(true);
  // 卡片上出现「已完成」标记（读取处向后兼容的可见面）
  await expect(firstBlock.getByTestId('m-block-done')).toBeVisible();
});

test('移动空态：云端没计划时给引导（F2 空态分支）', async ({ page }) => {
  await page.route('**/api/auth/register', (route) =>
    route.fulfill({ json: { userId: 8, token: 'e2e-token-2', icsToken: null } }));
  await page.route('**/api/sync/state', (route) => route.fulfill({ json: { found: false, state: null, schemaVer: 1, updatedAt: null } }));
  await page.route('**/api/version', (route) => route.fulfill({ status: 404, json: { error: 'version_unavailable' } }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/m.html');
  await page.getByTestId('m-login-user').fill('空空如也');
  await page.getByTestId('m-login-pass').fill('e2e-pass-123');
  await page.getByTestId('m-register-submit').click();
  await expect(page.getByTestId('m-empty-cloud')).toBeVisible({ timeout: 15_000 });
});

/* ==================== Second 夜批（2026-10-06）：e2e 2 → ≥8 的补充用例 ====================
   原则：只依赖既有 testid（红线：一个都不许删），网络层照旧 page.route 打桩；
   与并行批次的 TodayPage 三区重构解耦——不依赖新组件，只锁「跨重构必须存活」的行为。 */

/** 打开移动页并完成注册（复用 stubApi 的演示课表），返回时处于 ready 态 */
async function registerAndReady(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/m.html');
  await page.getByTestId('m-login-user').fill('补充用例宝');
  await page.getByTestId('m-login-pass').fill('e2e-pass-123');
  await page.getByTestId('m-register-submit').click();
  await expect(page.getByTestId('m-today-list')).toBeVisible({ timeout: 30_000 });
}

test('移动登录路径：老账号登录（非注册）→ 今日页正常渲染', async ({ page }) => {
  await stubApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/m.html');
  await page.getByTestId('m-login-user').fill('老用户宝');
  await page.getByTestId('m-login-pass').fill('e2e-pass-123');
  await page.getByTestId('m-login-submit').click();
  await expect(page.getByTestId('m-today-list')).toBeVisible({ timeout: 30_000 });
  // 周次以页面按 termStart 实算为准（2026-10-06 实算 = 第 5 周；桩里的 weekNo:4 只是云端缓存值）
  await expect(page.getByTestId('m-weekno')).toContainText(/第 \d+ 周/);
  await expect(page.getByTestId('m-tomorrow')).toBeVisible();
});

test('移动登录失败：密码错 → 页内报错文案，不进今日页', async ({ page }) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 401, json: { error: 'bad_credentials' } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/m.html');
  await page.getByTestId('m-login-user').fill('输错密码的宝');
  await page.getByTestId('m-login-pass').fill('wrong-pass');
  await page.getByTestId('m-login-submit').click();
  await expect(page.getByTestId('m-login-error')).toContainText('昵称或密码不对');
  await expect(page.getByTestId('m-today-list')).toHaveCount(0);
});

test('F18 检查更新：服务端版本更新 → 出下载横幅（有新版本）', async ({ page }) => {
  await stubApi(page);
  // 后注册的 route 优先：覆盖 stubApi 里的 404 版本桩
  await page.route('**/api/version', (route) =>
    route.fulfill({ json: { version: '9.9.9', apkUrl: 'http://example.com/lightpath-9.9.9.apk' } }));
  await registerAndReady(page);
  await expect(page.getByTestId('m-update')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('m-update').getByRole('link')).toHaveAttribute('href', /lightpath-9\.9\.9\.apk$/);
});

test('F9 变化标记：云端覆盖层变了 → 再次打开出「今天的安排有更新」', async ({ page }) => {
  await stubApi(page);
  let extraMoves: Array<Record<string, unknown>> = [];
  // 后注册的 route 优先：GET /api/sync/state 带上 extraMoves（初始为空）
  await page.route('**/api/sync/state', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      await route.fulfill({ json: { accepted: true, updatedAt: new Date().toISOString() } });
      return;
    }
    await route.fulfill({
      json: {
        found: true,
        schemaVer: 1,
        updatedAt: new Date().toISOString(),
        state: {
          schemaVer: 1,
          termStart: '2026-09-07',
          weekNo: 4,
          schedule: DEMO_SCHEDULE,
          planState: null,
          userOverrides: { ...EMPTY_LAYER, moves: extraMoves },
          clientUpdatedAt: new Date().toISOString(),
        },
      },
    });
  });
  await registerAndReady(page);
  const blockId = await page.getByTestId('m-block').first().getAttribute('data-block-id');
  expect(blockId).toBeTruthy();
  // 覆盖层按「weekNo + blockId」匹配（applyLayerToBlocks），周次必须用页面实算值
  const weekNoText = await page.getByTestId('m-weekno').innerText();
  const realWeekNo = Number(/第 (\d+) 周/.exec(weekNoText)?.[1] ?? 0);
  expect(realWeekNo).toBeGreaterThan(0);

  // 云端「别人改了计划」：把这块标记完成（done 位进今日签名 → 必有差异）
  extraMoves = [{ weekNo: realWeekNo, blockId, dayOfWeek: 6, startMin: 600, endMin: 660, done: true, source: 'edit' }];
  await page.reload();
  await expect(page.getByTestId('m-changed-banner')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('m-changed-banner')).toContainText('今天的安排有更新');
  // 知道了 → 收起
  await page.getByTestId('m-changed-banner').getByRole('button').click();
  await expect(page.getByTestId('m-changed-banner')).toHaveCount(0);
});

test('同步失败可见：GET 状态 500 → 错误态 + 重试按钮，不进今日页', async ({ page }) => {
  await page.route('**/api/auth/register', (route) =>
    route.fulfill({ json: { userId: 9, token: 'e2e-token-3', icsToken: null } }));
  await page.route('**/api/sync/state', (route) => route.fulfill({ status: 500, json: { error: 'server_error' } }));
  await page.route('**/api/version', (route) => route.fulfill({ status: 404, json: { error: 'version_unavailable' } }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/m.html');
  await page.getByTestId('m-login-user').fill('断网宝');
  await page.getByTestId('m-login-pass').fill('e2e-pass-123');
  await page.getByTestId('m-register-submit').click();
  await expect(page.getByText('同步失败，稍后重试')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
  await expect(page.getByTestId('m-today-list')).toHaveCount(0);
});

test('同步被拒：云端更新时（accepted=false）→ 采纳云端副本 + 状态条「同步失败」', async ({ page }) => {
  await stubApi(page);
  const serverState = () => ({
    schemaVer: 1,
    termStart: '2026-09-07',
    weekNo: 4,
    schedule: DEMO_SCHEDULE,
    planState: null,
    userOverrides: EMPTY_LAYER,
    clientUpdatedAt: new Date().toISOString(),
  });
  // 后注册的 route 优先：PUT 一律被拒（并发写入输给云端），GET 正常
  await page.route('**/api/sync/state', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ json: { accepted: false, updatedAt: new Date().toISOString(), state: serverState() } });
      return;
    }
    await route.fulfill({ json: { found: true, schemaVer: 1, updatedAt: new Date().toISOString(), state: serverState() } });
  });
  await registerAndReady(page);

  // 改一下（顺延 15）触发 debounce 上报 → PUT 被拒 → 采纳云端 → 状态条报「同步失败」
  await page.getByTestId('m-block').first().click();
  await expect(page.getByTestId('m-edit-sheet')).toBeVisible();
  await page.getByTestId('m-shift-15').click();
  await expect(page.getByTestId('m-sync-status')).toContainText('同步失败', { timeout: 15_000 });
});

test('退出登录：清掉本地身份 → 回到登录页', async ({ page }) => {
  await stubApi(page);
  await registerAndReady(page);
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('m-login-user')).toBeVisible({ timeout: 15_000 });
  // 刷新后仍是未登录（身份确实清掉了，不是 UI 假象）
  await page.reload();
  await expect(page.getByTestId('m-login-user')).toBeVisible({ timeout: 15_000 });
});
