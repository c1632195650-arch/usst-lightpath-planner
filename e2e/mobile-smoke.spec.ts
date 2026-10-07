/**
 * 光溯移动端 E2E 冒烟（M2 · 方案 §7.4；M3 新任务三扩充至 8 条）
 * ============================================================
 * 视口 390×844（Mate 40E 量级）。覆盖：
 *   1) 今日页闭环：注册 → 今日块 → 顺延/完成 → PUT 上报（含 schemaVer=2）
 *   2) 空态：云端没计划时给引导
 *   3) 三区 IA：当前块 NowBlock（燃烧条/大按钮）→ 完成直写
 *   4) 最近待办：打勾即完成（不填时间）→ PUT 含 todos
 *   5) 中长期待办：完成**必须**填粗粒度时段（选择器强制）
 *   6) 云端 → 手机：GET 带 todos → 待办卡采纳显示（另一端添加不丢）
 *   7) 梨宝抽屉：SSE 流式渲染 + 关闭后主界面状态不变（排程权已砍，无改计划入口）
 *   8) 通知可见性：web 环境诚实显示页内提醒；一键重排不崩
 *
 * 网络层用 page.route 打桩（GUI 是真实的、后端契约由 _smoke_*_api.py 用真实
 * SQLite+TestClient 覆盖）：/api/* 打桩才能在「不起常驻服务」前提下跑真实浏览器闭环。
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

const nowIso = () => new Date().toISOString();

function stateBody(schedule: unknown, todos: unknown[] = [], goals: unknown[] = []) {
  return {
    found: true,
    schemaVer: 2,
    updatedAt: nowIso(),
    state: {
      schemaVer: 2,
      termStart: '2026-09-07',
      weekNo: 5,
      schedule,
      planState: null,
      userOverrides: EMPTY_LAYER,
      todos,
      goals,
      clientUpdatedAt: nowIso(),
    },
  };
}

async function stubCoreApi(page: Page, opts: { state?: unknown; todos?: unknown[] } = {}) {
  const putStateBodies: Array<Record<string, unknown>> = [];
  const putPlanBodies: Array<Record<string, unknown>> = [];

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
    await route.fulfill({ json: opts.state ?? stateBody(DEMO_SCHEDULE, opts.todos ?? []) });
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

  await page.route('**/api/route/batch*', (route) => route.fulfill({ json: { routes: {} } }));
  await page.route('**/api/version', (route) => route.fulfill({ status: 404, json: { error: 'version_unavailable' } }));

  return { putStateBodies, putPlanBodies };
}

