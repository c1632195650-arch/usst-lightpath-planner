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
  expect(stateBody.state.schemaVer).toBe(1);
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
