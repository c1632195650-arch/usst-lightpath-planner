/**
 * 任务四 · 网页端待办工作区 E2E 冒烟（M4-W2 · 2 条）
 * ============================================================
 *   1) 网页端建待办 → PUT 上行（schemaVer=2 逐项 LWW 契约体）→ 刷新后云端仍在
 *   2) 移动端写的待办 → 网页端读到 → 补长文本 note + 标签 → PUT 回写不丢移动端字段
 *
 * 与 mobile-smoke 同纪律：GUI 是真实的（真点击/真输入/真渲染），
 * /api/* 打桩（服务端契约由 tests/syncContract.test.ts + server 端测试覆盖）。
 * 打桩的 GET 会**记住** PUT 进来的 todos/goals —— 模拟云端持久化。
 */
import { test, expect, type Page } from '@playwright/test';

const DEMO_SCHEDULE = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: '2026-09-07',
  totalWeeks: 20,
  source: 'demo',
  courses: [],
};

const EMPTY_LAYER = {
  schemaVersion: 2,
  tasks: [], excluded: [], moves: [], slots: [],
  courseOverrides: [], mealPlaces: {}, assignments: [],
};

const nowIso = () => new Date().toISOString();

interface ServerMemo {
  todos: Array<Record<string, unknown>>;
  goals: Array<Record<string, unknown>>;
}

/** 打桩：GET 返回当前 serverMemo（PUT 会更新它 = 模拟云端持久化），PUT 全部记入 putBodies */
async function stubSyncApi(page: Page, serverMemo: ServerMemo) {
  const putBodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/sync/state', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      const body = req.postDataJSON() as { state?: { todos?: unknown[]; goals?: unknown[] } };
      putBodies.push(body as Record<string, unknown>);
      // 模拟服务端 MERGED_ARRAY_KEYS 并集语义（测试里简化为整体替换，契约由 syncContract 测试锁）
      serverMemo.todos = (body.state?.todos ?? []) as Array<Record<string, unknown>>;
      serverMemo.goals = (body.state?.goals ?? []) as Array<Record<string, unknown>>;
      await route.fulfill({ json: { accepted: true, updatedAt: nowIso() } });
      return;
    }
    await route.fulfill({
      json: {
        found: true,
        schemaVer: 2,
        updatedAt: nowIso(),
        state: {
          schemaVer: 2,
          termStart: '2026-09-07',
          weekNo: 5,
          schedule: DEMO_SCHEDULE,
          planState: null,
          userOverrides: EMPTY_LAYER,
          todos: serverMemo.todos,
          goals: serverMemo.goals,
          clientUpdatedAt: nowIso(),
        },
      },
    });
  });
  // 周边接口：网页端其他 tab 可能触发，与待办无关，静默兜底
  await page.route('**/api/route/batch*', (route) => route.fulfill({ json: { routes: {} } }));
  await page.route('**/api/version', (route) => route.fulfill({ status: 404, json: { error: 'version_unavailable' } }));
  await page.route('**/my_schedule.json', (route) => route.fulfill({ status: 404, json: {} }));
  return putBodies;
}

/** 预置登录态（memo 面板凭 token 走云通道；App.tsx 的 webSync 钩子开关不开 = 零网络）。
 *  同时预置 onboarded=true —— 全新浏览器上下文会落在欢迎页，主界面（含待办 tab）不渲染。 */
async function gotoWebWithIdentity(page: Page, path = '/') {
  await page.addInitScript(() => {
    localStorage.setItem('usst.mobile.token', 'e2e-web-token');
    localStorage.setItem('usst.mobile.user', JSON.stringify({ userId: 7, username: '网页端宝' }));
    localStorage.setItem('usst-life-assistant-v2', JSON.stringify({ onboarded: true, selectedDays: [] }));
  });
  await page.goto(path);
}