/** M-W1 欢迎页（2026-10-07）：首次打开且未登录时先见品牌页 —— e2e 统一从这里过 */
async function openMobile(page: Page) {
  await page.goto('/m.html');
  // 等首个可判定根元素渲染（欢迎页 / 登录表单 / 今日页），避免与 React 挂载竞态
  await page
    .locator('[data-testid="m-welcome-start"], [data-testid="m-login-user"], [data-testid="m-today-list"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const start = page.getByTestId('m-welcome-start');
  if (await start.isVisible()) await start.click();
}

async function registerAndReady(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMobile(page);
  await page.getByTestId('m-login-user').fill('端到端宝');
  await page.getByTestId('m-login-pass').fill('e2e-pass-123');
  await page.getByTestId('m-register-submit').click();
  await expect(page.getByTestId('m-today-list')).toBeVisible({ timeout: 30_000 });
}

/* ---------------- 1) 既有闭环（M2 原样，含新 IA 适配：引导已折叠） ---------------- */

test('移动今日页闭环：注册 → 今日块渲染 → 顺延/完成写覆盖层 → PUT 上报 schemaVer=2', async ({ page }) => {
  const { putStateBodies, putPlanBodies } = await stubCoreApi(page);
  await registerAndReady(page);

  const firstBlock = page.getByTestId('m-block').first();
  await expect(firstBlock).toBeVisible({ timeout: 30_000 });
  const blockId = await firstBlock.getAttribute('data-block-id');
  expect(blockId, '块 id 必须存在（语义键）').toBeTruthy();
  await expect(page.getByTestId('m-block-title').first()).toContainText(/./);

  // F5 三区 IA：当前块横幅（m-now-banner）与接下来（m-next-banner）至少其一可见
  // （当前块存在时两者并存 → .first() 规避 strict mode 二义性；2026-10-06 深层验收实测抓到的时间相关 flaky）
  await expect(page.getByTestId('m-now-banner').or(page.getByTestId('m-next-banner')).first()).toBeVisible();
  // F7 / F10 节点（F10 已由 M3 WeekBoard 替换 WeekGlance —— 周切换/回到现在/点天展开）
  await expect(page.getByTestId('m-tomorrow')).toBeVisible();
  await expect(page.getByTestId('m-week-board')).toBeVisible();

  // F6/F17 已降级到「提醒与帮助」折叠区（P6-2）：先展开
  await page.getByTestId('m-more-toggle').click();
  await page.getByTestId('m-ics').getByRole('button').first().click();
  await expect(page.getByTestId('m-ics-url')).toHaveValue(/\/api\/sync\/plan\.ics\?token=ics-e2e-token/);
  await expect(page.getByTestId('m-ics-copy')).toBeVisible();

  await page.getByTestId('m-whitelist-toggle').click();
  await expect(page.getByTestId('m-whitelist-guide')).toContainText('华为 / 鸿蒙');

  // F4 顺延 +15：写覆盖层（唯一写法）→ debounce 上报
  await firstBlock.click();
  await expect(page.getByTestId('m-edit-sheet')).toBeVisible();
  await page.getByTestId('m-shift-15').click();
  const layerRaw1 = await page.evaluate(() => localStorage.getItem('usst-user-plan-v1'));
  const layer1 = JSON.parse(layerRaw1 ?? '{}');
  const move = (layer1.moves as Array<Record<string, unknown>>).find((m) => m.blockId === blockId);
  expect(move, '顺延必须落覆盖层 moves').toBeTruthy();
  expect(move?.source).toBe('edit');

  await expect.poll(async () => putStateBodies.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const stateBody1 = putStateBodies[0] as {
    clientUpdatedAt: string; schemaVer: number;
    state: { schemaVer: number; termStart: string; userOverrides: { moves: Array<Record<string, unknown>> } };
  };
  expect(stateBody1.clientUpdatedAt).toBeTruthy();
  expect(stateBody1.schemaVer).toBe(2, 'schemaVer=2（M3-W0 契约）');
  expect(stateBody1.state.termStart).toBe('2026-09-07');
  expect(stateBody1.state.userOverrides.moves.some((m) => m.blockId === blockId)).toBe(true);
  await expect.poll(async () => putPlanBodies.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // F4 完成勾选：done 落覆盖层
  await firstBlock.click();
  await page.getByTestId('m-edit-done').click();
  const layer2 = JSON.parse(await page.evaluate(() => localStorage.getItem('usst-user-plan-v1') ?? '{}'));
  const move2 = (layer2.moves as Array<Record<string, unknown>>).find((m) => m.blockId === blockId);
  expect(move2?.done).toBe(true);
  await expect(firstBlock.getByTestId('m-block-done')).toBeVisible();
});

/* ---------------- 2) 空态（M2 原样） ---------------- */

test('移动空态：云端没计划时给引导（F2 空态分支）', async ({ page }) => {
  await page.route('**/api/auth/register', (route) =>
    route.fulfill({ json: { userId: 8, token: 'e2e-token-2', icsToken: null } }));
  await page.route('**/api/sync/state', (route) => route.fulfill({ json: { found: false, state: null, schemaVer: 2, updatedAt: null } }));
  await page.route('**/api/version', (route) => route.fulfill({ status: 404, json: { error: 'version_unavailable' } }));

  await page.setViewportSize({ width: 390, height: 844 });
  await openMobile(page);
  await page.getByTestId('m-login-user').fill('空空如也');
  await page.getByTestId('m-login-pass').fill('e2e-pass-123');
  await page.getByTestId('m-register-submit').click();
  await expect(page.getByTestId('m-empty-cloud')).toBeVisible({ timeout: 15_000 });
});

/* ---------------- 3) 三区 IA：当前块放大 + 燃烧条 + 大按钮（新任务三 Wave 1） ---------------- */

test('NowBlock 当前块：燃烧条/大标题/两枚大按钮，点「完成」直写不进二级页', async ({ page }) => {
  // 构造「现在正在进行」的块：走覆盖层用户固定任务通道（星期+startMin → 固定块， construct §6.2）
  const now = new Date();
  const dow = ((now.getDay() + 6) % 7) + 1;
  const startMin = Math.max(0, now.getHours() * 60 + now.getMinutes() - 30);
  const liveState = stateBody(DEMO_SCHEDULE);
  (liveState.state as { userOverrides: { tasks: unknown[] } }).userOverrides.tasks = [{
    id: 'e2e-now', title: '背单词', kind: 'study', dayOfWeek: dow,
    startMin, durationMin: 60, priority: 90,
  }];
  await stubCoreApi(page, { state: liveState });
  await registerAndReady(page);

  // 区② 当前块：绝对核心，燃烧条 + 两枚大按钮（1 层交互，不进二级页）
  const banner = page.getByTestId('m-now-banner');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('m-now-title')).toContainText('背单词');
  await expect(page.getByTestId('m-burn-bar')).toBeVisible();
  await expect(page.getByTestId('m-now-done')).toBeVisible();
  await expect(page.getByTestId('m-now-shift')).toBeVisible();

  // 点「完成」：直接生效（不打开 EditSheet 二级页）
  await page.getByTestId('m-now-done').click();
  // 块 id 由重算时的真实周号决定（termStart=2026-09-07 固定，周号随日期走）
  const weekNo = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    - Date.UTC(2026, 8, 7)) / 86_400_000 / 7) + 1;
  const blockId = `w${weekNo}-d${dow}-user-e2e-now`;
  await expect(
    page.locator(`[data-testid="m-block"][data-block-id="${blockId}"]`).getByTestId('m-block-done'),
  ).toBeVisible({ timeout: 10_000 });
});

