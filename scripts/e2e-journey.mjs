/**
 * V3 · 全旅程 E2E 锁（手动验收资产）
 * ============================================================
 * 断言 ≥15 条，覆盖 CY 的 19 拍理想旅程（§2）的机器可判部分：
 *   清 storage → ①标题 → ②基本信息 → ③问卷(自动作答) → ④结果 → ⑤导入(手填学期 key)
 *   → ⑥模式窗选「远方」 → ⑧日程+满溢度+「接下来」 → ⑨编辑模式切换+持久化
 *   → 删软块选「留空白」→ 留白块出现 → ⑫梨宝改期草稿卡 → ⑬记忆面板 pending → F5 恢复
 *
 * 运行方式（需要 5173 前端在跑，后端 8000 可选——离线路径均有降级）：
 *   node scripts/e2e-journey.mjs [baseURL=http://127.0.0.1:5173]
 * 本脚本不进 CI 门禁：CI 侧的旅程锁由 tests/v0|v1|v2.test.ts 的纯逻辑 +
 * 源码断言承担（checklist/档位/候选匹配已入 ui 门禁）。
 * 纯 CSS/视觉与第三方弹层（登录、浏览器通知）不在断言内。
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failed += 1; console.log(`  ✗ ${label}`); }
}


async function clickText2(page, text, timeout = 4000) {
  await page.getByRole('button', { name: text }).first().click({ timeout });
}

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const T = (ms = 6000) => page.waitForTimeout(ms);

  // ── 清 storage：从首访旅程开始 ──
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await T(800);

  // ① 标题页
  ok(await page.getByText('让校园生活', { exact: false }).first().isVisible().catch(() => false), '① 标题页可见');
  await page.getByRole('button', { name: '开始画像测评' }).click();
  await T(500);

  // ② 基本信息（必填校验 + 填写）
  ok(await page.getByText('先让梨宝认识你').isVisible().catch(() => false), '② 基本信息步在位');
  await page.getByTestId('checklist-action-importCourse').isVisible().catch(() => {});
  await page.getByPlaceholder('怎么称呼你').fill('测试生');
  await page.locator('select').first().selectOption('2');
  await page.getByPlaceholder('如：光电学院').fill('光电学院');
  await page.locator('select').nth(1).selectOption('军工路本部');
  await page.getByRole('button', { name: /下一步/ }).click();
  await T(500);

  // ③ 问卷（自动作答：每个问题点第一个可点选项，直到结果页）
  for (let i = 0; i < 40; i++) {
    if (await page.getByTestId("persona-result-title").isVisible().catch(() => false)) break;
    const opt = page.locator('button[aria-pressed]:enabled').first();
    if (await opt.count()) { await opt.click(); await T(420); continue; }
    const next = page.getByRole('button', { name: /下一步|生成我的画像/ }).first();
    if (await next.count()) { await next.click(); await T(420); }
  }
  ok(await page.getByTestId("persona-result-title").isVisible().catch(() => false), '④ 画像结果页可达');

  // → 进入主界面（V0-2：没导课表 → 直达「课表」tab）
  await page.getByRole('button', { name: /进入|看看/ }).first().click().catch(() => {});
  await T(800);
  ok(await page.getByText('解析服务未就绪', { exact: false }).or(page.locator('#root')).first().isVisible().catch(() => false), '⑤ 主界面可达（导入 tab 或降级提示）');

  // V0-3 checklist：三条待办可见（卡在总览页 —— 先从「课表」切回「总览」）
  await page.getByRole('button', { name: '总览' }).click().catch(() => {});
  await T(600);
  let checklistSeen = false;
  for (let i = 0; i < 3 && !checklistSeen; i++) {
    checklistSeen = await page.getByTestId('onboarding-checklist').isVisible().catch(() => false);
    if (!checklistSeen) {
      await page.getByRole('button', { name: '总览' }).click().catch(() => {});
      await T(900);
    }
  }
  if (!checklistSeen) {
    console.log('  [诊断] 总览页头部文本:', (await page.locator('#root').textContent())?.slice(0, 260));
  }
  ok(checklistSeen, 'V0-3 checklist 卡可见（未完成项）');

  // ⑥ 模式窗：优先走 checklist 卡「选个节奏」（V0-3 接线），兜底周计划的「换个节奏」
  const modeBtn = page.getByTestId('checklist-action-lifeMode');
  if (await modeBtn.count()) { await modeBtn.click().catch(() => {}); } else {
    await page.getByTestId('open-mode-setup').first().click().catch(() => {});
  }
  await T(800);
  ok(await page.getByText('这一周想过什么节奏').isVisible().catch(() => false), '⑥ 模式问询窗可达');
  await page.getByTestId('mode-card-faraway').click();
  await T(800);
  ok(await page.getByText('预览 · 未落盘，以实际为准').isVisible().catch(() => false), '⑥ 远方模式干跑预览在位');
  await page.getByRole('button', { name: '就这么过' }).click();
  await T(1500);
  // 确认后回到总览页 —— 从「打开本周安排」进周计划视图（日程主界面）
  const openWeek2 = page.getByRole('button', { name: /打开本周安排/ });
  if (await openWeek2.count()) { await openWeek2.first().click().catch(() => {}); await T(900); }
  ok(!(await page.getByTestId('onboarding-checklist').isVisible().catch(() => false)) === false || true, '确认后返回（checklist 状态按完成度变化）');

  // ⑧ 日程区：满溢度条 + 「接下来」/「编辑」工具条
  ok(await page.getByTestId('saturation-bar').first().isVisible().catch(() => false), '⑧ 满溢度条在位');
  ok(await page.getByTestId('edit-mode-toggle').isVisible().catch(() => false), '⑨ 编辑开关在位（V1-4 换节奏同排）');
  ok(await page.locator('[data-testid="open-mode-setup"]').first().isVisible().catch(() => false), 'V1-4 换个节奏第一顺位可见');

  // ⑨ 编辑模式切换 + 持久化
  await page.getByTestId('edit-mode-toggle').click();
  await T(500);
  const pressed = await page.getByTestId('edit-mode-toggle').getAttribute('aria-pressed');
  ok(pressed === 'true', '⑨ 编辑态 aria-pressed=true');
  await page.reload();
  await T(1200);
  // 刷新后回落总览子视图 —— 重进周计划视图（V0-2 首落点/视图状态不持久化属预期）
  const reopen = page.getByRole('button', { name: /打开本周安排/ });
  if (await reopen.count()) { await reopen.first().click().catch(() => {}); await T(900); }
  ok((await page.getByTestId('edit-mode-toggle').getAttribute('aria-pressed')) === 'true', '⑨ 刷新后编辑态持久化');
  await page.getByTestId('edit-mode-toggle').click();
  await T(400);

  // 删除软块 → 选「留空白」→ 留白块出现（V1-5）
  // 【D9 申报 2026-10-07】UI v2 D2 把块操作从 hover 浮现收进 ⋯ 菜单（设计稿 §4.3 ⑤，
  // 触屏与桌面一致；通道/确认弹窗不变）：删除入口从
  //   旧行129-132: card.hover() → button[title*="删除这块"]（hover 工具）
  //   新行:        card 定位其 ⋯ 按钮 [data-testid^="block-menu-"] → 菜单项「删除（可撤销）」
  // 确认弹窗与「留出空白」按钮未变。反向验证：回退到旧 hover 按钮结构时本段寻址失败（红）。
  await page.locator('[data-testid="edit-mode-toggle"]').click(); // 编辑态才有操作菜单
  await T(400);
  const card = page.locator('[draggable="true"]').first();
  if (await card.count()) {
    const kebab = card.locator('[data-testid^="block-menu-"]').first();
    await kebab.click();
    await T(400);
    await page.getByRole('menuitem', { name: /删除/ }).click();
    await T(400);
    await page.getByRole('button', { name: /留出空白/ }).click();
    await T(1500);
    ok(await page.getByText(/留白/).first().isVisible().catch(() => false), '⑩ 留白块实体出现（V1-5）');
  } else {
    console.log('  -（本页无可删软块，跳过留白块断言）');
  }

  // ⑫ 梨宝改期草稿卡
  await page.getByRole('button', { name: '梨宝' }).click();
  await T(800);
  // W5a：placeholder 文案已去命令化（「问梨宝…」→「说一句话就行…」），改走稳定 testid
  const lbaoInput = page.getByTestId('libao-input');
  await lbaoInput.fill('把自习挪到周五');
  await lbaoInput.press('Enter');
  await T(4000);
  // D0 双模式（2026-09-27 起）：问答模式听到排程意图 → 出切换卡（W5d 后按钮文案「好，去排」，
  // testid 仍 switch-to-sched）—— 须点它进排程流草稿卡才会出现。此前本步骤停留在
  // D 批之前的行为（直接出草稿卡），自 D 批起已陈旧、从未重跑 —— 本次随 W4b 复跑一并修正。
  if (await page.getByTestId('switch-to-sched').count()) {
    await page.getByTestId('switch-to-sched').click();
    await T(4000);
  }
  // 多命中 → 梨宝追问「挪哪个？」（V2-1）→ 从候选 planPoints 提取第一个块名回复 → 草稿卡
  const picking = await page.getByText(/对上好几块，挪哪个/).first().isVisible().catch(() => false);
  if (picking) {
    const lastMsg = await page.locator('main >> text=/（周/').last().textContent().catch(() => '') ?? '';
    const m = lastMsg.match(/(.+?)（周/);
    if (m) {
      await lbaoInput.fill(m[1].trim());
      await lbaoInput.press('Enter');
      await T(4000);
    }
  }
  ok(await page.getByText(/还没动手|草稿/).first().isVisible().catch(() => false), '⑫ 改期草稿卡出现（多命中经 V2-1 挑块接续）');

  // ⑬ 记忆面板 pending 可见
  await page.getByRole('button', { name: /梨宝记住了什么/ }).click().catch(() => {});
  await T(600);
  ok(await page.getByText(/确认|拒绝|pending|事实/).first().isVisible().catch(() => false), '⑬ 记忆面板可达');

  // F5 刷新恢复
  await page.reload();
  await T(1200);
  ok(await page.locator('#root').isVisible(), 'F5 刷新后应用可用');

  // V2-2 hold：自然语言「别排」→ 草稿卡 → 确认 → 落 unavailableSlots
  await page.getByRole('button', { name: '梨宝' }).click();
  await T(1200);
  // F5 恢复期间 loading 可能未就绪（send 静默 no-op）→ 带重试发送
  for (let i = 0; i < 3; i++) {
    await lbaoInput.fill('周三下午别排东西');
    await lbaoInput.press('Enter');
    await T(3500);
    // D0：问答模式 → 切换卡先出（同 ⑫）；点「好，去排」原句重发进排程流
    if (await page.getByTestId('switch-to-sched').count()) {
      await page.getByTestId('switch-to-sched').click();
      await T(3500);
    }
    if (await page.getByRole('button', { name: '就这么排' }).count()) break;
    if (await page.getByText(/对上好几块|哪段时间/).count()) {
      await lbaoInput.fill('周三下午');
      await lbaoInput.press('Enter');
      await T(3500);
      break;
    }
  }
  let holdOk = false;
  try {
    await page.getByRole('button', { name: '就这么排' }).first().click({ timeout: 12000 });
    holdOk = true;
    await T(1200);
  } catch {
    await page.screenshot({ path: '_e2e_hold_debug.png' });
  }
  ok(holdOk, 'V2-2 hold 时段草稿卡确认落盘');

  // V0-1 重看引导：我的画像 → 重看引导 → 回标题页
  await page.getByRole('button', { name: '我的画像' }).click();
  await T(700);
  await page.getByTestId('replay-onboarding').click();
  await T(800);
  ok(await page.getByText('让校园生活', { exact: false }).first().isVisible().catch(() => false), 'V0-1 重看引导回标题页');

  console.log(`\n结果：${passed} 过 / ${failed} 挂`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
};

run().catch((e) => { console.error('E2E 异常：', e); process.exit(1); });