test('网页端建待办 → PUT 上行 → 刷新后云端仍在（持久化闭环）', async ({ page }) => {
  const serverMemo: ServerMemo = { todos: [], goals: [] };
  const putBodies = await stubSyncApi(page, serverMemo);
  await gotoWebWithIdentity(page);

  // 进入待办工作区
  await page.getByRole('button', { name: '待办' }).click();
  await expect(page.getByTestId('memo-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('memo-sync-state')).toContainText('已同步', { timeout: 15_000 });

  // S3d：待办→日程闭环 —— 起点是 0 条，状态条诚实说「还没进本周计划」
  await expect(page.getByTestId('memo-plan-link')).toContainText('待办还没进本周计划', { timeout: 15_000 });

  // 新建一条最近待办
  await page.getByTestId('memo-add').click();
  await page.getByTestId('todo-editor-title').fill('买考研英语真题');
  await page.getByTestId('todo-editor-submit').click();

  // 列表即时可见（乐观渲染来自云端读改写返回）
  await expect(page.getByTestId('todo-list')).toContainText('买考研英语真题', { timeout: 15_000 });

  // S3d：加待办后状态条计数 +1（与 WeekPlanView 的 todosToPendingTodos 同源口径）
  await expect(page.getByTestId('memo-plan-link')).toContainText('本次排程带上了 1 条待办', { timeout: 15_000 });

  // PUT 上行：契约体 = { state(含 todos), schemaVer: 2, clientUpdatedAt }
  await expect.poll(() => putBodies.length, { message: '至少一次 PUT' }).toBeGreaterThanOrEqual(1);
  const memoPut = putBodies.find((b) => Array.isArray((b.state as { todos?: unknown[] })?.todos)
    && ((b.state as { todos?: unknown[] }).todos as Array<{ title?: string }>).some((t) => t.title === '买考研英语真题'));
  expect(memoPut, 'PUT 请求体必须带上新建的待办').toBeTruthy();
  expect(memoPut?.schemaVer).toBe(2);
  expect(typeof memoPut?.clientUpdatedAt).toBe('string');

  // 刷新 → 云端（打桩已"存"下这条）→ 面板仍显示
  await page.reload();
  await page.getByRole('button', { name: '待办' }).click();
  await expect(page.getByTestId('memo-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('todo-list')).toContainText('买考研英语真题', { timeout: 15_000 });
  // S3a：已登录但尚未排进计划 → 条目级状态 chip 给出口（不再零提示）
  await expect(page.getByTestId('memo-todo-sched-state').first()).toContainText('未排进本周', { timeout: 15_000 });
});

test('移动端写的待办 → 网页端读到并可补 note/标签 → PUT 不丢移动端字段', async ({ page }) => {
  // 云端已有手机端写的两条（一条长期未完成、一条最近待办）
  const serverMemo: ServerMemo = {
    todos: [
      { id: 'td-mobile-1', kind: 'longterm', title: '读完《学习之道》', createdAt: '2026-10-05T02:00:00.000Z', updatedAt: '2026-10-05T02:00:00.000Z', completion: null },
      { id: 'td-mobile-2', kind: 'recent', title: '预约图书馆', createdAt: '2026-10-05T03:00:00.000Z', updatedAt: '2026-10-05T03:00:00.000Z', completion: null },
    ],
    goals: [],
  };
  const putBodies = await stubSyncApi(page, serverMemo);
  await gotoWebWithIdentity(page);

  await page.getByRole('button', { name: '待办' }).click();
  await expect(page.getByTestId('memo-panel')).toBeVisible({ timeout: 15_000 });

  // 移动端写的待办出现在网页端（跨端读取）
  await expect(page.getByTestId('todo-item-td-mobile-1')).toContainText('读完《学习之道》', { timeout: 15_000 });
  await expect(page.getByTestId('todo-item-td-mobile-2')).toBeVisible();

  // 网页端专属能力：补长文本 note + 标签
  await page.getByTestId('todo-edit-td-mobile-1').click();
  await expect(page.getByTestId('todo-editor')).toBeVisible();
  await page.getByTestId('todo-editor-note').fill('第 4 章最重要，配合习题集');
  await page.getByTestId('todo-editor-tags').fill('读书，备考');
  await page.getByTestId('todo-editor-submit').click();

  // PUT 回写：note/tags 上行，且移动端字段（id/kind/createdAt）不丢。
  // ⚠️ 挂载时面板自己会发一次"读-改-写"PUT（内容不变）——不能拿"最后一次 PUT"
  //    当编辑结果，要轮询到**带 note 的那条**待办出现在 PUT 体里。
  const todosOf = (b: Record<string, unknown>) =>
    (b as { state?: { todos?: Array<Record<string, unknown>> } }).state?.todos ?? [];
  let memoPutWithNote: Record<string, unknown> | undefined;
  await expect.poll(() => {
    const hits = putBodies
      .flatMap((b) => todosOf(b))
      .filter((t) => t.id === 'td-mobile-1' && t.note !== undefined);
    memoPutWithNote = hits[hits.length - 1];
    return memoPutWithNote ? 1 : 0;
  }, { timeout: 15_000, message: '编辑后的 PUT（含 note）必须上行' }).toBeGreaterThanOrEqual(1);
  const patched = memoPutWithNote as Record<string, unknown>;
  expect(patched.note).toBe('第 4 章最重要，配合习题集');
  expect(patched.tags).toEqual(['读书', '备考']);
  expect(patched.kind).toBe('longterm');
  expect(patched.createdAt).toBe('2026-10-05T02:00:00.000Z');

  // 另一条（没动过的）也仍在 PUT 体里（整数组上行，服务端按 id 合并）
  expect(todosOf(putBodies[putBodies.length - 1]).some((t) => t.id === 'td-mobile-2')).toBe(true);

  // 界面回显 note 与标签
  await expect(page.getByTestId('todo-item-td-mobile-1')).toContainText('第 4 章最重要', { timeout: 15_000 });
  await expect(page.getByTestId('todo-item-td-mobile-1')).toContainText('#读书');
});