/* ---------------- 4/5) 待办两分支：最近打勾即完成；中长期必须填时段（Wave 4 · CY 核心） ---------------- */

test('最近待办：记一条 → 点按露出动作 → 打勾即完成（不填时间）→ PUT 带 todos', async ({ page }) => {
  const { putStateBodies } = await stubCoreApi(page);
  await registerAndReady(page);

  await page.getByTestId('m-todo-input').fill('还图书馆的书');
  await page.getByTestId('m-todo-add-recent').click();
  const row = page.getByTestId('m-todo-row').filter({ hasText: '还图书馆的书' });
  await expect(row).toBeVisible();

  // 点按露出动作（左滑的等价桌面路径）→ 完成 → 正反馈，**不要求**填时间
  await row.click();
  await page.getByTestId('m-todo-done-btn').click();
  await expect(page.getByTestId('m-todo-feedback')).toContainText('办完一桩心事');

  // debounce 上行：PUT 请求体 todos 里这条已完成
  await expect.poll(async () => putStateBodies.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const withTodos = putStateBodies.map((b) => b.state as { todos?: Array<Record<string, unknown>> })
    .find((s) => Array.isArray(s.todos) && s.todos.length > 0);
  expect(withTodos, 'PUT 必须携带 todos').toBeTruthy();
  const t = withTodos!.todos!.find((x) => x.title === '还图书馆的书');
  expect(t?.completion).toBe('done');
  expect(t?.actualDoneAt).toBeTruthy();
  expect(t?.plannedDone).toBeUndefined();
});

test('中长期待办：打勾 → 必须填粗粒度时段（选择器拦截）→ 完成 + 记入显示', async ({ page }) => {
  const { putStateBodies } = await stubCoreApi(page);
  await registerAndReady(page);

  await page.getByTestId('m-todo-input').fill('背完六级词');
  await page.getByTestId('m-todo-add-long').click();
  const row = page.getByTestId('m-todo-row').filter({ hasText: '背完六级词' });
  await expect(row).toBeVisible();

  // 点完成 → 弹出粗粒度选择器（不精确到日），必须确认时段才完成
  await row.click();
  await page.getByTestId('m-todo-done-btn').click();
  await expect(page.getByTestId('m-todo-period-picker')).toBeVisible();
  await page.getByTestId('m-todo-period-confirm').click();

  // 正反馈 + 行上显示「已记入：YYYY 年 M 月中旬」
  await expect(page.getByTestId('m-todo-feedback')).toContainText('办完一桩心事');
  const ym = new Date();
  const label = `${ym.getFullYear()} 年 ${ym.getMonth() + 1} 月中旬`;
  await expect(row).toContainText(label);

  await expect.poll(async () => putStateBodies.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const withTodos = putStateBodies.map((b) => b.state as { todos?: Array<Record<string, unknown>> })
    .find((s) => Array.isArray(s.todos) && s.todos.length > 0);
  const t = withTodos!.todos!.find((x) => x.title === '背完六级词');
  expect(t?.completion).toBe('done');
  expect(String(t?.plannedDone)).toMatch(/^\d{4}-\d{2}-(上旬|中旬|下旬)$/, '粗粒度时段，不精确到日');
});

/* ---------------- 6) 云端 → 手机：另一端（网页端）加的待办，GET 采纳显示 ---------------- */

test('云端待办采纳：GET 带 todos → 待办卡显示（两端闭环的数据面）', async ({ page }) => {
  const cloudTodos = [
    { id: 'td-web-1', kind: 'recent', title: '网页端记的事', createdAt: nowIso(), updatedAt: nowIso(), completion: null },
  ];
  const cloudGoals = [
    {
      id: 'g-web-1', title: '拿下六级', createdAt: nowIso(), updatedAt: nowIso(),
      milestones: [{ id: 'ms-1', title: '词汇过 6000', done: false }],
    },
  ];
  await stubCoreApi(page, {
    state: stateBody(DEMO_SCHEDULE, cloudTodos, cloudGoals),
  });
  await registerAndReady(page);

  await expect(page.getByTestId('m-goal-card')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('m-goal-card')).toContainText('网页端记的事');
  await expect(page.getByTestId('m-goal-card')).toContainText('拿下六级');
  await expect(page.getByTestId('m-goal-card')).toContainText('词汇过 6000');
});

/* ---------------- 7) 梨宝抽屉（A1）：SSE 流式 + 排程权已砍 ---------------- */

test('梨宝抽屉：流式渲染回答；抽屉内没有改计划入口；关闭后主界面状态不变', async ({ page }) => {
  await stubCoreApi(page);
  await page.route('**/api/chat/stream', (route) => route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: 'data: {"type":"meta","route":"llm","mode":"llm"}\n\n'
      + 'data: {"type":"delta","text":"宝子，"}\n\n'
      + 'data: {"type":"delta","text":"稳住节奏！"}\n\n'
      + 'data: {"type":"done","sources":[]}\n\n',
  }));
  await registerAndReady(page);

  await page.getByTestId('m-lbao-toggle').click();
  await expect(page.getByTestId('m-drawer')).toBeVisible();
  await page.getByTestId('m-drawer-input').fill('今天状态不好怎么办');
  await page.getByTestId('m-drawer-send').click();
  await expect(page.getByTestId('m-drawer-msg').filter({ hasText: '宝子，稳住节奏！' })).toBeVisible({ timeout: 10_000 });

  // 🔴 排程权已砍：抽屉里没有任何「重排/改计划」按钮
  expect(await page.getByTestId('m-drawer').getByTestId('m-notify-reshuffle').count()).toBe(0);

  // 关抽屉：主界面原样（Today 状态不变）
  await page.getByTestId('m-drawer-close').click();
  await expect(page.getByTestId('m-drawer')).toHaveCount(0);
  await expect(page.getByTestId('m-today-list')).toBeVisible();
});

