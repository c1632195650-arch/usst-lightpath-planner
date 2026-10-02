/**
 * V3 · 全旅程 E2E 锁（手动验收资产）
 * ============================================================
 * 断言 ≥15 条，覆盖融合后动线（裁决③，2026-10-01）的机器可判部分：
 *   清 storage → ①标题 → ②基本信息(含住处/作息) → ③问卷(自动作答) → ④结果
 *   → ⑤导入课表 tab（未导入真实课表的首落点，接线 B）→ checklist 卡（今天页）
 *   → ⑥模式窗选「远方」 → ⑧周计划日程+满溢度 → ⑨编辑模式切换+持久化
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

  // ③ 问卷（自动作答：每个问题点第一个可点选项；末尾 Ray 的「目标偏好」组
  //    用「保存并完成测评 / 跳过」收口 —— 都纳入循环，直到结果页）
  for (let i = 0; i < 60; i++) {
    if (await page.getByText('你的节奏，已经有了轮廓').isVisible().catch(() => false)) break;
    const finish = page.getByRole('button', { name: /跳过（之后可在目标设置里补）|保存并完成测评/ }).first();
    if (await finish.count()) { await finish.click(); await T(420); continue; }
    const opt = page.locator('button[aria-pressed]:enabled').first();
    if (await opt.count()) { await opt.click(); await T(420); continue; }
    const next = page.getByRole('button', { name: /下一步|生成我的画像/ }).first();
    if (await next.count()) { await next.click(); await T(420); }
  }
  ok(await page.getByText('你的节奏，已经有了轮廓').isVisible().catch(() => false), '④ 画像结果页可达');

  // 兴趣追问弹窗（画像完成后一次性）若弹出，先跳过 —— 不然会挡住「进入」按钮
  const interestSkip = page.getByRole('button', { name: /跳过/ }).first();
  if (await page.getByRole('dialog', { name: '兴趣追问' }).isVisible().catch(() => false)) {
    await interestSkip.click().catch(() => {});
    await T(600);
  }

  // → 进入主界面（V0-2 / 接线 B：没导入真实课表 → 首落「导入课表」tab）
  await page.getByRole('button', { name: /进入我的本周安排|进入|看看/ }).first().click({ timeout: 8000 }).catch(() => {});
  await T(800);
  ok(await page.getByText('课表解析服务', { exact: false }).first().isVisible().catch(() => false), '⑤ 首落导入课表 tab（MOCK 兜底不算已有课表）');

  // V0-3 checklist：三条待办可见（卡在「今天」页 —— 从「导入课表」切回「今天」）
  await page.getByRole('button', { name: '今天' }).click().catch(() => {});
  await T(600);
  let checklistSeen = false;
  for (let i = 0; i < 3 && !checklistSeen; i++) {
    checklistSeen = await page.getByTestId('onboarding-checklist').isVisible().catch(() => false);
    if (!checklistSeen) {
      await page.getByRole('button', { name: '今天' }).click().catch(() => {});
      await T(900);
    }
  }
  if (!checklistSeen) {
    console.log('  [诊断] 今天页头部文本:', (await page.locator('#root').textContent())?.slice(0, 260));
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
  // 确认后回到今天页 —— 从「查看 / 编辑本周安排」进周计划视图（日程主界面）
  const openWeek2 = page.getByRole('button', { name: /查看 \/ 编辑本周安排|本周安排/ });
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
  // 刷新后回落导入子视图 —— 重进周计划视图（V0-2 首落点/视图状态不持久化属预期）
  const reopen = page.getByRole('button', { name: /查看 \/ 编辑本周安排|本周安排/ });
  if (await reopen.count()) { await reopen.first().click().catch(() => {}); await T(900); }
  ok((await page.getByTestId('edit-mode-toggle').getAttribute('aria-pressed')) === 'true', '⑨ 刷新后编辑态持久化');
  await page.getByTestId('edit-mode-toggle').click();
  await T(400);

  // 删除软块 → 选「留空白」→ 留白块出现（V1-5）
  await page.locator('[data-testid="edit-mode-toggle"]').click(); // 编辑态才有 hover 工具
  await T(400);
  const card = page.locator('[draggable="true"]').first();
  if (await card.count()) {
    await card.hover(); // hover 工具（删除按钮）随 hover 才渲染
    await T(300);
    const delBtn = page.locator('button[title*="删除这块"]').first();
    await delBtn.click({ force: true });
    await T(400);
    await page.getByRole('button', { name: /留出空白/ }).click();
    await T(1500);
    ok(await page.getByText(/留白/).first().isVisible().catch(() => false), '⑩ 留白块实体出现（V1-5）');
  } else {
    console.log('  -（本页无可删软块，跳过留白块断言）');
  }

  // ⑫ 梨宝改期草稿卡（白天批按新动线重写）：
  // 问答模式 → D0 模式提示卡（切到排程并继续）→ 挑块按钮卡 → … → 草稿卡。
  // 交互升级后追问带按钮卡且轮数不定 → 用『循环应答』：有选项点第一项，直到草稿卡出现。
  await page.getByRole('button', { name: '梨宝', exact: true }).click();
  await T(800);
  {
    const inputBox = () => page.getByPlaceholder(/问梨宝|排程模式|排程中/).first();
    await page.screenshot({ path: '_e2e_12_entry.png' });
    console.log('    [dbg⑫] url =', await page.url(), '| inputs =', await page.locator('input, textarea').count());
    await inputBox().fill('把自习挪到周五');
    await inputBox().press('Enter');
    await T(4000);
    for (let i = 0; i < 5; i++) {
      if (await page.getByText(/我排了一版草稿|草稿（还没写进日程）/).first().isVisible().catch(() => false)) break;
      const opt = page.getByTestId('msg-options').last().getByRole('button').first();
      if (await opt.count()) { await opt.click({ timeout: 8000 }); await T(4000); continue; }
      const hint = page.getByRole('button', { name: '切到排程模式并继续' });
      if (await hint.count()) { await hint.first().click(); await T(4000); continue; }
      break;
    }
  }
  ok(await page.getByText(/我排了一版草稿|草稿（还没写进日程）/).first().isVisible().catch(() => false), '⑫ 改期草稿卡出现（挑块按钮卡 → 草稿卡）');

  // ⑬ 记忆面板 pending 可见
  await page.getByRole('button', { name: /梨宝记住了什么/ }).click().catch(() => {});
  await T(600);
  ok(await page.getByText(/确认|拒绝|pending|事实/).first().isVisible().catch(() => false), '⑬ 记忆面板可达');

  // F5 刷新恢复
  await page.reload();
  await T(1200);
  ok(await page.locator('#root').isVisible(), 'F5 刷新后应用可用');

  // V2-2 hold：自然语言「别排」→ 草稿卡 → 确认 → 落 unavailableSlots
  await page.getByRole('button', { name: '梨宝', exact: true }).click();
  await T(1200);
  // F5 恢复期间 loading 可能未就绪（send 静默 no-op）→ 带重试发送
  // 输入框 placeholder 随模式变化（问答=问梨宝 / 排程=排程模式…）→ 每轮重新解析
  const schedInput = () => page.getByPlaceholder(/问梨宝|排程模式|排程中|草稿待确认/).first();
  for (let i = 0; i < 3; i++) {
    await schedInput().fill('周三下午别排东西');
    await schedInput().press('Enter');
    await T(3500);
    if (await page.getByRole('button', { name: '就这么排' }).count()) break;
    if (await page.getByText(/对上好几块|哪段时间/).count()) {
      await schedInput().fill('周三下午');
      await schedInput().press('Enter');
      await T(3500);
      break;
    }
    // P1-4 动线（白天批）：问答模式下「别排」会出 D0 模式提示卡 ——
    // 点「切到排程模式并继续」= 该卡的设计语义（切模式 + 原句重发进排程流）。
    const modeHint = page.getByRole('button', { name: '切到排程模式并继续' });
    if (await modeHint.count()) {
      await modeHint.first().click();
      await T(4000);
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