/* ---------------- 8) 通知可见性（C1）：web 环境诚实口径 + 一键重排不崩 ---------------- */

test('通知可见性：浏览器环境显示「网页版」诚实文案（M5a）；重排按钮可点不崩', async ({ page }) => {
  await stubCoreApi(page);
  await registerAndReady(page);

  const status = page.getByTestId('m-notify-status');
  await expect(status).toBeVisible({ timeout: 15_000 });
  await expect(status).toContainText('当前是网页版', 'web 环境不假装有时点通知（诚实口径，M5a 三段式）');
  await page.getByTestId('m-notify-reshuffle').click();
  await expect(page.getByTestId('m-notify-reshuffle')).toBeEnabled({ timeout: 10_000 });
});

/* ---------------- 9-15) Second 夜批（任务二会话）新增：登录/更新/变化标记/同步异常/退出 ---------------- */

test('移动登录路径：老账号登录（非注册）→ 今日页正常渲染', async ({ page }) => {
  await stubCoreApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openMobile(page);
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
  await openMobile(page);
  await page.getByTestId('m-login-user').fill('输错密码的宝');
  await page.getByTestId('m-login-pass').fill('wrong-pass');
  await page.getByTestId('m-login-submit').click();
  await expect(page.getByTestId('m-login-error')).toContainText('昵称或密码不对');
  await expect(page.getByTestId('m-today-list')).toHaveCount(0);
});

test('F18 检查更新：服务端版本更新 → 出下载横幅（有新版本）', async ({ page }) => {
  await stubCoreApi(page);
  // 后注册的 route 优先：覆盖 stubApi 里的 404 版本桩
  await page.route('**/api/version', (route) =>
    route.fulfill({ json: { version: '9.9.9', apkUrl: 'http://example.com/lightpath-9.9.9.apk' } }));
  await registerAndReady(page);
  await expect(page.getByTestId('m-update')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('m-update').getByRole('link')).toHaveAttribute('href', /lightpath-9\.9\.9\.apk$/);
});

test('F9 变化标记：云端覆盖层变了 → 再次打开出「今天的安排有更新」', async ({ page }) => {
  await stubCoreApi(page);
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
  await openMobile(page);
  await page.getByTestId('m-login-user').fill('断网宝');
  await page.getByTestId('m-login-pass').fill('e2e-pass-123');
  await page.getByTestId('m-register-submit').click();
  await expect(page.getByText('同步失败，稍后重试')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
  await expect(page.getByTestId('m-today-list')).toHaveCount(0);
});

test('同步被拒：云端更新时（accepted=false）→ 采纳云端副本 + 状态条「同步失败」', async ({ page }) => {
  await stubCoreApi(page);
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
  await stubCoreApi(page);
  await registerAndReady(page);
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('m-login-user')).toBeVisible({ timeout: 15_000 });
  // 刷新后仍是未登录（身份确实清掉了，不是 UI 假象）
  await page.reload();
  await expect(page.getByTestId('m-login-user')).toBeVisible({ timeout: 15_000 });
});

/* ============================================================
 * R批 Wave3 评估动线（2026-10-06 收官批次 P0-1c，验收项「E2E 点『评估』
 * 出报告且建议可采纳」——此前 E2E 对评估零覆盖）。
 * 评估入口在桌面端周计划页（plan-eval-entry），故这两条驱动 `/` 走真实
 * onboarding 动线（与 scripts/e2e-sched-session.mjs 的成熟路径同源）；
 * 后端三库复核 /api/plan/review 按「GUI 真实、契约打桩」口径打桩。
 * ============================================================ */

/** 桌面端 onboarding：画像问卷自动作答 → 落主界面（e2e-sched-session 同款） */
async function desktopOnboard(page: Page) {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole('button', { name: '开始画像测评' }).click();
  await page.getByPlaceholder('怎么称呼你').fill('走查生');
  await page.locator('select').first().selectOption('2');
  await page.getByPlaceholder('如：光电学院').fill('光电学院');
  await page.locator('select').nth(1).selectOption('军工路本部');
  await page.getByRole('button', { name: /下一步/ }).click();
  // 问卷自动作答：点可选项直到结果页（advancing 过渡期不能点「下一步」，见 e2e-sched-session 注）
  for (let i = 0; i < 80; i++) {
    if (await page.getByTestId("persona-result-title").isVisible().catch(() => false)) break;
    const opt = page.locator('button[aria-pressed]:enabled').first();
    if (await opt.count()) { await opt.click().catch(() => {}); await page.waitForTimeout(420); continue; }
    const next = page.getByRole('button', { name: /下一步|生成我的画像/ }).first();
    if (await next.count() && await next.isEnabled().catch(() => false)) {
      await next.click().catch(() => {});
      await page.waitForTimeout(420);
    } else {
      await page.waitForTimeout(300);
    }
  }
  await page.getByRole('button', { name: /进入|看看/ }).first().click();
}

/** 桌面端走到「日程」时间轴（总览 → 打开本周安排；W3/P1-5e：子标签已删，不再点「周计划」） */
async function desktopGoWeek(page: Page) {
  const overview = page.getByRole('button', { name: '总览' });
  if (await overview.count()) { await overview.first().click(); }
  const open = page.getByRole('button', { name: '打开本周安排' });
  if (await open.count()) { await open.first().click(); }
  await expect(page.getByTestId('week-timeline')).toBeVisible({ timeout: 20_000 });
}

test('W3：总览点某天 → 进「日程」并高亮该天；「周计划」子标签不再存在', async ({ page }) => {
  await desktopOnboard(page);
  await page.getByRole('button', { name: '总览' }).click();

  // 总览七天条里点周三（aria-label 以 ISO 日期开头，取本周的周三）
  const wednesday = await page.evaluate(() => {
    const d = new Date();
    const off = (d.getDay() + 6) % 7; // 0 = 周一
    d.setDate(d.getDate() - off + 2); // 周三
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await page.locator(`button[aria-label^="${wednesday}"]`).first().click();

  // 进了「日程」页且该天带「你点的那天」角标
  await expect(page.getByTestId('week-timeline')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('focus-day-you-clicked')).toBeVisible({ timeout: 10_000 });

  // 子标签按钮已删：全页不存在「周计划」按钮
  await expect(page.getByRole('button', { name: '周计划' })).toHaveCount(0);
});

test('评估动线①：周计划 → 点评估 → 五维分数渲染 → 展开某维「看依据」可读', async ({ page }) => {
  // 2026-10-08：离线分支改为**确定性打桩**（此前靠「8001 无后端」的环境假设 ——
  // CY 的 dev 后端常驻时 preview 代理会连通它，离线说明永不出现，用例在本机假红）。
  // route.abort() 产生的网络失败与连接被拒走同一条 fetch reject 路径，断言不变。
  await page.route('**/api/plan/review', (route) => route.abort());

  await desktopOnboard(page);
  await desktopGoWeek(page);

  // 入口在 issue 聚合条之后、时间轴之前；手动展开（评估不自动弹）
  await page.getByTestId('plan-eval-entry').locator('summary').click();
  const panel = page.getByTestId('plan-eval-panel');
  await expect(panel).toBeVisible({ timeout: 20_000 });

  // 五维分数渲染：每个维度一行，分数或「—」（unknown 如实展示，不冒充 0）
  const dims = page.locator('[data-testid^="plan-eval-dim-"]');
  await expect(dims).not.toHaveCount(0);
  const dimCount = await dims.count();
  if (dimCount < 2) throw new Error(`评估维度应 ≥2，实际 ${dimCount}`);

  // 后端未起 → 复核区如实显示离线说明（不冒充真检索）
  await expect(page.getByTestId('plan-review-offline')).toBeVisible({ timeout: 20_000 });

  // 展开某维的「看依据（N个块）」→ 依据内容可读
  const toggle = page.locator('[data-testid^="plan-eval-toggle-"]').first();
  await toggle.click();
  await expect(page.locator('[data-testid^="plan-eval-detail-"]').first()).toBeVisible();
});

test('评估动线②：有 gap 的语料 → 复核建议出「采纳」→ 进入重排草稿流（不断言直接改表）', async ({ page }) => {
  // 打桩后端复核：运动维度 gap → 建议带 add_task 骨架（采纳按钮的来源）
  await page.route('**/api/plan/review', (route) =>
    route.fulfill({
      json: {
        ok: true, user_id: 'e2e', week_no: 5, generated_at: nowIso(),
        dimensions: [{
          key: 'exercise', label: '运动', coverage: 1,
          findings: [],
          advice: [{
            text: '本周中高强度运动低于 150 分钟，先补一次 30 分钟快走。',
            source: { lib: '健康库', slug: 'aerobic-150', tier: 'A', quote: '每周至少 150 分钟中等强度有氧', retrieved: true },
            action: { kind: 'add_task', task: { title: '快走 30 分钟', kind: 'activity', durationMin: 30 } },
          }],
        }],
        retrieval: { health: true }, caveats: ['复核为对照真库的增强层，判定以前端 digest 为准。'],
      },
    }));

  await desktopOnboard(page);
  await desktopGoWeek(page);

  await page.getByTestId('plan-eval-entry').locator('summary').click();
  const backend = page.getByTestId('plan-review-backend');
  await expect(backend).toBeVisible({ timeout: 20_000 });
  // 复核建议收在 <details> 里 —— 展开才能看到「采纳」
  await backend.locator('summary').click();

  // 点「采纳」→ 任务进覆盖层草稿（layer.tasks），toast 明说「重排后」才上表
  await page.getByTestId('plan-review-adopt').first().click();
  await expect(page.getByText(/已加入「快走 30 分钟」/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/重排后会标注 🆕/)).toBeVisible({ timeout: 15_000 });

  // 草稿流证据：覆盖层里确有这条任务（不断言日程表直接变化 —— L4：重排才生效）
  const layerHasTask = await page.evaluate(() => {
    const raw = localStorage.getItem('usst-user-plan-v1');
    return !!raw && raw.includes('快走 30 分钟') && raw.includes('采纳自日程评估');
  });
  if (!layerHasTask) throw new Error('采纳后覆盖层（草稿）里应有该任务');
});
